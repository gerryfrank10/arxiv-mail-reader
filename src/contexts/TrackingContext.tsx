import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Paper, PaperScore, Settings, Tracker } from '../types';
import { scorePapersAgainstTracker } from '../utils/trackerScoring';
import { trackersStore, scoresStore, onStorageModeChange } from '../utils/storage';
import { isAIPaused } from './AIActivityContext';
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
  /** Score only the unscored papers for this tracker, on demand. */
  scoreTrackerNow: (id: string, mode: 'keyword' | 'ai') => Promise<void>;
  scoreNewPapers: (papers: Paper[]) => Promise<void>;
  // Derived
  matchesByTracker: (trackerId: string) => Array<{ paper: Paper; score: PaperScore }>;
  /** Matches that arrived since the user last marked this tracker seen. */
  newMatchesByTracker: (trackerId: string) => Array<{ paper: Paper; score: PaperScore }>;
  scoresForPaper:   (paperId: string)   => PaperScore[];
  // "New since last seen" watermarks
  lastSeen: Record<string, number>;
  markTrackerSeen: (trackerId: string) => void;
}

const LASTSEEN_KEY = 'tracker.lastSeen.v1';
function loadLastSeen(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(LASTSEEN_KEY) || '{}') as Record<string, number>; }
  catch { return {}; }
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
  const [lastSeen, setLastSeen] = useState<Record<string, number>>(() => loadLastSeen());

  // Mark a tracker's current matches as seen — clears its "new" badge. Stored
  // per-device in localStorage so "new to me" is independent of cross-device sync.
  const markTrackerSeen = useCallback((trackerId: string) => {
    setLastSeen(prev => {
      const next = { ...prev, [trackerId]: Date.now() };
      try { localStorage.setItem(LASTSEEN_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  // Load from the active storage adapter
  const loadAll = useCallback(async () => {
    try {
      const [t, s] = await Promise.all([trackersStore.getAll(), scoresStore.getAll()]);
      setTrackers(t);
      setScores(s);
    } catch (e) {
      console.error('[tracking] failed to load', e);
    }
    setReady(true);
  }, []);
  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => onStorageModeChange(() => { setReady(false); loadAll(); }), [loadAll]);

  // Establish a "seen" baseline for any tracker that doesn't have one yet (e.g.
  // trackers created before this feature) so their existing backlog isn't all
  // flagged "new" — only papers scored after this point count as new arrivals.
  useEffect(() => {
    if (!ready || trackers.length === 0) return;
    setLastSeen(prev => {
      const now = Date.now();
      let changed = false;
      const next = { ...prev };
      for (const t of trackers) {
        if (next[t.id] === undefined) { next[t.id] = now; changed = true; }
      }
      if (changed) { try { localStorage.setItem(LASTSEEN_KEY, JSON.stringify(next)); } catch { /* ignore */ } }
      return changed ? next : prev;
    });
  }, [ready, trackers]);

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
  // Score a subset of papers, forcing a specific mode:
  //   'keyword' → strips AI config so the keyword fallback runs (fast, free)
  //   'ai'      → uses the user's actual settings (real AI provider)
  const scoreSubsetWithMode = useCallback(async (subset: Paper[], tracker: Tracker, mode: 'keyword' | 'ai') => {
    if (!tracker.enabled || subset.length === 0) return;
    setScoring({ trackerId: tracker.id, done: 0, total: subset.length });
    try {
      const seeds = seedsFor(tracker);
      const settingsForRun = mode === 'ai'
        ? settings
        : ({ ...settings, ai: undefined, aiProfiles: undefined, claudeApiKey: undefined } as Settings);
      const newScores = await scorePapersAgainstTracker(subset, tracker, seeds, {
        settings: settingsForRun,
        onProgress: (done, total) => setScoring({ trackerId: tracker.id, done, total }),
      });
      await scoresStore.upsert(newScores);
      setScores(prev => {
        const byId = new Map(prev.map(s => [s.id, s]));
        for (const s of newScores) byId.set(s.id, s);
        return [...byId.values()];
      });
    } finally {
      setScoring(null);
    }
  }, [seedsFor, settings]);

  const rescoreTracker = useCallback(async (id: string) => {
    const tracker = trackers.find(t => t.id === id);
    if (!tracker) return;
    // Drop existing scores for this tracker and re-score from scratch. We use
    // the free keyword pass for the whole-library sweep — AI-scoring thousands
    // of papers here would be ruinously slow/expensive; the "Score with AI"
    // button handles AI on demand for the unscored subset.
    await scoresStore.deleteForTracker(id);
    setScores(prev => prev.filter(s => s.trackerId !== id));
    await scoreSubsetWithMode(papers, tracker, 'keyword');
    // A manual re-score isn't a "new arrival" — don't flood the new badge.
    markTrackerSeen(id);
  }, [trackers, papers, scoreSubsetWithMode, markTrackerSeen]);

  // Score only the papers that don't yet have a score for this tracker.
  // Called from the 'Score with AI now' / 'Score with keywords now' buttons.
  const scoreTrackerNow = useCallback(async (id: string, mode: 'keyword' | 'ai') => {
    const tracker = trackers.find(t => t.id === id);
    if (!tracker) return;
    const have = new Set(scores.filter(s => s.trackerId === id).map(s => s.paperId));
    const todo = papers.filter(p => !have.has(p.id));
    if (todo.length === 0) return;
    await scoreSubsetWithMode(todo, tracker, mode);
  }, [trackers, papers, scores, scoreSubsetWithMode]);

  // Score only papers that don't yet have a score for each enabled tracker.
  // Called automatically when the papers array changes (e.g. after sync).
  //
  // Per-tracker auto_score_mode controls behaviour:
  //   - 'manual'  → skip (user explicitly chose not to spend tokens)
  //   - 'keyword' → force the keyword path (fast, no AI calls)
  //   - 'ai'      → use the configured AI provider (the old behaviour)
  const scoreNewPapers = useCallback(async (papersToScore: Paper[]) => {
    if (papersToScore.length === 0) return;
    for (const tracker of trackers) {
      if (!tracker.enabled) continue;
      // 'manual' trackers don't run on auto. The user can still trigger
      // them explicitly via the 'Score with AI' button or the CLI.
      const mode = tracker.autoScoreMode ?? 'manual';
      if (mode === 'manual') continue;
      const have = new Set(scores.filter(s => s.trackerId === tracker.id).map(s => s.paperId));
      const todo = papersToScore.filter(p => !have.has(p.id));
      if (todo.length === 0) continue;
      await scoreSubsetWithMode(todo, tracker, mode);
    }
  }, [trackers, scores, scoreSubsetWithMode]);

  // Auto-score on paper change — debounced so rapid sync updates don't pile up.
  // Skipped entirely when AI background activity is paused (master switch in
  // the Activity panel) so the user can pin Ollama down for manual debugging.
  const autoScoreTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!ready || trackers.length === 0 || papers.length === 0) return;
    if (isAIPaused()) return;
    if (autoScoreTimer.current) clearTimeout(autoScoreTimer.current);
    autoScoreTimer.current = setTimeout(() => {
      if (isAIPaused()) return;
      scoreNewPapers(papers).catch(e => console.warn('[tracking] auto-score failed', e));
    }, 600);
    return () => { if (autoScoreTimer.current) clearTimeout(autoScoreTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [papers, trackers, ready]);

  // ----- CRUD -----
  const createTracker = useCallback(async (t: Omit<Tracker, 'id' | 'createdAt' | 'updatedAt'>) => {
    const now = Date.now();
    const full: Tracker = { ...t, id: uuid(), createdAt: now, updatedAt: now };
    await trackersStore.upsert(full);
    setTrackers(prev => [...prev, full]);
    // Backfill against the existing library with the free keyword pass (never
    // AI — that could be thousands of calls on a big library). Once done, mark
    // it seen so the existing backlog isn't all flagged "new"; only papers that
    // arrive AFTER creation light up the new badge.
    scoreSubsetWithMode(papers, full, 'keyword')
      .then(() => markTrackerSeen(full.id))
      .catch(e => console.warn('[tracking] initial score failed', e));
    return full;
  }, [papers, scoreSubsetWithMode, markTrackerSeen]);

  const updateTracker = useCallback(async (id: string, patch: Partial<Tracker>) => {
    const existing = trackers.find(t => t.id === id);
    if (!existing) return;
    const updated: Tracker = { ...existing, ...patch, id, updatedAt: Date.now() };
    await trackersStore.upsert(updated);
    setTrackers(prev => prev.map(t => t.id === id ? updated : t));
    // If the description/keywords/seeds changed materially, rescore
    const matChanged =
      (patch.description !== undefined && patch.description !== existing.description) ||
      (patch.keywords    !== undefined && patch.keywords.join('|')     !== existing.keywords.join('|')) ||
      (patch.seedArxivIds!== undefined && patch.seedArxivIds.join('|') !== existing.seedArxivIds.join('|'));
    if (matChanged) rescoreTracker(id).catch(e => console.warn('[tracking] rescore failed', e));
  }, [trackers, rescoreTracker]);

  const deleteTracker = useCallback(async (id: string) => {
    await trackersStore.remove(id);
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

  // Matches scored since the user last marked this tracker seen — i.e. papers
  // that arrived in recent syncs/imports. This is what stops a tracked paper
  // getting lost when hundreds land at once.
  const newMatchesByTracker = useCallback((trackerId: string) => {
    const since = lastSeen[trackerId] ?? 0;
    return matchesByTracker(trackerId).filter(m => m.score.ts > since);
  }, [matchesByTracker, lastSeen]);

  const scoresForPaper = useCallback((paperId: string) => {
    return scores
      .filter(s => s.paperId === paperId)
      .sort((a, b) => b.score - a.score);
  }, [scores]);

  return (
    <TrackingContext.Provider value={{
      trackers, scores, ready, scoring,
      createTracker, updateTracker, deleteTracker,
      rescoreTracker, scoreTrackerNow, scoreNewPapers,
      matchesByTracker, newMatchesByTracker, scoresForPaper,
      lastSeen, markTrackerSeen,
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
