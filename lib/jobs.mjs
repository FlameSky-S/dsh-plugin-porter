import { randomUUID } from 'node:crypto';

/**
 * Small in-memory registry for long-running operations.
 *
 * Desktop clients carry fetch over an IPC bridge, and browser deployments may
 * close a socket after a request has been open for a while. Exporting a large
 * dependency closure can take minutes, so the HTTP request only starts the
 * work and a second, short request polls for the result.
 */
export class JobRegistry {
  constructor({ ttlMs = 15 * 60 * 1000, maxJobs = 50 } = {}) {
    this.ttlMs = ttlMs;
    this.maxJobs = maxJobs;
    this.jobs = new Map();
  }

  start(kind, runner) {
    this.#sweep();
    const id = `job_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
    const job = {
      id,
      kind,
      state: 'running',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      result: undefined,
      error: undefined,
    };
    this.jobs.set(id, job);
    Promise.resolve()
      .then(runner)
      .then((result) => {
        if (this.jobs.get(id) !== job) return;
        job.state = 'done';
        job.result = result;
        job.updatedAt = Date.now();
      })
      .catch((error) => {
        if (this.jobs.get(id) !== job) return;
        job.state = 'error';
        job.error = error instanceof Error ? error.message : String(error);
        job.details = error && error.details !== undefined ? error.details : undefined;
        job.updatedAt = Date.now();
      });
    return { id, state: job.state };
  }

  get(id) {
    const job = this.jobs.get(id);
    if (!job) return undefined;
    return {
      id: job.id,
      kind: job.kind,
      state: job.state,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      result: job.state === 'done' ? job.result : undefined,
      error: job.state === 'error' ? job.error : undefined,
      details: job.state === 'error' ? job.details : undefined,
    };
  }

  #sweep() {
    const now = Date.now();
    for (const [id, job] of this.jobs) {
      if (job.state !== 'running' && now - job.updatedAt > this.ttlMs) this.jobs.delete(id);
    }
    if (this.jobs.size <= this.maxJobs) return;
    const finished = [...this.jobs.values()]
      .filter((job) => job.state !== 'running')
      .sort((a, b) => a.updatedAt - b.updatedAt);
    for (const job of finished) {
      if (this.jobs.size <= this.maxJobs) break;
      this.jobs.delete(job.id);
    }
  }
}
