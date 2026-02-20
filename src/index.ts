import express from 'express';
import { open } from 'lmdb';
import { randomUUID } from 'crypto';
import type { Job } from './types.js';

const app = express();
const port = 3200;

const db = open({ path: './data' });

app.use(express.json());

app.get('/bird', (req, res) => {
  const { name } = req.query;

  for (const { value } of db.getRange()) {
    const job = value as Job;
    if (job?.name === name) {
      if (job.status !== 'complete') {
        res.status(404).json({ error: 'Job not complete' });
        return;
      }
      res.json({ id: job.id, name: job.name, status: job.status, createdAt: job.createdAt, result: job.result });
      return;
    }
  }

  res.status(404).json({ error: 'Job not found' });
});

app.post('/bird', async (req, res) => {
  const { name } = req.body;

  for (const { value } of db.getRange()) {
    const existing = value as Job;
    if (existing?.name === name) {
      res.status(409).json({ error: 'Job with this name already exists' });
      return;
    }
  }

  const id = randomUUID();
  const job = { id, name, status: 'queued', createdAt: new Date().toISOString() };
  await db.put(id, job);
  res.status(201).json(job);
});

export { app };

if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
}

