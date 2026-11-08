import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function pathExists(target) {
  try {
    await fsp.access(target);
    return true;
  } catch {
    return false;
  }
}

export function pathExistsSync(target) {
  try {
    fs.accessSync(target);
    return true;
  } catch {
    return false;
  }
}

export async function readJson(file) {
  const raw = await fsp.readFile(file, 'utf8');
  return JSON.parse(raw);
}

export async function readJsonSafe(file, fallback = null) {
  try {
    return await readJson(file);
  } catch {
    return fallback;
  }
}

export async function writeJsonAtomic(file, value) {
  const dir = path.dirname(file);
  await fsp.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  await fsp.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fsp.rename(tmp, file);
}

export async function writeTextAtomic(file, text) {
  const dir = path.dirname(file);
  await fsp.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  await fsp.writeFile(tmp, text, 'utf8');
  await fsp.rename(tmp, file);
}

export function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

export async function* walkEntries(root, options = {}) {
  const { skipDirs = new Set(), includeDirs = false } = options;
  const stack = [''];
  while (stack.length > 0) {
    const rel = stack.pop();
    const abs = rel ? path.join(root, rel) : root;
    let entries;
    try {
      entries = await fsp.readdir(abs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name)) continue;
        if (includeDirs) yield { rel: childRel, abs: path.join(root, childRel), type: 'dir' };
        stack.push(childRel);
      } else if (entry.isSymbolicLink()) {
        yield { rel: childRel, abs: path.join(root, childRel), type: 'symlink' };
      } else if (entry.isFile()) {
        yield { rel: childRel, abs: path.join(root, childRel), type: 'file' };
      }
    }
  }
}

export async function listFiles(root, options = {}) {
  const files = [];
  for await (const entry of walkEntries(root, options)) {
    if (entry.type === 'file') files.push(entry);
  }
  return files;
}

export async function dirStats(root, options = {}) {
  let bytes = 0;
  let files = 0;
  for await (const entry of walkEntries(root, options)) {
    if (entry.type !== 'file') continue;
    try {
      const stat = await fsp.stat(entry.abs);
      bytes += stat.size;
      files += 1;
    } catch {
      // ignore unreadable file
    }
  }
  return { bytes, files };
}

export async function copyTree(src, dest, options = {}) {
  const { filter } = options;
  await fsp.cp(src, dest, {
    recursive: true,
    force: true,
    dereference: true,
    errorOnExist: false,
    filter: (source, destination) => {
      if (typeof filter === 'function') return filter(source, destination);
      return true;
    },
  });
}

export function defaultCopyFilter(source) {
  const base = path.basename(source);
  if (base === 'node_modules' || base === '.git' || base === '.hg' || base === '.svn') return false;
  if (base === '.DS_Store' || base === 'Thumbs.db') return false;
  if (base.endsWith('.log') || base.endsWith('.tmp')) return false;
  return true;
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '?';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

export function nowStamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export function safePackageSegment(name) {
  return String(name).replace(/^@/, '').replace(/[\\/:*?"<>|]/g, '_');
}

export function packageDirName(name, version) {
  return `${safePackageSegment(name)}-${String(version).replace(/[\\/:*?"<>|]/g, '_')}`;
}

export function isPathInside(child, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function assertRelativeInside(relativePath, parent, label = 'path') {
  if (typeof relativePath !== 'string' || relativePath.length === 0) {
    throw new Error(`${label} is empty`);
  }
  if (path.isAbsolute(relativePath)) {
    throw new Error(`${label} must be relative: ${relativePath}`);
  }
  const normalized = relativePath.replace(/\\/g, '/');
  if (normalized.split('/').some((part) => part === '..')) {
    throw new Error(`${label} escapes the export directory: ${relativePath}`);
  }
  const abs = path.resolve(parent, relativePath);
  if (!isPathInside(abs, parent)) {
    throw new Error(`${label} escapes the export directory: ${relativePath}`);
  }
  return abs;
}

export function parseGithubRepo(...candidates) {
  for (const raw of candidates) {
    if (!raw) continue;
    const value = typeof raw === 'string' ? raw : raw?.url;
    if (!value || typeof value !== 'string') continue;
    const cleaned = value
      .replace(/^git\+/, '')
      .replace(/^github:/, 'https://github.com/')
      .replace(/\.git(#.*)?$/, '')
      .replace(/#.*$/, '');
    const match = cleaned.match(/github\.com[\\/:]([A-Za-z0-9_.-]+)[\\/]([A-Za-z0-9_.-]+)/);
    if (match) return { owner: match[1], repo: match[2], url: `https://github.com/${match[1]}/${match[2]}` };
  }
  return null;
}

export function parseRepository(pkg) {
  const repository = pkg?.repository;
  const repoUrl = typeof repository === 'string' ? repository : repository?.url;
  const found = parseGithubRepo(repoUrl, pkg?.homepage, pkg?.bugs?.url);
  if (found) return found;
  if (repoUrl) return { owner: null, repo: null, url: repoUrl };
  return null;
}

export function compareVersions(a, b) {
  if (a === b) return 0;
  const parse = (value) => {
    const [core, pre = ''] = String(value ?? '').split('+')[0].split('-', 2);
    return {
      core: core.split('.').map((part) => {
        const n = Number.parseInt(part, 10);
        return Number.isFinite(n) ? n : 0;
      }),
      pre: pre ? pre.split('.') : [],
    };
  };
  const left = parse(a);
  const right = parse(b);
  const length = Math.max(left.core.length, right.core.length);
  for (let i = 0; i < length; i += 1) {
    const l = left.core[i] ?? 0;
    const r = right.core[i] ?? 0;
    if (l !== r) return l < r ? -1 : 1;
  }
  if (left.pre.length === 0 && right.pre.length === 0) return 0;
  if (left.pre.length === 0) return 1;
  if (right.pre.length === 0) return -1;
  const preLength = Math.max(left.pre.length, right.pre.length);
  for (let i = 0; i < preLength; i += 1) {
    const l = left.pre[i];
    const r = right.pre[i];
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    const ln = /^\d+$/.test(l) ? Number.parseInt(l, 10) : null;
    const rn = /^\d+$/.test(r) ? Number.parseInt(r, 10) : null;
    if (ln !== null && rn !== null) {
      if (ln !== rn) return ln < rn ? -1 : 1;
    } else if (ln !== null) {
      return -1;
    } else if (rn !== null) {
      return 1;
    } else if (l !== r) {
      return l < r ? -1 : 1;
    }
  }
  return 0;
}

export function statusForVersions(installedVersion, exportedVersion) {
  if (!installedVersion) return 'new';
  const cmp = compareVersions(installedVersion, exportedVersion);
  if (cmp === 0) return 'same';
  return cmp < 0 ? 'update' : 'downgrade';
}

export function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.length > 0))];
}

export function homeDir() {
  return os.homedir();
}
