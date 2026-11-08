import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  compareVersions,
  dirStats,
  isPathInside,
  listFiles,
  parseRepository,
  pathExists,
  readJson,
  readJsonSafe,
  statusForVersions,
  uniqueStrings,
} from './util.mjs';

const requireFromHere = createRequire(import.meta.url);

export class PorterError extends Error {
  constructor(message, status = 400, details = undefined) {
    super(message);
    this.name = 'PorterError';
    this.status = status;
    this.details = details;
  }
}

export function expandHome(input) {
  if (typeof input !== 'string') return input;
  if (input === '~') return os.homedir();
  if (input.startsWith(`~${path.sep}`) || input.startsWith('~/')) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}

export async function resolveProfileDir(input) {
  const explicit = input || process.env.DSH_PROFILE_DIR;
  if (explicit) {
    const dir = path.resolve(expandHome(explicit));
    if (!(await pathExists(path.join(dir, 'package.json')))) {
      throw new PorterError(`Not a DSH profile directory (package.json missing): ${dir}`, 400);
    }
    return dir;
  }

  const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  const profilesDir = path.join(dshHome, 'profiles');
  const preferred = process.env.DSH_PROFILE;
  if (preferred) {
    const dir = path.join(profilesDir, preferred);
    if (await pathExists(path.join(dir, 'package.json'))) return dir;
  }
  const desktop = path.join(profilesDir, 'desktop');
  if (await pathExists(path.join(desktop, 'package.json'))) return desktop;

  let entries = [];
  try {
    entries = await fsp.readdir(profilesDir, { withFileTypes: true });
  } catch {
    entries = [];
  }
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(profilesDir, entry.name);
    if (await pathExists(path.join(dir, 'package.json'))) candidates.push(dir);
  }
  if (candidates.length === 1) return candidates[0];
  throw new PorterError(
    candidates.length === 0
      ? `No DSH profile found under ${profilesDir}. Pass profileDir explicitly.`
      : `Multiple DSH profiles found (${candidates.map((p) => path.basename(p)).join(', ')}). Pass profileDir explicitly.`,
    400,
  );
}

export function profileName(profileDir) {
  return process.env.DSH_PROFILE || path.basename(profileDir);
}

export async function readProfile(profileDir) {
  const manifestPath = path.join(profileDir, 'package.json');
  const pkg = await readJson(manifestPath);
  const bundlesRaw = pkg?.dsh?.profile?.bundles ?? pkg?.dsh?.bundles ?? [];
  const bundles = Array.isArray(bundlesRaw) ? bundlesRaw.filter((item) => typeof item === 'string') : [];
  return { dir: profileDir, manifestPath, pkg, bundles };
}

export async function readPackageAt(dir) {
  const file = path.join(dir, 'package.json');
  try {
    return await readJson(file);
  } catch {
    return null;
  }
}

export function isPluginPackage(pkg, bundles = []) {
  if (!pkg) return false;
  if (pkg?.dsh?.bundle?.patch) return true;
  if (pkg?.dsh?.client) return true;
  return bundles.includes(pkg.name);
}

export async function findPackageDir(profileDir, name, fromDir = profileDir) {
  const root = path.resolve(profileDir);
  let dir = path.resolve(fromDir);
  if (!isPathInside(dir, root)) dir = root;
  for (;;) {
    const candidate = path.join(dir, 'node_modules', name);
    if (await pathExists(path.join(candidate, 'package.json'))) return candidate;
    if (dir === root) break;
    const parent = path.dirname(dir);
    if (!isPathInside(parent, root)) break;
    dir = parent;
  }
  return null;
}

export async function readInstalledPackage(profileDir, name) {
  const dir = await findPackageDir(profileDir, name);
  if (!dir) return null;
  const pkg = await readPackageAt(dir);
  if (!pkg) return null;
  return { dir, pkg };
}

export function normalizeRepository(pkg) {
  return parseRepository(pkg);
}

const DOC_PATTERN = /^(readme|changelog|changes|license|licence|notice|copying|authors|contributing)(\..*)?$/i;

export async function collectLocalDocs(packageDir) {
  const docs = [];
  let entries = [];
  try {
    entries = await fsp.readdir(packageDir, { withFileTypes: true });
  } catch {
    return docs;
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!DOC_PATTERN.test(entry.name)) continue;
    if (!/\.(md|markdown|txt|rst)$/i.test(entry.name) && !/^license|licence|notice|copying$/i.test(entry.name)) continue;
    const abs = path.join(packageDir, entry.name);
    const stat = await fsp.stat(abs);
    docs.push({ name: entry.name, path: entry.name, bytes: stat.size });
  }
  const docsDir = path.join(packageDir, 'docs');
  if (await pathExists(docsDir)) {
    const files = await listFiles(docsDir);
    for (const file of files.slice(0, 40)) {
      if (!/\.(md|markdown|txt)$/i.test(file.rel)) continue;
      if (file.rel.split('/').includes('node_modules')) continue;
      const stat = await fsp.stat(file.abs);
      if (stat.size > 2 * 1024 * 1024) continue;
      docs.push({ name: `docs/${file.rel}`, path: `docs/${file.rel}`, bytes: stat.size });
    }
  }
  return docs;
}

export async function describeInstalledPlugin(profileDir, name, pkg, dir, bundles) {
  const repository = normalizeRepository(pkg);
  const dependencies = Object.keys(pkg.dependencies ?? {});
  const optionalDependencies = Object.keys(pkg.optionalDependencies ?? {});
  const localDocs = await collectLocalDocs(dir);
  let size = { bytes: 0, files: 0 };
  try {
    size = await dirStats(dir, { skipDirs: new Set(['node_modules', '.git', '.hg', '.svn']) });
  } catch {
    // keep zero
  }
  return {
    name: pkg.name || name,
    version: pkg.version || '0.0.0',
    description: pkg.description || '',
    dir,
    relativeDir: path.relative(profileDir, dir).split(path.sep).join('/'),
    sizeBytes: size.bytes,
    fileCount: size.files,
    dependencyCount: dependencies.length + optionalDependencies.length,
    dependencies: uniqueStrings([...dependencies, ...optionalDependencies]),
    hasClient: Boolean(pkg?.dsh?.client),
    hasBundle: Boolean(pkg?.dsh?.bundle?.patch),
    bundlePatch: pkg?.dsh?.bundle?.patch || null,
    repository: repository?.url || null,
    license: typeof pkg.license === 'string' ? pkg.license : pkg.license?.type || null,
    docs: localDocs,
  };
}

export async function listInstalledPlugins(profileDir) {
  const profile = await readProfile(profileDir);
  const names = new Set();
  for (const name of Object.keys(profile.pkg.dependencies ?? {})) names.add(name);
  for (const name of Object.keys(profile.pkg.optionalDependencies ?? {})) names.add(name);
  for (const name of profile.bundles) names.add(name);

  const plugins = [];
  for (const name of [...names].sort()) {
    const installed = await readInstalledPackage(profileDir, name);
    if (!installed) continue;
    const { dir, pkg } = installed;
    if (!isPluginPackage(pkg, profile.bundles)) continue;
    plugins.push(await describeInstalledPlugin(profileDir, name, pkg, dir, profile.bundles));
  }
  plugins.sort((a, b) => a.name.localeCompare(b.name));
  const totals = {
    plugins: plugins.length,
    sizeBytes: plugins.reduce((sum, item) => sum + item.sizeBytes, 0),
    profileDependencies: Object.keys(profile.pkg.dependencies ?? {}).length,
  };
  return { profile, plugins, totals };
}

export async function installedVersionOf(profileDir, name) {
  const installed = await readInstalledPackage(profileDir, name);
  return installed?.pkg?.version ?? null;
}

export async function buildDependencyClosure(profileDir, rootNames) {
  const profile = await readProfile(profileDir);
  const packages = new Map();
  const missing = [];
  const optionalMissing = [];
  const runtimeProvided = [];
  const roots = [];
  const queue = [];

  for (const name of rootNames) {
    const installed = await readInstalledPackage(profileDir, name);
    if (!installed) {
      throw new PorterError(`Plugin is not installed in this profile: ${name}`, 400);
    }
    roots.push({ name, version: installed.pkg.version, dir: installed.dir });
    queue.push({
      name,
      fromDir: installed.dir,
      requiredBy: `<${name}>`,
      optional: false,
      isRoot: true,
    });
  }

  while (queue.length > 0) {
    const item = queue.shift();
    if (item.name.startsWith('node:')) continue;
    const dir = await findPackageDir(profileDir, item.name, item.fromDir);
    if (!dir) {
      if (item.name.startsWith('@deepseek-ai/')) {
        if (!runtimeProvided.includes(item.name)) runtimeProvided.push(item.name);
        continue;
      }
      const record = { name: item.name, requiredBy: item.requiredBy };
      if (item.optional) {
        if (!optionalMissing.some((entry) => entry.name === item.name)) optionalMissing.push(record);
      } else if (!missing.some((entry) => entry.name === item.name)) {
        missing.push(record);
      }
      continue;
    }
    const pkg = await readPackageAt(dir);
    if (!pkg) continue;
    const version = pkg.version || '0.0.0';
    const key = `${pkg.name || item.name}@${version}`;
    let entry = packages.get(key);
    if (!entry) {
      entry = {
        key,
        name: pkg.name || item.name,
        version,
        dir,
        isPlugin: isPluginPackage(pkg, profile.bundles),
        hasBundle: Boolean(pkg?.dsh?.bundle?.patch),
        hasClient: Boolean(pkg?.dsh?.client),
        dependencies: Object.keys(pkg.dependencies ?? {}),
        requiredBy: new Set(),
      };
      packages.set(key, entry);
      const deps = Object.entries(pkg.dependencies ?? {});
      const optional = Object.entries(pkg.optionalDependencies ?? {});
      for (const [depName] of deps) {
        queue.push({ name: depName, fromDir: dir, requiredBy: entry.key, optional: false });
      }
      for (const [depName] of optional) {
        queue.push({ name: depName, fromDir: dir, requiredBy: entry.key, optional: true });
      }
    }
    if (item.requiredBy) entry.requiredBy.add(item.requiredBy);
  }

  const list = [...packages.values()].map((entry) => ({
    ...entry,
    requiredBy: [...entry.requiredBy].sort(),
  }));
  list.sort((a, b) => a.name.localeCompare(b.name) || compareVersions(a.version, b.version));

  return {
    profile,
    roots,
    packages: list,
    missing,
    optionalMissing,
    runtimeProvided,
  };
}

export async function getDshVersion() {
  const envVersion = process.env.DSH_VERSION;
  if (envVersion) return envVersion;

  const candidates = [];
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'app.asar', 'package.json'));
    candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'package.json'));
  }
  try {
    candidates.push(requireFromHere.resolve('@deepseek-ai/dsh/package.json'));
  } catch {
    // ignore
  }
  for (const file of candidates) {
    const pkg = await readJsonSafe(file, null);
    if (pkg?.version) return pkg.version;
  }
  return null;
}

export async function getPorterVersion() {
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const pkg = await readJsonSafe(path.join(packageRoot, 'package.json'), null);
  return pkg?.version || null;
}

export async function getProfileStatus(profileDir, porter = {}) {
  const profile = await readProfile(profileDir);
  const dshVersion = await getDshVersion();
  const { plugins, totals } = await listInstalledPlugins(profileDir);
  const defaults = await getDefaults(profileDir);
  return {
    ok: true,
    porter: {
      name: 'dsh-plugin-porter',
      version: porter.version || (await getPorterVersion()),
    },
    profile: {
      dir: profileDir,
      name: profileName(profileDir),
      manifestPath: profile.manifestPath,
    },
    dsh: { version: dshVersion },
    platform: process.platform,
    arch: process.arch,
    node: process.versions.node,
    defaults,
    counts: {
      plugins: totals.plugins,
      profileDependencies: totals.profileDependencies,
    },
  };
}

export async function getDefaults(profileDir) {
  const state = await readState(profileDir);
  const desktop = path.join(os.homedir(), 'Desktop');
  let exportParent = state.lastExportParent;
  if (!exportParent) {
    exportParent = (await pathExists(desktop)) ? desktop : os.homedir();
  }
  return {
    exportParent,
    importDir: state.lastImportDir || null,
    includeDocs: state.includeDocs !== false,
    fetchDocs: state.fetchDocs !== false,
  };
}

export function stateFile(profileDir) {
  return path.join(profileDir, '.dsh-plugin-porter', 'state.json');
}

export async function readState(profileDir) {
  return (await readJsonSafe(stateFile(profileDir), {})) || {};
}

export async function writeState(profileDir, patch) {
  const current = await readState(profileDir);
  const next = { ...current, ...patch };
  await fsp.mkdir(path.dirname(stateFile(profileDir)), { recursive: true });
  await fsp.writeFile(stateFile(profileDir), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}

export { compareVersions, statusForVersions };
