// Storage adapter — single dispatch point so contexts don't care whether
// data lives in IndexedDB (local-only, default) or Postgres (server mode).
//
// Switch via setStorageMode(); the rest of the app reacts to the
// `storage-mode-changed` event we dispatch.

import { Paper, PaperScore, Tracker } from '../types';
import {
  dbGetAllPapers, dbUpsertPapers, dbUpdateAbstract,
  dbGetTrackers, dbUpsertTracker, dbDeleteTracker,
  dbGetAllScores, dbUpsertScores, dbDeleteScoresForTracker,
} from './paperDb';
import {
  apiListPapers, apiUpsertPapers, apiUpdatePaperAbstract,
  apiGetLibraryIds, apiSavePaper, apiUnsavePaper,
  apiGetReadIds, apiSetReadIds,
  apiGetTrackers, apiUpsertTracker, apiDeleteTracker,
  apiGetScores, apiUpsertScores, apiDeleteScoresForTracker,
} from './researchApi';

export type StorageMode = 'idb' | 'server';

const MODE_KEY = 'arxiv_storage_mode';
const STORAGE_MODE_EVENT = 'arxiv-storage-mode-changed';

export function getStorageMode(): StorageMode {
  return localStorage.getItem(MODE_KEY) === 'server' ? 'server' : 'idb';
}

export function setStorageMode(mode: StorageMode): void {
  localStorage.setItem(MODE_KEY, mode);
  window.dispatchEvent(new CustomEvent(STORAGE_MODE_EVENT, { detail: mode }));
}

/** Subscribe to mode changes. Returns an unsubscribe fn. */
export function onStorageModeChange(cb: (m: StorageMode) => void): () => void {
  const handler = (e: Event) => cb((e as CustomEvent).detail as StorageMode);
  window.addEventListener(STORAGE_MODE_EVENT, handler);
  return () => window.removeEventListener(STORAGE_MODE_EVENT, handler);
}

const isServer = () => getStorageMode() === 'server';

// =========================================================================
// Domain stores
// =========================================================================

export const papersStore = {
  async getAll(): Promise<Paper[]> {
    return isServer() ? apiListPapers() : dbGetAllPapers();
  },
  async upsert(papers: Paper[]): Promise<void> {
    if (isServer()) await apiUpsertPapers(papers);
    else            await dbUpsertPapers(papers);
  },
  async updateAbstract(id: string, abstract: string): Promise<void> {
    if (isServer()) await apiUpdatePaperAbstract(id, abstract);
    else            await dbUpdateAbstract(id, abstract);
  },
};

// Library stores Paper IDs only (the actual Paper data is in the papers
// store; LibraryContext joins the two).
const LEGACY_LIB_KEY = 'arxiv_reader_library';   // older versions stored full Paper objects
const LIB_IDS_KEY    = 'arxiv_reader_library_ids'; // newer compact store

function readLocalLibraryIds(): string[] {
  // Prefer the compact store; fall back to legacy full-object store
  try {
    const compact = localStorage.getItem(LIB_IDS_KEY);
    if (compact) return JSON.parse(compact) as string[];
  } catch { /* ignore */ }
  try {
    const legacy = localStorage.getItem(LEGACY_LIB_KEY);
    if (legacy) {
      const arr = JSON.parse(legacy) as Array<{ id: string }>;
      return arr.map(p => p.id);
    }
  } catch { /* ignore */ }
  return [];
}

function writeLocalLibraryIds(ids: string[]): void {
  try { localStorage.setItem(LIB_IDS_KEY, JSON.stringify(ids)); } catch { /* ignore */ }
}

export const libraryStore = {
  async getIds(): Promise<string[]> {
    return isServer() ? apiGetLibraryIds() : readLocalLibraryIds();
  },
  async save(paperId: string): Promise<void> {
    if (isServer()) {
      await apiSavePaper(paperId);
    } else {
      const cur = readLocalLibraryIds();
      if (!cur.includes(paperId)) writeLocalLibraryIds([...cur, paperId]);
    }
  },
  async unsave(paperId: string): Promise<void> {
    if (isServer()) {
      await apiUnsavePaper(paperId);
    } else {
      writeLocalLibraryIds(readLocalLibraryIds().filter(id => id !== paperId));
    }
  },
};

// Read states
const READ_KEY = 'arxiv_read_ids';

export const readStore = {
  async get(): Promise<Set<string>> {
    if (isServer()) return new Set(await apiGetReadIds());
    try {
      const raw = localStorage.getItem(READ_KEY);
      return new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch { return new Set(); }
  },
  async set(ids: Set<string>): Promise<void> {
    const arr = [...ids];
    if (isServer()) await apiSetReadIds(arr);
    else {
      try { localStorage.setItem(READ_KEY, JSON.stringify(arr)); } catch { /* ignore */ }
    }
  },
};

// Trackers
export const trackersStore = {
  async getAll(): Promise<Tracker[]> {
    return isServer() ? apiGetTrackers() : dbGetTrackers();
  },
  async upsert(t: Tracker): Promise<void> {
    if (isServer()) await apiUpsertTracker(t);
    else            await dbUpsertTracker(t);
  },
  async remove(id: string): Promise<void> {
    if (isServer()) await apiDeleteTracker(id);
    else            await dbDeleteTracker(id);
  },
};

// Scores
export const scoresStore = {
  async getAll(): Promise<PaperScore[]> {
    return isServer() ? apiGetScores() : dbGetAllScores();
  },
  async upsert(scores: PaperScore[]): Promise<void> {
    if (isServer()) await apiUpsertScores(scores);
    else            await dbUpsertScores(scores);
  },
  async deleteForTracker(trackerId: string): Promise<void> {
    if (isServer()) await apiDeleteScoresForTracker(trackerId);
    else            await dbDeleteScoresForTracker(trackerId);
  },
};

// lastSynced meta (per-mode key so switching modes preserves both)
export const metaStore = {
  async getLastSynced(): Promise<Date | null> {
    const key = `arxiv_last_synced_${getStorageMode()}`;
    try {
      const raw = localStorage.getItem(key);
      return raw ? new Date(raw) : null;
    } catch { return null; }
  },
  async setLastSynced(d: Date): Promise<void> {
    const key = `arxiv_last_synced_${getStorageMode()}`;
    try { localStorage.setItem(key, d.toISOString()); } catch { /* ignore */ }
  },
};
