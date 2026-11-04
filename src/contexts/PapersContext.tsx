import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Paper, Settings, SortField, SortDir } from '../types';
import { fetchArxivPapers } from '../utils/gmailApi';
import { fetchArxivPapersImap } from '../utils/imapApi';
import { computeAssessment } from '../utils/assessment';
import { useAuth } from './AuthContext';
import { AssessmentLabel } from '../utils/assessment';
import { papersStore, readStore, metaStore, onStorageModeChange, getStorageMode } from '../utils/storage';
import { apiExistingArxivIds } from '../utils/researchApi';
import type { PaperStats } from '../utils/researchApi';

const SETTINGS_KEY = 'arxiv_reader_settings';

// Papers are loaded in windows rather than all at once: the full list is tens
// of MB once a library has tens of thousands of papers. The sidebar paginates
// 50 at a time, so this window is plenty for browsing and filtering.
const PAGE_SIZE = 5000;

function loadSettings(): Settings {
  let stored: Settings | null = null;
  try {
    const s = localStorage.getItem(SETTINGS_KEY);
    if (s) stored = JSON.parse(s) as Settings;
  } catch { /* ignore */ }
  const base: Settings = stored ?? { senderEmail: 'no-reply@arxiv.org', maxEmails: 30 };
  // Older builds kept IMAP credentials on the login session. AuthContext
  // stashes them under arxiv_imap_config when it discards a legacy session, so
  // adopt them here (until the user saves Settings, which persists them).
  if (!base.imapConfig) {
    try {
      const legacy = localStorage.getItem('arxiv_imap_config');
      if (legacy) base.imapConfig = JSON.parse(legacy) as Settings['imapConfig'];
    } catch { /* ignore */ }
  }
  return base;
}

interface PapersContextValue {
  papers: Paper[];
  loading: boolean;
  progress: number;
  error: string | null;
  settings: Settings;
  selectedPaper: Paper | null;
  searchQuery: string;
  selectedCategory: string;
  authorFilter: string;
  assessmentFilter: AssessmentLabel | '';
  sortBy: SortField;
  sortDir: SortDir;
  lastSynced: Date | null;
  readIds: Set<string>;
  unreadCount: number;
  storageMode: 'idb' | 'server';
  totalPapers: number;
  hasMorePapers: boolean;
  loadingMore: boolean;
  loadMorePapers: () => Promise<void>;
  stats: PaperStats | null;
  sync: (force?: boolean) => Promise<void>;
  setSelectedPaper: (p: Paper | null) => void;
  markRead: (id: string) => void;
  markUnread: (id: string) => void;
  markManyRead:   (ids: string[]) => void;
  markManyUnread: (ids: string[]) => void;
  markAllRead:    () => void;
  markAllUnread:  () => void;
  addImportedPapers: (papers: Paper[]) => Promise<{ added: number; duplicates: number; addedPapers: Paper[] }>;
  reloadPapers: () => Promise<void>;
  setSearchQuery: (q: string) => void;
  setSelectedCategory: (c: string) => void;
  setAuthorFilter: (a: string) => void;
  setAssessmentFilter: (f: AssessmentLabel | '') => void;
  setSortBy: (f: SortField) => void;
  setSortDir: (d: SortDir) => void;
  updateSettings: (s: Partial<Settings>) => void;
  updatePaperAbstract: (id: string, abstract: string) => void;
  updatePaperMeta: (id: string, patch: Partial<Paper>) => void;
  filteredPapers: Paper[];
  allCategories: string[];
  allAuthors: string[];
  activeFilterCount: number;
}

const PapersContext = createContext<PapersContextValue | null>(null);

export function PapersProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [papers, setPapers]               = useState<Paper[]>([]);
  const [loading, setLoading]             = useState(false);
  const [progress, setProgress]           = useState(0);
  const [error, setError]                 = useState<string | null>(null);
  const [settings, setSettings]           = useState<Settings>(loadSettings);
  const [_selectedPaper, _setSelectedPaper] = useState<Paper | null>(null);
  const selectedPaper = _selectedPaper;
  const [searchQuery, setSearchQuery]     = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [authorFilter, setAuthorFilter]   = useState('');
  const [assessmentFilter, setAssessmentFilter] = useState<AssessmentLabel | ''>('');
  const [sortBy, setSortBy]               = useState<SortField>('date');
  const [sortDir, setSortDir]             = useState<SortDir>('desc');
  const [lastSynced, setLastSynced]       = useState<Date | null>(null);
  const [dbReady, setDbReady]             = useState(false);
  const [readIds, setReadIds]             = useState<Set<string>>(new Set());
  // Track storage mode so we can reload data when the user flips it
  const [storageMode, setStorageMode]     = useState<'idb' | 'server'>(getStorageMode());

  // Pagination bookkeeping. `nextOffsetRef` counts rows fetched from the
  // server, not `papers.length` — the latter can grow past the window when a
  // sync folds newly fetched papers into memory.
  const [totalPapers, setTotalPapers]     = useState(0);
  const [hasMorePapers, setHasMorePapers] = useState(false);
  const [loadingMore, setLoadingMore]     = useState(false);
  const [stats, setStats]                 = useState<PaperStats | null>(null);
  const nextOffsetRef                     = useRef(0);
  const loadingMoreRef                    = useRef(false);

  const refreshStats = useCallback(() => {
    papersStore.getStats()
      .then(s => { if (s) setStats(s); })
      .catch(e => console.warn('[papers] stats failed', e));
  }, []);

  // Load persisted state via the active storage adapter
  const loadAll = useCallback(async () => {
    try {
      const [page, ts, ids, libraryStats] = await Promise.all([
        papersStore.getPage(0, PAGE_SIZE),
        metaStore.getLastSynced(),
        readStore.get(),
        papersStore.getStats(),
      ]);
      setPapers(page.papers);
      nextOffsetRef.current = page.papers.length;
      setTotalPapers(page.total);
      setHasMorePapers(page.hasMore);
      setLastSynced(ts);
      setReadIds(ids);
      setStats(libraryStats);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (/unauthorized/i.test(msg)) {
        setError('Your session has expired — please sign in again.');
      }
      console.warn('[papers] failed to load', e);
    }
    setDbReady(true);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Append the next window of papers. Local IndexedDB returns the whole set on
  // the first page, so this only does real work in server mode.
  const loadMorePapers = useCallback(async () => {
    if (loadingMoreRef.current || !hasMorePapers) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const page = await papersStore.getPage(nextOffsetRef.current, PAGE_SIZE);
      nextOffsetRef.current += page.papers.length;
      setTotalPapers(page.total);
      setHasMorePapers(page.papers.length > 0 && page.hasMore);
      setPapers(prev => {
        const byId = new Map(prev.map(p => [p.id, p]));
        for (const p of page.papers) if (!byId.has(p.id)) byId.set(p.id, p);
        return [...byId.values()];
      });
    } catch (e) {
      console.warn('[papers] failed to load more', e);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [hasMorePapers]);

  // Re-load when storage mode changes (e.g. user flipped IDB → server)
  useEffect(() => {
    return onStorageModeChange((m) => {
      setStorageMode(m);
      setDbReady(false);
      loadAll();
    });
  }, [loadAll]);

  const sync = useCallback(async (force = false) => {
    if (!user || (!dbReady && !force)) return;
    if (!navigator.onLine) {
      setError('You are offline. Showing cached papers.');
      return;
    }
    setLoading(true);
    setError(null);
    setProgress(0);
    try {
      let newPapers: Paper[];
      if (settings.imapConfig) {
        newPapers = await fetchArxivPapersImap(
          settings.imapConfig,
          settings.senderEmail,
          settings.maxEmails,
          (loaded, total) => setProgress(Math.round((loaded / total) * 100))
        );
      } else if (user.provider === 'google' && user.accessToken) {
        // Legacy Google sessions are no longer issued, but keep the path for
        // any session that still has a valid token.
        newPapers = await fetchArxivPapers(
          user.accessToken,
          settings.senderEmail,
          settings.maxEmails,
          (loaded, total) => setProgress(Math.round((loaded / total) * 100))
        );
      } else {
        throw new Error('Add your mail credentials in Settings → Email & sync.');
      }

      // Persist the freshly-fetched papers (idempotent upsert).
      await papersStore.upsert(newPapers);

      // Merge them into in-memory state instead of re-downloading the whole
      // library — getAll() can be tens of MB once you have many thousands of
      // papers, which made every sync slow. The full set is already in `papers`
      // from the initial load; we only need to fold in what's new.
      setPapers(prev => {
        const byId = new Map(prev.map(p => [p.id, p]));
        for (const p of newPapers) byId.set(p.id, p);
        return [...byId.values()];
      });

      const now = new Date();
      await metaStore.setLastSynced(now);
      setLastSynced(now);
      refreshStats();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch emails');
    } finally {
      setLoading(false);
      setProgress(100);
    }
  }, [user, settings, dbReady]);

  // Auto-sync when user logs in and DB is ready — only when mail credentials
  // are configured, otherwise every login would show a "no credentials" error.
  useEffect(() => {
    if (user && dbReady && settings.imapConfig) sync();
  }, [user?.email, dbReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist read state through the active storage adapter. Incremental calls
  // (add/remove) keep a single click O(1); the full set is only used when
  // clearing everything.
  function persistReadIds(ids: Set<string>) {
    readStore.set(ids).catch(e => console.warn('[papers] persistReadIds failed', e));
  }

  const markRead = useCallback((id: string) => {
    setReadIds(prev => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      readStore.add([id]).catch(e => console.warn('[papers] markRead failed', e));
      return next;
    });
  }, []);

  const markUnread = useCallback((id: string) => {
    setReadIds(prev => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      readStore.remove([id]).catch(e => console.warn('[papers] markUnread failed', e));
      return next;
    });
  }, []);

  const markManyRead = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    setReadIds(prev => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      readStore.add(ids).catch(e => console.warn('[papers] markManyRead failed', e));
      return next;
    });
  }, []);

  const markManyUnread = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    setReadIds(prev => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      readStore.remove(ids).catch(e => console.warn('[papers] markManyUnread failed', e));
      return next;
    });
  }, []);

  const markAllRead = useCallback(() => {
    markManyRead(papers.map(p => p.id));
  }, [papers, markManyRead]);

  const markAllUnread = useCallback(() => {
    setReadIds(() => {
      const empty = new Set<string>();
      persistReadIds(empty);
      return empty;
    });
  }, []);

  // Add imported papers to the inbox (de-dup against the whole library).
  const addImportedPapers = useCallback(async (newPapers: Paper[]) => {
    if (newPapers.length === 0) return { added: 0, duplicates: 0, addedPapers: [] };

    // Dedupe within the batch first — pasting the same id twice used to make
    // the second copy overwrite the first and inflate the "added" count.
    const keyOf = (p: Paper) => (p.arxivId || p.id).trim().toLowerCase().replace(/v\d+$/i, '');
    const seen = new Set<string>();
    const unique: Paper[] = [];
    for (const p of newPapers) {
      const key = keyOf(p);
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(p);
    }

    // The in-memory list only holds the current page, so also ask the server
    // which of these already exist. Otherwise re-importing an old paper looked
    // like a successful add while the server silently updated/ignored the row.
    const existingByArxiv = new Set(papers.map(keyOf));
    if (storageMode === 'server' && unique.length > 0) {
      try {
        const found = await apiExistingArxivIds(unique.map(p => p.arxivId));
        for (const id of found) existingByArxiv.add(id.trim().toLowerCase().replace(/v\d+$/i, ''));
      } catch (e) {
        console.warn('[papers] duplicate check failed', e);
      }
    }

    const toAdd = unique.filter(p => !existingByArxiv.has(keyOf(p)));
    const dupCount = newPapers.length - toAdd.length;
    if (toAdd.length === 0) return { added: 0, duplicates: dupCount, addedPapers: [] };

    await papersStore.upsert(toAdd);

    // Merge in memory instead of re-downloading the whole list.
    setPapers(prev => {
      const byId = new Map(prev.map(p => [p.id, p]));
      for (const p of toAdd) byId.set(p.id, p);
      return [...byId.values()];
    });
    if (storageMode === 'server') setTotalPapers(prev => prev + toAdd.length);
    refreshStats();
    return { added: toAdd.length, duplicates: dupCount, addedPapers: toAdd };
  }, [papers, storageMode, refreshStats]);

  // Wrap setSelectedPaper to auto-mark as read
  const setSelectedPaperFn = useCallback((p: Paper | null) => {
    if (p) markRead(p.id);
    _setSelectedPaper(p);
  }, [markRead]);

  const updatePaperAbstract = useCallback((id: string, abstract: string) => {
    // Persist via the active store + update in-memory state immediately
    papersStore.updateAbstract(id, abstract).catch(() => {});
    setPapers(prev => prev.map(p => p.id === id ? { ...p, abstract } : p));
    _setSelectedPaper(prev => prev?.id === id ? { ...prev, abstract } : prev);
  }, []);

  // Local-only metadata patch (e.g. the server just cached a PDF or finished
  // extracting full text). Nothing is persisted here: the server already is
  // the source of truth for those fields.
  const updatePaperMeta = useCallback((id: string, patch: Partial<Paper>) => {
    setPapers(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p));
    _setSelectedPaper(prev => prev?.id === id ? { ...prev, ...patch } : prev);
  }, []);

  const updateSettings = useCallback((updates: Partial<Settings>) => {
    setSettings(prev => {
      const next = { ...prev, ...updates };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const allCategories = useMemo(
    () => [...new Set(papers.flatMap(p => p.categories))].sort(),
    [papers]
  );

  const allAuthors = useMemo(
    () => [...new Set(papers.flatMap(p => p.authorList))].sort(),
    [papers]
  );

  const filteredPapers = useMemo(() => {
    const q  = searchQuery.toLowerCase();
    const af = authorFilter.toLowerCase();

    const filtered = papers.filter(p => {
      const matchesSearch = !q ||
        p.title.toLowerCase().includes(q) ||
        p.authors.toLowerCase().includes(q) ||
        p.abstract.toLowerCase().includes(q) ||
        p.arxivId.includes(q);

      const matchesCat = !selectedCategory || p.categories.includes(selectedCategory);

      const matchesAuthor = !af ||
        p.authorList.some(a => a.toLowerCase().includes(af)) ||
        p.authors.toLowerCase().includes(af);

      const matchesAssessment = !assessmentFilter ||
        computeAssessment(p).label === assessmentFilter;

      return matchesSearch && matchesCat && matchesAuthor && matchesAssessment;
    });

    filtered.sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case 'date':    cmp = a.digestDate.getTime() - b.digestDate.getTime(); break;
        case 'title':   cmp = a.title.localeCompare(b.title); break;
        case 'authors': cmp = (a.authorList[0] ?? '').localeCompare(b.authorList[0] ?? ''); break;
        case 'score':   cmp = computeAssessment(a).score - computeAssessment(b).score; break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return filtered;
  }, [papers, searchQuery, selectedCategory, authorFilter, assessmentFilter, sortBy, sortDir]);

  const activeFilterCount = [selectedCategory, authorFilter, assessmentFilter].filter(Boolean).length;
  const unreadCount = useMemo(() => papers.filter(p => !readIds.has(p.id)).length, [papers, readIds]);

  return (
    <PapersContext.Provider value={{
      papers, loading, progress, error, settings, selectedPaper, searchQuery, selectedCategory,
      authorFilter, assessmentFilter, sortBy, sortDir, lastSynced, readIds, unreadCount,
      storageMode,
      totalPapers, hasMorePapers, loadingMore, loadMorePapers, stats,
      sync, setSelectedPaper: setSelectedPaperFn,
      markRead, markUnread, markManyRead, markManyUnread, markAllRead, markAllUnread,
      addImportedPapers,
      reloadPapers: loadAll,
      setSearchQuery, setSelectedCategory,
      setAuthorFilter, setAssessmentFilter, setSortBy, setSortDir,
      updateSettings, updatePaperAbstract, updatePaperMeta,
      filteredPapers, allCategories, allAuthors, activeFilterCount,
    }}>
      {children}
    </PapersContext.Provider>
  );
}

export function usePapers() {
  const ctx = useContext(PapersContext);
  if (!ctx) throw new Error('usePapers must be used inside PapersProvider');
  return ctx;
}
