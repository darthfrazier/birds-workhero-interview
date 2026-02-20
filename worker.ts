import { open } from 'lmdb';
import type { Job } from './src/types.js';

const db = open({ path: './data' });

async function claimJob(): Promise<Job | null> {
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

async function fetchWikipedia(name: string): Promise<{ extract?: string } | null> {
  const url = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&redirects=1&titles=${encodeURIComponent(name)}&format=json&formatversion=2`;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json() as {
        query: { pages: Array<{ pageid: number; title: string; extract?: string }> };
      };

      return data.query.pages[0] ?? null;
    } catch (err) {
      if (attempt === MAX_RETRIES) throw err;
      const delay = BASE_DELAY_MS * 2 ** attempt;
      console.warn(`Wikipedia fetch failed (attempt ${attempt + 1}/${MAX_RETRIES}), retrying in ${delay}ms:`, err);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  return null;
}

async function processJob(job: Job): Promise<void> {
  try {
    const page = await fetchWikipedia(job.name);
    await db.put(job.id, { ...job, status: 'complete', result: page?.extract ?? null });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await db.put(job.id, { ...job, status: 'failed', error });
  }
}

async function runWorker(workerId: number): Promise<void> {
  console.log(`Worker ${workerId} started (PID ${process.pid})`);

  while (true) {
    const job = await claimJob();

    if (job) {
      console.log(`[Worker ${workerId}] Claimed job ${job.id} (${job.name})`);
      await processJob(job);
      console.log(`[Worker ${workerId}] Finished job ${job.id}`);
    } else {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

const concurrency = parseInt(process.env.WORKER_CONCURRENCY ?? '1', 10);
console.log(`Starting ${concurrency} worker(s)`);
Promise.all(Array.from({ length: concurrency }, (_, i) => runWorker(i + 1)));
