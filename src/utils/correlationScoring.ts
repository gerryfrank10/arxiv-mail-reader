// AI correlation scorer.
//
// Given a "source" paper and N candidate papers, ask the configured AI
// provider to score each candidate's relatedness to the source on a
// 0-100 scale with a one-sentence rationale. Returns one row per
// candidate (low-score candidates included so we don't re-ask them
// later).
//
// The caller (CorrelationsContext) enforces rate limits so we don't
// burn through tokens.

import { Paper, PaperCorrelation, Settings } from '../types';
import { aiChat, resolveAIConfig } from './aiProvider';

const MAX_ABSTRACT_CHARS = 360;

export async function scoreCorrelationsForPaper(
  source: Paper,
  candidates: Paper[],
  settings: Settings,
): Promise<PaperCorrelation[]> {
  if (candidates.length === 0) return [];
  const provider = resolveAIConfig(settings).provider;

  const list = candidates.map((c, i) =>
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

Return strict JSON only, one object per candidate:
[
  {"arxivId": "...", "score": 0-100, "rationale": "≤ 18 words"},
  ...
]`;

  const text = await aiChat(
    [{ role: 'user', content: prompt }],
    settings,
    { maxTokens: Math.min(2500, 80 + candidates.length * 40), temperature: 0.2, timeoutMs: 60_000 },
  );

  const m = text.match(/\[[\s\S]*\]/);
  if (!m) throw new Error('AI correlation: no JSON array in response');
  const parsed = JSON.parse(m[0]) as Array<{ arxivId: string; score: number; rationale?: string }>;

  // Build correlation rows for every candidate the AI returned (skip self-matches)
  const known = new Set(candidates.map(c => c.arxivId));
  return parsed
    .filter(r => known.has(r.arxivId) && r.arxivId !== source.arxivId)
    .map(r => ({
      sourceArxivId: source.arxivId,
      targetArxivId: r.arxivId,
      score:         Math.max(0, Math.min(100, Math.round(r.score))),
      rationale:     r.rationale ?? '',
      aiProvider:    provider,
      computedAt:    Date.now(),
    }));
}
