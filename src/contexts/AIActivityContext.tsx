import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

// =========================================================================
// Public types
// =========================================================================

export type AIActivityStatus = 'pending' | 'success' | 'error' | 'cancelled';

export interface AIActivityRecord {
  id:        string;
  purpose:   string;          // 'tracker-score', 'paper-summary', 'magazine-editorial', etc.
  provider:  string;          // 'ollama', 'claude', 'openai', …
  model?:    string;
  startedAt: number;
  endedAt?:  number;
  status:    AIActivityStatus;
  /** Approximate prompt size in chars (we don't count tokens — just message length) */
  promptChars?: number;
  /** Length of returned text (chars) */
  responseChars?: number;
  /** Short error message when status === 'error' */
  error?:    string;
}

interface AIActivityValue {
  records:   AIActivityRecord[];
  paused:    boolean;
  setPaused: (v: boolean) => void;
  /** Begin a new record. Returns an id you pass to finish(). */
  start:     (info: { purpose: string; provider: string; model?: string; promptChars?: number }) => string;
  finish:    (id: string, info: { status: Exclude<AIActivityStatus, 'pending'>; responseChars?: number; error?: string }) => void;
  clear:     () => void;
  /** Live count of in-flight requests */
  inFlight:  number;
}

const AIActivityContext = createContext<AIActivityValue | null>(null);

const MAX_RECORDS = 50;
const PAUSED_KEY  = 'arxiv_ai_paused';

// =========================================================================
// A tiny external-store sink so non-React modules (aiProvider.ts) can
// push records too. The provider below subscribes and merges into state.
// =========================================================================

type Listener = (e: { kind: 'start' | 'finish'; record: AIActivityRecord }) => void;
const listeners = new Set<Listener>();
const pausedState = { value: localStorage.getItem(PAUSED_KEY) === '1' };

function emit(e: { kind: 'start' | 'finish'; record: AIActivityRecord }) {
  for (const l of listeners) {
    try { l(e); } catch { /* ignore listener errors */ }
  }
}

// Public functions that aiChat can import without needing React.
export function _aiActivityStart(info: { purpose: string; provider: string; model?: string; promptChars?: number }): string {
  const id = `act-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const record: AIActivityRecord = {
    id,
    purpose:    info.purpose,
    provider:   info.provider,
    model:      info.model,
    startedAt:  Date.now(),
    status:     'pending',
    promptChars: info.promptChars,
  };
  emit({ kind: 'start', record });
  return id;
}

export function _aiActivityFinish(id: string, info: { status: Exclude<AIActivityStatus, 'pending'>; responseChars?: number; error?: string }): void {
  const record: AIActivityRecord = {
    id,
    purpose:    '', provider: '',
    startedAt:  0,
    endedAt:    Date.now(),
    status:     info.status,
    responseChars: info.responseChars,
    error:      info.error,
  };
  emit({ kind: 'finish', record });
}

export function isAIPaused(): boolean {
  return pausedState.value;
}

// =========================================================================
// Provider
// =========================================================================

export function AIActivityProvider({ children }: { children: React.ReactNode }) {
  const [records, setRecords] = useState<AIActivityRecord[]>([]);
  const [paused, setPausedState] = useState(pausedState.value);
  const inFlightRef = useRef(0);
  const [inFlight, setInFlight] = useState(0);

  const setPaused = useCallback((v: boolean) => {
    pausedState.value = v;
    try { localStorage.setItem(PAUSED_KEY, v ? '1' : '0'); } catch { /* ignore */ }
    setPausedState(v);
  }, []);

  useEffect(() => {
    function handler(e: { kind: 'start' | 'finish'; record: AIActivityRecord }) {
      if (e.kind === 'start') {
        inFlightRef.current += 1;
        setInFlight(inFlightRef.current);
        setRecords(prev => {
          const next = [e.record, ...prev];
          if (next.length > MAX_RECORDS) next.length = MAX_RECORDS;
          return next;
        });
      } else {
        inFlightRef.current = Math.max(0, inFlightRef.current - 1);
        setInFlight(inFlightRef.current);
        setRecords(prev => prev.map(r => r.id === e.record.id
          ? { ...r,
              endedAt:       e.record.endedAt,
              status:        e.record.status,
              responseChars: e.record.responseChars ?? r.responseChars,
              error:         e.record.error ?? r.error,
            }
          : r));
      }
    }
    listeners.add(handler);
    return () => { listeners.delete(handler); };
  }, []);

  const start = useCallback((info: { purpose: string; provider: string; model?: string; promptChars?: number }) =>
    _aiActivityStart(info), []);
  const finish = useCallback((id: string, info: { status: Exclude<AIActivityStatus, 'pending'>; responseChars?: number; error?: string }) =>
    _aiActivityFinish(id, info), []);
  const clear  = useCallback(() => setRecords([]), []);

  return (
    <AIActivityContext.Provider value={{ records, paused, setPaused, start, finish, clear, inFlight }}>
      {children}
    </AIActivityContext.Provider>
  );
}

export function useAIActivity() {
  const ctx = useContext(AIActivityContext);
  if (!ctx) throw new Error('useAIActivity must be used inside AIActivityProvider');
  return ctx;
}
