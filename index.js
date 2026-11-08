import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { readJsonSafe } from './lib/util.mjs';
import {
  PorterError,
  getProfileStatus,
  getDefaults,
  listInstalledPlugins,
  readProfile,
  resolveProfileDir,
  writeState,
} from './lib/profile.mjs';
import { exportPlugins } from './lib/export.mjs';
import { installExport, scanExport } from './lib/import.mjs';
import { JobRegistry } from './lib/jobs.mjs';

export const inject = ['webServer'];

const API_PREFIX = '/api/dsh-plugin-porter';
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

let cachedPackage = null;
async function porterPackage() {
  if (!cachedPackage) {
    cachedPackage = (await readJsonSafe(path.join(PACKAGE_ROOT, 'package.json'), {})) || {};
  }
  return cachedPackage;
}

function writeJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
  });
  res.end(payload);
}

function writeError(res, status, message, details = undefined) {
  writeJson(res, status, details === undefined ? { ok: false, error: message } : { ok: false, error: message, details });
}

function isLoopbackAddress(address) {
  if (!address) return false;
  return (
    address === '127.0.0.1' ||
    address === '::1' ||
    address === '::ffff:127.0.0.1' ||
    address.startsWith('127.')
  );
}

function isLoopbackHostname(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}

function hostHeaderHostname(hostHeader) {
  const value = String(hostHeader || '').trim();
  if (!value) return '';
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    return end >= 0 ? value.slice(0, end + 1).toLowerCase() : value.toLowerCase();
  }
  return value.split(':')[0].toLowerCase();
}

function loopbackFence(req) {
  if (!isLoopbackAddress(req.socket?.remoteAddress)) return 403;
  const hostname = hostHeaderHostname(req.headers?.host);
  if (!isLoopbackHostname(hostname)) return 403;
  const site = req.headers?.['sec-fetch-site'];
  if (site === 'cross-site') return 403;
  const origin = req.headers?.origin;
  if (origin) {
    try {
      const originUrl = new URL(origin);
      if (!isLoopbackHostname(originUrl.hostname)) return 403;
    } catch {
      return 403;
    }
  }
  return undefined;
}

async function trustStatus(ctx, req) {
  const connection = typeof ctx.get === 'function' ? ctx.get('connection') : null;
  if (connection && typeof connection.requestRejection === 'function') {
    try {
      const rejection = await connection.requestRejection(req);
      if (rejection === undefined || rejection === null || rejection === false) return undefined;
      if (typeof rejection === 'number') return rejection;
      if (typeof rejection === 'string') return rejection === 'unauthorized' ? 401 : 403;
      if (typeof rejection === 'object') {
        if (typeof rejection.status === 'number') return rejection.status;
        if (rejection.reason === 'unauthenticated') return 401;
        return 403;
      }
      return 403;
    } catch (error) {
      return { error: String(error?.message || error) };
    }
  }
  return loopbackFence(req);
}

function readJsonBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new PorterError(`Request body exceeds ${limit} bytes`, 413));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text.trim() ? JSON.parse(text) : {});
      } catch {
        reject(new PorterError('Request body is not valid JSON', 400));
      }
    });
    req.on('error', reject);
  });
}

function route({ path: routePath, method, jsonBody = false, handler }) {
  const definition = {
    kind: 'exact',
    path: routePath,
    handler: async (req, res) => {
      const trust = await trustStatus(definition.ctx, req);
      if (trust !== undefined) {
        const status = trust?.error ? 500 : trust;
        writeError(res, status, trust?.error ? `Trust check failed: ${trust.error}` : 'Request rejected by the DSH trust fence.');
        return;
      }
      if (req.method !== method) {
        res.setHeader?.('allow', method);
        writeError(res, 405, `Method ${req.method} is not allowed; use ${method}.`);
        return;
      }
      if (method === 'POST' && req.headers?.['x-dsh-plugin-porter'] !== '1') {
        writeError(res, 403, 'Missing x-dsh-plugin-porter: 1 header.');
        return;
      }
      req.setTimeout?.(0);
      res.setTimeout?.(0);
      try {
        const body = jsonBody ? await readJsonBody(req) : {};
        const result = await handler({ req, res, body });
        if (!res.writableEnded) writeJson(res, result?.status || 200, result?.body === undefined ? result : result.body);
      } catch (error) {
        const status = error instanceof PorterError ? error.status : 500;
        const message = error instanceof Error ? error.message : String(error);
        if (status >= 500) {
          try {
            definition.ctx.logger?.error?.(`[dsh-plugin-porter] ${message}`);
          } catch {
            // ignore logger errors
          }
        }
        if (!res.writableEnded) {
          writeError(res, status, message, error instanceof PorterError ? error.details : undefined);
        }
      }
    },
  };
  return definition;
}

async function resolveRequestProfile(body) {
  return resolveProfileDir(typeof body?.profileDir === 'string' && body.profileDir.trim() ? body.profileDir.trim() : undefined);
}

function requireAbsoluteDir(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new PorterError(`${label} is required.`, 400);
  }
  const trimmed = value.trim();
  if (!path.isAbsolute(trimmed)) {
    throw new PorterError(`${label} must be an absolute path: ${trimmed}`, 400);
  }
  return path.resolve(trimmed);
}

export function apply(ctx) {
  const logger = ctx.logger;
  const packagePromise = porterPackage();
  const jobs = new JobRegistry();

  const routeEntries = [
    route({
      path: `${API_PREFIX}/ping`,
      method: 'GET',
      handler: async () => {
        const pkg = await packagePromise;
        return { ok: true, name: pkg.name || 'dsh-plugin-porter', version: pkg.version || null };
      },
    }),
    route({
      path: `${API_PREFIX}/status`,
      method: 'GET',
      handler: async () => {
        const pkg = await packagePromise;
        const profileDir = await resolveProfileDir();
        return getProfileStatus(profileDir, { version: pkg.version });
      },
    }),
    route({
      path: `${API_PREFIX}/plugins`,
      method: 'GET',
      handler: async () => {
        const profileDir = await resolveProfileDir();
        const result = await listInstalledPlugins(profileDir);
        return {
          ok: true,
          profileDir,
          plugins: result.plugins,
          totals: result.totals,
        };
      },
    }),
    route({
      path: `${API_PREFIX}/export`,
      method: 'POST',
      jsonBody: true,
      handler: async ({ body }) => {
        const profileDir = await resolveRequestProfile(body);
        const defaults = await getDefaults(profileDir);
        const outputParent = requireAbsoluteDir(body.outputParent || defaults.exportParent, 'outputParent');
        if (!Array.isArray(body.pluginNames) || body.pluginNames.length === 0) {
          throw new PorterError('Select at least one plugin to export.', 400);
        }
        const options = {
          profileDir,
          pluginNames: body.pluginNames,
          outputParent,
          includeDocs: body.includeDocs !== false,
          fetchDocs: body.fetchDocs !== false,
        };
        const job = jobs.start('export', async () => {
          const summary = await exportPlugins(options);
          await writeState(profileDir, {
            lastExportParent: path.dirname(summary.targetDir),
            includeDocs: options.includeDocs,
            fetchDocs: options.fetchDocs,
          }).catch(() => {});
          logger?.info?.(`[dsh-plugin-porter] exported ${summary.plugins.length} plugin(s) to ${summary.targetDir}`);
          return summary;
        });
        return { status: 202, body: { ok: true, jobId: job.id, state: job.state } };
      },
    }),
    route({
      path: `${API_PREFIX}/job`,
      method: 'GET',
      handler: async ({ req }) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const jobId = url.searchParams.get('jobId');
        if (!jobId) throw new PorterError('jobId is required.', 400);
        const job = jobs.get(jobId);
        if (!job) throw new PorterError(`Unknown job: ${jobId}`, 404);
        return job;
      },
    }),
    route({
      path: `${API_PREFIX}/import/scan`,
      method: 'POST',
      jsonBody: true,
      handler: async ({ body }) => {
        const profileDir = await resolveRequestProfile(body);
        const dir = requireAbsoluteDir(body.dir, 'dir');
        const job = jobs.start('scan', async () => {
          const result = await scanExport(dir, profileDir);
          await writeState(profileDir, { lastImportDir: dir }).catch(() => {});
          return result;
        });
        return { status: 202, body: { ok: true, jobId: job.id, state: job.state } };
      },
    }),
    route({
      path: `${API_PREFIX}/import/install`,
      method: 'POST',
      jsonBody: true,
      handler: async ({ body }) => {
        const profileDir = await resolveRequestProfile(body);
        const dir = requireAbsoluteDir(body.dir, 'dir');
        if (!Array.isArray(body.pluginNames) || body.pluginNames.length === 0) {
          throw new PorterError('Select at least one plugin to install.', 400);
        }
        const job = jobs.start('install', async () => {
          const result = await installExport({
            exportDir: dir,
            pluginNames: body.pluginNames,
            profileDir,
            allowUnverified: body.allowUnverified === true,
          });
          logger?.info?.(`[dsh-plugin-porter] installed ${result.installed.length} plugin(s) from ${dir}`);
          return result;
        });
        return { status: 202, body: { ok: true, jobId: job.id, state: job.state } };
      },
    }),
  ];

  for (const entry of routeEntries) entry.ctx = ctx;

  ctx.effect(() => {
    const disposers = [];
    for (const entry of routeEntries) {
      disposers.push(ctx.webServer.register(entry));
    }
    disposers.push(
      ctx.webServer.register({
        kind: 'prefix',
        path: API_PREFIX,
        handler: async (req, res) => {
          if (!res.writableEnded) writeError(res, 404, `Unknown dsh-plugin-porter API route: ${req.method} ${req.url}`);
        },
      }),
    );
    logger?.info?.(`[dsh-plugin-porter] routes registered under ${API_PREFIX}`);
    return () => {
      for (const dispose of disposers.reverse()) {
        try {
          dispose();
        } catch {
          // ignore disposal errors
        }
      }
    };
  }, 'dsh-plugin-porter: http routes');
}
