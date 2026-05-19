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
    const topInboxPapers = [...inboxPapers]
      .sort((a, b) => computeAssessment(b).score - computeAssessment(a).score)
      .slice(0, 8);
    const summary = {
      weekStart, weekEnd,
      inbox: topInboxPapers.map(p => ({
        arxivId: p.arxivId, title: p.title,
        cats:    p.categories.slice(0, 3),
        gist:    (p.abstract ?? '').slice(0, 220),
      })),
      hackernews:  (external.hackernews  ?? []).slice(0, 8).map(h => ({ title: h.title, points: h.points })),
      huggingface: (external.huggingface ?? []).slice(0, 8).map(m => ({ name: m.name, dl: m.downloads, likes: m.likes, tags: (m.tags || []).slice(0, 3) })),
      github:      (external.github      ?? []).slice(0, 8).map(r => ({ name: r.name, stars: r.stars, desc: (r.description ?? '').slice(0, 100) })),
      modelscope:  (external.modelscope  ?? []).slice(0, 6).map(m => ({ name: m.name })),
    };

    const prompt = `You are the editor of a personal weekly research magazine for an ML/AI researcher. Synthesise the data below into editorial copy. Return STRICT JSON ONLY — no markdown fences, no preamble, no explanation.

Be specific, not generic — name the papers, libraries, repos, and models. Avoid hype words like "breakthrough" or "revolutionary". If a section is empty, acknowledge rather than fabricate.

Data for week ${weekStart} → ${weekEnd}:
${JSON.stringify(summary, null, 2)}

Return this JSON (and nothing else):
{
  "cover":     "2-3 sentence cover blurb that previews what's in this issue",
  "inboxNote": "1 short paragraph (≤ 80 words) tying together the highlights from the user's inbox papers",
  "takeaways": ["3 to 5 specific takeaways across the whole week — each ≤ 25 words"]
}`;

    const text = await aiChat(
      [{ role: 'user', content: prompt }],
      settings,
      { maxTokens: 1200, temperature: 0.4, timeoutMs: 90_000 },
    );

    const parsed = parseEditorialJson(text);
    return {
      cover:     String(parsed.cover ?? '').trim(),
      inboxNote: String(parsed.inboxNote ?? '').trim(),
      takeaways: Array.isArray(parsed.takeaways) ? parsed.takeaways.map(s => String(s)).slice(0, 5) : [],
    };
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
      const inboxPapers: Paper[] = draft.inboxPapers.map(p => ({
        ...p,
        digestDate: typeof p.digestDate === 'string' ? new Date(p.digestDate) : p.digestDate,
      }));
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

/**
 * Extract a JSON object from an AI response. Tolerates:
 *   - markdown code fences (```json ... ``` or ``` ... ```)
 *   - leading "Here's the JSON:" preamble
 *   - trailing commentary after the JSON
 *   - trailing commas inside arrays/objects (some models add them)
 *   - smart quotes converted to straight quotes
 */
function parseEditorialJson(raw: string): MagazineEditorial {
  let text = raw.trim();

  // 1) Strip ```json … ``` or ``` … ``` fences if present.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();

  // 2) Locate the outermost JSON object. We scan brace-by-brace so an
  //    unclosed array inside the cover string can't fool the regex.
  const start = text.indexOf('{');
  if (start < 0) throw new Error('Editorial AI returned no JSON object');
  let depth = 0;
  let end   = -1;
  let inStr = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inStr) { escape = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end < 0) throw new Error('Editorial AI: unbalanced JSON braces');
  let body = text.slice(start, end + 1);

  // 3) Common fixups.
  //   - Smart APOSTROPHES → straight apostrophes (safe inside JSON strings).
  //   - Trailing commas before } or ] (some models add them).
  //   - We deliberately do NOT replace smart double-quotes — converting
  //     them to straight " would corrupt JSON string values that legitimately
  //     contain them (e.g. `"cover": "ships \"Zero\" language"`). They render
  //     fine as Unicode in the cover blurb.
  body = body
    .replace(/[‘’]/g, "'")
    .replace(/,\s*([}\]])/g, '$1');

  try {
    return JSON.parse(body) as MagazineEditorial;
  } catch (e) {
    throw new Error(`Editorial AI returned malformed JSON: ${(e as Error).message}. First 120 chars: ${body.slice(0, 120)}…`);
  }
}

// Helper exported for view code that needs to format provider label
export function magazineAiProviderLabel(provider: string | null): string {
  if (!provider) return '';
  return providerLabel({ provider: provider as never });
}
