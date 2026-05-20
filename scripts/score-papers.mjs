#!/usr/bin/env node
/**
 * scripts/score-papers.mjs
 *
 * Standalone CLI to score the user's papers against one (or all) of their
 * trackers using an AI provider. Designed to be run offline / on a schedule
 * so token usage is bounded and predictable.
 *
 * Usage:
 *   npm run score-papers -- --user=you@example.com
 *   npm run score-papers -- --user=you@example.com --tracker="World models"
 *   npm run score-papers -- --user=you@example.com --limit=200
 *   npm run score-papers -- --user=you@example.com --dry-run
 *   npm run score-papers -- --user=you@example.com --rescore   # wipe + redo
 *
 * Env vars (read from server/.env or current shell):
 *   DATABASE_URL              — same connection string the server uses
 *   AI_PROVIDER               — claude | openai | groq | ollama | custom
 *   AI_BASE_URL               — base URL (Ollama defaults to localhost)
 *   AI_MODEL                  — model name
 *   AI_API_KEY                — required for non-ollama providers
 *
 * The script processes papers in batches of 10 and prints progress per
 * tracker. It always skips trackers whose `enabled` flag is FALSE.
 */
import 'dotenv/config';
import pg from 'pg';
import process from 'node:process';

// =========================================================================
// CLI args
// =========================================================================

const args = (() => {
  const out = { user: '', tracker: '', limit: 500, dryRun: false, rescore: false, batchSize: 10 };
  for (const a of process.argv.slice(2)) {
    const [k, vRaw] = a.startsWith('--') ? a.slice(2).split('=') : [a, ''];
    const v = vRaw ?? '';
    switch (k) {
      case 'user':      out.user      = v; break;
      case 'tracker':   out.tracker   = v; break;
      case 'limit':     out.limit     = Math.max(1, parseInt(v, 10) || out.limit); break;
      case 'batch':     out.batchSize = Math.max(1, parseInt(v, 10) || out.batchSize); break;
      case 'dry-run':   out.dryRun    = true; break;
      case 'rescore':   out.rescore   = true; break;
      case 'help':
      case 'h':
        printHelp(); process.exit(0);
      default: console.warn(`[score-papers] unknown arg: ${a}`);
    }
  }
  return out;
})();

if (!args.user) {
  console.error('error: --user=<email> is required');
  printHelp();
  process.exit(1);
}

function printHelp() {
  console.log(`Usage: npm run score-papers -- --user=<email> [options]

Options:
  --user=EMAIL       (required) email of the user whose papers to score
  --tracker=NAME     score only this tracker (matches by name, case-insensitive)
  --limit=N          max papers per tracker (default 500)
  --batch=N          batch size for the AI call (default 10)
  --rescore          wipe existing scores for the targeted tracker(s) first
  --dry-run          fetch + score but DON'T write to the database
  --help             show this message

Env (server/.env or shell):
  DATABASE_URL  postgres connection string
  AI_PROVIDER   claude | openai | groq | ollama | custom
  AI_BASE_URL   base URL (defaults provided for known providers)
  AI_MODEL      model name
  AI_API_KEY    required for non-ollama providers`);
}

// =========================================================================
// AI provider config (env-driven)
// =========================================================================

const PROVIDER = (process.env.AI_PROVIDER ?? 'ollama').toLowerCase();
const MODEL    = process.env.AI_MODEL    ?? defaultModelFor(PROVIDER);
const BASE_URL = process.env.AI_BASE_URL ?? defaultBaseUrlFor(PROVIDER);
const API_KEY  = process.env.AI_API_KEY  ?? '';

function defaultBaseUrlFor(p) {
  switch (p) {
    case 'claude':  return 'https://api.anthropic.com/v1';
    case 'openai':  return 'https://api.openai.com/v1';
    case 'groq':    return 'https://api.groq.com/openai/v1';
    case 'ollama':  return 'http://localhost:11434/v1';
    default:        return 'http://localhost:8080/v1';
  }
}
function defaultModelFor(p) {
  switch (p) {
    case 'claude':  return 'claude-haiku-4-5-20251001';
    case 'openai':  return 'gpt-4o-mini';
    case 'groq':    return 'llama-3.3-70b-versatile';
    case 'ollama':  return 'llama3.1';
    default:        return 'local-model';
  }
}

if (PROVIDER !== 'ollama' && !API_KEY) {
  console.error(`error: AI_API_KEY is required for provider=${PROVIDER}`);
  process.exit(1);
}

// =========================================================================
// Postgres
// =========================================================================

if (!process.env.DATABASE_URL) {
  console.error('error: DATABASE_URL is required (set in server/.env)');
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });

async function getUserId(email) {
  const { rows } = await pool.query(
    `SELECT id FROM users WHERE lower(email)=lower($1)`,
    [email],
  );
  return rows[0]?.id ?? null;
}

async function getTrackers(userId, nameFilter) {
  const { rows } = await pool.query(
    `SELECT id, name, description, keywords, seed_arxiv_ids, enabled,
            color, min_score, auto_score_mode
     FROM trackers
     WHERE user_id=$1
       AND ($2::text IS NULL OR lower(name) LIKE '%' || lower($2) || '%')
       AND enabled IS TRUE`,
    [userId, nameFilter || null],
  );
  return rows.map(r => ({
    id: r.id, name: r.name, description: r.description ?? '',
    keywords: r.keywords ?? [], seedArxivIds: r.seed_arxiv_ids ?? [],
    enabled: r.enabled, color: r.color, minScore: r.min_score,
    autoScoreMode: r.auto_score_mode ?? 'manual',
  }));
}

async function getUnscoredPapers(userId, trackerId, limit) {
  const { rows } = await pool.query(
    `SELECT p.id, p.arxiv_id, p.title, p.authors, p.author_list,
            p.categories, p.abstract
     FROM papers p
     WHERE p.user_id=$1
       AND NOT EXISTS (
         SELECT 1 FROM paper_scores s
         WHERE s.user_id=p.user_id AND s.tracker_id=$2 AND s.paper_id=p.id
       )
     ORDER BY p.digest_date DESC
     LIMIT $3`,
    [userId, trackerId, limit],
  );
  return rows.map(r => ({
    id: r.id, arxivId: r.arxiv_id, title: r.title,
    authors: r.authors, authorList: r.author_list ?? [],
    categories: r.categories ?? [], abstract: r.abstract ?? '',
  }));
}

async function deleteScores(userId, trackerId) {
  await pool.query(
    `DELETE FROM paper_scores WHERE user_id=$1 AND tracker_id=$2`,
    [userId, trackerId],
  );
}

async function upsertScores(userId, scores) {
  if (!scores.length) return;
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    for (const s of scores) {
      await c.query(
        `INSERT INTO paper_scores
           (user_id, paper_id, tracker_id, score, rationale, source, ts)
         VALUES ($1,$2,$3,$4,$5,$6,now())
         ON CONFLICT (user_id, paper_id, tracker_id) DO UPDATE SET
           score=$4, rationale=$5, source=$6, ts=now()`,
        [userId, s.paperId, s.trackerId, s.score, s.rationale, s.source ?? 'claude'],
      );
    }
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

// =========================================================================
// AI scoring (Anthropic protocol or OpenAI-compatible)
// =========================================================================

async function aiScoreBatch(tracker, batch) {
  const list = batch.map((p, i) => {
    const abs = (p.abstract || '').slice(0, 500);
    return `${i + 1}. [id=${p.id}] ${p.title}\n   Authors: ${p.authors}\n   Abstract: ${abs || '(no abstract available)'}`;
  }).join('\n\n');

  const prompt = `You are a research-curation assistant. The user is tracking the following specific research interest:

Name: ${tracker.name}
Description: ${tracker.description || '(none provided)'}
${tracker.keywords.length ? `Keywords: ${tracker.keywords.join(', ')}` : ''}

For each candidate paper below, rate how well it matches the user's interest on a 0-100 scale where:
  • 90-100 = directly addresses the tracked interest with strong relevance
  • 70-89  = closely related
  • 40-69  = tangentially related
  • 10-39  = touches the area but unlikely to be useful
  • 0-9    = unrelated

Reward papers that match the SPECIFIC angle described, not just the broad area.

PAPERS:
${list}

Return ONLY a JSON array, one object per paper, no markdown fences, no preamble:
[
  {"paperId": "...", "score": 0-100, "rationale": "one short sentence explaining why"},
  ...
]`;

  let text;
  if (PROVIDER === 'claude') {
    const r = await fetch(`${BASE_URL}/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        temperature: 0.2,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      throw new Error(`Claude ${r.status}: ${body.slice(0, 200)}`);
    }
    const data = await r.json();
    text = data.content?.[0]?.text ?? '';
  } else {
    // OpenAI-compatible
    const headers = { 'Content-Type': 'application/json' };
    if (API_KEY) headers['Authorization'] = `Bearer ${API_KEY}`;
    const r = await fetch(`${BASE_URL.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        temperature: 0.2,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      throw new Error(`${PROVIDER} ${r.status}: ${body.slice(0, 200)}`);
    }
    const data = await r.json();
    text = data.choices?.[0]?.message?.content ?? '';
  }

  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error(`AI returned no JSON array (first 200 chars: ${text.slice(0, 200)})`);
  const parsed = JSON.parse(match[0]);
  if (!Array.isArray(parsed)) throw new Error('AI returned non-array JSON');
  return parsed;
}

// =========================================================================
// Main
// =========================================================================

(async () => {
  console.log(`╭───────────────────────────────────────────────`);
  console.log(`│ score-papers — provider=${PROVIDER}, model=${MODEL}`);
  console.log(`│ user=${args.user}${args.tracker ? `, tracker=${args.tracker}` : ''}`);
  console.log(`│ limit=${args.limit}, batch=${args.batchSize}${args.dryRun ? ', DRY RUN' : ''}${args.rescore ? ', RESCORE' : ''}`);
  console.log(`╰───────────────────────────────────────────────`);

  const userId = await getUserId(args.user);
  if (!userId) {
    console.error(`No user found for ${args.user}.`);
    await pool.end();
    process.exit(2);
  }

  const trackers = await getTrackers(userId, args.tracker || undefined);
  if (!trackers.length) {
    console.error(args.tracker
      ? `No enabled tracker matching "${args.tracker}".`
      : 'No enabled trackers for this user.');
    await pool.end();
    process.exit(2);
  }

  let totalScored = 0;
  let totalFailed = 0;
  const t0 = Date.now();

  for (const tracker of trackers) {
    console.log(`\n• ${tracker.name}`);

    if (args.rescore) {
      if (args.dryRun) {
        console.log(`  [dry-run] would wipe existing scores`);
      } else {
        await deleteScores(userId, tracker.id);
        console.log(`  wiped existing scores`);
      }
    }

    const candidates = await getUnscoredPapers(userId, tracker.id, args.limit);
    if (!candidates.length) {
      console.log(`  ✓ nothing to score`);
      continue;
    }
    console.log(`  ${candidates.length} unscored — batching ${args.batchSize} per call`);

    for (let i = 0; i < candidates.length; i += args.batchSize) {
      const batch = candidates.slice(i, i + args.batchSize);
      const tStart = Date.now();
      try {
        const results = await aiScoreBatch(tracker, batch);
        const known = new Set(batch.map(p => p.id));
        const scores = results
          .filter(r => r && known.has(r.paperId))
          .map(r => ({
            paperId:   r.paperId,
            trackerId: tracker.id,
            score:     Math.max(0, Math.min(100, Math.round(Number(r.score) || 0))),
            rationale: String(r.rationale ?? '').slice(0, 500),
            source:    'claude',
          }));
        if (!args.dryRun) await upsertScores(userId, scores);
        totalScored += scores.length;
        const ms = Date.now() - tStart;
        const min = scores.length ? Math.min(...scores.map(s => s.score)) : 0;
        const max = scores.length ? Math.max(...scores.map(s => s.score)) : 0;
        console.log(`  · batch ${i / args.batchSize + 1}: ${scores.length}/${batch.length} scored, range ${min}-${max} (${(ms / 1000).toFixed(1)}s)`);
      } catch (e) {
        totalFailed += batch.length;
        console.log(`  ✗ batch ${i / args.batchSize + 1} failed: ${e.message}`);
      }
    }
  }

  const elapsed = (Date.now() - t0) / 1000;
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Done in ${elapsed.toFixed(1)}s — ${totalScored} scored, ${totalFailed} failed`);
  if (args.dryRun) console.log(`(dry-run: NO writes to the database)`);

  await pool.end();
})().catch(async (e) => {
  console.error('fatal:', e);
  try { await pool.end(); } catch { /* ignore */ }
  process.exit(1);
});
