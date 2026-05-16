// Thin typed client for the /api/db/* server endpoints (books + documents).
//
// All Books & Writer features require Postgres on the server side. When it
// isn't enabled, the status endpoint returns { enabled: false } and the
// client UI shows a setup hint instead of an empty/broken state.

import { Book, Collection, CollectionItem, EntityKind, Link, LinkRel, Paper, PaperScore, ResearchDocument, Tracker } from '../types';

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

export function newCollectionId(): string {
  return `coll-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------- Collections ----------

export async function listCollections(): Promise<Collection[]> {
  const { collections } = await call<{ collections: Collection[] }>('/api/db/collections');
  return collections;
}

export async function upsertCollection(c: Collection): Promise<void> {
  await call(`/api/db/collections/${encodeURIComponent(c.id)}`, {
    method: 'PUT',
    body: JSON.stringify(c),
  });
}

export async function deleteCollection(id: string): Promise<void> {
  await call(`/api/db/collections/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function addCollectionItem(item: Omit<CollectionItem, 'addedAt' | 'position'> & { position?: number }): Promise<void> {
  await call(`/api/db/collections/${encodeURIComponent(item.collectionId)}/items`, {
    method: 'POST',
    body: JSON.stringify(item),
  });
}

export async function updateCollectionItem(item: Partial<CollectionItem> & { collectionId: string; targetKind: EntityKind; targetId: string }): Promise<void> {
  await call(`/api/db/collections/${encodeURIComponent(item.collectionId)}/items`, {
    method: 'PATCH',
    body: JSON.stringify(item),
  });
}

export async function removeCollectionItem(collectionId: string, targetKind: EntityKind, targetId: string): Promise<void> {
  await call(`/api/db/collections/${encodeURIComponent(collectionId)}/items/${encodeURIComponent(targetKind)}/${encodeURIComponent(targetId)}`, { method: 'DELETE' });
}

// ---------- Links (cross-references) ----------

export async function listLinks(): Promise<Link[]> {
  const { links } = await call<{ links: Link[] }>('/api/db/links');
  return links;
}

export async function addLink(link: Omit<Link, 'createdAt'>): Promise<void> {
  await call('/api/db/links', { method: 'POST', body: JSON.stringify(link) });
}

export async function deleteLink(link: { sourceKind: EntityKind; sourceId: string; targetKind: EntityKind; targetId: string; rel: LinkRel }): Promise<void> {
  await call('/api/db/links', { method: 'DELETE', body: JSON.stringify(link) });
}

// ---------- Papers (server-backed inbox) ----------

export async function apiListPapers(): Promise<Paper[]> {
  const { papers } = await call<{ papers: Array<Paper & { digestDate: string }> }>('/api/db/papers');
  return papers.map(p => ({ ...p, digestDate: new Date(p.digestDate) }));
}

export async function apiUpsertPapers(papers: Paper[]): Promise<void> {
  await call('/api/db/papers', { method: 'POST', body: JSON.stringify({ papers }) });
}

export async function apiUpdatePaperAbstract(id: string, abstract: string): Promise<void> {
  await call(`/api/db/papers/${encodeURIComponent(id)}/abstract`, {
    method: 'PATCH',
    body: JSON.stringify({ abstract }),
  });
}

// ---------- Library ----------

export async function apiGetLibraryIds(): Promise<string[]> {
  const { items } = await call<{ items: Array<{ paperId: string; savedAt: string }> }>('/api/db/library');
  return items.map(i => i.paperId);
}

export async function apiSavePaper(paperId: string): Promise<void> {
  await call(`/api/db/library/${encodeURIComponent(paperId)}`, { method: 'PUT' });
}

export async function apiUnsavePaper(paperId: string): Promise<void> {
  await call(`/api/db/library/${encodeURIComponent(paperId)}`, { method: 'DELETE' });
}

// ---------- Read states ----------

export async function apiGetReadIds(): Promise<string[]> {
  const { ids } = await call<{ ids: string[] }>('/api/db/read');
  return ids ?? [];
}

export async function apiSetReadIds(ids: string[]): Promise<void> {
  await call('/api/db/read', { method: 'PUT', body: JSON.stringify({ ids }) });
}

// ---------- Trackers + scores ----------

export async function apiGetTrackers(): Promise<Tracker[]> {
  const { trackers } = await call<{ trackers: Tracker[] }>('/api/db/trackers');
  return trackers;
}

export async function apiUpsertTracker(t: Tracker): Promise<void> {
  await call(`/api/db/trackers/${encodeURIComponent(t.id)}`, {
    method: 'PUT',
    body: JSON.stringify(t),
  });
}

export async function apiDeleteTracker(id: string): Promise<void> {
  await call(`/api/db/trackers/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function apiGetScores(): Promise<PaperScore[]> {
  const { scores } = await call<{ scores: PaperScore[] }>('/api/db/scores');
  return scores;
}

export async function apiUpsertScores(scores: PaperScore[]): Promise<void> {
  await call('/api/db/scores', { method: 'POST', body: JSON.stringify({ scores }) });
}

export async function apiDeleteScoresForTracker(trackerId: string): Promise<void> {
  await call(`/api/db/scores/tracker/${encodeURIComponent(trackerId)}`, { method: 'DELETE' });
}

// ---------- IndexedDB → Postgres migration ----------

export interface MigrationPayload {
  papers:   unknown[];
  library:  string[];   // paper ids
  readIds:  string[];
  trackers: unknown[];
  scores:   unknown[];
}

export async function migrateFromIdb(payload: MigrationPayload): Promise<{ ok: boolean; counts: Record<string, number> }> {
  return call('/api/db/migrate-from-idb', { method: 'POST', body: JSON.stringify(payload) });
}
