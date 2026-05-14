import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Paper, PaperScore, Tracker } from '../types';
import {
  dbDeleteScoresForTracker,
  dbDeleteTracker,
  dbGetAllScores,
  dbGetTrackers,
  dbUpsertScores,
  dbUpsertTracker,
} from '../utils/paperDb';
import { scorePapersAgainstTracker } from '../utils/trackerScoring';
import { usePapers } from './PapersContext';

interface ScoringState {
  trackerId: string;
  done: number;
  total: number;
}

interface TrackingValue {
  trackers: Tracker[];
  scores:   PaperScore[];
  ready:    boolean;
  scoring:  ScoringState | null;
  // CRUD
  createTracker: (t: Omit<Tracker, 'id' | 'createdAt' | 'updatedAt'>) => Promise<Tracker>;
  updateTracker: (id: string, patch: Partial<Tracker>) => Promise<void>;
  deleteTracker: (id: string) => Promise<void>;
  // Scoring
  rescoreTracker: (id: string) => Promise<void>;
  scoreNewPapers: (papers: Paper[]) => Promise<void>;
  // Derived
  matchesByTracker: (trackerId: string) => Array<{ paper: Paper; score: PaperScore }>;
  scoresForPaper:   (paperId: string)   => PaperScore[];
}

const TrackingContext = createContext<TrackingValue | null>(null);

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `t-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function TrackingProvider({ children }: { children: React.ReactNode }) {
  const { papers, settings } = usePapers();
  const [trackers, setTrackers] = useState<Tracker[]>([]);
  const [scores,   setScores]   = useState<PaperScore[]>([]);
  const [ready,    setReady]    = useState(false);
  const [scoring,  setScoring]  = useState<ScoringState | null>(null);

  // Load from IndexedDB on mount
  useEffect(() => {
    (async () => {
      try {
        const [t, s] = await Promise.all([dbGetTrackers(), dbGetAllScores()]);
        setTrackers(t);
        setScores(s);
      } catch (e) {
        console.error('[tracking] failed to load from IDB', e);
      }
      setReady(true);
    })();
  }, []);

  // ----- Helper -----
  const papersById = useMemo(() => {
    const m = new Map<string, Paper>();
    for (const p of papers) m.set(p.id, p);
    return m;
  }, [papers]);

  const seedsFor = useCallback((tracker: Tracker): Paper[] => {
    if (tracker.seedArxivIds.length === 0) return [];
    const byArxiv = new Map<string, Paper>();
    for (const p of papers) byArxiv.set(p.arxivId, p);
    return tracker.seedArxivIds.map(id => byArxiv.get(id)).filter((p): p is Paper => !!p);
  }, [papers]);

  // ----- Scoring -----
  const scoreSubset = useCallback(async (subset: Paper[], tracker: Tracker) => {
    if (!tracker.enabled || subset.length === 0) return;
    setScoring({ trackerId: tracker.id, done: 0, total: subset.length });
    try {
      const seeds = seedsFor(tracker);
      const newScores = await scorePapersAgainstTracker(subset, tracker, seeds, {
        claudeApiKey: settings.claudeApiKey,
        onProgress: (done, total) => setScoring({ trackerId: tracker.id, done, total }),
      });
      await dbUpsertScores(newScores);
      setScores(prev => {
        const byId = new Map(prev.map(s => [s.id, s]));
        for (const s of newScores) byId.set(s.id, s);
        return [...byId.values()];
      });
    } finally {
      setScoring(null);
    }
  }, [seedsFor, settings.claudeApiKey]);

  const rescoreTracker = useCallback(async (id: string) => {
    const tracker = trackers.find(t => t.id === id);
    if (!tracker) return;
    // Drop existing scores for this tracker and re-score from scratch
    await dbDeleteScoresForTracker(id);
    setScores(prev => prev.filter(s => s.trackerId !== id));
    await scoreSubset(papers, tracker);
  }, [trackers, papers, scoreSubset]);

  // Score only papers that don't yet have a score for each enabled tracker.
  // Called automatically when the papers array changes (e.g. after sync).
  const scoreNewPapers = useCallback(async (papersToScore: Paper[]) => {
    if (papersToScore.length === 0) return;
    for (const tracker of trackers) {
      if (!tracker.enabled) continue;
      const have = new Set(scores.filter(s => s.trackerId === tracker.id).map(s => s.paperId));
      const todo = papersToScore.filter(p => !have.has(p.id));
      if (todo.length === 0) continue;
      await scoreSubset(todo, tracker);
    }
  }, [trackers, scores, scoreSubset]);

  // Auto-score on paper change — debounced so rapid sync updates don't pile up
  const autoScoreTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!ready || trackers.length === 0 || papers.length === 0) return;
    if (autoScoreTimer.current) clearTimeout(autoScoreTimer.current);
    autoScoreTimer.current = setTimeout(() => {
      scoreNewPapers(papers).catch(e => console.warn('[tracking] auto-score failed', e));
    }, 600);
    return () => { if (autoScoreTimer.current) clearTimeout(autoScoreTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [papers, trackers, ready]);

  // ----- CRUD -----
  const createTracker = useCallback(async (t: Omit<Tracker, 'id' | 'createdAt' | 'updatedAt'>) => {
    const now = Date.now();
    const full: Tracker = { ...t, id: uuid(), createdAt: now, updatedAt: now };
    await dbUpsertTracker(full);
    setTrackers(prev => [...prev, full]);
    // Score against all existing papers
    scoreSubset(papers, full).catch(e => console.warn('[tracking] initial score failed', e));
    return full;
  }, [papers, scoreSubset]);

  const updateTracker = useCallback(async (id: string, patch: Partial<Tracker>) => {
    const existing = trackers.find(t => t.id === id);
    if (!existing) return;
    const updated: Tracker = { ...existing, ...patch, id, updatedAt: Date.now() };
    await dbUpsertTracker(updated);
    setTrackers(prev => prev.map(t => t.id === id ? updated : t));
    // If the description/keywords/seeds changed materially, rescore
    const matChanged =
      (patch.description !== undefined && patch.description !== existing.description) ||
      (patch.keywords    !== undefined && patch.keywords.join('|')     !== existing.keywords.join('|')) ||
      (patch.seedArxivIds!== undefined && patch.seedArxivIds.join('|') !== existing.seedArxivIds.join('|'));
    if (matChanged) rescoreTracker(id).catch(e => console.warn('[tracking] rescore failed', e));
  }, [trackers, rescoreTracker]);

  const deleteTracker = useCallback(async (id: string) => {
    await dbDeleteTracker(id);
    setTrackers(prev => prev.filter(t => t.id !== id));
    setScores(prev => prev.filter(s => s.trackerId !== id));
  }, []);

  // ----- Derived -----
  const matchesByTracker = useCallback((trackerId: string) => {
    const tracker = trackers.find(t => t.id === trackerId);
    const min     = tracker?.minScore ?? 0;
    return scores
      .filter(s => s.trackerId === trackerId && s.score >= min)
      .map(s => ({ paper: papersById.get(s.paperId), score: s }))
      .filter((r): r is { paper: Paper; score: PaperScore } => !!r.paper)
      .sort((a, b) => b.score.score - a.score.score);
  }, [scores, papersById, trackers]);

  const scoresForPaper = useCallback((paperId: string) => {
    return scores
      .filter(s => s.paperId === paperId)
      .sort((a, b) => b.score - a.score);
  }, [scores]);

  return (
    <TrackingContext.Provider value={{
      trackers, scores, ready, scoring,
      createTracker, updateTracker, deleteTracker,
      rescoreTracker, scoreNewPapers,
      matchesByTracker, scoresForPaper,
    }}>
      {children}
    </TrackingContext.Provider>
  );
}

export function useTracking() {
  const ctx = useContext(TrackingContext);
  if (!ctx) throw new Error('useTracking must be used within TrackingProvider');
  return ctx;
}
