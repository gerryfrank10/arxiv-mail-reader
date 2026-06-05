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
- **Gmail** via Google OAuth (read-only, nothing stored on any server), or
- **IMAP** — iCloud, Outlook, Yahoo, or any IMAP host (requires the backend running)

---

## Architecture

- **Frontend** — React + TypeScript + Vite + Tailwind
- **Backend** — Node/Express (`server/index.mjs`) — proxies arXiv/Semantic Scholar/AI calls, fetches IMAP mail, and serves the built frontend in production
- **Database** — PostgreSQL (optional)

Storage has two modes:
- **IndexedDB (default, local-only)** — works with no backend; the Library/Reader run entirely in the browser (Gmail login only).
- **Server mode (Postgres)** — set `DATABASE_URL` and the `/api/db/*` routes light up, enabling Books, Writer, Magazine, Collections, Cross-refs, trackers, and cross-device sync.

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

`npm run dev` alone runs only the frontend (IndexedDB mode, Gmail login).

> Run **either** Docker (`:3001`) **or** dev (`:5173`) — both use port 3001 for
> the API, so don't run them at once.

---

## Configuration (`.env`)

Everything is optional — the app degrades gracefully. Copy `.env.example` to
`.env`. Highlights:

| Variable | Purpose |
| --- | --- |
| `VITE_GOOGLE_CLIENT_ID` | Enables "Sign in with Google" (Gmail). **Baked at build time.** Blank → IMAP login only. |
| `DATABASE_URL` | Connect Postgres → enables server-storage features. Unset → IndexedDB-only. |
| `PORT` | API port (default 3001). |
| `SEMANTIC_SCHOLAR_API_KEY` | Higher rate limits for Discover + citation graph. |
| `OPENALEX_MAILTO` | Polite-pool contact for OpenAlex (and the arXiv User-Agent). |
| `DISABLE_MAGAZINE_SCHEDULER` | `1` to stop the weekly Magazine worker. |

> Non-`VITE_`-prefixed values (API keys, `DATABASE_URL`) stay on the server and
> never reach the browser bundle.

### Google OAuth client ID (for Gmail login)

1. [console.cloud.google.com](https://console.cloud.google.com) → new project
2. **APIs & Services → Library** → enable **Gmail API**
3. **OAuth consent screen** → External → add scope `gmail.readonly` → add your email as a test user
4. **Credentials → Create → OAuth 2.0 Client ID** → Web application
   - Authorized JavaScript origins: `http://localhost:5173` (dev), `http://localhost:3001` (Docker), and your production URL
5. Put the Client ID in `.env` as `VITE_GOOGLE_CLIENT_ID`

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
└── utils/             emailParser, gmailApi, imapApi, paperImport, researchApi,
                       aiProvider, aiJson, semanticScholar, storage, latex…
server/
├── index.mjs          Express API (arXiv/S2/AI proxies, IMAP, /api/db/*, SPA)
├── db.mjs             Postgres data access
├── sources.mjs        Magazine external-source fetchers
└── migrations/        SQL schema (run on first DB init)
scripts/               backup, restore, migrate, score-papers (CLI)
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

---

## Acknowledgements

- [arXiv.org](https://arxiv.org) — open-access preprints
- [Semantic Scholar](https://www.semanticscholar.org/product/api) & [OpenAlex](https://openalex.org) — discovery / citation graph
- [KaTeX](https://katex.org), [CodeMirror](https://codemirror.net), [Recharts](https://recharts.org), [Lucide](https://lucide.dev), [date-fns](https://date-fns.org)
- [@react-oauth/google](https://github.com/MomenSherif/react-oauth) by Momen Sherif
- [Tailwind CSS](https://tailwindcss.com), [Vite](https://vitejs.dev), [Express](https://expressjs.com), [PostgreSQL](https://www.postgresql.org), [Ollama](https://ollama.com)

---

## License

MIT — see [LICENSE](LICENSE)
