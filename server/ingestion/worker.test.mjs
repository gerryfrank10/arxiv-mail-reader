import { describe, expect, it } from 'vitest';
import { startIngestionWorker } from './worker.mjs';

describe('ingestion worker diagnostics', () => {
  it('persists provider retries and the exact failed checkpoint', async () => {
    let available = true;
    let currentJob;
    let resolveFailure;
    const failed = new Promise(resolve => { resolveFailure = resolve; });
    const job = {
      id: 'job-429',
      userId: 'user-1',
      sourceId: 'arxiv',
      config: { categories: ['cs.CV'], fromYear: 2000, toYear: 2000 },
      status: 'running',
      sliceIndex: 0,
      pageStart: 2000,
      totalSlices: 12,
      papersAdded: 123,
      papersSkipped: 4,
    };
    const db = {
      async claimNextIngestJob() {
        if (!available) return null;
        available = false;
        currentJob = { ...job };
        return currentJob;
      },
      async getIngestJobForWorker() { return currentJob; },
      async setIngestJobCurrentSlice(_id, label) {
        currentJob.currentSlice = label;
        return true;
      },
      async failIngestJob(_id, message, details) {
        resolveFailure({ message, details });
      },
    };
    const stop = startIngestionWorker({
      db,
      request: async () => {
        const error = new Error('arXiv returned HTTP 429.');
        Object.assign(error, {
          provider: 'arXiv',
          status: 429,
          attempts: 5,
          retryDelaysMs: [4000, 10000, 25000, 45000],
          retryDelaySources: ['configured exponential backoff', 'configured exponential backoff', 'configured exponential backoff', 'configured exponential backoff'],
        });
        throw error;
      },
    });

    try {
      const result = await failed;
      expect(result.message).toContain('HTTP 429');
      expect(result.details).toMatchObject({
        provider: 'arXiv',
        status: 429,
        attempts: 5,
        retryDelaysMs: [4000, 10000, 25000, 45000],
        currentSlice: 'cs.CV · 2000-01',
        pageStart: 2000,
        sliceIndex: 0,
        totalSlices: 12,
        papersAdded: 123,
        papersSkipped: 4,
      });
      expect(result.details.recommendation).toContain('Wait at least 15 minutes');
    } finally {
      stop();
    }
  });
});
