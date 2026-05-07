import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { Paper, Settings } from '../types';
import { fetchArxivPapers } from '../utils/gmailApi';
import { fetchArxivPapersImap } from '../utils/imapApi';
import { useAuth } from './AuthContext';

const SETTINGS_KEY = 'arxiv_reader_settings';
const CACHE_KEY = 'arxiv_reader_papers';
const CACHE_TTL = 30 * 60 * 1000;

function loadSettings(): Settings {
  try {
    const s = localStorage.getItem(SETTINGS_KEY);
    if (s) return JSON.parse(s) as Settings;
  } catch { /* ignore */ }
  // arXiv digest emails arrive from no-reply@arxiv.org (most common)
  // or cs@arxiv.org depending on the list. Change in Settings if needed.
  return { senderEmail: 'no-reply@arxiv.org', maxEmails: 30 };
}

function loadCache(): Paper[] | null {
  try {
    const c = localStorage.getItem(CACHE_KEY);
    if (!c) return null;
    const { papers, ts } = JSON.parse(c) as { papers: Paper[]; ts: number };
    if (Date.now() - ts > CACHE_TTL) return null;
    return papers.map(p => ({ ...p, digestDate: new Date(p.digestDate) }));
  } catch { return null; }
}

function saveCache(papers: Paper[]) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ papers, ts: Date.now() }));
  } catch { /* ignore */ }
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
  sync: (force?: boolean) => Promise<void>;
  setSelectedPaper: (p: Paper | null) => void;
  setSearchQuery: (q: string) => void;
  setSelectedCategory: (c: string) => void;
  updateSettings: (s: Partial<Settings>) => void;
  filteredPapers: Paper[];
  allCategories: string[];
}

const PapersContext = createContext<PapersContextValue | null>(null);

export function PapersProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [papers, setPapers] = useState<Paper[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [selectedPaper, setSelectedPaper] = useState<Paper | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');

  const sync = useCallback(async (force = false) => {
    if (!user) return;
    if (!force) {
      const cached = loadCache();
      if (cached) { setPapers(cached); return; }
    }
    setLoading(true);
    setError(null);
    setProgress(0);
    try {
      let result: Paper[];
      if (user.provider === 'google' && user.accessToken) {
        result = await fetchArxivPapers(
          user.accessToken,
          settings.senderEmail,
          settings.maxEmails,
          (loaded, total) => setProgress(Math.round((loaded / total) * 100))
        );
      } else if (user.provider === 'imap' && user.imapConfig) {
        result = await fetchArxivPapersImap(
          user.imapConfig,
          settings.senderEmail,
          settings.maxEmails,
          (loaded, total) => setProgress(Math.round((loaded / total) * 100))
        );
      } else {
        throw new Error('No valid auth credentials found.');
      }
      setPapers(result);
      saveCache(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch emails');
    } finally {
      setLoading(false);
      setProgress(100);
    }
  }, [user, settings]);

  useEffect(() => {
    if (user) sync();
  }, [user?.email]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateSettings = useCallback((updates: Partial<Settings>) => {
    setSettings(prev => {
      const next = { ...prev, ...updates };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const allCategories = [...new Set(papers.flatMap(p => p.categories))].sort();

  const filteredPapers = papers.filter(p => {
    const q = searchQuery.toLowerCase();
    const matchesSearch = !q ||
      p.title.toLowerCase().includes(q) ||
      p.authors.toLowerCase().includes(q) ||
      p.abstract.toLowerCase().includes(q) ||
      p.arxivId.includes(q);
    const matchesCat = !selectedCategory || p.categories.includes(selectedCategory);
    return matchesSearch && matchesCat;
  });

  return (
    <PapersContext.Provider value={{
      papers, loading, progress, error, settings, selectedPaper, searchQuery, selectedCategory,
      sync, setSelectedPaper, setSearchQuery, setSelectedCategory, updateSettings,
      filteredPapers, allCategories,
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
