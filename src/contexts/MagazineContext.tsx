import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  MagazineDraft, MagazineEditorial, MagazineIssue, MagazineIssueSummary,
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
  error:        string | null;
  refresh:      () => Promise<void>;
  setActiveId:  (id: string | null) => Promise<void>;
  generateThisWeek: (opts?: { sources?: MagazineSource[]; weekStart?: string; useAi?: boolean }) => Promise<MagazineIssue | null>;
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

  async function buildEditorial(draft: MagazineDraft): Promise<MagazineEditorial | undefined> {
    if (!hasAI(settings)) return undefined;
    // Compact every section into a short bullet list so we don't burn
    // tokens on full abstracts. The AI's job is to synthesise — not
    // regurgitate.
    const topInboxPapers = [...draft.inboxPapers]
      .sort((a, b) => computeAssessment(b).score - computeAssessment(a).score)
      .slice(0, 8);

    const summary = {
      weekStart: draft.weekStart,
      weekEnd:   draft.weekEnd,
      inbox:     topInboxPapers.map(p => ({
        arxivId: p.arxivId,
        title:   p.title,
        cats:    p.categories.slice(0, 3),
        gist:    (p.abstract ?? '').slice(0, 220),
      })),
      hackernews:  (draft.external.hackernews  ?? []).slice(0, 8).map(h => ({ title: h.title, points: h.points })),
      huggingface: (draft.external.huggingface ?? []).slice(0, 8).map(m => ({ name: m.name, dl: m.downloads, likes: m.likes, tags: (m.tags || []).slice(0, 3) })),
      github:      (draft.external.github      ?? []).slice(0, 8).map(r => ({ name: r.name, stars: r.stars, desc: (r.description ?? '').slice(0, 100) })),
      modelscope:  (draft.external.modelscope  ?? []).slice(0, 6).map(m => ({ name: m.name })),
    };

    const prompt = `You are the editor of a personal weekly research magazine for an ML/AI researcher. Synthesise the data below into editorial copy. Return STRICT JSON ONLY (no markdown, no preamble).

Be specific, not generic — name the papers, libraries, repos, and models. Avoid hype words like "breakthrough" or "revolutionary". If a section is empty, leave it acknowledged rather than fabricated.

Data for week ${draft.weekStart} → ${draft.weekEnd}:
${JSON.stringify(summary, null, 2)}

Return this JSON:
{
  "cover":     "2-3 sentence cover blurb that previews what's in this issue",
  "inboxNote": "1 short paragraph (≤ 80 words) tying together the highlights from the user's inbox papers",
  "takeaways": ["3 to 5 specific takeaways across the whole week, e.g. 'Apple shipped MLX 0.x with grouped-query attention support' — each ≤ 25 words"]
}`;

    const text = await aiChat(
      [{ role: 'user', content: prompt }],
      settings,
      { maxTokens: 800, temperature: 0.4, timeoutMs: 60_000 },
    );
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('Editorial AI returned no parseable JSON');
    const parsed = JSON.parse(m[0]) as MagazineEditorial;
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
      if (useAi && hasAI(settings)) {
        try { editorial = await buildEditorial(draft); }
        catch (e) { console.warn('[magazine] editorial generation failed:', e); }
      }

      const id = newMagazineIssueId();
      const title    = `Week of ${prettyDate(draft.weekStart)}`;
      const subtitle = `Edition #${draft.editionNumber}`;
      // Cast the server's serialised Paper.digestDate (string) back into
      // a real Date so the rest of the app's date helpers keep working.
      const inboxPapers: Paper[] = draft.inboxPapers.map(p => ({
        ...p,
        digestDate: typeof p.digestDate === 'string' ? new Date(p.digestDate) : p.digestDate,
      }));

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

  return (
    <MagazineContext.Provider value={{
      issues, active, dbEnabled, loading, generating, error,
      refresh, setActiveId, generateThisWeek, removeIssue,
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

// Helper exported for view code that needs to format provider label
export function magazineAiProviderLabel(provider: string | null): string {
  if (!provider) return '';
  return providerLabel({ provider: provider as never });
}
