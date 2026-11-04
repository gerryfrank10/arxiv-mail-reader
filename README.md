# Engai — arXiv Mail Reader

A research workspace built around your arXiv digest emails. It reads your arXiv
alert emails (Gmail or any IMAP mailbox), parses the papers, and surrounds them
with tools to read, organize, discover, track, and **write** — with optional AI
assistance and a Postgres backend for durable, cross-device storage.

The original reader (parse digests → browse beautifully) is still at its core;
everything else is built on top.

---

## Features

**Reading**
- **Smart parser** — pulls title, authors, categories, abstract, arXiv ID, and PDF link out of arXiv's plaintext digest format
- **LaTeX rendering** — inline and display math via [KaTeX](https://katex.org/)
- **Offline full text** — with server storage, a paper's PDF is downloaded once, stored in `uploads/papers/`, and its text is extracted into Postgres. Every later open is instant; no arxiv.org round-trip
- **Search & filter** — full-text search, category and author filters, assessment filter
- **Dashboard** — stats cards, category distribution, papers-over-time timeline

**Library & discovery**
- **Library** — bookmark papers into a personal collection
- **Discover** — search any topic (Semantic Scholar, with OpenAlex fallback) and add results; from any paper, explore its **references, citations, and similar work**
- **Trackers** — define topic trackers that score incoming papers (AI or keyword based) so the important ones surface

**Import** (sidebar ⬆ button)
- **Single / Bulk paste** — paste arXiv IDs or URLs (one or many)
- **BibTeX** — upload a `.bib` from Zotero/Mendeley/Google Scholar
- **From arXiv** — pull papers straight from the arXiv API by **category, author, or keyword**, optionally within a date range — ideal for backfilling a field

**Writer** (research drafting)
- **Templates** — IMRaD paper, IEEE/ACM conference, literature review, proposal, note, blank
- **Live-preview Markdown editor** (CodeMirror) — headings, bold/italic/code render as you type; native undo/redo
- **AI co-writer** — Continue / Expand / Tighten / Academic / Abstract / Related Work, plus a **highlight popover** with an "Ask AI" custom instruction grounded in your cited references
- **Citations** — cite saved papers/books inline; AI citation suggestions from your library
- **Pace tracker** — daily word goal, session delta, focus sprint
- **Export** — Word (`.doc`), PDF (print), or Markdown

**More**
- **Books** — a bookshelf with file uploads and ISBN lookup
- **Magazine** — a weekly auto-generated digest from external sources (Hacker News, tech/science news, Hugging Face, GitHub, ModelScope) with AI editorials, field-adaptive to your inbox
- **Collections & Cross-references** — group and link papers, books, and documents
- **AI providers** — Claude, OpenAI, Groq, Ollama, or any OpenAI-compatible endpoint; two-tier profiles (a premium model + a cheap/local default) with per-purpose routing, an activity log, and a master pause switch

**Login**
- **Email + password** accounts stored in Postgres (scrypt hashes, 30-day
  sessions). The first account is seeded from `SEED_USER_EMAIL` /
  `SEED_USER_PASSWORD`; anyone else can create their own account and library.
- **Mailbox credentials** (IMAP host/port/username/app password) are entered
  after sign-in under **Settings → Email & sync** and stored in that browser.

---

## Architecture

- **Frontend** — React + TypeScript + Vite + Tailwind
- **Backend** — Node/Express (`server/index.mjs`) — proxies arXiv/Semantic Scholar/AI calls, fetches IMAP mail, and serves the built frontend in production
- **Database** — PostgreSQL (optional)

Storage has two modes:
- **Server mode (Postgres, required for accounts)** — set `DATABASE_URL`; login,
  sessions and the `/api/db/*` routes (Books, Writer, Magazine, Collections,
  Cross-refs, trackers, cross-device sync) all live here.
- **IndexedDB (per-browser cache)** — the paper list can still be cached
  locally, but signing in requires the backend + Postgres.

In server mode, opening an arXiv paper downloads its PDF once into
`uploads/papers/<user>/` and extracts its text into `papers.full_text`. The
**Library → Cache PDFs** button does the same for every saved paper in the
background (one download every ~3 s to respect arXiv's rate limits). Set
`ARXIV_PDF_GAP_MS` to change that gap.

> Node **22+** is required (the PDF text extractor uses `unpdf`/PDF.js). The
> Docker image already uses `node:22-alpine`.

---

## Quick start

### Option A — Everything in Docker (recommended)

Runs the frontend, backend, and Postgres together. Same command locally or on a
server.

```bash
git clone https://github.com/gerryfrank10/arxiv-mail-reader.git
cd arxiv-mail-reader
cp .env.example .env        # fill in what you need (all optional)

npm run app:up              # build + start app + db
# → open http://localhost:3001
```

Useful commands: `npm run app:logs`, `npm run app:restart`, `npm run app:down`.
Full guide (remote deploy, HTTPS, Ollama) in **[DEPLOY.md](DEPLOY.md)**.

### Option B — Local dev (hot reload)

```bash
npm install
npm run db:up               # start Postgres in Docker (optional, for server features)
npm run dev:all             # Vite (:5173) + API (:3001)
# → open http://localhost:5173
```

`npm run dev` alone runs only the frontend, but sign-in needs the API and
Postgres — use `npm run dev:all` plus `npm run db:up`.

> Run **either** Docker (`:3001`) **or** dev (`:5173`) — both use port 3001 for
> the API, so don't run them at once.

---

## Configuration (`.env`)

Everything is optional — the app degrades gracefully. Copy `.env.example` to
`.env`. Highlights:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Connect Postgres — required for accounts, sessions and all library data. |
| `SEED_USER_EMAIL` | Owner account created/adopted on first start. |
| `SEED_USER_PASSWORD` | Password set once, when the owner account has none yet. |
| `SEED_LEGACY_EMAIL` | Existing user email to rename to `SEED_USER_EMAIL` so its papers stay attached. |
| `PORT` | API port (default 3001). |
| `SEMANTIC_SCHOLAR_API_KEY` | Higher rate limits for Discover + citation graph. |
| `OPENALEX_MAILTO` | Polite-pool contact for OpenAlex (and the arXiv User-Agent). |
| `DISABLE_MAGAZINE_SCHEDULER` | `1` to stop the weekly Magazine worker. |

> Non-`VITE_`-prefixed values (API keys, `DATABASE_URL`) stay on the server and
> never reach the browser bundle.

### Accounts and first login

On startup the server ensures the owner account exists:

1. If `SEED_LEGACY_EMAIL` is set and `SEED_USER_EMAIL` doesn't exist yet, the
   legacy user row is **renamed** to `SEED_USER_EMAIL` — every paper, library
   entry, like, read state and score keeps its `user_id`, so nothing moves.
2. If that account has no password yet, `SEED_USER_PASSWORD` is applied.
   Later password changes (Settings → Account) are never overwritten.

```dotenv
SEED_USER_EMAIL=you@example.com
SEED_USER_PASSWORD=choose-a-strong-one
SEED_LEGACY_EMAIL=old-address@example.com   # optional, for migrations
```

Everyone else can click **Create an account** on the login screen; each account
gets its own papers, library, trackers and mail settings.

### Abstract backfill

Papers imported from listings can have no abstract. Fill them from the arXiv API
(only empty rows are touched, so re-running is safe):

```bash
npm run backfill:abstracts -- --user=you@example.com
npm run backfill:abstracts -- --all --limit=1000
npm run backfill:abstracts -- --dry-run
```

Requests are batched (50 ids) and paced; `--delay=3000` controls the gap.

---

## AI providers

Configure under **Settings → AI provider** (stored in the browser). AI calls are
proxied through the server to avoid CORS.

- **Ollama (local, free):** keep the base URL `http://localhost:11434/v1`. In
  Docker the server transparently rewrites `localhost` → `host.docker.internal`,
  so the same setting works in dev and in a container.
- **Cloud (Claude / OpenAI / Groq):** paste an API key; these are public URLs.
- For a self-contained server with no host Ollama, an optional bundled Ollama
  container is available (`npm run ollama:up && npm run ollama:pull`) — see
  [DEPLOY.md](DEPLOY.md).

---

## Importing your back catalogue

To backfill papers from before you started:

- **From arXiv tab** — pick a category (e.g. `cs.LG`), optional date range, and a
  max count; the server pulls and imports them (paced to respect arXiv's rate
  limit).
- **BibTeX** — export your existing Zotero/Mendeley library and upload it.
- **Bulk paste** — paste a list of arXiv IDs/URLs.
- Or raise **Settings → Max emails to fetch** to pull more history from your
  digest mailbox.

---

## arXiv sender addresses

Digest emails arrive from `no-reply@arxiv.org` (default) or `cs@arxiv.org`.
Switch in **Settings** anytime.

---

## Project structure

```
src/
├── components/        Views: Reader, Dashboard, Library, Discover, Writer,
│                      Books, Magazine, Collections, Tracking, Import, Settings…
├── contexts/          State: Auth, Papers, Library, Writer, Books, Magazine,
│                      Collections, Tracking, Links, AIActivity, Confirm
└── utils/             emailParser, imapApi, paperImport, researchApi,
                       aiProvider, aiJson, semanticScholar, storage, latex…
server/
├── index.mjs          Express API (arXiv/S2/AI proxies, IMAP, /api/db/*, SPA)
├── db.mjs             Postgres data access
├── sources.mjs        Magazine external-source fetchers
└── migrations/        SQL schema (run on first DB init)
scripts/               backup, restore, migrate, score-papers, backfill-abstracts (CLI)
Dockerfile, docker-compose.yml, DEPLOY.md
```

### npm scripts

| Script | Does |
| --- | --- |
| `dev` / `dev:all` | Frontend only / frontend + API (hot reload) |
| `app:up` / `app:down` / `app:logs` | Full Docker stack (app + db) |
| `db:up` / `db:down` / `db:reset` | Postgres container |
| `ollama:up` / `ollama:pull` | Optional bundled Ollama |
| `build` | Type-check + production build |
| `test` / `test:run` | Vitest |
| `score-papers` | Offline tracker scoring CLI |
| `backfill:abstracts` | Fill missing abstracts from the arXiv API |

---

## Acknowledgements

- [arXiv.org](https://arxiv.org) — open-access preprints
- [Semantic Scholar](https://www.semanticscholar.org/product/api) & [OpenAlex](https://openalex.org) — discovery / citation graph
- [KaTeX](https://katex.org), [CodeMirror](https://codemirror.net), [Recharts](https://recharts.org), [Lucide](https://lucide.dev), [date-fns](https://date-fns.org)
- [Tailwind CSS](https://tailwindcss.com), [Vite](https://vitejs.dev), [Express](https://expressjs.com), [PostgreSQL](https://www.postgresql.org), [Ollama](https://ollama.com)

---

## License

MIT — see [LICENSE](LICENSE)
