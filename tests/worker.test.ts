import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

const mockDb = vi.hoisted(() => ({
  getRange: vi.fn<() => { key: string; value: unknown }[]>(),
  put: vi.fn().mockResolvedValue(true),
  get: vi.fn().mockReturnValue(undefined),
  transaction: vi.fn((cb: () => unknown) => cb()),
}));

vi.mock('lmdb', () => ({
  open: () => mockDb,
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { claimJob, processJob } from '../daemons/worker.js';

const baseJob = { id: 'job-1', name: 'Robin', status: 'queued', createdAt: '2026-01-01T00:00:00.000Z' };

describe('claimJob', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null when there are no queued jobs', async () => {
    mockDb.getRange.mockReturnValue([]);

    const job = await claimJob();

    expect(job).toBeNull();
    expect(mockDb.put).not.toHaveBeenCalled();
  });

  it('skips jobs that are not queued', async () => {
    mockDb.getRange.mockReturnValue([
      { key: 'job-1', value: { ...baseJob, status: 'processing' } },
      { key: 'job-2', value: { ...baseJob, id: 'job-2', status: 'complete' } },
    ]);

    const job = await claimJob();

    expect(job).toBeNull();
    expect(mockDb.put).not.toHaveBeenCalled();
  });

  it('claims the first queued job and sets status to processing', async () => {
    mockDb.getRange.mockReturnValue([
      { key: 'job-1', value: baseJob },
    ]);

    const job = await claimJob();

    expect(job).toMatchObject({ id: 'job-1', name: 'Robin', status: 'processing' });
    expect(mockDb.put).toHaveBeenCalledWith('job-1', expect.objectContaining({ status: 'processing' }));
  });

  it('claims only the first queued job when multiple are queued', async () => {
    mockDb.getRange.mockReturnValue([
      { key: 'job-1', value: baseJob },
      { key: 'job-2', value: { ...baseJob, id: 'job-2' } },
    ]);

    const job = await claimJob();

    expect(job?.id).toBe('job-1');
    expect(mockDb.put).toHaveBeenCalledTimes(1);
  });
});

describe('processJob', () => {
  const processingJob = { ...baseJob, status: 'processing' };

  beforeEach(() => vi.clearAllMocks());

  afterEach(() => vi.useRealTimers());

  it('marks the job complete with the Wikipedia extract on success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        query: { pages: [{ pageid: 1, title: 'Robin', extract: 'The robin is a small bird.' }] },
      }),
    });

    await processJob(processingJob, 1);

    expect(mockDb.put).toHaveBeenCalledWith('job-1', expect.objectContaining({
      status: 'complete',
      result: 'The robin is a small bird.',
    }));
  });

  it('stores null result when Wikipedia returns no extract', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        query: { pages: [{ pageid: 1, title: 'Robin' }] },
      }),
    });

    await processJob(processingJob, 1);

    expect(mockDb.put).toHaveBeenCalledWith('job-1', expect.objectContaining({
      status: 'complete',
      result: null,
    }));
  });

  it('marks the job failed with an error message after all retries are exhausted', async () => {
    vi.useFakeTimers();
    mockFetch.mockRejectedValue(new Error('Network error'));

    const processPromise = processJob(processingJob, 1);
    await vi.runAllTimersAsync();
    await processPromise;

    expect(mockDb.put).toHaveBeenCalledWith('job-1', expect.objectContaining({
      status: 'failed',
      error: 'Network error',
    }));
  });

  it('retries on non-ok HTTP responses before failing', async () => {
    vi.useFakeTimers();
    mockFetch.mockResolvedValue({ ok: false, status: 503 });

    const processPromise = processJob(processingJob, 1);
    await vi.runAllTimersAsync();
    await processPromise;

    expect(mockFetch).toHaveBeenCalledTimes(6); // 1 initial + 5 retries
    expect(mockDb.put).toHaveBeenCalledWith('job-1', expect.objectContaining({ status: 'failed' }));
  });
});
