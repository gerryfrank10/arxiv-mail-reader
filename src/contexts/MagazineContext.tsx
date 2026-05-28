import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  MagazineEditorial, MagazineIssue, MagazineIssueSummary,
  MagazineSource, Paper,
} from '../types';
import {
  apiDeleteMagazineIssue, apiDraftMagazine, apiGetMagazineIssue,
  apiListMagazineIssues, apiSaveMagazineIssue, getDbStatus, newMagazineIssueId,
} from '../utils/researchApi';
import { aiChat, hasAI, providerLabel, resolveAIConfig } from '../utils/aiProvider';
import { extractJson, AITruncatedJsonError } from '../utils/aiJson';
import { computeAssessment } from '../utils/assessment';
import { usePapers } from './PapersContext';

interface MagazineValue {
  issues:       MagazineIssueSummary[];
  active:       MagazineIssue | null;
  dbEnabled:    boolean;
  loading:      boolean;
  generating:   boolean;
  // Last editorial-generation error (for the currently-active issue), so the
  // UI can surface it instead of silently dropping the editorial.
  editorialError: string | null;
  /** True while an editorial-only retry is in flight for the active issue. */
  editorialBusy:  boolean;
  error:        string | null;
  refresh:      () => Promise<void>;
  setActiveId:  (id: string | null) => Promise<void>;
  generateThisWeek: (opts?: { sources?: MagazineSource[]; weekStart?: string; useAi?: boolean }) => Promise<MagazineIssue | null>;
  /** Retroactively generate (or regenerate) the editorial for an existing issue. */
  generateEditorialFor: (id: string) => Promise<void>;
  removeIssue:  (id: string) => Promise<void>;
}

const MagazineContext = createContext<MagazineValue | null>(null);

const DEFAULT_SOURCES: MagazineSource[] = ['hackernews', 'huggingface', 'github', 'modelscope'];

export function MagazineProvider({ children }: { children: React.ReactNode }) {
  const { settings } = usePapers();
  const [issues,    setIssues]    = useState<MagazineIssueSummary[]>([]);
  const [active,    setActive]    = useState<MagazineIssue | null>(null);
  const [dbEnabled, setDbEnabled] = useState(false);
  const [loading,   setLoading]   = useState(false);
  const [generating, setGenerating] = useState(false);
  const [editorialBusy,  setEditorialBusy]  = useState(false);
  const [editorialError, setEditorialError] = useState<string | null>(null);
  const [error,     setError]     = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const status = await getDbStatus();
      setDbEnabled(status.enabled);
      if (status.enabled) setIssues(await apiListMagazineIssues());
      else                setIssues([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load issues');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Set the active issue. We always re-fetch from the server when switching
  // so the user gets the full content (the list omits content for size).
  const setActiveId = useCallback(async (id: string | null) => {
    if (!id) { setActive(null); return; }
    setLoading(true);
    setError(null);
    try {
      setActive(await apiGetMagazineIssue(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load issue');
    } finally {
      setLoading(false);
    }
  }, []);

  async function buildEditorial(
    weekStart: string,
    weekEnd:   string,
    inboxPapers: Paper[],
    external: import('../types').MagazineExternal,
  ): Promise<MagazineEditorial> {
    if (!hasAI(settings)) throw new Error('No AI provider configured. Open Settings.');
    // Trim the input aggressively so verbose models (deepseek-v4-pro, etc.)
    // have more of their completion budget left for the actual editorial.
    const topInboxPapers = [...inboxPapers]
      .sort((a, b) => computeAssessment(b).score - computeAssessment(a).score)
      .slice(0, 6);
    const summary = {
      weekStart, weekEnd,
      inbox: topInboxPapers.map(p => ({
        title: p.title,
        cats:  p.categories.slice(0, 2),
        gist:  (p.abstract ?? '').slice(0, 160),
      })),
      hackernews:  (external.hackernews  ?? []).slice(0, 6).map(h => ({ title: h.title, points: h.points })),
      huggingface: (external.huggingface ?? []).slice(0, 6).map(m => ({ name: m.name, dl: m.downloads, likes: m.likes })),
      github:      (external.github      ?? []).slice(0, 6).map(r => ({ name: r.name, stars: r.stars, desc: (r.description ?? '').slice(0, 80) })),
      modelscope:  (external.modelscope  ?? []).slice(0, 4).map(m => ({ name: m.name })),
    };

    const prompt = `You are the editor of a personal weekly research magazine for an ML/AI researcher. Synthesise the data below into editorial copy. Return STRICT JSON ONLY — no markdown fences, no preamble, no explanation.

Be specific, not generic — name the papers, libraries, repos, and models. Avoid hype words like "breakthrough" or "revolutionary". Keep "cover" under 60 words and "inboxNote" under 80 words; takeaways under 20 words each.

Data for week ${weekStart} → ${weekEnd}:
${JSON.stringify(summary, null, 2)}

Return this exact JSON shape (all three fields required, non-empty):
{
  "cover":     "2-3 sentence cover blurb",
  "inboxNote": "1 short paragraph tying the inbox highlights together",
  "takeaways": ["3 to 5 specific takeaways"]
}

Do not return empty strings or empty arrays. Do not rename the keys.`;

    const attempt = async (): Promise<MagazineEditorial> => {
      const text = await aiChat(
        [{ role: 'user', content: prompt }],
        settings,
        // Raised from 1200 → 2500: deepseek-v4-pro and similar verbose
        // models were getting cut off mid-JSON, which extractJson then
        // (correctly) reported as AITruncatedJsonError. Salvaging partial
        // output below covers the residual cases.
        { maxTokens: 2500, temperature: 0.4, timeoutMs: 120_000, purpose: 'magazine-editorial' },
      );
      try {
        return normaliseEditorial(parseEditorialJson(text));
      } catch (e) {
        // The first two fields almost always arrive intact even when the
        // model runs out of budget mid-takeaway — pull them out with a
        // regex rather than discarding the whole response.
        if (e instanceof AITruncatedJsonError) {
          const salvaged = salvageEditorialFromPartial(e.partial);
          if (!isEditorialEmpty(salvaged)) return salvaged;
        }
        throw e;
      }
    };

    let editorial = await attempt();
    if (isEditorialEmpty(editorial)) editorial = await attempt();
    if (isEditorialEmpty(editorial)) {
      throw new Error('AI returned an editorial with no usable content — try a larger model or rerun.');
    }
    return editorial;
  }

  const generateThisWeek = useCallback(async (opts: { sources?: MagazineSource[]; weekStart?: string; useAi?: boolean } = {}) => {
    if (!dbEnabled) { setError('Server DB not enabled'); return null; }
    setGenerating(true);
    setError(null);
    try {
      const draft = await apiDraftMagazine({
        sources: opts.sources ?? DEFAULT_SOURCES,
        weekStart: opts.weekStart,
      });

      let editorial: MagazineEditorial | undefined;
      const useAi = opts.useAi ?? true;
      // Surface editorial failures explicitly — silent fallbacks confused
      // the user when one issue had an editorial and the next didn't.
      setEditorialError(null);
      // The server already capped at 200 (or 50 for auto-issues). We further
      // trim to the top 30 by assessment score before saving so the JSONB
      // body stays small and the reader loads instantly. The total count
      // comes from the server so the "X this week" header stays honest.
      const allFetched: Paper[] = draft.inboxPapers.map(p => ({
        ...p,
        digestDate: typeof p.digestDate === 'string' ? new Date(p.digestDate) : p.digestDate,
      }));
      const inboxPapers = [...allFetched]
        .sort((a, b) => computeAssessment(b).score - computeAssessment(a).score)
        .slice(0, 30);
      if (useAi && hasAI(settings)) {
        try { editorial = await buildEditorial(draft.weekStart, draft.weekEnd, inboxPapers, draft.external); }
        catch (e) {
          const msg = e instanceof Error ? e.message : 'Editorial generation failed';
          console.warn('[magazine] editorial generation failed:', msg);
          setEditorialError(msg);
        }
      }

      const id = newMagazineIssueId();
      const title    = `Week of ${prettyDate(draft.weekStart)}`;
      const subtitle = `Edition #${draft.editionNumber}`;

      const issue: MagazineIssue = {
        id,
        weekStart:     draft.weekStart,
        weekEnd:       draft.weekEnd,
        editionNumber: draft.editionNumber,
        title,
        subtitle,
        content: {
          editorial,
          inboxPapers,
          inboxTotalCount: draft.inboxTotal ?? allFetched.length,
          external: draft.external,
          sourceErrors: draft.sourceErrors,
        },
        sources:    draft.sources,
        aiProvider: editorial ? resolveAIConfig(settings).provider : null,
        createdAt:  Date.now(),
      };

      await apiSaveMagazineIssue(issue);
      // Optimistically prepend to the issue list + load as active
      const summary: MagazineIssueSummary = {
        id: issue.id, weekStart: issue.weekStart, weekEnd: issue.weekEnd,
        editionNumber: issue.editionNumber, title: issue.title, subtitle: issue.subtitle,
        sources: issue.sources, aiProvider: issue.aiProvider, createdAt: issue.createdAt,
        sectionKeys: Object.keys(issue.content),
      };
      setIssues(prev => [summary, ...prev]);
      setActive(issue);
      return issue;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed');
      return null;
    } finally {
      setGenerating(false);
    }
  }, [dbEnabled, settings]);

  const removeIssue = useCallback(async (id: string) => {
    await apiDeleteMagazineIssue(id);
    setIssues(prev => prev.filter(i => i.id !== id));
    if (active?.id === id) setActive(null);
  }, [active]);

  // Re-run JUST the editorial for an existing issue (used by the "Generate
  // editorial" button on auto-issues, or as a manual retry when the
  // editorial failed during initial generation).
  const generateEditorialFor = useCallback(async (id: string) => {
    if (!hasAI(settings)) {
      setEditorialError('No AI provider configured. Open Settings.');
      return;
    }
    setEditorialBusy(true);
    setEditorialError(null);
    try {
      const issue = await apiGetMagazineIssue(id);
      const inboxPapers = (issue.content.inboxPapers ?? []).map(p => ({
        ...p,
        digestDate: typeof p.digestDate === 'string' ? new Date(p.digestDate) : p.digestDate,
      }));
      const editorial = await buildEditorial(issue.weekStart, issue.weekEnd, inboxPapers, issue.content.external ?? {});
      const updated: MagazineIssue = {
        ...issue,
        aiProvider: resolveAIConfig(settings).provider,
        content: { ...issue.content, editorial },
      };
      await apiSaveMagazineIssue(updated);
      setActive(updated);
      // Refresh the summary list so the "auto-generated" subtitle goes away
      refresh();
    } catch (e) {
      setEditorialError(e instanceof Error ? e.message : 'Editorial failed');
    } finally {
      setEditorialBusy(false);
    }
  }, [settings, refresh]);

  return (
    <MagazineContext.Provider value={{
      issues, active, dbEnabled, loading, generating, error,
      editorialBusy, editorialError,
      refresh, setActiveId, generateThisWeek, generateEditorialFor, removeIssue,
    }}>
      {children}
    </MagazineContext.Provider>
  );
}

export function useMagazine() {
  const ctx = useContext(MagazineContext);
  if (!ctx) throw new Error('useMagazine must be used inside MagazineProvider');
  return ctx;
}

function prettyDate(isoDate: string): string {
  const d = new Date(isoDate);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Editorial JSON extractor — thin shim over the shared aiJson util so
 *  empty / truncated / malformed cases get distinct error types we can
 *  show in the UI. The raw JSON is intentionally loosely-typed so the
 *  normaliser can map common synonyms (cover/summary, takeaways/bullets). */
function parseEditorialJson(raw: string): Record<string, unknown> {
  return extractJson<Record<string, unknown>>(raw, 'object');
}

/** Map noisy AI keys to our canonical {cover, inboxNote, takeaways} shape.
 *  Smaller local models routinely use synonyms or wrap the payload in an
 *  extra `editorial` key — silently dropping those produces a blank section
 *  in the UI, which is what the user reported. */
function normaliseEditorial(parsed: Record<string, unknown>): MagazineEditorial {
  // Unwrap one level of nesting (e.g. {"editorial": {...}})
  const candidates = [parsed];
  for (const k of ['editorial', 'magazine', 'output', 'result', 'response']) {
    const inner = parsed?.[k];
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
      candidates.unshift(inner as Record<string, unknown>);
    }
  }

  const pickStr = (keys: string[]): string => {
    for (const obj of candidates) {
      for (const k of keys) {
        const v = obj?.[k];
        if (typeof v === 'string' && v.trim()) return v.trim();
      }
    }
    return '';
  };

  const pickArr = (keys: string[]): string[] => {
    for (const obj of candidates) {
      for (const k of keys) {
        const v = obj?.[k];
        if (Array.isArray(v)) {
          const out = v.map(x => String(x ?? '').trim()).filter(Boolean);
          if (out.length > 0) return out.slice(0, 5);
        }
      }
    }
    return [];
  };

  return {
    cover:     pickStr(['cover', 'summary', 'intro', 'introduction', 'lede', 'headline', 'tldr']),
    inboxNote: pickStr(['inboxNote', 'inbox_note', 'inbox', 'note', 'analysis', 'commentary', 'overview']),
    takeaways: pickArr(['takeaways', 'key_takeaways', 'keyTakeaways', 'bullets', 'highlights', 'points', 'key_points']),
  };
}

/** True when the editorial has nothing the UI can render. */
function isEditorialEmpty(e: MagazineEditorial): boolean {
  return !e.cover && !e.inboxNote && (e.takeaways?.length ?? 0) === 0;
}

/**
 * Best-effort field-by-field extraction from a truncated AI response.
 *
 * deepseek-v4-pro and other verbose models can blow past our max_tokens
 * budget while emitting takeaways, leaving the JSON unterminated. JSON.parse
 * rejects the whole payload, but cover/inboxNote almost always survive
 * intact at the start — so we pull them out individually rather than
 * discarding the whole response and showing a blank issue.
 */
function salvageEditorialFromPartial(partial: string): MagazineEditorial {
  const grabString = (key: string): string => {
    // Match "key": "...possibly-escaped..." — non-greedy, allows escaped quotes
    const re = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`);
    const m = partial.match(re);
    if (!m) return '';
    // Unescape \" and \\ minimally
    return m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\').replace(/\\n/g, '\n').trim();
  };

  const grabStringArray = (key: string): string[] => {
    // Find the array opener, then collect every complete "..." string until
    // we hit the closing ] OR run out of input (truncation).
    const opener = new RegExp(`"${key}"\\s*:\\s*\\[`);
    const m = partial.match(opener);
    if (!m) return [];
    const start = m.index! + m[0].length;
    const strRe = /"((?:[^"\\]|\\.)*)"/g;
    strRe.lastIndex = start;
    const out: string[] = [];
    let next;
    // Stop scanning at the first ] after `start`, if present
    const closeIdx = partial.indexOf(']', start);
    const limit    = closeIdx >= 0 ? closeIdx : partial.length;
    while ((next = strRe.exec(partial)) !== null && next.index < limit) {
      const cleaned = next[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\').replace(/\\n/g, '\n').trim();
      if (cleaned) out.push(cleaned);
    }
    return out.slice(0, 5);
  };

  return {
    cover:     grabString('cover')     || grabString('summary')   || grabString('intro') || grabString('tldr'),
    inboxNote: grabString('inboxNote') || grabString('inbox_note') || grabString('inbox') || grabString('overview'),
    takeaways: grabStringArray('takeaways').length > 0
                 ? grabStringArray('takeaways')
                 : (grabStringArray('key_takeaways').length > 0
                      ? grabStringArray('key_takeaways')
                      : grabStringArray('bullets')),
  };
}

// Helper exported for view code that needs to format provider label
export function magazineAiProviderLabel(provider: string | null): string {
  if (!provider) return '';
  return providerLabel({ provider: provider as never });
}
