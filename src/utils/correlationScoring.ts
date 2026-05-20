// AI correlation scorer.
//
// Given a "source" paper and N candidate papers, ask the configured AI
// provider to score each candidate's relatedness to the source on a
// 0-100 scale with a one-sentence rationale.
//
// Resilience strategy (added after local Ollama models kept returning
// empty strings on 18-candidate prompts):
//   - Bigger token budget (we were silently truncating before).
//   - Adaptive batching: if a batch fails to parse, retry with the batch
//     split in half — recurses down to size 1 in the worst case so a
//     single bad candidate can't kill the whole call.
//   - Empty / truncated responses surface as structured errors so the
//     activity log shows what actually went wrong.

import { Paper, PaperCorrelation, Settings } from '../types';
import { aiChat, resolveAIConfig } from './aiProvider';
import { AIEmptyResponseError, AIMalformedJsonError, AITruncatedJsonError, describeJsonError, extractJson } from './aiJson';

const MAX_ABSTRACT_CHARS = 360;
/** Cap per AI call. We keep batches small to avoid hitting context limits
 *  on local Ollama models — better to make two requests than blow up. */
const MAX_BATCH = 8;
/** Tokens reserved per candidate output object (id + score + rationale). */
const TOKENS_PER_CANDIDATE = 90;
/** Floor + ceiling on max_tokens so we always have headroom. */
const MIN_TOKENS = 500;
const MAX_TOKENS = 4000;

interface RawResult { arxivId: string; score: number; rationale?: string }

/**
 * Public entry point. Splits the candidates into batches of MAX_BATCH and
 * concatenates results. Per-batch failures are logged but don't abort the
 * whole call — partial results are returned.
 */
export async function scoreCorrelationsForPaper(
  source: Paper,
  candidates: Paper[],
  settings: Settings,
): Promise<PaperCorrelation[]> {
  if (candidates.length === 0) return [];
  const provider = resolveAIConfig(settings).provider;
  const out: PaperCorrelation[] = [];

  for (let i = 0; i < candidates.length; i += MAX_BATCH) {
    const batch = candidates.slice(i, i + MAX_BATCH);
    try {
      const rows = await scoreOneBatchWithRetry(source, batch, settings);
      const known = new Set(batch.map(c => c.arxivId));
      for (const r of rows) {
        if (!known.has(r.arxivId) || r.arxivId === source.arxivId) continue;
        out.push({
          sourceArxivId: source.arxivId,
          targetArxivId: r.arxivId,
          score:         Math.max(0, Math.min(100, Math.round(r.score))),
          rationale:     (r.rationale ?? '').slice(0, 500),
          aiProvider:    provider,
          computedAt:    Date.now(),
        });
      }
    } catch (e) {
      // Log + continue — the caller surfaces this via the activity log
      console.warn(`[correlations] batch ${i / MAX_BATCH + 1} failed:`, describeJsonError(e));
    }
  }

  return out;
}

/**
 * Try to score `batch` in one AI call. On parse failure, split in half
 * and recurse — down to size 1 in the worst case. The recursion makes a
 * single problematic candidate (e.g. unicode that confuses the model)
 * survivable without aborting the whole correlation run.
 */
async function scoreOneBatchWithRetry(
  source: Paper,
  batch: Paper[],
  settings: Settings,
): Promise<RawResult[]> {
  try {
    return await scoreOneBatch(source, batch, settings);
  } catch (e) {
    const cannotShrink = batch.length <= 1;
    const isParseError = e instanceof AIEmptyResponseError
                      || e instanceof AITruncatedJsonError
                      || e instanceof AIMalformedJsonError;
    if (cannotShrink || !isParseError) throw e;
    // Halve and try each half independently
    const mid = Math.ceil(batch.length / 2);
    const left  = await scoreOneBatchWithRetry(source, batch.slice(0, mid), settings).catch(() => []);
    const right = await scoreOneBatchWithRetry(source, batch.slice(mid),    settings).catch(() => []);
    return [...left, ...right];
  }
}

async function scoreOneBatch(
  source: Paper,
  batch: Paper[],
  settings: Settings,
): Promise<RawResult[]> {
  const list = batch.map((c, i) =>
    `${i + 1}. [arxiv:${c.arxivId}] ${c.title}\n   Authors: ${c.authorList.slice(0, 3).join(', ')}\n   Abstract: ${(c.abstract || '').slice(0, MAX_ABSTRACT_CHARS) || '(no abstract)'}`,
  ).join('\n\n');

  const prompt = `You are a research correlation assistant. Score how related each candidate paper is to the SOURCE paper on a 0-100 scale.

Scoring rubric:
  90-100 = direct continuation / replication / closely-related extension
  70-89  = same problem and methodology family
  40-69  = same broad area
  10-39  = adjacent area
  0-9    = unrelated

Be honest with low scores — most candidates from a noisy library are NOT related. Reward papers that share a specific technique, problem, or finding with the source.

SOURCE PAPER:
[arxiv:${source.arxivId}] ${source.title}
Authors: ${source.authorList.slice(0, 5).join(', ')}
Abstract: ${(source.abstract || '').slice(0, 700) || '(no abstract)'}

CANDIDATES:
${list}

Return STRICT JSON ONLY — no markdown fences, no preamble, no explanation. One object per candidate:
[
  {"arxivId": "${batch[0]?.arxivId ?? '...'}", "score": 0, "rationale": "≤ 18 words"}
]
You MUST return exactly ${batch.length} object${batch.length === 1 ? '' : 's'}, in the same order as the candidates above.`;

  const maxTokens = Math.max(MIN_TOKENS, Math.min(MAX_TOKENS, 200 + batch.length * TOKENS_PER_CANDIDATE));

  const text = await aiChat(
    [{ role: 'user', content: prompt }],
    settings,
    {
      maxTokens,
      temperature: 0.2,
      timeoutMs: 90_000,
      purpose: 'correlation-score',
    },
  );

  const parsed = extractJson<RawResult[]>(text, 'array');
  if (!Array.isArray(parsed)) {
    throw new AIMalformedJsonError(String(text).slice(0, 160), 'parsed value is not an array');
  }
  return parsed.filter(r => r && typeof r.arxivId === 'string' && typeof r.score === 'number');
}
