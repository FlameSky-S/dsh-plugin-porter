#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatBytes } from '../lib/util.mjs';
import {
  getProfileStatus,
  listInstalledPlugins,
  resolveProfileDir,
} from '../lib/profile.mjs';
import { exportPlugins } from '../lib/export.mjs';
import { installExport, scanExport } from '../lib/import.mjs';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function usage() {
  console.log(`DSH Plugin Porter ${readVersion()}

用法:
  porter list                      列出当前 profile 中已安装的插件
  porter status                    显示 profile / DSH / 搬运助手状态
  porter export --all --out <目录>  导出全部插件（或 --plugins a,b）
  porter scan --dir <导出目录>      扫描并校验搬运目录
  porter install --dir <导出目录> --plugins a,b
                                   安装/更新指定插件
  porter verify --dir <导出目录>    仅校验文件完整性
  porter where                     显示插件包目录

通用选项:
  --profile-dir <目录>   指定 DSH profile（默认取 DSH_PROFILE_DIR）
  --json                以 JSON 输出
  --help                显示帮助

export 选项:
  --out <父目录>         导出到该目录下的时间戳子目录（默认桌面）
  --plugins a,b          选择插件（逗号分隔，可重复）
  --all                  导出全部已安装插件
  --no-docs              不复制文档
  --no-remote-docs       不抓取 GitHub 上的 README

install 选项:
  --allow-unverified     校验失败或缺少 checksums.json 时仍继续（不推荐）
`);
}

function readVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8')).version;
  } catch {
    return '';
  }
}

function parseArgs(argv) {
  const options = { pluginNames: [] };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--all') {
      options.all = true;
    } else if (arg === '--no-docs') {
      options.includeDocs = false;
    } else if (arg === '--no-remote-docs') {
      options.fetchDocs = false;
    } else if (arg === '--allow-unverified') {
      options.allowUnverified = true;
    } else if (arg === '--profile-dir') {
      options.profileDir = argv[++i];
    } else if (arg.startsWith('--profile-dir=')) {
      options.profileDir = arg.slice('--profile-dir='.length);
    } else if (arg === '--out') {
      options.out = argv[++i];
    } else if (arg.startsWith('--out=')) {
      options.out = arg.slice('--out='.length);
    } else if (arg === '--dir') {
      options.dir = argv[++i];
    } else if (arg.startsWith('--dir=')) {
      options.dir = arg.slice('--dir='.length);
    } else if (arg === '--plugins') {
      options.pluginNames.push(...String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean));
    } else if (arg.startsWith('--plugins=')) {
      options.pluginNames.push(...arg.slice('--plugins='.length).split(',').map((s) => s.trim()).filter(Boolean));
    } else if (arg === '--version' || arg === '-v') {
      options.version = true;
    } else {
      rest.push(arg);
    }
  }
  return { options, rest };
}

function printTable(rows, columns) {
  const widths = columns.map((column) => {
    let width = column.label.length;
    for (const row of rows) width = Math.max(width, String(row[column.key] ?? '').length);
    return Math.min(width, column.max || 60);
  });
  const line = (values) =>
    values
      .map((value, index) => {
        const text = String(value ?? '');
        return text.length > widths[index] ? `${text.slice(0, widths[index] - 1)}…` : text.padEnd(widths[index]);
      })
      .join('  ');
  console.log(line(columns.map((column) => column.label)));
  console.log(line(columns.map((_, index) => '-'.repeat(widths[index]))));
  for (const row of rows) {
    console.log(line(columns.map((column) => row[column.key] ?? '')));
  }
}

function defaultOutputParent() {
  const desktop = path.join(os.homedir(), 'Desktop');
  return desktop;
}

async function main() {
  const { options, rest } = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return 0;
  }
  if (options.version) {
    console.log(readVersion());
    return 0;
  }
  const command = rest[0];
  if (!command) {
    usage();
    return 1;
  }

  if (command === 'where') {
    console.log(PACKAGE_ROOT);
    return 0;
  }

  const profileDir = await resolveProfileDir(options.profileDir);

  if (command === 'status') {
    const status = await getProfileStatus(profileDir, {});
    if (options.json) {
      console.log(JSON.stringify(status, null, 2));
    } else {
      console.log(`profile: ${status.profile.name}  ${status.profile.dir}`);
      console.log(`DSH: ${status.dsh.version || '未知'}    porter: ${status.porter.version || '未知'}`);
      console.log(`插件: ${status.counts.plugins}    默认导出父目录: ${status.defaults.exportParent}`);
    }
    return 0;
  }

  if (command === 'list') {
    const result = await listInstalledPlugins(profileDir);
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`profile: ${profileDir}`);
      printTable(
        result.plugins.map((plugin) => ({
          name: plugin.name,
          version: plugin.version,
          deps: plugin.dependencyCount,
          client: plugin.hasClient ? 'yes' : '',
          size: formatBytes(plugin.sizeBytes),
        })),
        [
          { key: 'name', label: '插件', max: 48 },
          { key: 'version', label: '版本', max: 20 },
          { key: 'deps', label: '依赖', max: 6 },
          { key: 'client', label: 'UI', max: 5 },
          { key: 'size', label: '大小', max: 12 },
        ],
      );
    }
    return 0;
  }

  if (command === 'export') {
    let pluginNames = options.pluginNames;
    if (options.all) {
      const result = await listInstalledPlugins(profileDir);
      pluginNames = result.plugins.map((plugin) => plugin.name);
    }
    if (pluginNames.length === 0) {
      throw new Error('Specify --all or --plugins a,b');
    }
    const outputParent = options.out ? path.resolve(options.out) : defaultOutputParent();
    const result = await exportPlugins({
      profileDir,
      pluginNames,
      outputParent,
      includeDocs: options.includeDocs !== false,
      fetchDocs: options.fetchDocs !== false,
      onProgress: (progress) => {
        if (!options.json) process.stderr.write(`  · ${progress.message}\n`);
      },
    });
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`\n导出完成: ${result.targetDir}`);
      console.log(`插件 ${result.plugins.length} 个, 包 ${result.packages} 个, 文档 ${result.docs.copied} 份 (上游 ${result.docs.remoteFetched})`);
      console.log(`大小约 ${formatBytes(result.totals.bytes)}`);
      for (const warning of result.warnings) console.log(`警告: ${warning}`);
      console.log('\n把整个目录复制到内网，运行 install-porter.cmd 安装本插件，或在已安装后使用 设置 → 插件搬运 → 导入。');
    }
    return 0;
  }

  if (command === 'scan' || command === 'verify') {
    if (!options.dir) throw new Error('Specify --dir <export directory>');
    const result = await scanExport(path.resolve(options.dir), profileDir);
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`目录: ${result.dir}`);
      console.log(`来源 DSH: ${result.manifest.source?.dshVersion || '未知'}  当前 DSH: ${result.target.dshVersion || '未知'}`);
      console.log(`校验: ${result.checksums.ok ? '通过' : '失败'}  已检查 ${result.checksums.checked} 个文件`);
      if (!result.checksums.ok) {
        for (const mismatch of result.checksums.mismatches.slice(0, 5)) console.log(`  不匹配: ${mismatch.path}`);
        for (const missing of result.checksums.missing.slice(0, 5)) console.log(`  缺失: ${missing}`);
      }
      printTable(
        result.plugins.map((plugin) => ({
          name: plugin.name,
          version: plugin.version,
          installed: plugin.installedVersion || '-',
          status: plugin.status,
          size: formatBytes(plugin.sizeBytes),
        })),
        [
          { key: 'name', label: '插件', max: 48 },
          { key: 'version', label: '包内版本', max: 18 },
          { key: 'installed', label: '已安装', max: 18 },
          { key: 'status', label: '状态', max: 10 },
          { key: 'size', label: '大小', max: 12 },
        ],
      );
      for (const warning of result.warnings) console.log(`警告: ${warning}`);
    }
    return 0;
  }

  if (command === 'install') {
    if (!options.dir) throw new Error('Specify --dir <export directory>');
    if (options.pluginNames.length === 0) throw new Error('Specify --plugins a,b');
    const result = await installExport({
      exportDir: path.resolve(options.dir),
      pluginNames: options.pluginNames,
      profileDir,
      allowUnverified: options.allowUnverified === true,
    });
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      for (const plugin of result.installed) {
        console.log(`已安装 ${plugin.name}@${plugin.version} (${plugin.status})`);
      }
      console.log(`包 ${result.packages} 个, 备份目录: ${result.backupRoot}`);
      console.log('请完全退出并重启 DSH 后生效。');
      for (const warning of result.warnings) console.log(`警告: ${warning}`);
    }
    return 0;
  }

  console.error(`未知命令: ${command}`);
  usage();
  return 1;
}

main()
  .then((code) => {
    process.exitCode = code || 0;
  })
  .catch((error) => {
    console.error(`错误: ${error?.message || error}`);
    if (process.env.DSH_PORTER_DEBUG === '1' && error?.stack) console.error(error.stack);
    process.exitCode = 1;
  });
