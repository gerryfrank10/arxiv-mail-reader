import express from 'express';
import cors from 'cors';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;
const isProd = process.env.NODE_ENV === 'production';

app.use(express.json());
if (!isProd) {
  // In dev the Vite proxy handles CORS; in prod everything is same-origin
  app.use(cors({ origin: ['http://localhost:5173', 'http://127.0.0.1:5173'] }));
}

// Known IMAP presets
const PRESETS = {
  icloud:  { host: 'imap.mail.me.com',        port: 993 },
  gmail:   { host: 'imap.gmail.com',           port: 993 },
  outlook: { host: 'outlook.office365.com',    port: 993 },
  yahoo:   { host: 'imap.mail.yahoo.com',      port: 993 },
};

app.get('/api/presets', (_req, res) => res.json(PRESETS));
app.get('/api/health',  (_req, res) => res.json({ ok: true }));

// Proxy arXiv API to avoid CORS issues in the browser
app.get('/api/arxiv-abstract', async (req, res) => {
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'id is required' });
  try {
    const upstream = await fetch(`https://arxiv.org/api/query?id_list=${encodeURIComponent(id)}`);
    const xml = await upstream.text();
    res.setHeader('Content-Type', 'application/xml');
    res.send(xml);
  } catch (err) {
    res.status(502).json({ error: `Failed to fetch from arXiv: ${err.message}` });
  }
});

app.post('/api/fetch-imap-emails', async (req, res) => {
  const { host, port = 993, username, password, senderEmail, maxEmails = 30 } = req.body;

  if (!host || !username || !password || !senderEmail) {
    return res.status(400).json({ error: 'host, username, password, and senderEmail are required.' });
  }

  const client = new ImapFlow({
    host,
    port: Number(port),
    secure: true,
    auth: { user: username, pass: password },
    logger: false,
    tls: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
  } catch (err) {
    return res.status(401).json({ error: `Connection failed: ${err.message}` });
  }

  let lock;
  try {
    lock = await client.getMailboxLock('INBOX');
    const uids = await client.search({ from: senderEmail });

    if (!uids.length) {
      lock.release();
      await client.logout();
      return res.json({ emails: [] });
    }

    const slice = uids.slice(-Math.min(Number(maxEmails), uids.length));
    const emails = [];

    for await (const msg of client.fetch(slice, { source: true, envelope: true })) {
      try {
        const parsed = await simpleParser(msg.source);
        emails.push({
          id: String(msg.uid),
          subject: parsed.subject ?? msg.envelope?.subject ?? '',
          date: parsed.date?.toISOString() ?? msg.envelope?.date?.toISOString() ?? '',
          body: parsed.text ?? '',
        });
      } catch { /* skip malformed messages */ }
    }

    lock.release();
    await client.logout();

    emails.reverse(); // newest first
    res.json({ emails });
  } catch (err) {
    lock?.release();
    try { await client.logout(); } catch { /* ignore */ }
    res.status(500).json({ error: err.message });
  }
});

// Serve built frontend in production
if (isProd) {
  const distPath = join(__dirname, '../dist');
  app.use(express.static(distPath));
  app.get('*', (_req, res) => res.sendFile(join(distPath, 'index.html')));
}

app.listen(PORT, () => {
  console.log(`[arxiv-server] running on http://localhost:${PORT} (${isProd ? 'production' : 'development'})`);
});
