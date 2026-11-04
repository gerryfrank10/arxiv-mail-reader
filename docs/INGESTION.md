# Historical paper ingestion

## What is implemented

The **History** tab in Import papers creates a durable server-side import job.
It can scan one or more arXiv categories from 2000 through a selected year,
checkpointed by category, month, and result page. Jobs are stored in Postgres,
so closing the browser does not interrupt them. After a server restart,
in-progress jobs are returned to the queue at their last committed page.

The job UI supports pause, resume, retry after an error, and cancel. Cancelling
stops future pages; papers already committed remain in the library. Each result
page and its cursor are written in one transaction, so a crash cannot checkpoint
past papers that were not saved.

If arXiv returns HTTP 429 after the retry schedule is exhausted, the job stops
as failed and keeps the failing month/page cursor. Its diagnostic panel records
the provider, HTTP status, attempt count, retry waits (and whether each came
from `Retry-After` or the app's backoff), failed window, page offset, and saved
totals. The server enforces a 15-minute cooldown before a rate-limited job can
resume. Resume retries the saved page and does not remove or duplicate
committed papers.

The importer fetches metadata and abstracts only. PDFs are still fetched on
demand, avoiding a huge and unnecessary download job. Existing papers are
deduplicated by the current per-user arXiv id key, including overlap between
categories and papers already in the account.

## Using it

1. Open **Import papers → History**.
2. Enter the arXiv categories for your field, comma-separated (for example
   `cs.AI, cs.LG`). Use the taxonomy categories that match your research; the
   application does not guess a field from a natural-language description yet.
3. Choose a start year (2000 or later) and end year.
4. Start the job. It continues on the server; reopen the History tab to monitor
   it or control it.

The job is partitioned into monthly date windows. The app serializes arXiv
requests through the shared rate-limited queue and retries temporary failures.
Pages request up to 2,000 records at a time. Large pulls can take a long time;
there is deliberately no browser timeout or single-session requirement. The UI reports completed windows, papers added,
duplicates, current window, and any error. It does not estimate a paper count
before the source query runs.

The dates are **arXiv submission dates**, not the date a paper appeared in a
journal or conference. For historical published literature outside arXiv, a
separate source plugin is needed.

## Source plugin architecture

Built-in trusted source plugins are registered in
`server/ingestion/registry.mjs`. The first plugin is
`server/ingestion/sources/arxiv.mjs`:

```js
{
  id,
  label,
  plan(config) -> { config, slices },
  fetchPage({ slice, start, pageSize, jobId, request })
    -> { papers, hasMore }
}
```

The source owns provider-specific planning, pagination, and normalization. The
shared worker (`server/ingestion/worker.mjs`) owns durable job state, checkpoint
transactions, lifecycle, and errors. The source's `request` callback must use a
single provider-wide throttle and retry policy, shared with interactive search
and metadata requests.

Plugins are registered as code, not downloaded or evaluated from user settings.
This keeps credentials, network access, and database writes inside the trusted
server boundary. A new source should also have fixtures and tests for its
normalizer and pagination boundaries.

## Current limits and next architecture steps

- Historical search currently supports **arXiv categories**. It does not yet
  combine keywords, author filters, or other providers into one profile.
- `papers.arxiv_id` is still the database identity. Before a non-arXiv source is
  added, the schema must gain generic source/external identifiers and DOI-based
  cross-source deduplication while preserving existing arXiv references.
- Source ingestion is now a plugin boundary; **feature plugins are the next
  step**. Magazine and Tracker still have providers mounted by `AppLayout` and
  are not yet independently enableable. The intended feature registry will
  contribute navigation, routes, settings, and data migrations, while core
  retains accounts, papers, library, and the job runner. Disabling a feature
  must not delete its data.
- OpenAlex is a candidate for a broad, publication-date-based literature
  source; its current API has key/usage requirements, which should be visible
  to users rather than hidden inside a silent background crawl. PubMed,
  OpenReview, ACL Anthology, and publisher-specific adapters can follow where
  relevant to the user's field.

The next high-value change is extracting Magazine and Tracker behind a small
first-party feature registry and publishing core `papers.ingested` events so
features consume batches without coupling to React paper-array updates.
