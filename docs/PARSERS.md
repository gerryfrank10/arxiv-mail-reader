# Paper source parsers

The app turns incoming papers into records with the same shape (`Paper` in
`src/types/index.ts`), no matter where they came from. Today almost everything
is **arXiv**. This document describes how other publishing sites will plug in,
what is supported now, and what is planned.

## Current support

| Source | Ingest path | Status |
| --- | --- | --- |
| arXiv (digest emails) | IMAP → `parseArxivEmail` (`src/utils/emailParser.ts`) | Supported |
| arXiv (id / URL import) | `src/utils/paperImport.ts`, `/api/arxiv-metadata*` | Supported |
| arXiv (historical category imports) | `server/ingestion/sources/arxiv.mjs` + durable job worker | Supported; category/month checkpoints, year range from 2000 |
| arXiv (abstracts) | `scripts/backfill-abstracts.mjs`, `/api/arxiv-abstract` | Supported |
| BibTeX (`.bib`) | `src/utils/paperImport.ts` | Supported. Does not set `publisher` yet, so the badge falls back to the URL or "Unknown source" (planned: read `journal`/`booktitle`/`publisher` fields) |
| Local PDF upload | `/api/db/papers/:id/upload` | Supported, publisher shown as "Local upload" |
| OpenReview, ACL Anthology, PMLR / NeurIPS, bioRxiv / medRxiv, IEEE, ACM DL, Nature / Science, Springer / Elsevier, PubMed | — | Planned, see below |

## Where the publisher comes from

Every card in the Dashboard feed shows the **publishing place** as its
header. The answer is computed in one place, `src/utils/publisher.ts`
(`publisherOf`), in this order:

1. An explicit `paper.publisher` set by a parser or importer (for example
   `"OpenReview"`). It wins over everything else.
2. The arXiv id or an `arxiv.org` URL → **arXiv**.
3. The host of `paper.url` or `paper.pdfUrl`, matched against known publishers
   (e.g. `openreview.net` → OpenReview, `aclanthology.org` → ACL Anthology).
   Unknown hosts are shown by their hostname.
4. Uploaded files with no remote URL → **Local upload**.

Parsers should therefore always set `publisher` when they know it. The URL
heuristic is only a fallback.

## Historical source plugin contract (implemented)

Durable server-side sources use the plugin interface in
`server/ingestion/registry.mjs`. See [INGESTION.md](INGESTION.md) for the full
contract and job lifecycle. A source plans checkpointable work slices and
fetches one page at a time; the shared worker commits each page together with
its cursor.

## Parser adapter contract (planned)

A separate parser adapter will handle single IDs, URLs, and incoming mail. It
will answer four questions: does this input belong to me, how do I read it,
how do I enrich it, and how is it named.

```ts
interface PaperSourceAdapter {
  /** Stable key stored with the paper, e.g. 'openreview'. Lowercase, no spaces. */
  id: string;
  /** Display name shown on feed cards, e.g. 'OpenReview'. */
  label: string;
  /** Cheap, synchronous check on a URL, DOI, id or email sender. */
  match(input: string): boolean;
  /** Turn raw input (an email body, an HTML page, an API payload) into papers. */
  parse(raw: string | unknown): Promise<Paper[]> | Paper[];
  /** Optional: fill in the abstract or other metadata for an existing paper. */
  fetchMetadata?(paper: Paper, signal?: AbortSignal): Promise<Partial<Paper> | null>;
}
```

Rules every parser adapter must follow:

- **Set `publisher` and `source`.** `publisher` is the `label`. `source` stays
  one of `'email' | 'import' | 'upload'` (how it arrived, not where it was
  published).
- **Keep native identity.** For arXiv, set `arxivId` to its canonical id. The
  current `Paper`/database model requires `arxivId` and uniquely keys on
  `(user_id, arxiv_id)`. Do not permanently put a DOI into that field; a
  non-arXiv source must wait for the generic `source_id`/`external_id` schema
  migration described in [INGESTION.md](INGESTION.md).
- **Abstract is required when available.** Abstracts shown on the feed come
  from `paper.abstract`. If a digest omits it, `fetchMetadata` fills it in
  later, the same way the arXiv backfill does.
- **Be polite.** Batch requests, pace them, back off on 429/503, and never
  hammer a site from the browser. Server-side fetches go through `server/index.mjs`
  so they sit behind the login gate.
- **No scraping behind logins or paywalls.** Use official APIs, OAI-PMH feeds,
  or public metadata only.

## Dedupe and versions

- The same paper often appears on several sites (arXiv and a conference
  proceedings page, for example). Dedupe on the DOI when there is one, then on a
  normalised title plus first author. Keep the first record and link the others
  rather than creating duplicates.
- arXiv versions (`v1`, `v2`) share a base id. Abstracts can change between
  versions, so the version that was imported is the one kept (see the
  "respect the arXiv version you give" change in the git history).

## Per-user parser settings (planned)

Each account should be able to choose which sources it follows and how they
arrive:

- **Mail senders**: the digest sender addresses per source (arXiv is
  `no-reply@arxiv.org`; others will be configured here).
- **Enabled sources**: a list of adapter ids. Papers from disabled sources are
  not ingested.
- **Stored in `Settings`** and synced with the rest of the user's settings, so
  they follow the account across browsers.

Nothing in this section is implemented yet. The current single-source setup is
the arXiv sender in `Settings.senderEmail`.

## Planned sources, in priority order

1. **OpenReview**: ICLR, NeurIPS and TMLR submissions. Public API, with a
   `venue` field.
2. **ACL Anthology**: NLP proceedings. Publishes a bulk XML/BibTeX export.
3. **PMLR / NeurIPS proceedings**: official proceedings pages and BibTeX.
4. **bioRxiv / medRxiv**: public details API by date range.
5. **PubMed**: E-utilities (`esearch` + `efetch`), which give title, abstract
   and DOI.
6. **IEEE Xplore, ACM DL, Springer, Elsevier, Nature, Science**: DOI-based.
   Usually need API keys or licences, so these are last. Until then, a DOI or
   URL import gets the metadata from Crossref.
7. **Generic DOI / URL import**: Crossref metadata by DOI, plus the
   `citation_*` meta tags many publisher pages expose. This is the fallback for
   any site that has no dedicated adapter.

## Adding a source

1. For a durable history source, add a server plugin under
   `server/ingestion/sources/` implementing the checkpointed source contract.
   For one-off URL/email parsing, add a parser under `src/utils/sources/`.
2. Register it in the relevant source registry and add its configuration to
   the import/job UI.
3. Add its host to `KNOWN` in `src/utils/publisher.ts` so the badge and colour
   are right even when `publisher` is missing.
4. Add a fixture-based test next to the adapter (see
   `src/utils/__tests__/`).
5. Update the table at the top of this file.
