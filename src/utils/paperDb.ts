import { Paper, Tracker, PaperScore } from '../types';

const DB_NAME    = 'arxiv_reader';
const DB_VERSION = 2;
const PAPERS     = 'papers';
const META       = 'meta';
const TRACKERS   = 'trackers';
const SCORES     = 'paper_scores';

let _db: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (_db) return _db;
  _db = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(PAPERS)) {
        const s = db.createObjectStore(PAPERS, { keyPath: 'id' });
        s.createIndex('digestDate', 'digestDate');
        s.createIndex('emailId',    'emailId');
      }
      if (!db.objectStoreNames.contains(META)) {
        db.createObjectStore(META);
      }
      // v2: tracking
      if (!db.objectStoreNames.contains(TRACKERS)) {
        db.createObjectStore(TRACKERS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(SCORES)) {
        const s = db.createObjectStore(SCORES, { keyPath: 'id' });
        s.createIndex('paperId',   'paperId');
        s.createIndex('trackerId', 'trackerId');
      }
    };
    req.onsuccess  = () => resolve(req.result);
    req.onerror    = () => { _db = null; reject(req.error); };
  });
  return _db;
}

function ser(p: Paper): Record<string, unknown> {
  return { ...p, digestDate: p.digestDate instanceof Date ? p.digestDate.toISOString() : p.digestDate };
}
function deser(r: Record<string, unknown>): Paper {
  return { ...r, digestDate: new Date(r.digestDate as string) } as Paper;
}

export async function dbGetAllPapers(): Promise<Paper[]> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = db.transaction(PAPERS, 'readonly').objectStore(PAPERS).getAll();
    req.onsuccess = () => resolve((req.result as Record<string, unknown>[]).map(deser));
    req.onerror   = () => reject(req.error);
  });
}

export async function dbUpsertPapers(papers: Paper[]): Promise<void> {
  if (!papers.length) return;
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(PAPERS, 'readwrite');
    const store = tx.objectStore(PAPERS);
    for (const p of papers) store.put(ser(p));
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

export async function dbUpdateAbstract(id: string, abstract: string): Promise<void> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(PAPERS, 'readwrite');
    const store = tx.objectStore(PAPERS);
    const req   = store.get(id);
    req.onsuccess = () => {
      if (!req.result) { resolve(); return; }
      const updated = { ...req.result, abstract };
      store.put(updated);
    };
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

export async function dbGetMeta(key: string): Promise<unknown> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = db.transaction(META, 'readonly').objectStore(META).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror   = () => reject(req.error);
  });
}

export async function dbSetMeta(key: string, value: unknown): Promise<void> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META, 'readwrite');
    tx.objectStore(META).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

// ---------- Trackers ----------

export async function dbGetTrackers(): Promise<Tracker[]> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = db.transaction(TRACKERS, 'readonly').objectStore(TRACKERS).getAll();
    req.onsuccess = () => resolve(req.result as Tracker[]);
    req.onerror   = () => reject(req.error);
  });
}

export async function dbUpsertTracker(t: Tracker): Promise<void> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TRACKERS, 'readwrite');
    tx.objectStore(TRACKERS).put(t);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

export async function dbDeleteTracker(id: string): Promise<void> {
  const db = await open();
  return new Promise((resolve, reject) => {
    // Delete the tracker + every score that references it
    const tx       = db.transaction([TRACKERS, SCORES], 'readwrite');
    tx.objectStore(TRACKERS).delete(id);
    const scoreIdx = tx.objectStore(SCORES).index('trackerId');
    const cur      = scoreIdx.openCursor(IDBKeyRange.only(id));
    cur.onsuccess = (e) => {
      const c = (e.target as IDBRequest<IDBCursorWithValue>).result;
      if (c) { c.delete(); c.continue(); }
    };
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

// ---------- Paper scores ----------

export async function dbGetAllScores(): Promise<PaperScore[]> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = db.transaction(SCORES, 'readonly').objectStore(SCORES).getAll();
    req.onsuccess = () => resolve(req.result as PaperScore[]);
    req.onerror   = () => reject(req.error);
  });
}

export async function dbUpsertScores(scores: PaperScore[]): Promise<void> {
  if (!scores.length) return;
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(SCORES, 'readwrite');
    const store = tx.objectStore(SCORES);
    for (const s of scores) store.put(s);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

// Get the set of paperIds that already have scores for a given tracker
export async function dbGetScoredPaperIds(trackerId: string): Promise<Set<string>> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const idx = db.transaction(SCORES, 'readonly').objectStore(SCORES).index('trackerId');
    const req = idx.getAll(IDBKeyRange.only(trackerId));
    req.onsuccess = () => resolve(new Set((req.result as PaperScore[]).map(s => s.paperId)));
    req.onerror   = () => reject(req.error);
  });
}

export async function dbDeleteScoresForTracker(trackerId: string): Promise<void> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx       = db.transaction(SCORES, 'readwrite');
    const idx      = tx.objectStore(SCORES).index('trackerId');
    const cur      = idx.openCursor(IDBKeyRange.only(trackerId));
    cur.onsuccess = (e) => {
      const c = (e.target as IDBRequest<IDBCursorWithValue>).result;
      if (c) { c.delete(); c.continue(); }
    };
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}
