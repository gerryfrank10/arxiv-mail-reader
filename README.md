# arXiv Mail Reader

A clean, fast web app that reads your arXiv digest alert emails and lets you browse papers beautifully — searchable list on the left, full abstract with LaTeX rendering on the right, and a stats dashboard showing category breakdowns and a papers-over-time chart.

Supports **Gmail** (OAuth, no password needed) and **IMAP providers** including iCloud Mail, Outlook, Yahoo, and any standard IMAP server.

---

## Features

- **Multi-provider login** — Gmail OAuth or IMAP (iCloud, Outlook/Hotmail, Yahoo, custom server)
- **Smart parser** — extracts title, authors, categories, abstract, arXiv ID, and PDF link from arXiv's plaintext digest format
- **LaTeX rendering** — inline and display math in abstracts via [KaTeX](https://katex.org/)
- **Search & filter** — full-text search across title, authors, and abstract; filter by category
- **Dashboard** — total papers, digest count, category distribution chart, papers-over-time timeline, recent papers
- **Persistent sessions** — IMAP stays logged in until you sign out; Gmail is remembered for 55 minutes
- **30-minute cache** — avoids re-fetching emails on every reload
- **Configurable sender** — works with `no-reply@arxiv.org`, `cs@arxiv.org`, or any digest sender

---

## Hosting options

| Option | Gmail | IMAP (iCloud, Outlook…) | Setup effort |
|---|:---:|:---:|---|
| **GitHub Pages** (this repo) | ✅ | ❌ needs local backend | Add one GitHub secret → auto-deploys on push |
| **Run locally** | ✅ | ✅ | `npm run dev:all` |
| **Render.com** | ✅ | ✅ | Connect repo → set env var → deploy |

---

## GitHub Pages deployment (recommended)

The included GitHub Actions workflow builds and deploys automatically on every push to `main`.

### 1. Fork & enable Pages

1. **Fork** this repository on GitHub
2. Go to your fork → **Settings → Pages → Source** → select **GitHub Actions**

### 2. Add your Google OAuth client ID as a secret

> Skip if you only want IMAP (but then Gmail login won't work on the hosted version).

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → create a project
2. **APIs & Services → Library** → enable **Gmail API**
3. **APIs & Services → OAuth consent screen** → External → fill in app name + email → add scope `https://www.googleapis.com/auth/gmail.readonly` → add your email as a test user
4. **Credentials → Create → OAuth 2.0 Client ID** → Web application
   - Authorized JavaScript origins: `https://<your-username>.github.io`
5. Copy the **Client ID**
6. In your fork: **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `VITE_GOOGLE_CLIENT_ID`
   - Value: the client ID you copied

### 3. Push to deploy

```bash
git push origin main
```

GitHub Actions builds the app and publishes it to `https://<your-username>.github.io/arxiv-mail-reader/`.
The workflow runs automatically on every push to `main`.

> **IMAP on GitHub Pages:** Because GitHub Pages is a static host, the IMAP backend can't run there. iCloud, Outlook, and Yahoo logins work only when running the app locally (`npm run dev:all`). Gmail works on the hosted version with no extra setup.

---

## Local development

```bash
git clone https://github.com/gerryfrank10/arxiv-mail-reader.git
cd arxiv-mail-reader
npm install

cp .env.example .env
# Set VITE_GOOGLE_CLIENT_ID in .env (only needed for Gmail)

npm run dev:all     # starts frontend (port 5173) + IMAP backend (port 3001)
```

Open [http://localhost:5173](http://localhost:5173).

---

## Email providers

| Provider | Auth method | What you need |
|---|---|---|
| **Gmail** | Google OAuth — no password | Client ID from Google Cloud Console |
| **iCloud Mail** | IMAP + app-specific password | Generate at [appleid.apple.com](https://appleid.apple.com) → Sign-In & Security → App-Specific Passwords |
| **Outlook / Hotmail** | IMAP + password | Enable IMAP in [Outlook settings](https://outlook.live.com/mail/options/mail/popImapAccess) |
| **Yahoo Mail** | IMAP + app password | Generate at [Yahoo security settings](https://login.yahoo.com/account/security) |
| **Other IMAP** | IMAP | Your server host, port 993, and credentials |

> Credentials for IMAP providers are sent only to the local backend server (`localhost:3001`) and are never persisted or forwarded externally.

### arXiv sender addresses

arXiv digest emails arrive from one of:

- `no-reply@arxiv.org` ← **default, most common**
- `cs@arxiv.org` (computer science mailing list address)

Switch between them any time in **Settings** (gear icon in the sidebar).

---

## Self-hosting with Render.com (full IMAP support)

For a hosted version that also supports IMAP:

1. Fork this repo
2. Go to [dashboard.render.com](https://dashboard.render.com) → **New → Blueprint** → connect your fork
3. Render reads `render.yaml` automatically
4. In the **Environment** tab set `VITE_GOOGLE_CLIENT_ID` to your client ID
5. Add your Render URL to Google's **Authorized JavaScript origins**
6. Deploy

> Free tier spins down after 15 min of inactivity; first request after sleep takes ~30 s.

---

## Project structure

```
arxiv-mail-reader/
├── .github/workflows/deploy.yml  GitHub Pages CI/CD
├── server/
│   └── index.mjs          IMAP proxy (Express) — also serves dist/ in production
├── src/
│   ├── components/
│   │   ├── AppLayout.tsx   Root layout (sidebar + main panel)
│   │   ├── Dashboard.tsx   Stats cards, category chart, timeline, recent papers
│   │   ├── LoginPage.tsx   Provider picker + IMAP credential form
│   │   ├── PaperCard.tsx   Sidebar paper card
│   │   ├── PaperDetail.tsx Full abstract with LaTeX rendering + links
│   │   ├── SettingsModal.tsx  Sender email + max emails config
│   │   └── Sidebar.tsx     Left panel — search, filter, paper list
│   ├── contexts/
│   │   ├── AuthContext.tsx  Google OAuth + IMAP auth, session persistence
│   │   └── PapersContext.tsx  Fetching, caching, search/filter state
│   └── utils/
│       ├── emailParser.ts  Parses arXiv digest plaintext format
│       ├── gmailApi.ts     Gmail REST API (browser-direct)
│       ├── imapApi.ts      Calls /api/fetch-imap-emails on local backend
│       ├── latex.ts        KaTeX renderer for abstracts
│       └── categories.ts   Category labels + colour palettes
├── render.yaml             Render.com deployment config
└── vite.config.ts          Vite config — base path + /api proxy in dev
```

---

## Development scripts

| Command | Description |
|---|---|
| `npm run dev:all` | Start frontend + IMAP backend together (recommended) |
| `npm run dev` | Frontend only (Vite, port 5173) |
| `npm run dev:server` | IMAP backend only (Express, port 3001) |
| `npm run build` | Build frontend for production |
| `npm start` | Production — serves API + built frontend |

---

## Acknowledgements

This project stands on the shoulders of:

- [arXiv.org](https://arxiv.org) — the open-access preprint repository that makes all of this possible
- [@react-oauth/google](https://github.com/MomenSherif/react-oauth) by Momen Sherif — Google Identity integration for React
- [imapflow](https://github.com/postalsys/imapflow) by Postal Systems — modern IMAP client for Node.js
- [mailparser](https://github.com/nodemailer/mailparser) by Nodemailer — RFC 2822 email parsing
- [Recharts](https://recharts.org) — composable chart library for React
- [KaTeX](https://katex.org) by Khan Academy — fast, accurate LaTeX math rendering
- [Lucide](https://lucide.dev) — clean, consistent icon set
- [date-fns](https://date-fns.org) — date utility library
- [Tailwind CSS](https://tailwindcss.com) — utility-first CSS framework
- [Vite](https://vitejs.dev) — next-generation frontend build tool

---

## License

MIT — see [LICENSE](LICENSE)
