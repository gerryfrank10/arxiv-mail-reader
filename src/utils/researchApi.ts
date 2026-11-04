// Thin typed client for the /api/db/* server endpoints (books + documents).
//
// All Books & Writer features require Postgres on the server side. When it
// isn't enabled, the status endpoint returns { enabled: false } and the
// client UI shows a setup hint instead of an empty/broken state.

import { Book, Collection, CollectionItem, EntityKind, Link, LinkRel, MagazineDraft, MagazineIssue, MagazineIssueSummary, MagazineSource, Paper, PaperComment, PaperScore, ResearchDocument, Tracker } from '../types';

function userEmailFromLocalStorage(): string | null {
  try {
    const raw = localStorage.getItem('arxiv_auth_session');
    if (!raw) return null;
    const u = JSON.parse(raw) as { email?: string };
    return u.email ?? null;
  } catch { return null; }
}

const TOKEN_KEY = 'arxiv_server_token';

export function getServerToken(): string {
  try { return localStorage.getItem(TOKEN_KEY) ?? ''; } catch { return ''; }
}

export function setServerToken(token: string): void {
  const t = token.trim();
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else   localStorage.removeItem(TOKEN_KEY);
  } catch { /* ignore */ }
}

function sessionToken(): string {
  try {
    const raw = localStorage.getItem('arxiv_auth_session');
    if (!raw) return '';
    const s = JSON.parse(raw) as { accessToken?: string; provider?: string };
    return s.provider === 'server' ? (s.accessToken ?? '') : '';
  } catch { return ''; }
}

export function authHeaders(): HeadersInit {
  const email = userEmailFromLocalStorage();
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (email) h['x-user-email'] = email;
  const token = sessionToken() || getServerToken();
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

// ---------- accounts ----------

export interface AuthResult { token: string; user: { email: string } }

export async function apiLogin(email: string, password: string): Promise<AuthResult> {
  return call<AuthResult>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export async function apiRegister(email: string, password: string): Promise<AuthResult> {
  return call<AuthResult>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export async function apiLogout(): Promise<void> {
  await call('/api/auth/logout', { method: 'POST' });
}

export async function apiMe(): Promise<{ user: { email: string } }> {
  return call<{ user: { email: string } }>('/api/auth/me');
}

export async function apiChangePassword(currentPassword: string, newPassword: string): Promise<{ token: string }> {
  return call<{ token: string }>('/api/auth/password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
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

// Uploads a file (PDF/EPUB/etc) to an existing book and returns the
// refreshed Book record. The book must already exist on the server.
export async function uploadBookFile(bookId: string, file: File): Promise<Book> {
  const form = new FormData();
  form.append('file', file);
  // Don't set Content-Type — let the browser add the multipart boundary
  const email = userEmailFromLocalStorage();
  const headers: Record<string, string> = {};
  if (email) headers['x-user-email'] = email;
  const token = getServerToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const r = await fetch(`/api/db/books/${encodeURIComponent(bookId)}/upload`, {
    method: 'POST',
    headers,
    body: form,
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? `Upload failed (HTTP ${r.status})`);
  }
  const data = await r.json() as { book: Book };
  return data.book;
}

export async function deleteBookFile(bookId: string): Promise<void> {
  await call(`/api/db/books/${encodeURIComponent(bookId)}/file`, { method: 'DELETE' });
}

// Build a URL the browser can open directly. We append the user email
// as a query param since the server route protects via header — but for
// <a href> and <iframe src> we need it in the URL. The server accepts
// both for the /file endpoint.
export function bookFileUrl(bookId: string, opts: { download?: boolean } = {}): string {
  // Browser-direct navigation (<a target=_blank>, <iframe src>) can't set
  // headers, so we pass the user email as a query param. The server route
  // accepts either header or query param.
  const email = (() => {
    try {
      const raw = localStorage.getItem('arxiv_auth_session');
      return raw ? (JSON.parse(raw) as { email?: string }).email ?? '' : '';
    } catch { return ''; }
  })();
  const params = new URLSearchParams();
  if (opts.download) params.set('download', '1');
  if (email)         params.set('email', email);
  const token = sessionToken() || getServerToken();
  if (token)         params.set('token', token);
  return `/api/db/books/${encodeURIComponent(bookId)}/file?${params}`;
}

// ---------- Paper PDF uploads (read in-app) ----------

export async function uploadPaperFile(paperId: string, file: File): Promise<void> {
  const form = new FormData();
  form.append('file', file);
  const email = userEmailFromLocalStorage();
  const headers: Record<string, string> = {};
  if (email) headers['x-user-email'] = email;
  const token = getServerToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const r = await fetch(`/api/db/papers/${encodeURIComponent(paperId)}/upload`, {
    method: 'POST',
    headers,
    body: form,
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? `Upload failed (HTTP ${r.status})`);
  }
}

export async function deletePaperFile(paperId: string): Promise<void> {
  await call(`/api/db/papers/${encodeURIComponent(paperId)}/file`, { method: 'DELETE' });
}

export interface CachedPaperFile {
  paper: Paper;
  cached: boolean;       // true when the PDF was already on the server
  textPending: boolean;  // text extraction still running in the background
}

/** Download an arXiv PDF into server storage (idempotent) and start text extraction. */
export async function cachePaperFile(paperId: string): Promise<CachedPaperFile> {
  const data = await call<CachedPaperFile>(`/api/db/papers/${encodeURIComponent(paperId)}/cache-file`, {
    method: 'POST',
    body: '{}',
  });
  return {
    ...data,
    paper: { ...data.paper, digestDate: new Date(data.paper.digestDate) },
  };
}

export interface PaperFullText {
  text: string;
  ready: boolean;
  chars: number;
  extractedAt: number | null;
  hasFile: boolean;
  originalFilename: string | null;
}

/** Extracted plain text for a cached paper (empty + ready:false until extraction finishes). */
export async function getPaperFullText(paperId: string): Promise<PaperFullText> {
  return call(`/api/db/papers/${encodeURIComponent(paperId)}/fulltext`);
}

// URL the browser can open directly (<iframe src>, <a href>) — email goes in
// the query since those can't set headers; the server route accepts either.
export function paperFileUrl(paperId: string, opts: { download?: boolean } = {}): string {
  const email = (() => {
    try {
      const raw = localStorage.getItem('arxiv_auth_session');
      return raw ? (JSON.parse(raw) as { email?: string }).email ?? '' : '';
    } catch { return ''; }
  })();
  const params = new URLSearchParams();
  if (opts.download) params.set('download', '1');
  if (email)         params.set('email', email);
  const token = sessionToken() || getServerToken();
  if (token)         params.set('token', token);
  return `/api/db/papers/${encodeURIComponent(paperId)}/file?${params}`;
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

export async function apiListPapers(
  { limit = 0, offset = 0 }: { limit?: number; offset?: number } = {},
): Promise<{ papers: Paper[]; total: number }> {
  const qs = new URLSearchParams();
  if (limit > 0) qs.set('limit', String(limit));
  if (offset > 0) qs.set('offset', String(offset));
  const suffix = qs.toString() ? `?${qs}` : '';
  const { papers, total } = await call<{
    papers: Array<Paper & { digestDate: string }>;
    total: number;
  }>(`/api/db/papers${suffix}`);
  return {
    papers: papers.map(p => ({ ...p, digestDate: new Date(p.digestDate) })),
    total: typeof total === 'number' ? total : papers.length,
  };
}

export interface PaperStats {
  total: number;
  read: number;
  unread: number;
  saved: number;
  last30: number;
  firstDate: string | null;
  lastDate: string | null;
  categories: Array<{ category: string; count: number }>;
  daily: Array<{ day: string; count: number }>;
}

export async function apiGetStats(): Promise<PaperStats> {
  return call<PaperStats>('/api/db/stats');
}

export async function apiExistingArxivIds(arxivIds: string[]): Promise<string[]> {
  const { arxivIds: found } = await call<{ arxivIds: string[] }>('/api/db/papers/existing', {
    method: 'POST',
    body: JSON.stringify({ arxivIds }),
  });
  return found ?? [];
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

// ---------- Paper comments ----------

export async function apiGetPaperComments(paperId: string): Promise<PaperComment[]> {
  const { comments } = await call<{ comments: PaperComment[] }>(
    `/api/db/papers/${encodeURIComponent(paperId)}/comments`,
  );
  return comments ?? [];
}

export async function apiAddPaperComment(paperId: string, body: string): Promise<PaperComment> {
  const { comment } = await call<{ comment: PaperComment }>(
    `/api/db/papers/${encodeURIComponent(paperId)}/comments`,
    { method: 'POST', body: JSON.stringify({ body }) },
  );
  return comment;
}

export async function apiDeletePaperComment(commentId: string): Promise<void> {
  await call(`/api/db/comments/${encodeURIComponent(commentId)}`, { method: 'DELETE' });
}

export async function apiGetCommentCounts(paperIds: string[]): Promise<Record<string, number>> {
  if (paperIds.length === 0) return {};
  const { counts } = await call<{ counts: Record<string, number> }>(
    '/api/db/comments/counts',
    { method: 'POST', body: JSON.stringify({ ids: paperIds }) },
  );
  return counts ?? {};
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

// ---------- Likes (distinct from library) ----------

export async function apiGetLikedIds(): Promise<string[]> {
  const { items } = await call<{ items: Array<{ paperId: string; likedAt: string }> }>('/api/db/likes');
  return items.map(i => i.paperId);
}

export async function apiLikePaper(paperId: string): Promise<void> {
  await call(`/api/db/likes/${encodeURIComponent(paperId)}`, { method: 'PUT' });
}

export async function apiUnlikePaper(paperId: string): Promise<void> {
  await call(`/api/db/likes/${encodeURIComponent(paperId)}`, { method: 'DELETE' });
}

// ---------- Read states ----------

export async function apiGetReadIds(): Promise<string[]> {
  const { ids } = await call<{ ids: string[] }>('/api/db/read');
  return ids ?? [];
}

export async function apiSetReadIds(ids: string[]): Promise<void> {
  await call('/api/db/read', { method: 'PUT', body: JSON.stringify({ ids }) });
}

export async function apiAddReadIds(ids: string[]): Promise<void> {
  await call('/api/db/read/add', { method: 'POST', body: JSON.stringify({ ids }) });
}

export async function apiRemoveReadIds(ids: string[]): Promise<void> {
  await call('/api/db/read/remove', { method: 'POST', body: JSON.stringify({ ids }) });
}

export async function apiMarkAllRead(): Promise<number> {
  const { marked } = await call<{ marked: number }>('/api/db/read/all', { method: 'POST' });
  return marked ?? 0;
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

// ---------- Magazine ----------

export async function apiListMagazineIssues(): Promise<MagazineIssueSummary[]> {
  const { issues } = await call<{ issues: MagazineIssueSummary[] }>('/api/db/magazine');
  return issues;
}

export async function apiGetMagazineIssue(id: string): Promise<MagazineIssue> {
  const { issue } = await call<{ issue: MagazineIssue }>(`/api/db/magazine/${encodeURIComponent(id)}`);
  return issue;
}

export async function apiDeleteMagazineIssue(id: string): Promise<void> {
  await call(`/api/db/magazine/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function apiDraftMagazine(opts: { sources?: MagazineSource[]; weekStart?: string; newsTopics?: string } = {}): Promise<MagazineDraft> {
  return call('/api/db/magazine/draft', {
    method: 'POST',
    body: JSON.stringify(opts),
  });
}

export async function apiSaveMagazineIssue(issue: MagazineIssue): Promise<void> {
  await call(`/api/db/magazine/${encodeURIComponent(issue.id)}`, {
    method: 'PUT',
    body: JSON.stringify(issue),
  });
}

export function newMagazineIssueId(): string {
  return `mag-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface MagazineAutoPrefs {
  email:       string;
  auto:        boolean;
  dayOfWeek:   number;   // 1=Mon..7=Sun
  hour:        number;   // 0..23
  sources:     MagazineSource[];
  lastAutoRun: number | null;
}

export async function apiGetMagazineAutoPrefs(): Promise<MagazineAutoPrefs | null> {
  const { prefs } = await call<{ prefs: MagazineAutoPrefs | null }>('/api/db/magazine/auto/prefs');
  return prefs;
}

export async function apiSetMagazineAutoPrefs(prefs: Partial<Omit<MagazineAutoPrefs, 'email' | 'lastAutoRun'>>): Promise<MagazineAutoPrefs | null> {
  const { prefs: next } = await call<{ prefs: MagazineAutoPrefs | null }>('/api/db/magazine/auto/prefs', {
    method: 'PUT',
    body: JSON.stringify(prefs),
  });
  return next;
}

// ---------- Global search ----------

export type SearchResultKind = 'paper' | 'book' | 'document' | 'collection' | 'magazine';

export interface SearchResult {
  kind:    SearchResultKind;
  id:      string;
  title:   string;
  snippet: string;
  sub:     string;
  ts:      number | null;
}

export async function apiGlobalSearch(query: string, limit = 40): Promise<SearchResult[]> {
  if (!query || query.length < 2) return [];
  const url = `/api/db/search?q=${encodeURIComponent(query)}&limit=${limit}`;
  const { results } = await call<{ results: SearchResult[] }>(url);
  return results;
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
