import { execFile } from 'node:child_process';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { promisify } from 'node:util';
import { pathExists, readJsonSafe, writeJsonAtomic } from './util.mjs';

const execFileAsync = promisify(execFile);

function comparablePath(value) {
  if (!value) return '';
  let resolved;
  try {
    resolved = path.resolve(value);
  } catch {
    return '';
  }
  resolved = resolved.replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function samePath(a, b) {
  return comparablePath(a) === comparablePath(b);
}

function runtimeDependencyRoots() {
  const roots = new Set();
  if (process.resourcesPath) {
    roots.add(path.join(process.resourcesPath, 'runtime', 'primary-runtime', 'dependencies'));
  }
  const execDir = path.dirname(process.execPath || '');
  if (execDir) {
    // Running as the bundled Node: <dependencies>/node/bin/node[.exe]
    roots.add(path.resolve(execDir, '..', '..'));
    // Running as the desktop executable: <install>/<executable>
    roots.add(path.resolve(execDir, '..', 'resources', 'runtime', 'primary-runtime', 'dependencies'));
  }
  return [...roots];
}

function pnpmCandidates() {
  const candidates = [];
  const nodeOverride = process.env.DSH_PORTER_NODE;
  const pnpmOverride = process.env.DSH_PORTER_PNPM;
  if (nodeOverride && pnpmOverride) {
    candidates.push({ node: nodeOverride, pnpm: pnpmOverride, electron: false });
  }
  const nodeName = process.platform === 'win32' ? 'node.exe' : 'node';
  for (const root of runtimeDependencyRoots()) {
    candidates.push({
      node: path.join(root, 'node', 'bin', nodeName),
      pnpm: path.join(root, 'pnpm', 'bin', 'pnpm.cjs'),
      electron: false,
    });
  }
  if (process.versions.electron && pnpmOverride) {
    candidates.push({ node: process.execPath, pnpm: pnpmOverride, electron: true });
  }
  return candidates;
}

async function usableCandidate(candidate) {
  try {
    return (await pathExists(candidate.node)) && (await pathExists(candidate.pnpm));
  } catch {
    return false;
  }
}

async function readModules(profileDir) {
  const modulesPath = path.join(profileDir, 'node_modules', '.modules.yaml');
  let raw;
  try {
    raw = await fsp.readFile(modulesPath, 'utf8');
  } catch {
    return { modulesPath, modules: null };
  }
  try {
    return { modulesPath, modules: JSON.parse(raw) };
  } catch {
    return { modulesPath, modules: null };
  }
}

/**
 * Ask the pnpm shipped with DSH for the store directory it resolves for this
 * profile. pnpm deliberately records that path in node_modules/.modules.yaml;
 * a profile copied from another machine keeps the old path and pnpm then
 * refuses every add/remove with ERR_PNPM_UNEXPECTED_STORE.
 */
export async function currentPnpmStoreDir(profileDir) {
  for (const candidate of pnpmCandidates()) {
    if (!(await usableCandidate(candidate))) continue;
    try {
      const { stdout } = await execFileAsync(
        candidate.node,
        [candidate.pnpm, 'store', 'path'],
        {
          cwd: profileDir,
          timeout: 20000,
          windowsHide: true,
          env: candidate.electron
            ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
            : process.env,
        },
      );
      const lines = String(stdout || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        if (path.isAbsolute(lines[index])) return lines[index];
      }
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

export async function repairPnpmStoreMetadata(profileDir) {
  const { modulesPath, modules } = await readModules(profileDir);
  if (!modules) return { status: 'absent' };

  const recorded = typeof modules.storeDir === 'string' ? modules.storeDir : '';
  if (!recorded) return { status: 'unrecorded' };

  const current = await currentPnpmStoreDir(profileDir);
  const virtualStoreDir = path.join(profileDir, 'node_modules', '.pnpm');
  let changed = false;

  if (current && !samePath(current, recorded)) {
    modules.storeDir = current;
    changed = true;
  }
  if (modules.virtualStoreDir && !samePath(modules.virtualStoreDir, virtualStoreDir)) {
    modules.virtualStoreDir = virtualStoreDir;
    changed = true;
  }

  if (changed) {
    await writeJsonAtomic(modulesPath, modules);
    return {
      status: 'repaired',
      from: recorded,
      to: current || recorded,
      virtualStoreDir: modules.virtualStoreDir || null,
    };
  }

  // If pnpm cannot be located, at least remove metadata that points at a
  // store which no longer exists on this machine. pnpm rebuilds .modules.yaml
  // against its own store on the next add/remove.
  if (!current && !(await pathExists(recorded))) {
    await fsp.rm(modulesPath, { force: true });
    return { status: 'removed', from: recorded };
  }

  return { status: 'ok' };
}

export { samePath };
