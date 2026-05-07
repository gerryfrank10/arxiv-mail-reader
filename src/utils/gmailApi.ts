import { Paper } from '../types';
import { parseArxivEmail } from './emailParser';

const BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

async function apiFetch(url: string, token: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: { message?: string } }).error?.message || `HTTP ${res.status}`);
  }
  return res.json();
}

function base64Decode(data: string): string {
  // Gmail uses base64url encoding (- and _ instead of + and /)
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/');
  try {
    return decodeURIComponent(
      atob(b64)
        .split('')
        .map(c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join('')
    );
  } catch {
    return atob(b64);
  }
}

interface GmailPart {
  mimeType: string;
  body: { data?: string };
  parts?: GmailPart[];
}

function extractTextBody(payload: GmailPart): string {
  // Direct text/plain body
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return base64Decode(payload.body.data);
  }
  // Recurse into parts
  if (payload.parts) {
    for (const part of payload.parts) {
      const text = extractTextBody(part);
      if (text) return text;
    }
  }
  return '';
}

interface GmailMessage {
  id: string;
  payload: GmailPart & {
    headers?: Array<{ name: string; value: string }>;
  };
  internalDate?: string;
}

function getHeader(msg: GmailMessage, name: string): string {
  return msg.payload.headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

export async function fetchArxivPapers(
  accessToken: string,
  senderEmail: string,
  maxEmails = 30,
  onProgress?: (loaded: number, total: number) => void
): Promise<Paper[]> {
  // 1. List message IDs matching the sender
  const listData = (await apiFetch(
    `${BASE}/messages?q=from:${encodeURIComponent(senderEmail)}&maxResults=${maxEmails}`,
    accessToken
  )) as { messages?: Array<{ id: string }> };

  const messages = listData.messages ?? [];
  const total = messages.length;

  if (total === 0) return [];

  // 2. Fetch each message in parallel (batched to avoid rate limits)
  const BATCH = 5;
  const allPapers: Paper[] = [];

  for (let i = 0; i < messages.length; i += BATCH) {
    const batch = messages.slice(i, i + BATCH);
    const details = await Promise.all(
      batch.map(m =>
        apiFetch(`${BASE}/messages/${m.id}?format=full`, accessToken) as Promise<GmailMessage>
      )
    );

    for (const msg of details) {
      const body = extractTextBody(msg.payload);
      if (!body) continue;

      const subject = getHeader(msg, 'subject');
      const dateStr = getHeader(msg, 'date');
      const digestDate = dateStr ? new Date(dateStr) : new Date(Number(msg.internalDate));

      const papers = parseArxivEmail(body, msg.id, subject, digestDate);
      allPapers.push(...papers);
    }

    onProgress?.(Math.min(i + BATCH, total), total);
  }

  // Sort by digest date descending
  return allPapers.sort((a, b) => b.digestDate.getTime() - a.digestDate.getTime());
}
