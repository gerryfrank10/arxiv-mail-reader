// Local paper-similarity index. Pure TypeScript, no AI, no network.
//
// Builds a TF-IDF vector for every paper's title+abstract and ranks
// candidates by cosine similarity. Blends in two cheap signals:
//   - Jaccard overlap on arXiv categories
//   - normalised author overlap
//
// Designed for typical library sizes (hundreds to a few thousand
// papers). Index construction is ~10ms / 100 papers; per-query lookup
// is O(n) and runs in milliseconds even for 5k papers.
//
// The index is rebuilt whenever the input paper set changes; we expose
// a stable `signature()` so React contexts can memoise correctly.

import { Paper } from '../types';

// =========================================================================
// Tokenization
// =========================================================================

// Conservative English stopwords + a handful of academic boilerplate.
// Kept deliberately small to avoid hiding genuine signal.
const STOPWORDS = new Set<string>([
  'a','an','and','are','as','at','be','been','being','but','by','can','could','did','do','does','done',
  'each','for','from','had','has','have','having','here','how','i','if','in','into','is','it','its',
  'may','might','must','no','not','of','on','only','or','our','out','over','same','should','so',
  'such','than','that','the','their','them','then','there','these','they','this','those','through',
  'thus','to','too','under','up','use','used','using','was','we','were','what','when','where','which',
  'while','who','why','will','with','within','would','yet','you','your',
  // mild academic stop words — too common to discriminate
  'abstract','approach','approaches','also','among','based','beyond','case','cases','common','consider','considered',
  'context','different','effective','et','etc','example','examples','existing','figure','finally','first','further','generally',
  'give','given','however','include','includes','including','introduce','introduces','introduction','main','many',
  'method','methods','model','models','moreover','need','novel','number','obtain','obtained','one','paper','papers',
  'particular','perform','performance','possible','present','presented','propose','proposed','provide','provides',
  'recent','related','report','research','results','setting','show','shown','shows','since','simple','specific','specifically',
  'still','study','studies','task','tasks','then','therefore','three','two','various','well','work','works',
]);

function tokenize(text: string): string[] {
  if (!text) return [];
  // Lowercase, replace non-alphanumerics with space, split, drop stop / short tokens.
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+#-]/gu, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 3 && t.length <= 30 && !STOPWORDS.has(t));
}

function textForPaper(p: Paper): string {
  // Title weighted heavily (3x) because it's a strong discriminator.
  return `${p.title} ${p.title} ${p.title} ${p.abstract ?? ''}`;
}

// =========================================================================
// Index
// =========================================================================

export interface SimilaritySignals {
  text:       number; // TF-IDF cosine, 0..1
  categories: number; // Jaccard on category sets, 0..1
  authors:    number; // overlap fraction, 0..1
}

export interface SimilarityResult {
  paper:    Paper;
  score:    number;            // weighted blend, 0..1
  scorePct: number;            // 0..100, rounded
  signals:  SimilaritySignals;
}

const W_TEXT = 0.7;
const W_CATS = 0.18;
const W_AUTH = 0.12;

export class SimilarityIndex {
  /** All papers indexed (by arxivId). */
  private papers: Map<string, Paper> = new Map();
  /** IDF score per term across the corpus. */
  private idf:    Map<string, number> = new Map();
  /** Normalised TF-IDF vectors per paper, keyed by arxivId. Sparse map. */
  private vectors: Map<string, Map<string, number>> = new Map();
  /** Cached signature so callers can detect "same papers" → reuse index. */
  readonly signature: string;

  constructor(papers: Paper[]) {
    this.signature = computeSignature(papers);

    // 1) Tokenise every paper once, build document frequency.
    const docTokens: Array<{ arxivId: string; tokens: string[] }> = [];
    const df = new Map<string, number>();
    for (const p of papers) {
      if (!p.arxivId) continue;
      this.papers.set(p.arxivId, p);
      const tokens = tokenize(textForPaper(p));
      docTokens.push({ arxivId: p.arxivId, tokens });
      const seen = new Set<string>();
      for (const t of tokens) {
        if (seen.has(t)) continue;
        seen.add(t);
        df.set(t, (df.get(t) ?? 0) + 1);
      }
    }

    // 2) IDF with smoothing: idf(t) = ln((N + 1) / (df + 1)) + 1
    const N = docTokens.length;
    for (const [term, count] of df) {
      this.idf.set(term, Math.log((N + 1) / (count + 1)) + 1);
    }

    // 3) Build TF-IDF vectors, normalise to unit length.
    for (const { arxivId, tokens } of docTokens) {
      const tf = new Map<string, number>();
      for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
      const vec = new Map<string, number>();
      let norm = 0;
      for (const [term, freq] of tf) {
        const idfVal = this.idf.get(term) ?? 0;
        const w = freq * idfVal;
        if (w === 0) continue;
        vec.set(term, w);
        norm += w * w;
      }
      norm = Math.sqrt(norm);
      if (norm > 0) {
        for (const [term, w] of vec) vec.set(term, w / norm);
      }
      this.vectors.set(arxivId, vec);
    }
  }

  /** How many papers are in this index. */
  get size(): number { return this.papers.size; }

  /** Top-K papers most similar to the given source arXiv id. Source is
   *  excluded from the results. minScore filters out near-zero matches. */
  similar(sourceArxivId: string, k: number = 20, minScore: number = 0.05): SimilarityResult[] {
    const source = this.papers.get(sourceArxivId);
    if (!source) return [];
    const srcVec  = this.vectors.get(sourceArxivId);
    const srcCats = new Set(source.categories ?? []);
    const srcAuth = new Set((source.authorList ?? []).map(a => a.toLowerCase()));

    const results: SimilarityResult[] = [];
    for (const [otherId, otherPaper] of this.papers) {
      if (otherId === sourceArxivId) continue;
      const otherVec = this.vectors.get(otherId);

      const text  = srcVec && otherVec ? cosineSparse(srcVec, otherVec) : 0;
      const cats  = jaccard(srcCats, new Set(otherPaper.categories ?? []));
      const auth  = overlap(srcAuth, new Set((otherPaper.authorList ?? []).map(a => a.toLowerCase())));

      const score = W_TEXT * text + W_CATS * cats + W_AUTH * auth;
      if (score < minScore) continue;
      results.push({
        paper:    otherPaper,
        score,
        scorePct: Math.round(score * 100),
        signals:  { text, categories: cats, authors: auth },
      });
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, k);
  }
}

// =========================================================================
// Helpers
// =========================================================================

function cosineSparse(a: Map<string, number>, b: Map<string, number>): number {
  // Both vectors are already L2-normalised so we just need the dot product.
  // Iterate the smaller of the two for speed.
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [term, wa] of small) {
    const wb = large.get(term);
    if (wb !== undefined) dot += wa * wb;
  }
  // Clamp to handle tiny floating-point overshoots
  return Math.max(0, Math.min(1, dot));
}

function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const x of small) if (large.has(x)) inter++;
  const uni = a.size + b.size - inter;
  return uni === 0 ? 0 : inter / uni;
}

function overlap<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const x of small) if (large.has(x)) inter++;
  return inter / Math.max(a.size, b.size);
}

/**
 * Cheap signature so React contexts can detect whether the input paper
 * set has changed and avoid rebuilding the index unnecessarily.
 *
 * Uses the count + a hash of the sorted arxivIds — collisions are
 * effectively impossible for normal usage.
 */
function computeSignature(papers: Paper[]): string {
  const ids = papers.map(p => p.arxivId).filter(Boolean).sort();
  let hash = 0;
  for (const id of ids) {
    for (let i = 0; i < id.length; i++) {
      hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
    }
  }
  return `${ids.length}:${hash}`;
}
