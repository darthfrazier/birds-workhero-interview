import { open } from 'lmdb';
import type { Job } from '../src/types.js';
import { Metrics } from '../observability/metrics.js';

const db = open({ path: './data' });
const metrics = new Metrics();

const pid = process.pid;
const log = (workerId: number, msg: string) => console.log(`[PID ${pid}] [Worker ${workerId}] ${msg}`);

export async function claimJob(): Promise<Job | null> {
  return db.transaction(() => {
    for (const { key, value } of db.getRange()) {
      const job = value as Job;
      if (job?.status === 'queued') {
        db.put(key as string, { ...job, status: 'processing' });
        return { ...job, status: 'processing' };
      }
    }
    return null;
  });
}

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 500;

async function fetchWikipedia(name: string, workerId: number): Promise<{ extract?: string } | null> {
  const url = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&redirects=1&titles=${encodeURIComponent(name)}&format=json&formatversion=2`;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    log(workerId, `Fetching Wikipedia for "${name}" (attempt ${attempt + 1}/${MAX_RETRIES + 1})`);
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json() as {
        query: { pages: Array<{ pageid: number; title: string; extract?: string }> };
      };

      log(workerId, `Wikipedia fetch succeeded for "${name}"`);
      return data.query.pages[0] ?? null;
    } catch (err) {
      if (attempt === MAX_RETRIES) throw err;
      const delay = BASE_DELAY_MS * 2 ** attempt;
      log(workerId, `Wikipedia fetch failed for "${name}", retrying in ${delay}ms: ${err}`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  return null;
}

export async function processJob(job: Job, workerId: number): Promise<void> {
  log(workerId, `Processing job ${job.id} (${job.name})`);
  try {
    const page = await fetchWikipedia(job.name, workerId);
    await db.put(job.id, { ...job, status: 'complete', result: page?.extract ?? null });
    log(workerId, `Job ${job.id} complete`);
    await metrics.recordJobProcessed(workerId);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await db.put(job.id, { ...job, status: 'failed', error });
    log(workerId, `Job ${job.id} failed: ${error}`);
    await metrics.recordProcessingError();
  }
}

async function runWorker(workerId: number): Promise<void> {
  log(workerId, `Started`);

  while (true) {
    const job = await claimJob();

    if (job) {
      log(workerId, `Claimed job ${job.id} (${job.name})`);
      await processJob(job, workerId);
    } else {
      log(workerId, `No jobs queued, polling in 1s`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

if (process.env.NODE_ENV !== 'test') {
  const concurrency = parseInt(process.env.WORKER_CONCURRENCY ?? '1', 10);
  console.log(`[PID ${pid}] Starting ${concurrency} worker(s)`);
  Promise.all(Array.from({ length: concurrency }, (_, i) => runWorker(i + 1)));
}
