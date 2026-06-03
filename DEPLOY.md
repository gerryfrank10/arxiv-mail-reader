# Running & deploying arxiv-mail-reader

There are two modes. Pick based on what you're doing.

## 1. Local development (hot reload)

Use this while writing code — the frontend hot-reloads on save.

```bash
npm install
npm run db:up      # start Postgres in Docker (port 5433)
npm run dev:all    # Vite on :5173 + API on :3001
```

Open **http://localhost:5173**. Stop the DB with `npm run db:down`.

## 2. Full app, one command (production-style)

This builds the frontend and runs the **whole app as one container** (the
Express server serves the built site *and* the API on a single port), plus
Postgres. It behaves identically on your laptop and on your remote server —
so this is what you ship.

```bash
cp .env.example .env     # fill in values (see below), first time only
npm run app:up           # build image + start db + app
```

Open **http://localhost:3001**. Other commands:

```bash
npm run app:logs         # tail the app logs
npm run app:restart      # rebuild + restart after a code change
npm run app:down         # stop app + db
```

Because `dev:server` / `node` don't auto-reload, after changing **server**
code just run `npm run app:restart`.

> Note: `npm run db:up` still starts **only** the database (the `app` service
> is behind a compose profile), so your dev workflow is unchanged.

## 3. Deploy to a remote server

On a fresh Linux box (Ubuntu/Debian shown):

```bash
# 1. Install Docker + the compose plugin (once)
curl -fsSL https://get.docker.com | sh

# 2. Get the code
git clone https://github.com/gerryfrank10/arxiv-mail-reader.git
cd arxiv-mail-reader

# 3. Configure
cp .env.example .env
nano .env                # set the values you need (see below)

# 4. Launch
npm install --omit=dev   # only needed so `npm run` shortcuts exist; or call docker compose directly
docker compose --profile app up -d --build
```

The app now listens on port **3001**. To put it online on a domain with HTTPS,
run a reverse proxy in front of it (recommended — handles TLS for you):

- **Caddy** (simplest, automatic HTTPS):
  ```
  yourdomain.com {
      reverse_proxy localhost:3001
  }
  ```
- or **Nginx** proxying `:80/:443 → localhost:3001`.

Alternatively, for a quick test without a domain, change the app port mapping
in `docker-compose.yml` to `"80:3001"` and hit the server's IP directly.

### Updating the remote after you push changes

```bash
git pull
docker compose --profile app up -d --build
```

## Environment variables (`.env`)

All optional — the app degrades gracefully. The ones that matter for a
server deploy:

| Variable | What it does |
| --- | --- |
| `VITE_GOOGLE_CLIENT_ID` | Enables "Sign in with Google" (Gmail). **Baked at build time** — set it *before* `app:up`. Leave blank to use IMAP login (iCloud/Outlook/Yahoo). |
| `SEMANTIC_SCHOLAR_API_KEY` | Higher rate limits for Discover + citation graph. |
| `OPENALEX_MAILTO` | Polite-pool email for the Discover fallback. |
| `DISABLE_MAGAZINE_SCHEDULER` | Set to `1` to stop the weekly auto-generation worker. |

`DATABASE_URL`, `PORT`, `NODE_ENV`, and `UPLOAD_ROOT` are set automatically for
the container by `docker-compose.yml` — you don't need to touch them.

## AI provider (Ollama)

The app proxies AI calls through the server, so a `localhost` AI URL must be
reachable *from the server*:

- **Local (Mac/Windows):** keep Ollama running on your host. The container
  rewrites `localhost` → `host.docker.internal` automatically, so leave the
  base URL in **Settings → AI provider** as `http://localhost:11434/v1`.
- **Remote server with no host Ollama:** run the bundled Ollama container
  (opt-in, separate profile), then pull a model:

  ```bash
  npm run ollama:up         # start the ollama container
  npm run ollama:pull       # pull llama3.2 (or: docker exec arxiv-reader-ollama ollama pull <model>)
  ```

  It publishes port 11434 on the host, so the same `http://localhost:11434/v1`
  base URL keeps working — no settings change. To run the whole stack at once:

  ```bash
  docker compose --profile app --profile ollama up -d --build
  ```

  For a GPU host, uncomment the `deploy.resources` block on the `ollama`
  service in `docker-compose.yml` (needs the nvidia-container-toolkit).

> Don't enable the Ollama container on your Mac — it would clash with host
> Ollama on port 11434, and the container build has no Metal GPU access.
> A cloud provider (OpenAI / Groq / Claude) configured in Settings also works
> on the remote with no Docker networking at all (those are public URLs).

## Data & backups

- **Database** lives in the `arxiv_db_data` Docker volume (persists across
  restarts). The SQL in `server/migrations/` provisions the schema on first
  boot. Back up with `npm run db:backup`.
- **Uploaded book files** live in `./uploads` on the host (bind-mounted), so
  they survive `npm run db:reset`.
