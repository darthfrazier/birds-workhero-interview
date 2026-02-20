import { open, type RootDatabase } from 'lmdb';

const KEYS = {
  JOBS_CREATED: 'jobs_created',
  RESULT_REQUESTS: 'result_requests',
  PROCESSING_ERRORS: 'processing_errors',
  JOBS_PROCESSED_PREFIX: 'jobs_processed:',
} as const;

export class Metrics {
  private db: RootDatabase;

  constructor(path: string = './metrics') {
    this.db = open({ path });
  }

  private async increment(key: string): Promise<void> {
    await this.db.transaction(() => {
      const current = (this.db.get(key) as number | undefined) ?? 0;
      this.db.put(key, current + 1);
    });
  }

  recordJobCreated(): Promise<void> {
    return this.increment(KEYS.JOBS_CREATED);
  }

  recordJobResultRequest(): Promise<void> {
    return this.increment(KEYS.RESULT_REQUESTS);
  }

  recordJobProcessed(workerId: number): Promise<void> {
    return this.increment(`${KEYS.JOBS_PROCESSED_PREFIX}${workerId}`);
  }

  recordProcessingError(): Promise<void> {
    return this.increment(KEYS.PROCESSING_ERRORS);
  }
}
