import { getSourcePlugin } from './registry.mjs';

// arXiv permits up to 2,000 results per response. Larger pages reduce the
// number of globally rate-limited requests while keeping each DB transaction
// well below Postgres' parameter limit.
const PAGE_SIZE = 2000;
const POLL_MS = 2000;

/**
 * One serialized, resumable source worker. Paper rows and the page cursor are
 * committed together, so a process restart cannot skip a page. The injected
 * request function owns per-source throttling and retry policy.
 */
export function startIngestionWorker({ db, request }) {
  let stopped = false;
  let busy = false;
  let timer = null;

  async function processJob(initialJob) {
    const source = getSourcePlugin(initialJob.sourceId);
    if (!source) {
      await db.failIngestJob(initialJob.id, `Unknown source plugin: ${initialJob.sourceId}`);
      return;
    }

    const { slices } = source.plan(initialJob.config);
    while (!stopped) {
      const job = await db.getIngestJobForWorker(initialJob.id);
      if (!job || job.status !== 'running') return;
      if (job.sliceIndex >= slices.length) {
        await db.completeIngestJob(job.id);
        return;
      }

      const slice = slices[job.sliceIndex];
      const page = await source.fetchPage({
        slice,
        start: job.pageStart,
        pageSize: PAGE_SIZE,
        jobId: job.id,
        request,
      });
      const sliceDone = !page.hasMore;
      await db.commitIngestPage(job.id, page.papers.map(paper => ({ ...paper, userId: job.userId })), {
        sliceDone,
        nextStart: job.pageStart + page.papers.length,
        sliceLabel: slice.label,
        totalSlices: slices.length,
      });
    }
  }

  async function tick() {
    if (stopped || busy) return;
    busy = true;
    try {
      const job = await db.claimNextIngestJob();
      if (job) {
        try {
          await processJob(job);
        } catch (error) {
          await db.failIngestJob(job.id, error?.message ?? 'Import failed');
          console.error(`[ingest] job ${job.id} failed:`, error?.message ?? error);
        }
      }
    } catch (error) {
      console.error('[ingest] worker error:', error?.message ?? error);
    } finally {
      busy = false;
    }
  }

  timer = setInterval(() => { void tick(); }, POLL_MS);
  void tick();
  console.log('[ingest] persistent source worker active');

  return () => {
    stopped = true;
    if (timer) clearInterval(timer);
  };
}
