import { Paper } from '../types';

const DB_NAME    = 'arxiv_reader';
const DB_VERSION = 1;
const PAPERS     = 'papers';
const META       = 'meta';

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
