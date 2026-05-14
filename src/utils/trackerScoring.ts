import { Paper, Tracker, PaperScore, Settings } from '../types';
import { aiChat, hasAI } from './aiProvider';

// =========================================================================
// Tokenization + TF utilities for keyword/seed scoring
// =========================================================================

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should',
  'could', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought',
  'of', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'from', 'as', 'into', 'about',
  'this', 'that', 'these', 'those', 'we', 'our', 'us', 'their', 'them', 'they',
  'it', 'its', 'such', 'than', 'then', 'so', 'also', 'not', 'no', 'nor', 'yet',
  'between', 'through', 'over', 'under', 'while', 'when', 'where', 'how', 'why',
  'using', 'used', 'use', 'show', 'shows', 'shown', 'paper', 'work', 'approach',
  'method', 'methods', 'model', 'models', 'result', 'results', 'find', 'found',
  'present', 'presented', 'propose', 'proposed', 'study', 'studies',
]);

function tokenize(s: string): string[] {
  return (s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOPWORDS.has(w));
}

interface TermFreq {
  total: number;
  counts: Map<string, number>;
}

function termFreq(words: string[]): TermFreq {
  const counts = new Map<string, number>();
  for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);
  return { total: words.length, counts };
}

function cosineSimilarity(a: TermFreq, b: TermFreq): number {
  if (a.total === 0 || b.total === 0) return 0;
  let dot = 0;
  for (const [term, ac] of a.counts) {
    const bc = b.counts.get(term);
    if (bc) dot += ac * bc;
  }
  let na = 0, nb = 0;
  for (const v of a.counts.values()) na += v * v;
  for (const v of b.counts.values()) nb += v * v;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// Combine title (weighted 3x) and abstract into a paper text
function paperText(p: Paper): string {
  return `${p.title} ${p.title} ${p.title} ${p.abstract}`;
}

// =========================================================================
// Keyword + seed similarity scorer (no API needed)
// =========================================================================

function rationale(matches: string[], simBest?: { id: string; sim: number }): string {
  const parts: string[] = [];
  if (matches.length > 0) parts.push(`matches keywords: ${matches.slice(0, 4).join(', ')}`);
  if (simBest && simBest.sim > 0.05) parts.push(`semantically similar to ${simBest.id} (${(simBest.sim * 100).toFixed(0)}%)`);
  return parts.length === 0 ? 'no strong signal' : parts.join('; ');
}

export function scoreKeyword(paper: Paper, tracker: Tracker, seedPapers: Paper[]): PaperScore {
  const text = paperText(paper);
  const lower = text.toLowerCase();
  const paperTF = termFreq(tokenize(text));

  // Keyword hits: count occurrences across title (already 3x'd via repetition) + abstract
  const matchedKeywords: string[] = [];
  let keywordHits = 0;
  for (const k of tracker.keywords) {
    const kl = k.toLowerCase().trim();
    if (!kl) continue;
    const re = new RegExp(`\\b${escapeRegex(kl)}\\b`, 'gi');
    const hits = (lower.match(re) || []).length;
    if (hits > 0) {
      matchedKeywords.push(k);
      keywordHits += hits;
    }
  }
  // Normalise keyword score: saturate at ~10 hits
  const keywordScore = tracker.keywords.length === 0
    ? 0
    : Math.min(1, keywordHits / Math.max(8, tracker.keywords.length * 2));

  // Seed similarity: max cosine across all seed papers
  let bestSeed: { id: string; sim: number } | undefined;
  for (const s of seedPapers) {
    const sim = cosineSimilarity(paperTF, termFreq(tokenize(paperText(s))));
    if (!bestSeed || sim > bestSeed.sim) bestSeed = { id: s.arxivId, sim };
  }
  // Empirically cosine similarity tops out around 0.4 for real papers — scale accordingly
  const simScore = bestSeed ? Math.min(1, bestSeed.sim / 0.35) : 0;

  // Combined score: if we have both, weight them; otherwise use whichever exists
  let combined: number;
  if (tracker.keywords.length > 0 && seedPapers.length > 0) {
    combined = 0.6 * keywordScore + 0.4 * simScore;
  } else if (tracker.keywords.length > 0) {
    combined = keywordScore;
  } else if (seedPapers.length > 0) {
    combined = simScore;
  } else {
    combined = 0;
  }

  // Boost when both signals fire together
  if (keywordScore > 0.4 && simScore > 0.4) combined = Math.min(1, combined * 1.2);

  const score = Math.round(combined * 100);
  return {
    id:        `${paper.id}:${tracker.id}`,
    paperId:   paper.id,
    trackerId: tracker.id,
    score,
    rationale: rationale(matchedKeywords, bestSeed),
    source:    'keyword',
    ts:        Date.now(),
  };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// =========================================================================
// AI-driven scorer (batched, provider-agnostic)
// =========================================================================

export interface AIScoringResult {
  paperId: string;
  score: number;
  rationale: string;
}

const BATCH_SIZE    = 10;
const MAX_ABSTRACT  = 500;   // chars

export async function scoreWithAI(
  papers: Paper[],
  tracker: Tracker,
  settings: Settings,
  onBatch?: (done: number, total: number) => void,
): Promise<PaperScore[]> {
  if (papers.length === 0) return [];
  const out: PaperScore[] = [];

  const batches: Paper[][] = [];
  for (let i = 0; i < papers.length; i += BATCH_SIZE) {
    batches.push(papers.slice(i, i + BATCH_SIZE));
  }

  let done = 0;
  for (const batch of batches) {
    try {
      const results = await scoreOneBatch(batch, tracker, settings);
      for (const r of results) {
        out.push({
          id:        `${r.paperId}:${tracker.id}`,
          paperId:   r.paperId,
          trackerId: tracker.id,
          score:     Math.max(0, Math.min(100, Math.round(r.score))),
          rationale: r.rationale,
          source:    'claude', // historical label — represents "AI-scored"
          ts:        Date.now(),
        });
      }
    } catch (e) {
      // If AI fails on a batch, fall back to keyword for those papers so
      // the user isn't left empty-handed
      console.warn('[tracker] AI batch failed, falling back to keyword:', e);
      for (const p of batch) out.push(scoreKeyword(p, tracker, []));
    }
    done += batch.length;
    onBatch?.(done, papers.length);
  }

  return out;
}

async function scoreOneBatch(
  batch: Paper[],
  tracker: Tracker,
  settings: Settings,
): Promise<AIScoringResult[]> {
  const list = batch.map((p, i) => {
    const abs = (p.abstract || '').slice(0, MAX_ABSTRACT);
    return `${i + 1}. [id=${p.id}] ${p.title}\n   Authors: ${p.authors}\n   Abstract: ${abs || '(no abstract available)'}`;
  }).join('\n\n');

  const userPrompt = `You are a research-curation assistant. The user is tracking the following specific research interest:

Name: ${tracker.name}
Description: ${tracker.description || '(none provided)'}
${tracker.keywords.length ? `Keywords: ${tracker.keywords.join(', ')}` : ''}

For each candidate paper below, rate how well it matches the user's interest on a 0-100 scale where:
  • 90-100 = directly addresses the tracked interest with strong relevance
  • 70-89  = closely related, would be valuable reading for someone tracking this
  • 40-69  = tangentially related
  • 10-39  = touches the area but unlikely to be useful
  • 0-9    = unrelated

Score strictly. Reward papers that match the SPECIFIC angle described, not just the broad area. Penalise papers in adjacent fields that don't move the user's interest forward.

PAPERS:
${list}

Return ONLY a JSON array, one object per paper, with no extra text:
[
  {"paperId": "...", "score": 0-100, "rationale": "one short sentence explaining why"},
  ...
]`;

  const text = await aiChat(
    [{ role: 'user', content: userPrompt }],
    settings,
    { maxTokens: 2000, temperature: 0.2 },
  );
  // Be lenient: grab the first JSON array
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('AI returned no parseable JSON');
  const parsed = JSON.parse(match[0]) as AIScoringResult[];
  if (!Array.isArray(parsed)) throw new Error('AI returned non-array JSON');
  return parsed;
}

// =========================================================================
// Top-level dispatcher used by the TrackingContext
// =========================================================================

interface ScoreOptions {
  settings: Settings;
  onProgress?: (done: number, total: number) => void;
}

export async function scorePapersAgainstTracker(
  papers: Paper[],
  tracker: Tracker,
  seedPapers: Paper[],
  opts: ScoreOptions,
): Promise<PaperScore[]> {
  if (papers.length === 0) return [];
  if (hasAI(opts.settings)) {
    return scoreWithAI(papers, tracker, opts.settings, opts.onProgress);
  }
  // Local keyword scoring is synchronous, just iterate
  const out: PaperScore[] = [];
  for (let i = 0; i < papers.length; i++) {
    out.push(scoreKeyword(papers[i], tracker, seedPapers));
    if ((i + 1) % 20 === 0) opts.onProgress?.(i + 1, papers.length);
  }
  opts.onProgress?.(papers.length, papers.length);
  return out;
}

// Default palette for new trackers
export const TRACKER_COLORS = ['blue', 'rose', 'emerald', 'violet', 'amber', 'cyan', 'fuchsia', 'lime'] as const;
export type TrackerColor = typeof TRACKER_COLORS[number];

// Tailwind class lookup so the picker is exhaustive and JIT-safe
export const TRACKER_COLOR_CLASSES: Record<string, { dot: string; chip: string; ring: string; bar: string }> = {
  blue:    { dot: 'bg-blue-500',    chip: 'bg-blue-50 text-blue-700 border-blue-200',         ring: 'ring-blue-400',    bar: 'bg-blue-500' },
  rose:    { dot: 'bg-rose-500',    chip: 'bg-rose-50 text-rose-700 border-rose-200',         ring: 'ring-rose-400',    bar: 'bg-rose-500' },
  emerald: { dot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200', ring: 'ring-emerald-400', bar: 'bg-emerald-500' },
  violet:  { dot: 'bg-violet-500',  chip: 'bg-violet-50 text-violet-700 border-violet-200',   ring: 'ring-violet-400',  bar: 'bg-violet-500' },
  amber:   { dot: 'bg-amber-500',   chip: 'bg-amber-50 text-amber-700 border-amber-200',     ring: 'ring-amber-400',   bar: 'bg-amber-500' },
  cyan:    { dot: 'bg-cyan-500',    chip: 'bg-cyan-50 text-cyan-700 border-cyan-200',         ring: 'ring-cyan-400',    bar: 'bg-cyan-500' },
  fuchsia: { dot: 'bg-fuchsia-500', chip: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200', ring: 'ring-fuchsia-400', bar: 'bg-fuchsia-500' },
  lime:    { dot: 'bg-lime-500',    chip: 'bg-lime-50 text-lime-700 border-lime-200',         ring: 'ring-lime-400',    bar: 'bg-lime-500' },
};
