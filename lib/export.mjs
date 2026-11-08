import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  PACKAGE_ROOT,
  copyTree,
  defaultCopyFilter,
  dirStats,
  formatBytes,
  isPathInside,
  listFiles,
  nowStamp,
  packageDirName,
  parseRepository,
  pathExists,
  readJsonSafe,
  sha256File,
  writeJsonAtomic,
  writeTextAtomic,
} from './util.mjs';
import {
  PorterError,
  buildDependencyClosure,
  collectLocalDocs,
  getDshVersion,
  profileName,
  readPackageAt,
  readProfile,
} from './profile.mjs';

export const EXPORT_SCHEMA = 'dsh-plugin-porter/export@1';
export const CHECKSUM_SCHEMA = 'dsh-plugin-porter/checksums@1';

const REMOTE_DOC_CANDIDATES = ['README.md', 'readme.md', 'README.zh-CN.md', 'README.zh.md'];

async function uniqueTargetDir(parent, stamp) {
  let name = `dsh-plugin-porter-export-${stamp}`;
  let candidate = path.join(parent, name);
  let index = 2;
  while (await pathExists(candidate)) {
    name = `dsh-plugin-porter-export-${stamp}-${index}`;
    candidate = path.join(parent, name);
    index += 1;
  }
  return candidate;
}

function runProcess(command, args, extraEnv, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    let child;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      try {
        child?.kill();
      } catch {
        // ignore
      }
      finish({ ok: false, reason: 'timeout' });
    }, timeoutMs);
    try {
      child = spawn(command, args, {
        env: { ...process.env, ...extraEnv },
        stdio: 'ignore',
        windowsHide: true,
      });
    } catch (error) {
      finish({ ok: false, reason: String(error?.message || error) });
      return;
    }
    child.on('error', (error) => finish({ ok: false, reason: String(error?.message || error) }));
    child.on('close', (code) => finish(code === 0 ? { ok: true } : { ok: false, reason: `exit ${code}` }));
  });
}

async function fetchRemoteViaSystemTool(url, dest, maxBytes) {
  let result;
  if (process.platform === 'win32') {
    const script = [
      "$ErrorActionPreference = 'Stop'",
      "$ProgressPreference = 'SilentlyContinue'",
      'Invoke-WebRequest -UseBasicParsing -Uri $env:PORTER_DOC_URL -OutFile $env:PORTER_DOC_DEST -TimeoutSec 12',
    ].join('; ');
    result = await runProcess(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { PORTER_DOC_URL: url, PORTER_DOC_DEST: dest },
      20000,
    );
  } else {
    result = await runProcess(
      'curl',
      ['-fsSL', '--connect-timeout', '8', '--max-time', '12', '-o', dest, url],
      {},
      20000,
    );
  }
  if (!result.ok) return { ok: false, status: 0, reason: result.reason || 'system download failed' };
  try {
    const stat = await fsp.stat(dest);
    if (!stat.isFile() || stat.size === 0 || stat.size > maxBytes) {
      await fsp.rm(dest, { force: true }).catch(() => {});
      return { ok: false, status: 0, reason: 'system download returned an unusable file' };
    }
    return { ok: true, status: 200, bytes: stat.size, via: process.platform === 'win32' ? 'powershell' : 'curl' };
  } catch (error) {
    return { ok: false, status: 0, reason: String(error?.message || error) };
  }
}

async function fetchRemoteDoc(url, dest, maxBytes = 2 * 1024 * 1024) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': 'dsh-plugin-porter' },
    });
    if (!response.ok) return { ok: false, status: response.status };
    const length = Number(response.headers.get('content-length') || 0);
    if (length > maxBytes) return { ok: false, status: 413, reason: 'document too large' };
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      return { ok: false, status: 413, reason: 'document too large' };
    }
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.writeFile(dest, text, 'utf8');
    return { ok: true, status: response.status, bytes: Buffer.byteLength(text, 'utf8') };
  } catch {
    // Node's fetch ignores the Windows system proxy. Fall back to the platform
    // downloader (PowerShell / curl) only for transport failures, never for a
    // real HTTP error such as 404.
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    return fetchRemoteViaSystemTool(url, dest, maxBytes);
  } finally {
    clearTimeout(timer);
  }
}

function docsDirName(name, version) {
  return packageDirName(name, version);
}

async function copyPluginDocs({ packageDir, packageName, version, docsRoot, targetDir, includeDocs, fetchDocs, pkg }) {
  const records = [];
  const outDir = path.join(docsRoot, docsDirName(packageName, version));
  if (!includeDocs) return { records, remoteFetched: 0, skipped: [] };

  const localDocs = await collectLocalDocs(packageDir);
  for (const doc of localDocs) {
    const rel = `local/${doc.path}`;
    const dest = path.join(outDir, ...rel.split('/'));
    const source = path.join(packageDir, ...doc.path.split('/'));
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.copyFile(source, dest);
    records.push({
      kind: 'local',
      name: doc.name,
      path: path.relative(targetDir, dest).split(path.sep).join('/'),
      bytes: doc.bytes,
    });
  }

  let remoteFetched = 0;
  const skipped = [];
  const repository = parseRepository(pkg);
  if (fetchDocs && repository?.owner && repository?.repo) {
    let successes = 0;
    for (const candidate of REMOTE_DOC_CANDIDATES) {
      if (successes >= 2) break;
      const url = `https://raw.githubusercontent.com/${repository.owner}/${repository.repo}/HEAD/${candidate}`;
      const dest = path.join(outDir, 'upstream', candidate);
      const result = await fetchRemoteDoc(url, dest);
      if (result.ok) {
        successes += 1;
        remoteFetched += 1;
        records.push({
          kind: 'upstream',
          name: candidate,
          path: path.relative(targetDir, dest).split(path.sep).join('/'),
          bytes: result.bytes,
          url,
        });
      } else if (result.status && result.status !== 404) {
        skipped.push(`${packageName}: ${candidate} (${result.status}${result.reason ? ` ${result.reason}` : ''})`);
      }
    }
  } else if (fetchDocs) {
    skipped.push(`${packageName}: no GitHub repository metadata`);
  }

  if (records.length > 0) {
    await fsp.mkdir(outDir, { recursive: true });
    await fsp.writeFile(
      path.join(outDir, 'sources.json'),
      `${JSON.stringify({ package: packageName, version, repository: repository?.url || null, files: records }, null, 2)}\n`,
      'utf8',
    );
  }
  return { records, remoteFetched, skipped };
}

function buildInstallMarkdown({ targetDir, pluginEntries, packages, totals, dshVersion, sourceProfile, warnings }) {
  const lines = [];
  lines.push('# DSH 插件离线搬运包');
  lines.push('');
  lines.push(`- 生成时间：${new Date().toISOString()}`);
  lines.push(`- 搬运助手：dsh-plugin-porter`);
  lines.push(`- 来源 DSH 版本：${dshVersion || '未知'}`);
  lines.push(`- 来源 profile：${sourceProfile}`);
  lines.push(`- 插件数量：${pluginEntries.length}`);
  lines.push(`- 包数量：${packages.length}（含依赖）`);
  lines.push(`- 插件包总大小：${formatBytes(totals.bytes)}（${totals.files} 个文件，未含文档和搬运助手副本）`);
  lines.push('');
  lines.push('## 一、在内网安装“插件搬运助手”（首次，或需要更新助手本身时）');
  lines.push('');
  lines.push('1. 将本目录整体复制到内网机器（U 盘 / DVD 均可，注意保持目录结构）。');
  lines.push('2. 完全退出 DSH（托盘图标 → 退出），不要只关闭窗口。');
  lines.push('3. 在本目录运行 `install-porter.cmd`；如果双击没有反应，用 PowerShell 运行：');
  lines.push('');
  lines.push('   ```powershell');
  lines.push('   powershell -NoProfile -ExecutionPolicy Bypass -File .\\install-porter.ps1');
  lines.push('   ```');
  lines.push('');
  lines.push('   脚本会自动找到 `%USERPROFILE%\\.dsh\\profiles\\desktop`，备份 `package.json`，把 `porter\\` 复制进 profile，并登记插件。');
  lines.push('   也可以用 `-ProfileDir "D:\\path\\to\\profile"` 显式指定。');
  lines.push('4. 重新启动 DSH，打开 设置 → 插件搬运。');
  lines.push('');
  lines.push('如果本机已经安装过搬运助手，且版本相同，可以跳过这一步，直接用界面导入。');
  lines.push('');
  lines.push('## 二、安装本包中的插件');
  lines.push('');
  lines.push('1. 打开 设置 → 插件搬运 → 导入。');
  lines.push('2. 粘贴本目录的绝对路径（例如 `E:\\dsh-plugin-porter-export-20261107-161500`），点“扫描搬运目录”。');
  lines.push('3. 核对校验结果与插件版本，勾选需要安装或更新的插件。');
  lines.push('4. 点“安装所选插件”。安装会先备份旧插件目录和 `package.json`。');
  lines.push('5. 完全退出并重新启动 DSH，使新插件生效。');
  lines.push('');
  lines.push('## 三、包含的插件');
  lines.push('');
  lines.push('| 插件 | 版本 | 包数量 | 大小 |');
  lines.push('| --- | --- | --- | --- |');
  for (const entry of pluginEntries) {
    lines.push(`| ${entry.name} | ${entry.version} | ${entry.packageCount} | ${formatBytes(entry.bytes)} |`);
  }
  lines.push('');
  lines.push('## 四、目录结构');
  lines.push('');
  lines.push('```text');
  lines.push('manifest.json          包清单（插件、依赖、校验信息）');
  lines.push('checksums.json         所有文件的 SHA-256');
  lines.push('packages/              插件与依赖的完整包目录');
  lines.push('docs/                  本地文档 + 抓取到的 GitHub README');
  lines.push('porter/                搬运助手自身（供安装脚本使用）');
  lines.push('install-porter.ps1     内网安装搬运助手');
  lines.push('install-porter.cmd     Windows 双击入口');
  lines.push('porter-cli.cmd         命令行工具（需要 node 在 PATH）');
  lines.push('INSTALL.md             本文件');
  lines.push('```');
  lines.push('');
  lines.push('## 五、说明与注意');
  lines.push('');
  lines.push('- 本包采用“直接复制到 profile/node_modules”的离线安装方式，不访问 npm 源，不需要 pnpm。');
  lines.push('- 安装后会更新 profile 的 `package.json`（dependencies 与 `dsh.profile.bundles`）。旧 `package.json` 与旧包目录会备份到 `<profile>\\.dsh-plugin-porter\\backups\\<时间戳>\\`。');
  lines.push('- `pnpm-lock.yaml` 不会更新；以后联网执行 pnpm 安装时可能重新解析依赖，这是预期行为。');
  lines.push('- 不要只复制单个 `packages/` 子目录；导入功能依赖 `manifest.json` 与 `checksums.json`。');
  lines.push('- 所有文件均可离线校验：用 `checksums.json` 对照 SHA-256。');
  lines.push('- 搬运介质请排除无关文件；本包不包含任何 API key / 令牌。');
  if (warnings.length > 0) {
    lines.push('');
    lines.push('### 打包警告');
    lines.push('');
    for (const warning of warnings) lines.push(`- ${warning}`);
  }
  lines.push('');
  return `${lines.join('\n')}`;
}

function buildPorterCliFiles(targetDir) {
  return [
    {
      name: 'porter-cli.cmd',
      content: '@echo off\r\nnode "%~dp0porter\\bin\\porter.mjs" %*\r\n',
    },
    {
      name: 'porter-cli.sh',
      content: '#!/usr/bin/env sh\nnode "$(dirname "$0")/porter/bin/porter.mjs" "$@"\n',
    },
  ];
}

export async function exportPlugins(options) {
  const {
    profileDir,
    pluginNames,
    outputParent,
    includeDocs = true,
    fetchDocs = true,
    onProgress = () => {},
  } = options;

  if (!Array.isArray(pluginNames) || pluginNames.length === 0) {
    throw new PorterError('Select at least one plugin to export.', 400);
  }
  const selected = [...new Set(pluginNames.map((name) => String(name).trim()).filter(Boolean))];
  if (selected.length === 0) throw new PorterError('Select at least one plugin to export.', 400);

  const startedAt = Date.now();
  const profile = await readProfile(profileDir);
  onProgress({ phase: 'resolve', message: '解析插件与依赖…' });

  const combined = await buildDependencyClosure(profileDir, selected);
  if (combined.missing.length > 0) {
    throw new PorterError(
      `Some required dependencies are missing from the profile: ${combined.missing.map((item) => item.name).join(', ')}`,
      409,
      { missing: combined.missing },
    );
  }

  const perRootClosures = new Map();
  for (const name of selected) {
    const single = await buildDependencyClosure(profileDir, [name]);
    perRootClosures.set(name, new Set(single.packages.map((pkg) => pkg.key)));
  }

  const parent = path.resolve(outputParent);
  await fsp.mkdir(parent, { recursive: true });
  for (const pkg of combined.packages) {
    if (isPathInside(parent, pkg.dir)) {
      throw new PorterError(`Output directory must not be inside a source package: ${parent}`, 400);
    }
  }
  if (isPathInside(parent, PACKAGE_ROOT)) {
    throw new PorterError(`Output directory must not be inside the porter package: ${parent}`, 400);
  }

  const targetDir = await uniqueTargetDir(parent, nowStamp());
  const packagesDir = path.join(targetDir, 'packages');
  const docsRoot = path.join(targetDir, 'docs');
  await fsp.mkdir(packagesDir, { recursive: true });
  await fsp.mkdir(docsRoot, { recursive: true });
  await fsp.mkdir(path.join(targetDir, 'porter'), { recursive: true });

  const warnings = [];
  if (combined.optionalMissing.length > 0) {
    warnings.push(
      `Optional dependencies not present in the profile: ${combined.optionalMissing.map((item) => item.name).join(', ')}`,
    );
  }
  if (combined.runtimeProvided.length > 0) {
    warnings.push(`Runtime-provided packages not copied: ${combined.runtimeProvided.join(', ')}`);
  }

  const versionGroups = new Map();
  for (const pkg of combined.packages) {
    if (!versionGroups.has(pkg.name)) versionGroups.set(pkg.name, new Set());
    versionGroups.get(pkg.name).add(pkg.version);
  }
  const conflicts = [...versionGroups.entries()].filter(([, versions]) => versions.size > 1);
  for (const [name, versions] of conflicts) {
    warnings.push(`Multiple versions of ${name} were found (${[...versions].join(', ')}); offline install keeps one flat version.`);
  }

  const packageEntries = [];
  const keyToEntry = new Map();
  onProgress({ phase: 'packages', message: `复制 ${combined.packages.length} 个包…` });

  for (const pkg of combined.packages) {
    const dirName = packageDirName(pkg.name, pkg.version);
    const relativePath = `packages/${dirName}`;
    const dest = path.join(targetDir, ...relativePath.split('/'));
    await copyTree(pkg.dir, dest, { filter: defaultCopyFilter });
    const stats = await dirStats(dest);
    const rawPkg = (await readPackageAt(dest)) || {};
    const entry = {
      key: pkg.key,
      name: pkg.name,
      version: pkg.version,
      path: relativePath,
      role: pkg.isPlugin ? 'plugin' : 'dependency',
      isPlugin: pkg.isPlugin,
      hasBundle: pkg.hasBundle,
      hasClient: pkg.hasClient,
      bundlePatch: rawPkg?.dsh?.bundle?.patch || null,
      requiredBy: pkg.requiredBy,
      dependencies: pkg.dependencies,
      description: rawPkg.description || '',
      repository: parseRepository(rawPkg)?.url || null,
      license: typeof rawPkg.license === 'string' ? rawPkg.license : rawPkg.license?.type || null,
      bytes: stats.bytes,
      files: stats.files,
    };
    packageEntries.push(entry);
    keyToEntry.set(pkg.key, entry);
  }

  onProgress({ phase: 'docs', message: '收集文档…' });
  const pluginEntries = [];
  let docsCopied = 0;
  let remoteFetched = 0;
  const docsSkipped = [];

  for (const root of selected) {
    const rootPkg = combined.packages.find((pkg) => pkg.name === root);
    if (!rootPkg) throw new PorterError(`Exported package not found for ${root}`, 500);
    const rawPkg = await readPackageAt(rootPkg.dir);
    const docsResult = await copyPluginDocs({
      packageDir: rootPkg.dir,
      packageName: rootPkg.name,
      version: rootPkg.version,
      docsRoot,
      targetDir,
      includeDocs,
      fetchDocs,
      pkg: rawPkg,
    });
    docsCopied += docsResult.records.filter((record) => record.kind === 'local').length;
    remoteFetched += docsResult.remoteFetched;
    docsSkipped.push(...docsResult.skipped);
    const closureKeys = perRootClosures.get(root) || new Set([rootPkg.key]);
    const closureEntries = [...closureKeys]
      .map((key) => keyToEntry.get(key))
      .filter(Boolean)
      .sort((a, b) => (a.key === rootPkg.key ? 1 : b.key === rootPkg.key ? -1 : a.name.localeCompare(b.name) || a.version.localeCompare(b.version)));
    pluginEntries.push({
      name: rootPkg.name,
      version: rootPkg.version,
      description: rawPkg?.description || '',
      repository: parseRepository(rawPkg)?.url || null,
      license: typeof rawPkg?.license === 'string' ? rawPkg.license : rawPkg?.license?.type || null,
      packageKey: rootPkg.key,
      packagePath: keyToEntry.get(rootPkg.key)?.path || null,
      hasBundle: rootPkg.hasBundle,
      hasClient: rootPkg.hasClient,
      dependencyKeys: [...closureKeys].filter((key) => key !== rootPkg.key),
      closure: closureEntries.map((entry) => entry.key),
      packageCount: closureEntries.length,
      bytes: closureEntries.reduce((sum, entry) => sum + entry.bytes, 0),
      files: closureEntries.reduce((sum, entry) => sum + entry.files, 0),
      docs: docsResult.records,
    });
  }

  const indexLines = ['# 插件文档索引', '', `生成时间：${new Date().toISOString()}`, ''];
  for (const entry of pluginEntries) {
    indexLines.push(`## ${entry.name}@${entry.version}`);
    indexLines.push('');
    if (entry.repository) indexLines.push(`- 仓库：${entry.repository}`);
    if (entry.docs.length === 0) {
      indexLines.push('- 未收集到文档');
    } else {
      for (const doc of entry.docs) {
        indexLines.push(`- ${doc.kind === 'upstream' ? '上游' : '本地'}：\`${doc.path}\`${doc.url ? `（${doc.url}）` : ''}`);
      }
    }
    indexLines.push('');
  }
  await fsp.writeFile(path.join(docsRoot, 'INDEX.md'), `${indexLines.join('\n')}\n`, 'utf8');

  onProgress({ phase: 'porter', message: '复制搬运助手自身与安装脚本…' });
  await copyTree(PACKAGE_ROOT, path.join(targetDir, 'porter'), {
    filter: (source) => {
      const base = path.basename(source);
      if (base === 'node_modules' || base === '.git') return false;
      if (base.endsWith('.porter-export-tmp')) return false;
      return true;
    },
  });

  const scriptsDir = path.join(PACKAGE_ROOT, 'scripts');
  const scriptCopies = [
    ['install-porter.ps1', 'install-porter.ps1'],
    ['install-porter.cmd', 'install-porter.cmd'],
    ['install-porter.sh', 'install-porter.sh'],
  ];
  for (const [sourceName, destName] of scriptCopies) {
    const source = path.join(scriptsDir, sourceName);
    if (await pathExists(source)) {
      await fsp.copyFile(source, path.join(targetDir, destName));
    }
  }
  for (const file of buildPorterCliFiles(targetDir)) {
    await fsp.writeFile(path.join(targetDir, file.name), file.content, 'utf8');
  }

  const dshVersion = await getDshVersion();
  const totals = {
    packages: packageEntries.length,
    plugins: pluginEntries.length,
    files: packageEntries.reduce((sum, entry) => sum + entry.files, 0),
    bytes: packageEntries.reduce((sum, entry) => sum + entry.bytes, 0),
  };

  const installMarkdown = buildInstallMarkdown({
    targetDir,
    pluginEntries,
    packages: packageEntries,
    totals,
    dshVersion,
    sourceProfile: `${profileName(profileDir)} (${profileDir})`,
    warnings,
  });
  await writeTextAtomic(path.join(targetDir, 'INSTALL.md'), installMarkdown);

  const manifest = {
    schema: EXPORT_SCHEMA,
    createdAt: new Date().toISOString(),
    createdBy: { name: 'dsh-plugin-porter', version: (await readJsonSafe(path.join(PACKAGE_ROOT, 'package.json'), {}))?.version || null },
    source: {
      profileDir,
      profileName: profileName(profileDir),
      dshVersion,
      platform: process.platform,
      arch: process.arch,
      node: process.versions.node,
    },
    settings: { includeDocs: Boolean(includeDocs), fetchDocs: Boolean(fetchDocs) },
    warnings,
    plugins: pluginEntries,
    packages: packageEntries,
    totals,
  };
  await writeJsonAtomic(path.join(targetDir, 'manifest.json'), manifest);

  onProgress({ phase: 'checksums', message: '计算校验和…' });
  const hashFiles = await listFiles(targetDir);
  const fileHashes = {};
  for (const file of hashFiles) {
    if (file.rel === 'checksums.json') continue;
    fileHashes[file.rel] = await sha256File(file.abs);
  }
  const checksumPayload = {
    schema: CHECKSUM_SCHEMA,
    algorithm: 'sha256',
    createdAt: new Date().toISOString(),
    root: '.',
    files: fileHashes,
  };
  await writeJsonAtomic(path.join(targetDir, 'checksums.json'), checksumPayload);

  onProgress({ phase: 'done', message: '导出完成' });

  return {
    ok: true,
    targetDir,
    manifestPath: path.join(targetDir, 'manifest.json'),
    plugins: pluginEntries.map((entry) => ({
      name: entry.name,
      version: entry.version,
      packageCount: entry.packageCount,
      bytes: entry.bytes,
      docs: entry.docs.length,
    })),
    packages: packageEntries.length,
    docs: {
      copied: docsCopied,
      remoteFetched,
      skipped: docsSkipped,
    },
    totals: {
      packages: totals.packages,
      plugins: totals.plugins,
      files: totals.files + 1,
      bytes: totals.bytes,
    },
    warnings,
    durationMs: Date.now() - startedAt,
  };
}
