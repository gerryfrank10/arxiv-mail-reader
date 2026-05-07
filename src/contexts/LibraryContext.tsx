import React, { createContext, useContext, useState, useCallback } from 'react';
import { Paper } from '../types';

const LIBRARY_KEY = 'arxiv_reader_library';

function loadLibrary(): Paper[] {
  try {
    const raw = localStorage.getItem(LIBRARY_KEY);
    if (!raw) return [];
    const papers = JSON.parse(raw) as Paper[];
    return papers.map(p => ({ ...p, digestDate: new Date(p.digestDate) }));
  } catch { return []; }
}

function saveLibrary(papers: Paper[]) {
  try { localStorage.setItem(LIBRARY_KEY, JSON.stringify(papers)); } catch { /* ignore */ }
}

interface LibraryContextValue {
  savedPapers: Paper[];
  savePaper: (p: Paper) => void;
  unsavePaper: (id: string) => void;
  isSaved: (id: string) => boolean;
}

const LibraryContext = createContext<LibraryContextValue | null>(null);

export function LibraryProvider({ children }: { children: React.ReactNode }) {
  const [savedPapers, setSavedPapers] = useState<Paper[]>(loadLibrary);

  const savePaper = useCallback((p: Paper) => {
    setSavedPapers(prev => {
      if (prev.some(x => x.id === p.id)) return prev;
      const next = [p, ...prev];
      saveLibrary(next);
      return next;
    });
  }, []);

  const unsavePaper = useCallback((id: string) => {
    setSavedPapers(prev => {
      const next = prev.filter(p => p.id !== id);
      saveLibrary(next);
      return next;
    });
  }, []);

  const isSaved = useCallback((id: string) => savedPapers.some(p => p.id === id), [savedPapers]);

  return (
    <LibraryContext.Provider value={{ savedPapers, savePaper, unsavePaper, isSaved }}>
      {children}
    </LibraryContext.Provider>
  );
}

export function useLibrary() {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error('useLibrary must be inside LibraryProvider');
  return ctx;
}
