import { S2Paper, S2AuthorProfile, Settings } from '../types';

// Pull the optional API key from settings so the server can use it for higher rate limits
function headersFromSettings(settings?: Settings): HeadersInit {
  const h: Record<string, string> = { Accept: 'application/json' };
  if (settings?.s2ApiKey) h['x-s2-api-key'] = settings.s2ApiKey;
  return h;
}

async function getJson<T>(url: string, settings: Settings | undefined, signal?: AbortSignal): Promise<T> {
  const r = await fetch(url, { headers: headersFromSettings(settings), signal });
  if (!r.ok) {
    const err = await r.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? `HTTP ${r.status}`);
  }
  return r.json() as Promise<T>;
}

export interface S2SearchResult {
  total?: number;
  offset?: number;
  data: S2Paper[];
}

export function s2Search(query: string, opts: { limit?: number; signal?: AbortSignal; settings?: Settings }) {
  const url = `/api/s2/search?q=${encodeURIComponent(query)}&limit=${opts.limit ?? 80}`;
  return getJson<S2SearchResult>(url, opts.settings, opts.signal);
}

export interface S2ReferenceRow  { isInfluential?: boolean; intents?: string[]; citedPaper:  S2Paper }
export interface S2CitationRow   { isInfluential?: boolean; intents?: string[]; citingPaper: S2Paper }

export function s2References(id: string, opts: { limit?: number; signal?: AbortSignal; settings?: Settings }) {
  return getJson<{ data: S2ReferenceRow[] }>(`/api/s2/paper/${encodeURIComponent(id)}/references?limit=${opts.limit ?? 40}`, opts.settings, opts.signal);
}

export function s2Citations(id: string, opts: { limit?: number; signal?: AbortSignal; settings?: Settings }) {
  return getJson<{ data: S2CitationRow[] }>(`/api/s2/paper/${encodeURIComponent(id)}/citations?limit=${opts.limit ?? 40}`, opts.settings, opts.signal);
}

export function s2Recommendations(id: string, opts: { limit?: number; signal?: AbortSignal; settings?: Settings }) {
  return getJson<{ recommendedPapers: S2Paper[] }>(`/api/s2/paper/${encodeURIComponent(id)}/recommendations?limit=${opts.limit ?? 20}`, opts.settings, opts.signal);
}

export function s2Author(authorId: string, opts: { signal?: AbortSignal; settings?: Settings }) {
  return getJson<{ author: S2AuthorProfile; papers: S2Paper[] }>(`/api/s2/author/${encodeURIComponent(authorId)}`, opts.settings, opts.signal);
}

// ---------- ranking helpers for the Discover view ----------

const SURVEY_REGEX = /\b(survey|review|overview|tutorial|primer|introduction to|state[- ]of[- ]the[- ]art)\b/i;

export interface DiscoverGroups {
  foundational: S2Paper[];   // high citations, older
  influential:  S2Paper[];   // high citations, recent (last 3y)
  latest:       S2Paper[];   // most recent
  surveys:      S2Paper[];   // surveys / reviews ranked by citations
}

export function groupForDiscover(papers: S2Paper[], thisYear = new Date().getFullYear()): DiscoverGroups {
  const withCit = papers.filter(p => typeof p.citationCount === 'number');
  // Foundational: published >=4 years ago, sorted by citations
  const foundational = withCit
    .filter(p => p.year && thisYear - p.year >= 4)
    .sort((a, b) => (b.citationCount ?? 0) - (a.citationCount ?? 0))
    .slice(0, 8);

  // Influential recent: published in last 3 years, sorted by citations
  const influential = withCit
    .filter(p => p.year && thisYear - p.year <= 3)
    .sort((a, b) => (b.citationCount ?? 0) - (a.citationCount ?? 0))
    .slice(0, 8);

  // Latest: most recent regardless of citations
  const latest = papers
    .filter(p => p.year)
    .sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
    .slice(0, 8);

  // Surveys: filter by publicationType or title keyword
  const surveys = withCit
    .filter(p =>
      (p.publicationTypes?.some(t => /review|survey/i.test(t)) ?? false) ||
      SURVEY_REGEX.test(p.title)
    )
    .sort((a, b) => (b.citationCount ?? 0) - (a.citationCount ?? 0))
    .slice(0, 6);

  return { foundational, influential, latest, surveys };
}

// Convenience: stable preview URL for a paper
export function s2PaperUrl(p: S2Paper): string {
  if (p.externalIds?.ArXiv) return `https://arxiv.org/abs/${p.externalIds.ArXiv}`;
  if (p.externalIds?.DOI)   return `https://doi.org/${p.externalIds.DOI}`;
  return p.url || `https://www.semanticscholar.org/paper/${p.paperId}`;
}

export function s2PdfUrl(p: S2Paper): string | undefined {
  if (p.openAccessPdf?.url) return p.openAccessPdf.url;
  if (p.externalIds?.ArXiv) return `https://arxiv.org/pdf/${p.externalIds.ArXiv}`;
  return undefined;
}

export function authorNames(p: S2Paper): string {
  return p.authors?.map(a => a.name).join(', ') ?? '';
}
