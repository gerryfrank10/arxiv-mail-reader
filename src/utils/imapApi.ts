import { Paper } from '../types';
import { ImapConfig } from '../types';
import { parseArxivEmail } from './emailParser';

interface RawEmail {
  id: string;
  subject: string;
  date: string;
  body: string;
}

export async function fetchArxivPapersImap(
  imapConfig: ImapConfig,
  senderEmail: string,
  maxEmails = 30,
  onProgress?: (loaded: number, total: number) => void
): Promise<Paper[]> {
  const res = await fetch('/api/fetch-imap-emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      host: imapConfig.host,
      port: imapConfig.port,
      username: imapConfig.username,
      password: imapConfig.password,
      senderEmail,
      maxEmails,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? `Server error ${res.status}`);
  }

  const data = await res.json() as { emails: RawEmail[] };
  const emails = data.emails ?? [];

  const allPapers: Paper[] = [];
  for (let i = 0; i < emails.length; i++) {
    const email = emails[i];
    const digestDate = email.date ? new Date(email.date) : new Date();
    const papers = parseArxivEmail(email.body, email.id, email.subject, digestDate);
    allPapers.push(...papers);
    onProgress?.(i + 1, emails.length);
  }

  return allPapers.sort((a, b) => b.digestDate.getTime() - a.digestDate.getTime());
}
