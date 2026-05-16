import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { CorrelationStats, Paper, PaperCorrelation } from '../types';
import {
  apiFindPapersMissingCorrelations, apiGetCorrelationsForPaper,
  apiGetCorrelationStats, apiUpsertCorrelations, getDbStatus,
} from '../utils/researchApi';
import { scoreCorrelationsForPaper } from '../utils/correlationScoring';
import { hasAI } from '../utils/aiProvider';
import { usePapers } from './PapersContext';
import { useLibrary } from './LibraryContext';

// Tunable ceiling — 100 papers/hour as the user requested.
const PAPERS_PER_HOUR  = 100;
const CANDIDATES_PER_PAPER = 18;       // batch size sent to AI
const TICK_INTERVAL_MS = 60_000;        // worker checks once a minute
const MIN_PAPERS_FOR_AUTO = 3;          // skip auto when library is tiny

const ENABLED_KEY = 'arxiv_correlations_enabled';

interface CorrelationsValue {
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  stats: CorrelationStats | null;
  dbEnabled: boolean;
  /** Get cached correlations for one paper (always fresh from server). */
  getForPaper: (arxivId: string) => Promise<PaperCorrelation[]>;
  /** Manually score a single paper now, ignoring the rate limit. */
  scorePaperNow: (paper: Paper) => Promise<{ added: number; error?: string }>;
  /** Background worker state */
  workerBusy: boolean;
  workerLastRun: Date | null;
  workerLastError: string | null;
  workerNextEligibleAt: Date | null;
}

const CorrelationsContext = createContext<CorrelationsValue | null>(null);

export function CorrelationsProvider({ children }: { children: React.ReactNode }) {
  const { papers, settings } = usePapers();
  const { savedPapers } = useLibrary();

  const [enabled, setEnabledState] = useState<boolean>(() => localStorage.getItem(ENABLED_KEY) === 'true');
  const [stats, setStats]          = useState<CorrelationStats | null>(null);
  const [dbEnabled, setDbEnabled]  = useState(false);
  const [workerBusy, setWorkerBusy]       = useState(false);
  const [workerLastRun, setWorkerLastRun] = useState<Date | null>(null);
  const [workerLastError, setWorkerLastError] = useState<string | null>(null);

  // Per-hour rate tracking. Each entry is the timestamp of a processed source paper.
  const recentRunsRef = useRef<number[]>([]);
  const tickTimerRef  = useRef<ReturnType<typeof setInterval> | null>(null);

  const setEnabled = useCallback((v: boolean) => {
    localStorage.setItem(ENABLED_KEY, String(v));
    setEnabledState(v);
  }, []);

  const refreshStats = useCallback(async () => {
    if (!dbEnabled) return;
    try { setStats(await apiGetCorrelationStats()); }
    catch { /* ignore */ }
  }, [dbEnabled]);

  // Initial DB status + stats
  useEffect(() => {
    (async () => {
      try {
        const s = await getDbStatus();
        setDbEnabled(s.enabled);
        if (s.enabled) setStats(await apiGetCorrelationStats());
      } catch { setDbEnabled(false); }
    })();
  }, []);

  // ----- helpers -----

  function pruneRecentRuns() {
    const cutoff = Date.now() - 60 * 60 * 1000;
    recentRunsRef.current = recentRunsRef.current.filter(t => t > cutoff);
  }
  function nextEligibleAt(): Date | null {
    pruneRecentRuns();
    if (recentRunsRef.current.length < PAPERS_PER_HOUR) return null;
    const oldest = recentRunsRef.current[0];
    return new Date(oldest + 60 * 60 * 1000);
  }

  // Build candidate pool: library + inbox (de-dup by arxivId). Library first
  // so it gets correlated preferentially.
  const candidatePool = useCallback((): Paper[] => {
    const seen = new Set<string>();
    const out: Paper[] = [];
    for (const p of [...savedPapers, ...papers]) {
      if (!p.arxivId) continue;
      if (seen.has(p.arxivId)) continue;
      seen.add(p.arxivId);
      out.push(p);
    }
    return out;
  }, [savedPapers, papers]);

  // ----- the actual work -----

  const scorePaperNow = useCallback(async (paper: Paper): Promise<{ added: number; error?: string }> => {
    if (!dbEnabled) return { added: 0, error: 'Server DB not enabled' };
    if (!hasAI(settings)) return { added: 0, error: 'No AI provider configured (Settings → AI provider)' };
    setWorkerBusy(true);
    setWorkerLastError(null);
    try {
      // Pick CANDIDATES_PER_PAPER candidates that aren't the source paper itself.
      // Random sample to avoid always scoring the same first 18 papers.
      const pool = candidatePool().filter(c => c.arxivId !== paper.arxivId);
      const candidates = pool.length <= CANDIDATES_PER_PAPER
        ? pool
        : shuffle(pool).slice(0, CANDIDATES_PER_PAPER);

      const rows = await scoreCorrelationsForPaper(paper, candidates, settings);
      if (rows.length === 0) return { added: 0 };
      await apiUpsertCorrelations(rows);
      recentRunsRef.current.push(Date.now());
      setWorkerLastRun(new Date());
      refreshStats();
      return { added: rows.length };
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Scoring failed';
      setWorkerLastError(msg);
      return { added: 0, error: msg };
    } finally {
      setWorkerBusy(false);
    }
  }, [dbEnabled, settings, candidatePool, refreshStats]);

  // Pick the next source paper to score: one that has NO correlation rows yet.
  const pickNextSource = useCallback(async (): Promise<Paper | null> => {
    const pool = candidatePool();
    if (pool.length < MIN_PAPERS_FOR_AUTO) return null;
    const candidateIds = pool.map(p => p.arxivId);
    const missing = await apiFindPapersMissingCorrelations(candidateIds, 1);
    if (missing.length === 0) return null;
    return pool.find(p => p.arxivId === missing[0]) ?? null;
  }, [candidatePool]);

  // Background tick — runs once a minute when enabled
  useEffect(() => {
    if (!enabled || !dbEnabled || !hasAI(settings)) {
      if (tickTimerRef.current) { clearInterval(tickTimerRef.current); tickTimerRef.current = null; }
      return;
    }
    async function tick() {
      if (workerBusy) return;
      pruneRecentRuns();
      if (recentRunsRef.current.length >= PAPERS_PER_HOUR) return;
      try {
        const src = await pickNextSource();
        if (!src) return;
        await scorePaperNow(src);
      } catch (e) {
        setWorkerLastError(e instanceof Error ? e.message : 'tick failed');
      }
    }
    // First run shortly after enabling, then on interval
    const initial = setTimeout(tick, 3_000);
    tickTimerRef.current = setInterval(tick, TICK_INTERVAL_MS);
    return () => {
      clearTimeout(initial);
      if (tickTimerRef.current) { clearInterval(tickTimerRef.current); tickTimerRef.current = null; }
    };
  }, [enabled, dbEnabled, settings, workerBusy, pickNextSource, scorePaperNow]);

  const getForPaper = useCallback(async (arxivId: string) => {
    if (!dbEnabled) return [];
    return apiGetCorrelationsForPaper(arxivId, { limit: 20, minScore: 40 });
  }, [dbEnabled]);

  return (
    <CorrelationsContext.Provider value={{
      enabled, setEnabled, stats, dbEnabled,
      getForPaper, scorePaperNow,
      workerBusy, workerLastRun, workerLastError,
      workerNextEligibleAt: nextEligibleAt(),
    }}>
      {children}
    </CorrelationsContext.Provider>
  );
}

export function useCorrelations() {
  const ctx = useContext(CorrelationsContext);
  if (!ctx) throw new Error('useCorrelations must be used inside CorrelationsProvider');
  return ctx;
}

function shuffle<T>(arr: T[]): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
