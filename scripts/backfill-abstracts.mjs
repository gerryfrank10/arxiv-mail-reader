#!/usr/bin/env node
/**
 * scripts/backfill-abstracts.mjs
 *
 * Fills in missing abstracts for papers already in the database. Papers that
 * were imported from an arXiv listing (or whose digest email omitted the
 * abstract) have an empty `abstract` column, which weakens search, assessment
 * and AI summaries. This script asks the arXiv API for those ids in batches
 * and updates only rows that are still empty, so it is safe to re-run and will
 * never overwrite an abstract that arrived in the meantime.
 *
 * Usage:
 *   npm run backfill:abstracts -- --user=you@example.com
 *   npm run backfill:abstracts -- --user=you@example.com --limit=500
 *   npm run backfill:abstracts -- --all            # every user
 *   npm run backfill:abstracts -- --dry-run --limit=50
 *
 * Env:
 *   DATABASE_URL   same connection string the server uses
 */
import 'dotenv/config';
import pg from 'pg';
import process from 'node:process';

const ARXIV_ENDPOINT = 'https://export.arxiv.org/api/query';
const HEADERS = {
  'User-Agent': 'arxiv-mail-reader/1.0 (abstract backfill)',
  Accept: 'application/atom+xml',
};

const args = (() => {
  const out = { user: '', all: false, limit: 0, batch: 100, delay: 3000, dryRun: false };
  for (const a of process.argv.slice(2)) {
    const [k, vRaw] = a.startsWith('--') ? a.slice(2).split('=') : [a, ''];
    const v = vRaw ?? '';
    switch (k) {
      case 'user':    out.user  = v; break;
      case 'all':     out.all   = true; break;
      case 'limit':   out.limit = Math.max(0, parseInt(v, 10) || 0); break;
      case 'batch':   out.batch = Math.min(200, Math.max(1, parseInt(v, 10) || 100)); break;
      case 'delay':   out.delay = Math.max(0, parseInt(v, 10) || 3000); break;
      case 'dry-run': out.dryRun = true; break;
      case 'help':
      case 'h':
        printHelp(); process.exit(0);
      default: console.warn(`[backfill] unknown arg: ${a}`);
    }
  }
  return out;
})();

function printHelp() {
  console.log(`Usage:
  npm run backfill:abstracts -- --user=you@example.com [--limit=500] [--batch=100] [--delay=3000]
  npm run backfill:abstracts -- --all
  npm run backfill:abstracts -- --dry-run --limit=50

Fills empty paper abstracts from the arXiv API. Re-runs are safe; abstracts that
already exist are never overwritten.`);
}

if (!args.user && !args.all) {
  console.error('error: pass --user=<email> or --all');
  printHelp();
  process.exit(1);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function decodeXml(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

const baseId = (id) => String(id).trim().replace(/v\d+$/i, '');

// arXiv returns Atom XML; pull id + summary out of each <entry>.
function parseEntries(xml) {
  const out = new Map();
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const entry = m[1];
    const idMatch = entry.match(/<id>https?:\/\/arxiv\.org\/abs\/([^<]+)<\/id>/i);
    const sumMatch = entry.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i);
    if (!idMatch || !sumMatch) continue;
    const id = baseId(decodeXml(idMatch[1]));
    const abstract = decodeXml(sumMatch[1]).replace(/\s+/g, ' ').trim();
    if (id && abstract) out.set(id, abstract);
  }
  return out;
}

async function fetchBatch(ids) {
  const url = `${ARXIV_ENDPOINT}?id_list=${encodeURIComponent(ids.join(','))}&max_results=${ids.length}`;
  let wait = 5000;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(60_000) });
    if (r.ok) return parseEntries(await r.text());
    if (r.status === 429 || r.status === 503) {
      console.warn(`[backfill] arXiv ${r.status}, retrying in ${wait / 1000}s…`);
      await sleep(wait);
      wait *= 2;
      continue;
    }
    throw new Error(`arXiv HTTP ${r.status}`);
  }
  throw new Error('arXiv repeatedly rate-limited; stopping this batch');
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('error: DATABASE_URL is not set');
    process.exit(1);
  }
  const pool = new pg.Pool({ connectionString: url, max: 4 });

  let userId = null;
  if (args.user) {
    const { rows } = await pool.query('SELECT id, email FROM users WHERE lower(email)=lower($1)', [args.user]);
    if (rows.length === 0) {
      console.error(`error: no user found for ${args.user}`);
      await pool.end();
      process.exit(1);
    }
    userId = rows[0].id;
    console.log(`[backfill] user ${rows[0].email}`);
  } else {
    console.log('[backfill] all users');
  }

  const params = [];
  let where = `(abstract IS NULL OR btrim(abstract) = '') AND arxiv_id <> ''`;
  if (userId) { params.push(userId); where += ` AND user_id = $${params.length}`; }
  const limitSql = args.limit > 0 ? ` LIMIT ${args.limit}` : '';

  const { rows: missing } = await pool.query(
    `SELECT user_id, id, arxiv_id FROM papers WHERE ${where} ORDER BY digest_date DESC${limitSql}`,
    params,
  );
  console.log(`[backfill] ${missing.length} paper(s) with no abstract`);

  if (args.dryRun) {
    console.log(`[backfill] dry run — ${missing.length} would be fetched in batches of ${args.batch}`);
    await pool.end();
    return;
  }
  if (missing.length === 0) { await pool.end(); return; }

  // Group ids → rows so one arXiv fetch can update many user rows (the same
  // paper can exist in several accounts).
  const byArxiv = new Map();
  for (const row of missing) {
    const key = baseId(row.arxiv_id);
    if (!key) continue;
    if (!byArxiv.has(key)) byArxiv.set(key, []);
    byArxiv.get(key).push(row);
  }
  const keys = [...byArxiv.keys()];
  console.log(`[backfill] ${keys.length} unique arXiv id(s), ${Math.ceil(keys.length / args.batch)} request(s)`);

  let updated = 0, notFound = 0, failed = 0;
  for (let i = 0; i < keys.length; i += args.batch) {
    const chunk = keys.slice(i, i + args.batch);
    const n = Math.floor(i / args.batch) + 1;
    const total = Math.ceil(keys.length / args.batch);
    try {
      const found = await fetchBatch(chunk);
      for (const key of chunk) {
        const abstract = found.get(key);
        if (!abstract) { notFound += 1; continue; }
        for (const row of byArxiv.get(key) ?? []) {
          const r = await pool.query(
            `UPDATE papers SET abstract=$1
             WHERE user_id=$2 AND id=$3 AND (abstract IS NULL OR btrim(abstract) = '')`,
            [abstract, row.user_id, row.id],
          );
          updated += r.rowCount ?? 0;
        }
      }
      console.log(`[backfill] ${n}/${total} — updated ${updated}, not found ${notFound}`);
    } catch (e) {
      failed += chunk.length;
      console.error(`[backfill] ${n}/${total} failed: ${e.message}`);
    }
    if (i + args.batch < keys.length) await sleep(args.delay);
  }

  console.log(`[backfill] done — updated ${updated}, not found ${notFound}, failed ${failed}`);
  await pool.end();
}

main().catch(e => { console.error('[backfill] fatal:', e); process.exit(1); });
