import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import { Paper, Settings, SortField, SortDir } from '../types';
import { fetchArxivPapers } from '../utils/gmailApi';
import { fetchArxivPapersImap } from '../utils/imapApi';
import { computeAssessment } from '../utils/assessment';
import { dbGetAllPapers, dbUpsertPapers, dbGetMeta, dbSetMeta, dbUpdateAbstract } from '../utils/paperDb';
import { useAuth } from './AuthContext';
import { AssessmentLabel } from '../utils/assessment';

const SETTINGS_KEY = 'arxiv_reader_settings';
const READ_KEY     = 'arxiv_read_ids';

function loadReadIds(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(READ_KEY) ?? '[]') as string[]); }
  catch { return new Set(); }
}
function saveReadIds(ids: Set<string>) {
  try { localStorage.setItem(READ_KEY, JSON.stringify([...ids])); } catch { /* ignore */ }
}

function loadSettings(): Settings {
  try {
    const s = localStorage.getItem(SETTINGS_KEY);
    if (s) return JSON.parse(s) as Settings;
  } catch { /* ignore */ }
  return { senderEmail: 'no-reply@arxiv.org', maxEmails: 30 };
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
  sync: (force?: boolean) => Promise<void>;
  setSelectedPaper: (p: Paper | null) => void;
  markRead: (id: string) => void;
  setSearchQuery: (q: string) => void;
  setSelectedCategory: (c: string) => void;
  setAuthorFilter: (a: string) => void;
  setAssessmentFilter: (f: AssessmentLabel | '') => void;
  setSortBy: (f: SortField) => void;
  setSortDir: (d: SortDir) => void;
  updateSettings: (s: Partial<Settings>) => void;
  updatePaperAbstract: (id: string, abstract: string) => void;
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
  const [readIds, setReadIds]             = useState<Set<string>>(loadReadIds);

  // Load persisted papers from IndexedDB on mount
  useEffect(() => {
    (async () => {
      try {
        const stored = await dbGetAllPapers();
        if (stored.length) setPapers(stored);
        const ts = await dbGetMeta('lastSynced');
        if (ts) setLastSynced(new Date(ts as string));
      } catch { /* IndexedDB unavailable */ }
      setDbReady(true);
    })();
  }, []);

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
      if (user.provider === 'google' && user.accessToken) {
        newPapers = await fetchArxivPapers(
          user.accessToken,
          settings.senderEmail,
          settings.maxEmails,
          (loaded, total) => setProgress(Math.round((loaded / total) * 100))
        );
      } else if (user.provider === 'imap' && user.imapConfig) {
        newPapers = await fetchArxivPapersImap(
          user.imapConfig,
          settings.senderEmail,
          settings.maxEmails,
          (loaded, total) => setProgress(Math.round((loaded / total) * 100))
        );
      } else {
        throw new Error('No valid credentials.');
      }

      // Merge new papers into IndexedDB (upsert — existing unchanged)
      await dbUpsertPapers(newPapers);

      // Reload full set from DB so old papers are preserved
      const all = await dbGetAllPapers();
      setPapers(all);

      const now = new Date();
      await dbSetMeta('lastSynced', now.toISOString());
      setLastSynced(now);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch emails');
    } finally {
      setLoading(false);
      setProgress(100);
    }
  }, [user, settings, dbReady]);

  // Auto-sync when user logs in and DB is ready
  useEffect(() => {
    if (user && dbReady) sync();
  }, [user?.email, dbReady]); // eslint-disable-line react-hooks/exhaustive-deps

  const markRead = useCallback((id: string) => {
    setReadIds(prev => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      saveReadIds(next);
      return next;
    });
  }, []);

  // Wrap setSelectedPaper to auto-mark as read
  const setSelectedPaperFn = useCallback((p: Paper | null) => {
    if (p) markRead(p.id);
    _setSelectedPaper(p);
  }, [markRead]);

  const updatePaperAbstract = useCallback((id: string, abstract: string) => {
    // Persist to IndexedDB and update in-memory state so the abstract is available everywhere
    dbUpdateAbstract(id, abstract).catch(() => {});
    setPapers(prev => prev.map(p => p.id === id ? { ...p, abstract } : p));
    _setSelectedPaper(prev => prev?.id === id ? { ...prev, abstract } : prev);
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
      sync, setSelectedPaper: setSelectedPaperFn, markRead,
      setSearchQuery, setSelectedCategory,
      setAuthorFilter, setAssessmentFilter, setSortBy, setSortDir,
      updateSettings, updatePaperAbstract,
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
