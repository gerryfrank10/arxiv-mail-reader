// Thin typed client for the /api/db/* server endpoints (books + documents).
//
// All Books & Writer features require Postgres on the server side. When it
// isn't enabled, the status endpoint returns { enabled: false } and the
// client UI shows a setup hint instead of an empty/broken state.

import { Book, ResearchDocument } from '../types';

function userEmailFromLocalStorage(): string | null {
  try {
    const raw = localStorage.getItem('arxiv_auth_session');
    if (!raw) return null;
    const u = JSON.parse(raw) as { email?: string };
    return u.email ?? null;
  } catch { return null; }
}

function authHeaders(): HeadersInit {
  const email = userEmailFromLocalStorage();
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (email) h['x-user-email'] = email;
  return h;
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { ...authHeaders(), ...(init?.headers ?? {}) } });
  if (!r.ok) {
    const err = await r.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? `HTTP ${r.status}`);
  }
  return r.json() as Promise<T>;
}

// ---------- DB status ----------

export async function getDbStatus(): Promise<{ enabled: boolean }> {
  return call('/api/db/status');
}

// ---------- Books ----------

export interface BookLookupResult {
  isbn: string;
  title: string;
  authors: string[];
  year: number | null;
  publisher: string;
  coverUrl: string | null;
  sourceUrl: string;
  abstract: string;
}

export async function lookupBookByIsbn(isbn: string): Promise<BookLookupResult> {
  return call(`/api/books/lookup?isbn=${encodeURIComponent(isbn)}`);
}

export async function listBooks(): Promise<Book[]> {
  const { books } = await call<{ books: Book[] }>('/api/db/books');
  return books;
}

export async function upsertBook(b: Book): Promise<void> {
  await call(`/api/db/books/${encodeURIComponent(b.id)}`, {
    method: 'PUT',
    body: JSON.stringify(b),
  });
}

export async function deleteBook(id: string): Promise<void> {
  await call(`/api/db/books/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ---------- Documents (Writer) ----------

export async function listDocuments(): Promise<ResearchDocument[]> {
  const { documents } = await call<{ documents: ResearchDocument[] }>('/api/db/documents');
  return documents;
}

export async function getDocument(id: string): Promise<ResearchDocument> {
  const { document } = await call<{ document: ResearchDocument }>(`/api/db/documents/${encodeURIComponent(id)}`);
  return document;
}

export async function upsertDocument(d: ResearchDocument): Promise<void> {
  await call(`/api/db/documents/${encodeURIComponent(d.id)}`, {
    method: 'PUT',
    body: JSON.stringify(d),
  });
}

export async function deleteDocument(id: string): Promise<void> {
  await call(`/api/db/documents/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ---------- helpers ----------

export function newDocumentId(): string {
  return `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function newBookId(): string {
  return `book-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
