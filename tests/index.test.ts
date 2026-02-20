import { vi, describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/index.js';

const mockDb = vi.hoisted(() => ({
  getRange: vi.fn<() => { key: string; value: unknown }[]>(),
  put: vi.fn().mockResolvedValue(true),
  get: vi.fn().mockReturnValue(undefined),
  transaction: vi.fn((cb: () => unknown) => cb()),
}));

vi.mock('lmdb', () => ({
  open: () => mockDb,
}));

describe('GET /bird', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 404 when no job exists with the given name', async () => {
    mockDb.getRange.mockReturnValue([]);

    const res = await request(app).get('/bird').query({ name: 'Robin' });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Job not found' });
  });

  it('returns 404 when the job exists but is not complete', async () => {
    mockDb.getRange.mockReturnValue([
      { key: 'id-1', value: { id: 'id-1', name: 'Robin', status: 'queued', createdAt: '2026-01-01T00:00:00.000Z' } },
    ]);

    const res = await request(app).get('/bird').query({ name: 'Robin' });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Job not complete' });
  });

  it('returns 404 when the job is processing', async () => {
    mockDb.getRange.mockReturnValue([
      { key: 'id-1', value: { id: 'id-1', name: 'Robin', status: 'processing', createdAt: '2026-01-01T00:00:00.000Z' } },
    ]);

    const res = await request(app).get('/bird').query({ name: 'Robin' });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Job not complete' });
  });

  it('returns the full job when status is complete', async () => {
    const job = { id: 'id-1', name: 'Robin', status: 'complete', createdAt: '2026-01-01T00:00:00.000Z', result: 'The robin is a small bird.' };
    mockDb.getRange.mockReturnValue([{ key: 'id-1', value: job }]);

    const res = await request(app).get('/bird').query({ name: 'Robin' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(job);
  });
});

describe('POST /bird', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 201 with id, name, status, and createdAt', async () => {
    const res = await request(app).post('/bird').send({ name: 'Eagle' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Eagle', status: 'queued' });
    expect(res.body.id).toBeDefined();
    expect(res.body.createdAt).toBeDefined();
  });

  it('stores the job in the database', async () => {
    const res = await request(app).post('/bird').send({ name: 'Eagle' });

    expect(mockDb.put).toHaveBeenCalledWith(
      res.body.id,
      expect.objectContaining({ id: res.body.id, name: 'Eagle', status: 'queued' }),
    );
  });

  it('returns 409 when a job with the same name already exists', async () => {
    mockDb.getRange.mockReturnValue([
      { key: 'id-1', value: { id: 'id-1', name: 'Eagle', status: 'queued', createdAt: '2026-01-01T00:00:00.000Z' } },
    ]);

    const res = await request(app).post('/bird').send({ name: 'Eagle' });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Job with this name already exists' });
    expect(mockDb.put).not.toHaveBeenCalled();
  });
});
