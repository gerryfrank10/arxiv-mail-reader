# arXiv Mail Reader

A clean, fast web app that reads your arXiv digest alert emails and lets you browse papers beautifully — searchable list on the left, full abstract with LaTeX rendering on the right, and a stats dashboard showing category breakdowns and a papers-over-time chart.

Supports **Gmail** (OAuth, no password needed) and **IMAP providers** including iCloud Mail, Outlook, Yahoo, and any standard IMAP server.

---

## Features

- **Multi-provider login** — Gmail OAuth or IMAP (iCloud, Outlook/Hotmail, Yahoo, custom server)
- **Smart parser** — extracts title, authors, categories, abstract, arXiv ID, PDF link from arXiv's plaintext digest format
- **LaTeX rendering** — inline and display math in abstracts via [KaTeX](https://katex.org/)
- **Search & filter** — full-text search across title, authors, abstract; filter by category
- **Dashboard** — total papers, digest count, category distribution bar chart, papers-over-time timeline, recent papers list
- **Persistent sessions** — IMAP stays logged in until you sign out; Gmail token is remembered for 55 minutes
- **30-minute cache** — avoids re-fetching emails on every reload
- **Configurable sender** — works with `no-reply@arxiv.org`, `cs@arxiv.org`, or any digest sender

---

## Quick Start (local)

### 1. Clone

```bash
git clone https://github.com/gerryfrank10/arxiv-mail-reader.git
cd arxiv-mail-reader
npm install
```

### 2. Configure Google OAuth (for Gmail users)

> Skip this if you're only using IMAP (iCloud, Outlook, etc.).

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and create a project
2. **APIs & Services → Library** → enable **Gmail API**
3. **APIs & Services → OAuth consent screen** → External → fill app name + email → add scope `https://www.googleapis.com/auth/gmail.readonly` → add your email as test user
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
   - Application type: **Web application**
   - Authorized JavaScript origins: `http://localhost:5173`
5. Copy the **Client ID**

```bash
cp .env.example .env
# Edit .env:
VITE_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
```

### 3. Run

```bash
npm run dev:all     # starts frontend (port 5173) + IMAP backend (port 3001)
```

Open [http://localhost:5173](http://localhost:5173).

---

## Email Providers

| Provider | Auth method | What you need |
|---|---|---|
| **Gmail** | Google OAuth (no password) | Client ID in `.env` |
| **iCloud Mail** | IMAP + app-specific password | Generate at [appleid.apple.com](https://appleid.apple.com) → Sign-In & Security → App-Specific Passwords |
| **Outlook / Hotmail** | IMAP | Microsoft password (enable IMAP in [Outlook settings](https://outlook.live.com/mail/options/mail/popImapAccess)) |
| **Yahoo Mail** | IMAP + app password | Generate at [Yahoo security settings](https://login.yahoo.com/account/security) |
| **Other IMAP** | IMAP | Your server host, port 993, and credentials |

> **IMAP note:** credentials are sent only to the local backend server (`localhost:3001`) and are never stored on any external server.

### arXiv sender addresses

arXiv digest emails arrive from one of:
- `no-reply@arxiv.org` ← most common, set as default
- `cs@arxiv.org` (computer science list address)

You can switch between them in **Settings** (gear icon in the sidebar) at any time.

---

## Free Hosting on Render.com

The app ships with a `render.yaml` for one-click deployment on [Render.com](https://render.com) (free tier).

1. Fork this repo on GitHub
2. Go to [dashboard.render.com](https://dashboard.render.com) → **New → Blueprint**
3. Connect your fork → Render auto-reads `render.yaml`
4. In the **Environment** tab, set:
   - `VITE_GOOGLE_CLIENT_ID` → your Google OAuth client ID
5. In Google Cloud Console, add your Render URL to **Authorized JavaScript origins** (e.g. `https://arxiv-mail-reader.onrender.com`)
6. Deploy!

> The free tier spins down after 15 minutes of inactivity (first request after sleep takes ~30 s). Upgrade to Starter ($7/mo) to keep it always-on.

---

## Project Structure

```
arxiv-mail-reader/
├── server/
│   └── index.mjs          IMAP proxy (Express) — also serves dist/ in production
├── src/
│   ├── components/
│   │   ├── AppLayout.tsx   Root layout
│   │   ├── Dashboard.tsx   Stats cards + charts
│   │   ├── LoginPage.tsx   Provider picker + IMAP credential form
│   │   ├── PaperCard.tsx   Sidebar paper card
│   │   ├── PaperDetail.tsx Full abstract view with LaTeX + links
│   │   ├── SettingsModal.tsx  Sender email + max emails config
│   │   └── Sidebar.tsx     Left panel — search, filter, paper list
│   ├── contexts/
│   │   ├── AuthContext.tsx  Google OAuth + IMAP auth, session persistence
│   │   └── PapersContext.tsx  Fetching, caching, search/filter state
│   └── utils/
│       ├── emailParser.ts  Parses arXiv digest plaintext format
│       ├── gmailApi.ts     Gmail REST API (browser-direct, no backend)
│       ├── imapApi.ts      Calls /api/fetch-imap-emails on local backend
│       ├── latex.ts        KaTeX renderer for abstracts
│       └── categories.ts   Category labels + color palettes
├── render.yaml             Render.com deployment config
├── vite.config.ts          Proxies /api → localhost:3001 in dev
└── .env.example
```

---

## Development Scripts

| Command | Description |
|---|---|
| `npm run dev:all` | Start frontend + IMAP backend together (recommended) |
| `npm run dev` | Frontend only (Vite on port 5173) |
| `npm run dev:server` | IMAP backend only (Express on port 3001) |
| `npm run build` | Build frontend for production |
| `npm start` | Production server (serves both API and built frontend) |

---

## Acknowledgements

This project stands on the shoulders of:

- [arXiv.org](https://arxiv.org) — the preprint repository that makes this possible
- [@react-oauth/google](https://github.com/MomenSherif/react-oauth) by Momen Sherif — Google Identity integration for React
- [imapflow](https://github.com/postalsys/imapflow) by Postal Systems — modern IMAP client for Node.js
- [mailparser](https://github.com/nodemailer/mailparser) by Nodemailer — email parsing
- [Recharts](https://recharts.org) — composable chart library for React
- [KaTeX](https://katex.org) by Khan Academy — fast LaTeX math rendering
- [Lucide](https://lucide.dev) — clean, consistent icon set
- [date-fns](https://date-fns.org) — date utility library
- [Tailwind CSS](https://tailwindcss.com) — utility-first CSS framework
- [Vite](https://vitejs.dev) — next-generation frontend build tool

---

## License

MIT — see [LICENSE](LICENSE)
