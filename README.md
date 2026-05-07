# arXiv Mail Reader

A clean web app that reads your arXiv digest alert emails from Gmail and lets you browse papers beautifully — searchable list on the left, full abstract with LaTeX rendering on the right, and a stats dashboard.

**Live:** [gerryfrank10.github.io/arxiv-mail-reader](https://gerryfrank10.github.io/arxiv-mail-reader/)

---

## Features

- **Gmail OAuth** — read-only access, no password needed, nothing stored on any server
- **Smart parser** — extracts title, authors, categories, abstract, arXiv ID, and PDF link from arXiv's plaintext digest format
- **LaTeX rendering** — inline and display math via [KaTeX](https://katex.org/)
- **Search & filter** — full-text search and category filter
- **Dashboard** — stats cards, category distribution chart, papers-over-time timeline
- **Persistent sessions** — stays signed in for 55 minutes across page reloads
- **30-minute cache** — avoids re-fetching on every reload
- **Configurable sender** — works with `no-reply@arxiv.org`, `cs@arxiv.org`, or any digest sender

---

## Setup

### 1. Google OAuth client ID

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → create a project
2. **APIs & Services → Library** → enable **Gmail API**
3. **APIs & Services → OAuth consent screen** → External → fill in app name + your email → add scope `https://www.googleapis.com/auth/gmail.readonly` → add your email as a test user
4. **Credentials → Create → OAuth 2.0 Client ID** → Web application
   - Authorized JavaScript origins: `http://localhost:5173` (dev) and your production URL
5. Copy the **Client ID**

### 2. Run locally

```bash
git clone https://github.com/gerryfrank10/arxiv-mail-reader.git
cd arxiv-mail-reader
npm install

cp .env.example .env
# Paste your client ID:
# VITE_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com

npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

---

## GitHub Pages deployment

The repo includes a GitHub Actions workflow that builds and deploys automatically on every push to `main`.

1. Fork this repo
2. **Settings → Pages → Source** → GitHub Actions
3. **Settings → Secrets → Actions → New secret**
   - Name: `VITE_GOOGLE_CLIENT_ID`, Value: your client ID
4. In Google Cloud Console add `https://<your-username>.github.io` to **Authorized JavaScript origins**
5. Push to `main` — deploys in ~40 seconds

---

## arXiv sender addresses

arXiv digest emails arrive from one of:
- `no-reply@arxiv.org` ← default, most common
- `cs@arxiv.org` (CS mailing list)

Switch in **Settings** (gear icon in the sidebar) at any time.

---

## Project structure

```
src/
├── components/
│   ├── AppLayout.tsx      Root layout
│   ├── Dashboard.tsx      Stats + charts
│   ├── LoginPage.tsx      Google sign-in
│   ├── PaperCard.tsx      Sidebar paper card
│   ├── PaperDetail.tsx    Abstract + links
│   ├── SettingsModal.tsx  Sender email config
│   └── Sidebar.tsx        Search, filter, list
├── contexts/
│   ├── AuthContext.tsx    Google OAuth + session persistence
│   └── PapersContext.tsx  Fetch, cache, filter
└── utils/
    ├── emailParser.ts     Parses arXiv digest plaintext
    ├── gmailApi.ts        Gmail REST API (browser-direct)
    ├── latex.ts           KaTeX renderer
    └── categories.ts      Labels + colours
```

---

## Acknowledgements

- [arXiv.org](https://arxiv.org) — the open-access preprint repository
- [@react-oauth/google](https://github.com/MomenSherif/react-oauth) by Momen Sherif
- [Recharts](https://recharts.org) — chart library for React
- [KaTeX](https://katex.org) by Khan Academy — LaTeX math rendering
- [Lucide](https://lucide.dev) — icon set
- [date-fns](https://date-fns.org) — date utilities
- [Tailwind CSS](https://tailwindcss.com)
- [Vite](https://vitejs.dev)

---

## License

MIT — see [LICENSE](LICENSE)
