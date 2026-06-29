import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import { Paper } from '../types';
import { libraryStore, likesStore, onStorageModeChange } from '../utils/storage';
import { usePapers } from './PapersContext';

interface LibraryContextValue {
  savedPapers: Paper[];
  savePaper:   (p: Paper) => void;
  unsavePaper: (id: string) => void;
  isSaved:     (id: string) => boolean;
  // Likes — a separate signal from bookmarks
  likedPapers: Paper[];
  likePaper:   (p: Paper) => void;
  unlikePaper: (id: string) => void;
  isLiked:     (id: string) => boolean;
}

const LibraryContext = createContext<LibraryContextValue | null>(null);

export function LibraryProvider({ children }: { children: React.ReactNode }) {
  const { papers } = usePapers();
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());

  const reload = useCallback(async () => {
    try {
      const [saved, liked] = await Promise.all([libraryStore.getIds(), likesStore.getIds()]);
      setSavedIds(new Set(saved));
      setLikedIds(new Set(liked));
    } catch (e) {
      console.warn('[library] failed to load', e);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  // Re-load when storage mode flips
  useEffect(() => onStorageModeChange(() => reload()), [reload]);

  // savedPapers = intersection of saved IDs with the in-memory papers list.
  // This means books/imported papers from the inbox both work the same way,
  // and there's no risk of storing stale paper data in two places.
  const savedPapers = useMemo(() => {
    if (savedIds.size === 0) return [];
    const byId = new Map(papers.map(p => [p.id, p]));
    const out: Paper[] = [];
    for (const id of savedIds) {
      const p = byId.get(id);
      if (p) out.push(p);
    }
    return out;
  }, [papers, savedIds]);

  const savePaper = useCallback((p: Paper) => {
    setSavedIds(prev => {
      if (prev.has(p.id)) return prev;
      const next = new Set(prev);
      next.add(p.id);
      libraryStore.save(p.id).catch(e => console.warn('[library] save failed', e));
      return next;
    });
  }, []);

  const unsavePaper = useCallback((id: string) => {
    setSavedIds(prev => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      libraryStore.unsave(id).catch(e => console.warn('[library] unsave failed', e));
      return next;
    });
  }, []);

  const isSaved = useCallback((id: string) => savedIds.has(id), [savedIds]);

  const likedPapers = useMemo(() => {
    if (likedIds.size === 0) return [];
    const byId = new Map(papers.map(p => [p.id, p]));
    const out: Paper[] = [];
    for (const id of likedIds) {
      const p = byId.get(id);
      if (p) out.push(p);
    }
    return out;
  }, [papers, likedIds]);

  const likePaper = useCallback((p: Paper) => {
    setLikedIds(prev => {
      if (prev.has(p.id)) return prev;
      const next = new Set(prev);
      next.add(p.id);
      likesStore.like(p.id).catch(e => console.warn('[likes] like failed', e));
      return next;
    });
  }, []);

  const unlikePaper = useCallback((id: string) => {
    setLikedIds(prev => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      likesStore.unlike(id).catch(e => console.warn('[likes] unlike failed', e));
      return next;
    });
  }, []);

  const isLiked = useCallback((id: string) => likedIds.has(id), [likedIds]);

  return (
    <LibraryContext.Provider value={{
      savedPapers, savePaper, unsavePaper, isSaved,
      likedPapers, likePaper, unlikePaper, isLiked,
    }}>
      {children}
    </LibraryContext.Provider>
  );
}

export function useLibrary() {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error('useLibrary must be inside LibraryProvider');
  return ctx;
}
