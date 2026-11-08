import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  assertRelativeInside,
  compareVersions,
  nowStamp,
  readJsonSafe,
  sha256File,
  statusForVersions,
  walkEntries,
  writeJsonAtomic,
} from './util.mjs';
import {
  PorterError,
  getDshVersion,
  installedVersionOf,
  profileName,
  readPackageAt,
  readProfile,
} from './profile.mjs';
import { EXPORT_SCHEMA } from './export.mjs';

function summarizeManifest(manifest) {
  return {
    schema: manifest.schema,
    createdAt: manifest.createdAt,
    createdBy: manifest.createdBy,
    source: manifest.source,
    settings: manifest.settings,
    warnings: manifest.warnings || [],
    plugins: (manifest.plugins || []).map((plugin) => ({
      name: plugin.name,
      version: plugin.version,
      description: plugin.description,
      repository: plugin.repository,
      packageKey: plugin.packageKey,
      packagePath: plugin.packagePath,
      hasBundle: plugin.hasBundle,
      hasClient: plugin.hasClient,
      dependencyKeys: plugin.dependencyKeys,
      closure: plugin.closure,
      packageCount: plugin.packageCount,
      bytes: plugin.bytes,
      files: plugin.files,
      docs: plugin.docs,
    })),
    packages: (manifest.packages || []).map((pkg) => ({
      key: pkg.key,
      name: pkg.name,
      version: pkg.version,
      path: pkg.path,
      role: pkg.role,
      isPlugin: pkg.isPlugin,
      hasBundle: pkg.hasBundle,
      hasClient: pkg.hasClient,
      requiredBy: pkg.requiredBy,
      dependencies: pkg.dependencies,
      bytes: pkg.bytes,
      files: pkg.files,
    })),
    totals: manifest.totals,
  };
}

async function verifyChecksums(dir) {
  const checksumPath = path.join(dir, 'checksums.json');
  const checksums = await readJsonSafe(checksumPath, null);
  const result = {
    present: Boolean(checksums),
    ok: false,
    algorithm: checksums?.algorithm || null,
    checked: 0,
    mismatches: [],
    missing: [],
    extra: 0,
    unsafeSymlinks: [],
  };

  const symlinks = [];
  for await (const entry of walkEntries(dir)) {
    if (entry.type === 'symlink') symlinks.push(entry.rel);
  }
  result.unsafeSymlinks = symlinks.slice(0, 50);

  if (!checksums || typeof checksums.files !== 'object' || checksums.files === null) {
    result.ok = false;
    return result;
  }

  const expected = checksums.files;
  for (const [rel, expectedHash] of Object.entries(expected)) {
    let abs;
    try {
      abs = assertRelativeInside(rel, dir, 'checksum path');
    } catch {
      result.mismatches.push({ path: rel, expected: expectedHash, actual: null, reason: 'unsafe path' });
      continue;
    }
    const actual = await sha256File(abs).catch(() => null);
    if (actual === null) {
      result.missing.push(rel);
      continue;
    }
    result.checked += 1;
    if (actual !== expectedHash) {
      result.mismatches.push({ path: rel, expected: expectedHash, actual });
    }
  }

  let extra = 0;
  for await (const entry of walkEntries(dir)) {
    if (entry.type !== 'file') continue;
    if (entry.rel === 'checksums.json') continue;
    if (!(entry.rel in expected)) extra += 1;
  }
  result.extra = extra;
  result.ok = result.missing.length === 0 && result.mismatches.length === 0 && symlinks.length === 0;
  return result;
}

export async function scanExport(exportDirInput, profileDir) {
  if (!exportDirInput || typeof exportDirInput !== 'string') {
    throw new PorterError('Export directory is required.', 400);
  }
  const dir = path.resolve(exportDirInput);
  const manifestPath = path.join(dir, 'manifest.json');
  const manifest = await readJsonSafe(manifestPath, null);
  if (!manifest) {
    throw new PorterError(`Not an exported porter package: manifest.json not found in ${dir}`, 400);
  }
  if (manifest.schema !== EXPORT_SCHEMA) {
    throw new PorterError(
      `Unsupported export schema: ${manifest.schema || '(missing)'}. This porter supports ${EXPORT_SCHEMA}.`,
      409,
    );
  }
  if (!Array.isArray(manifest.plugins) || !Array.isArray(manifest.packages)) {
    throw new PorterError('manifest.json is missing plugins or packages.', 400);
  }

  const packagesByKey = new Map();
  const packageWarnings = [];
  for (const pkg of manifest.packages) {
    if (!pkg || typeof pkg !== 'object') throw new PorterError('Invalid package entry in manifest.json.', 400);
    if (typeof pkg.key !== 'string' || typeof pkg.name !== 'string' || typeof pkg.version !== 'string') {
      throw new PorterError('Invalid package entry in manifest.json.', 400);
    }
    if (!isSafePackageName(pkg.name)) {
      throw new PorterError(`Unsafe package name in manifest.json: ${pkg.name}`, 400);
    }
    const packageDir = assertRelativeInside(pkg.path, dir, `package path for ${pkg.key}`);
    const actual = await readPackageAt(packageDir);
    if (!actual) {
      throw new PorterError(`Package payload is missing: ${pkg.path}`, 409);
    }
    if (actual.name !== pkg.name || actual.version !== pkg.version) {
      packageWarnings.push(
        `Package ${pkg.path} reports ${actual.name}@${actual.version}, manifest says ${pkg.name}@${pkg.version}.`,
      );
    }
    packagesByKey.set(pkg.key, { ...pkg, absDir: packageDir });
  }

  for (const plugin of manifest.plugins) {
    if (!plugin || typeof plugin.name !== 'string' || typeof plugin.version !== 'string') {
      throw new PorterError('Invalid plugin entry in manifest.json.', 400);
    }
    if (!isSafePackageName(plugin.name)) {
      throw new PorterError(`Unsafe plugin name in manifest.json: ${plugin.name}`, 400);
    }
    if (plugin.packageKey) {
      const packageEntry = packagesByKey.get(plugin.packageKey);
      if (!packageEntry) {
        throw new PorterError(`Plugin ${plugin.name} references missing package ${plugin.packageKey}.`, 409);
      }
      if (packageEntry.name !== plugin.name) {
        throw new PorterError(
          `Plugin ${plugin.name} points at package ${packageEntry.name}@${packageEntry.version}.`,
          409,
        );
      }
    }
    for (const key of plugin.closure || []) {
      if (!packagesByKey.has(key)) {
        throw new PorterError(`Plugin ${plugin.name} references missing package ${key}.`, 409);
      }
    }
  }

  const checksums = await verifyChecksums(dir);
  const targetDshVersion = await getDshVersion();
  const warnings = [...packageWarnings, ...(Array.isArray(manifest.warnings) ? manifest.warnings : [])];

  if (!checksums.present) warnings.push('checksums.json is missing; content cannot be verified.');
  if (checksums.mismatches.length > 0) warnings.push(`${checksums.mismatches.length} file(s) failed the SHA-256 check.`);
  if (checksums.missing.length > 0) warnings.push(`${checksums.missing.length} file(s) listed in checksums.json are missing.`);
  if (checksums.unsafeSymlinks.length > 0) warnings.push('The export contains symbolic links; install is blocked for safety.');

  const sourceVersion = manifest.source?.dshVersion;
  if (sourceVersion && targetDshVersion && sourceVersion !== targetDshVersion) {
    warnings.push(
      `The export was created on DSH ${sourceVersion}; this machine runs ${targetDshVersion}. Check compatibility before installing.`,
    );
  }
  if (manifest.source?.platform && manifest.source.platform !== process.platform) {
    warnings.push(`The export was created on ${manifest.source.platform}; this machine is ${process.platform}.`);
  }

  const plugins = [];
  for (const plugin of manifest.plugins) {
    const installedVersion = await installedVersionOf(profileDir, plugin.name);
    const status = statusForVersions(installedVersion, plugin.version);
    const docs = Array.isArray(plugin.docs) ? plugin.docs : [];
    plugins.push({
      name: plugin.name,
      version: plugin.version,
      description: plugin.description || '',
      repository: plugin.repository || null,
      installedVersion,
      status,
      selectedByDefault: status !== 'same',
      sizeBytes: plugin.bytes || 0,
      packageCount: plugin.packageCount || (plugin.closure ? plugin.closure.length : 1),
      docsCount: docs.length,
      hasBundle: Boolean(plugin.hasBundle),
      hasClient: Boolean(plugin.hasClient),
    });
  }
  plugins.sort((a, b) => a.name.localeCompare(b.name));

  return {
    ok: true,
    dir,
    manifest: summarizeManifest(manifest),
    checksums: {
      present: checksums.present,
      ok: checksums.ok,
      algorithm: checksums.algorithm,
      checked: checksums.checked,
      mismatches: checksums.mismatches.slice(0, 50),
      missing: checksums.missing.slice(0, 50),
      extra: checksums.extra,
      unsafeSymlinks: checksums.unsafeSymlinks,
    },
    target: {
      profileDir,
      profileName: profileName(profileDir),
      dshVersion: targetDshVersion,
    },
    plugins,
    warnings,
  };
}

function resolvePluginPackageKeys(manifest, selectedNames) {
  const byName = new Map(manifest.plugins.map((plugin) => [plugin.name, plugin]));
  const keys = new Set();
  const pluginEntries = [];
  for (const name of selectedNames) {
    const plugin = byName.get(name);
    if (!plugin) throw new PorterError(`Plugin not found in export: ${name}`, 400);
    pluginEntries.push(plugin);
    if (plugin.packageKey) keys.add(plugin.packageKey);
    for (const key of plugin.closure || []) keys.add(key);
    for (const key of plugin.dependencyKeys || []) keys.add(key);
  }
  return { keys, pluginEntries };
}

function planPackages(manifest, keys) {
  const byKey = new Map(manifest.packages.map((pkg) => [pkg.key, pkg]));
  const selected = [];
  for (const key of keys) {
    const pkg = byKey.get(key);
    if (!pkg) throw new PorterError(`Package missing from manifest: ${key}`, 409);
    selected.push(pkg);
  }
  const byName = new Map();
  for (const pkg of selected) {
    if (!byName.has(pkg.name)) byName.set(pkg.name, []);
    byName.get(pkg.name).push(pkg);
  }
  const conflicts = [];
  const packages = [];
  for (const [name, entries] of byName.entries()) {
    const versions = [...new Set(entries.map((pkg) => pkg.version))].sort(compareVersions).reverse();
    const chosen = entries.find((pkg) => pkg.version === versions[0]);
    packages.push(chosen);
    if (versions.length > 1) conflicts.push({ name, versions, chosen: chosen.version });
  }
  return { packages, conflicts };
}

async function backupPackageJson(profileDir, backupRoot) {
  const manifestPath = path.join(profileDir, 'package.json');
  await fsp.mkdir(backupRoot, { recursive: true });
  const backupPath = path.join(backupRoot, 'package.json');
  await fsp.copyFile(manifestPath, backupPath);
  return backupPath;
}

function isSafePackageName(name) {
  if (typeof name !== 'string' || name.length === 0 || name.length > 214) return false;
  const segments = name.split('/');
  if (segments.length > 2) return false;
  const plain = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
  if (segments.length === 2) {
    return /^@[A-Za-z0-9][A-Za-z0-9._-]*$/.test(segments[0]) && plain.test(segments[1]);
  }
  return plain.test(segments[0]);
}

function targetPackageDir(profileDir, name) {
  if (!isSafePackageName(name)) throw new PorterError(`Unsafe package name: ${name}`, 400);
  return path.join(profileDir, 'node_modules', ...name.split('/'));
}

async function replacePackage({ sourceDir, targetDir, backupDir, isSelf }) {
  await fsp.mkdir(path.dirname(targetDir), { recursive: true });
  const existed = await readPackageAt(targetDir).then(Boolean).catch(() => false);
  if (!existed) {
    await fsp.cp(sourceDir, targetDir, { recursive: true, force: true, dereference: true });
    return { existed: false, backupPath: null, created: true };
  }

  if (isSelf) {
    const tempDir = `${targetDir}.porter-new-${process.pid}-${Date.now()}`;
    await fsp.rm(tempDir, { recursive: true, force: true });
    await fsp.cp(sourceDir, tempDir, { recursive: true, force: true, dereference: true });
    try {
      await fsp.rename(targetDir, backupDir);
    } catch {
      // The running package directory can be locked on Windows; merge in place instead.
      await fsp.cp(tempDir, targetDir, { recursive: true, force: true, dereference: true });
      await fsp.rm(tempDir, { recursive: true, force: true });
      return { existed: true, backupPath: null, created: false, merged: true };
    }
    try {
      await fsp.rename(tempDir, targetDir);
      return { existed: true, backupPath: backupDir, created: false };
    } catch (error) {
      await fsp.rm(targetDir, { recursive: true, force: true }).catch(() => {});
      await fsp.rename(backupDir, targetDir).catch(() => {});
      throw error;
    }
  }

  await fsp.mkdir(path.dirname(backupDir), { recursive: true });
  await fsp.rename(targetDir, backupDir);
  try {
    await fsp.cp(sourceDir, targetDir, { recursive: true, force: true, dereference: true });
  } catch (error) {
    await fsp.rm(targetDir, { recursive: true, force: true }).catch(() => {});
    await fsp.rename(backupDir, targetDir).catch(() => {});
    throw error;
  }
  return { existed: true, backupPath: backupDir, created: false };
}

export async function installExport({ exportDir, pluginNames, profileDir, allowUnverified = false }) {
  if (!Array.isArray(pluginNames) || pluginNames.length === 0) {
    throw new PorterError('Select at least one plugin to install.', 400);
  }
  const selectedNames = [...new Set(pluginNames.map((name) => String(name).trim()).filter(Boolean))];
  const scan = await scanExport(exportDir, profileDir);
  if (!scan.checksums.present && !allowUnverified) {
    throw new PorterError('This export has no checksums.json; pass allowUnverified to install anyway.', 409);
  }
  if (!scan.checksums.ok && !allowUnverified) {
    throw new PorterError(
      'The export failed integrity verification. Re-copy the folder or pass allowUnverified to install anyway.',
      409,
      { checksums: scan.checksums },
    );
  }

  const manifest = scan.manifest;
  const { keys, pluginEntries } = resolvePluginPackageKeys(manifest, selectedNames);
  const plan = planPackages(manifest, keys);
  const packageEntries = plan.packages;

  const profile = await readProfile(profileDir);
  const stamp = nowStamp();
  const backupRoot = path.join(profileDir, '.dsh-plugin-porter', 'backups', stamp);
  const packageJsonBackup = await backupPackageJson(profileDir, backupRoot);
  const warnings = [...scan.warnings];
  for (const conflict of plan.conflicts) {
    warnings.push(
      `Multiple versions of ${conflict.name} in the export (${conflict.versions.join(', ')}). ` +
        `Missing packages will use ${conflict.chosen}; packages already in the target profile are kept.`,
    );
  }
  const selectedPluginNames = new Set(pluginEntries.map((plugin) => plugin.name));
  const planned = [];
  const rollbacks = [];
  const installedRows = [];
  let copiedPackages = 0;
  let copiedBytes = 0;

  try {
    for (const pkg of packageEntries) {
      const sourceDir = assertRelativeInside(pkg.path, scan.dir, `package path for ${pkg.key}`);
      const target = targetPackageDir(profileDir, pkg.name);
      const isSelf = pkg.name === 'dsh-plugin-porter';
      const isSelectedPlugin = selectedPluginNames.has(pkg.name);
      const backupDir = path.join(backupRoot, 'node_modules', ...pkg.name.split('/'));
      const existing = await readPackageAt(target);
      if (existing && !isSelectedPlugin) {
        if (existing.version !== pkg.version) {
          warnings.push(`Kept existing ${pkg.name}@${existing.version}; the export also contains ${pkg.version}.`);
        }
        planned.push({ pkg, target, result: { existed: true, backupPath: null, created: false, skipped: true } });
        continue;
      }
      if (isSelf && existing) warnings.push('Updating dsh-plugin-porter while it is running; restart DSH to load the new version.');
      const result = await replacePackage({ sourceDir, targetDir: target, backupDir, isSelf });
      const installed = await readPackageAt(target);
      if (!installed || installed.name !== pkg.name || installed.version !== pkg.version) {
        throw new PorterError(`Copy verification failed for ${pkg.key}`, 500);
      }
      copiedPackages += 1;
      copiedBytes += pkg.bytes || 0;
      planned.push({ pkg, target, result });
      if (result.created) rollbacks.push(async () => fsp.rm(target, { recursive: true, force: true }));
      else if (result.backupPath) rollbacks.push(async () => {
        await fsp.rm(target, { recursive: true, force: true });
        await fsp.rename(result.backupPath, target);
      });
    }

    const manifestFile = path.join(profileDir, 'package.json');
    const current = await readProfile(profileDir);
    const pkgJson = current.pkg;
    if (!pkgJson.dependencies || typeof pkgJson.dependencies !== 'object') pkgJson.dependencies = {};
    if (!pkgJson.dsh || typeof pkgJson.dsh !== 'object') pkgJson.dsh = {};
    if (!pkgJson.dsh.profile || typeof pkgJson.dsh.profile !== 'object') pkgJson.dsh.profile = {};
    const bundles = Array.isArray(pkgJson.dsh.profile.bundles) ? [...pkgJson.dsh.profile.bundles] : [];

    for (const plugin of pluginEntries) {
      const pkg = packageEntries.find((entry) => entry.key === plugin.packageKey) || packageEntries.find((entry) => entry.name === plugin.name);
      if (!pkg) throw new PorterError(`Package plan missing for ${plugin.name}`, 500);
      pkgJson.dependencies[pkg.name] = pkg.version;
      const target = targetPackageDir(profileDir, pkg.name);
      const installedPkg = await readPackageAt(target);
      const hasBundle = Boolean(installedPkg?.dsh?.bundle?.patch);
      if (hasBundle && !bundles.includes(pkg.name)) bundles.push(pkg.name);
      const status = scan.plugins.find((item) => item.name === pkg.name)?.status || 'new';
      installedRows.push({
        name: pkg.name,
        version: pkg.version,
        status: status === 'new' ? 'new' : status === 'same' ? 'reinstalled' : 'updated',
        previousVersion: scan.plugins.find((item) => item.name === pkg.name)?.installedVersion || null,
        target,
        backupPath: planned.find((item) => item.pkg.key === pkg.key)?.result.backupPath || null,
      });
    }
    pkgJson.dsh.profile.bundles = bundles;

    await writeJsonAtomic(manifestFile, pkgJson);
    await readProfile(profileDir);
  } catch (error) {
    for (const rollback of rollbacks.reverse()) {
      await rollback().catch(() => {});
    }
    await fsp.copyFile(packageJsonBackup, path.join(profileDir, 'package.json')).catch(() => {});
    throw error;
  }

  return {
    ok: true,
    installed: installedRows,
    packages: packageEntries.length,
    copied: copiedPackages,
    bytes: copiedBytes,
    backupRoot,
    profileManifest: profile.manifestPath,
    restartRequired: true,
    warnings,
  };
}
