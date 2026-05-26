#!/usr/bin/env node
/**
 * scripts/backup.mjs
 *
 * Snapshot the local Postgres database AND the uploads/ directory into
 * timestamped archives under ./backups/. Designed to be run on demand
 * (npm run db:backup) or via cron — pg_dump is online-safe and does not
 * block writes, so it's fine to run while the app is in use.
 *
 * Usage:
 *   npm run db:backup
 *   npm run db:backup -- --prune=14        # keep only the latest 14 backups
 *   npm run db:backup -- --skip-uploads    # db only
 *   npm run db:backup -- --skip-db         # uploads only
 *   npm run db:backup -- --out=/some/dir   # write somewhere other than ./backups
 *
 * What gets written (per run, with a shared ISO timestamp):
 *   backups/db-<ts>.sql.gz       — pg_dump | gzip of arxiv_reader
 *   backups/uploads-<ts>.tar.gz  — tar+gzip of ./uploads/ (skipped if empty)
 *
 * Restore with: npm run db:restore -- --file=backups/db-<ts>.sql.gz
 *               tar -xzf backups/uploads-<ts>.tar.gz   (manual for uploads)
 *
 * No credentials are read from or printed to the environment — pg_dump runs
 * INSIDE the docker container using the role baked into docker-compose.yml.
 */
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import process from 'node:process';

// =========================================================================
// CLI args
// =========================================================================

const args = (() => {
  const out = { prune: 0, skipDb: false, skipUploads: false, outDir: 'backups' };
  for (const a of process.argv.slice(2)) {
    const [k, vRaw] = a.startsWith('--') ? a.slice(2).split('=') : [a, ''];
    const v = vRaw ?? '';
    switch (k) {
      case 'prune':         out.prune       = Math.max(0, parseInt(v, 10) || 0); break;
      case 'skip-db':       out.skipDb      = true; break;
      case 'skip-uploads':  out.skipUploads = true; break;
      case 'out':           out.outDir      = v || out.outDir; break;
      case 'help':
      case 'h':
        printHelp(); process.exit(0);
      default: console.warn(`[backup] unknown arg: ${a}`);
    }
  }
  return out;
})();

function printHelp() {
  console.log(`
Usage: npm run db:backup -- [options]

Options:
  --prune=N           After backup, delete all but the most recent N db/uploads pairs
  --skip-uploads      Back up Postgres only
  --skip-db           Back up uploads/ only
  --out=<dir>         Write archives to <dir> instead of ./backups
  --help              Show this message
`);
}

// =========================================================================
// Constants
// =========================================================================

const CONTAINER = 'arxiv-reader-db';
const DB_USER   = 'arxiv';
const DB_NAME   = 'arxiv_reader';
const UPLOADS   = 'uploads';

// ISO timestamp with colons replaced so it's filename-safe & lexicographically sortable
const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);

// =========================================================================
// Helpers
// =========================================================================

function header(title) {
  const bar = '─'.repeat(Math.max(0, 60 - title.length));
  console.log(`\n╭── ${title} ${bar}╮`);
}

function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Pipe a child process's stdout into a gzip stream into a file. Returns a Promise. */
function pipeToFile({ cmd, args, gzipArgs = [], outPath, label }) {
  return new Promise((resolveP, rejectP) => {
    const src  = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const gzip = spawn('gzip', gzipArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
    const sink = createWriteStream(outPath);

    src.stdout.pipe(gzip.stdin);
    gzip.stdout.pipe(sink);

    let srcErr = '';
    src.stderr.on('data', d => { srcErr += d.toString(); });
    gzip.stderr.on('data', d => { srcErr += d.toString(); });

    let srcDone = false, gzipDone = false, sinkDone = false;
    const maybeFinish = () => {
      if (!(srcDone && gzipDone && sinkDone)) return;
      if (src.exitCode !== 0) {
        try { unlinkSync(outPath); } catch {}
        rejectP(new Error(`${label} failed (exit ${src.exitCode}): ${srcErr.trim()}`));
      } else if (gzip.exitCode !== 0) {
        try { unlinkSync(outPath); } catch {}
        rejectP(new Error(`gzip failed (exit ${gzip.exitCode}): ${srcErr.trim()}`));
      } else {
        resolveP();
      }
    };
    src.on('close',  () => { srcDone  = true; maybeFinish(); });
    gzip.on('close', () => { gzipDone = true; maybeFinish(); });
    sink.on('close', () => { sinkDone = true; maybeFinish(); });
    sink.on('error', rejectP);
  });
}

// =========================================================================
// Steps
// =========================================================================

async function backupDb(outDir) {
  header('Postgres dump');
  const outPath = join(outDir, `db-${ts}.sql.gz`);
  console.log(`  container : ${CONTAINER}`);
  console.log(`  database  : ${DB_NAME}`);
  console.log(`  → ${outPath}`);

  await pipeToFile({
    cmd:  'docker',
    args: ['exec', CONTAINER, 'pg_dump', '-U', DB_USER, '-d', DB_NAME, '--clean', '--if-exists'],
    outPath,
    label: 'pg_dump',
  });

  const size = statSync(outPath).size;
  console.log(`  ✓ wrote ${fmtSize(size)}`);
  return outPath;
}

async function backupUploads(outDir) {
  header('uploads/ archive');
  if (!existsSync(UPLOADS)) {
    console.log(`  (no ${UPLOADS}/ directory — skipping)`);
    return null;
  }
  const entries = readdirSync(UPLOADS);
  if (entries.length === 0) {
    console.log(`  (${UPLOADS}/ is empty — skipping)`);
    return null;
  }

  const outPath = join(outDir, `uploads-${ts}.tar.gz`);
  console.log(`  source    : ./${UPLOADS}/`);
  console.log(`  → ${outPath}`);

  await new Promise((resolveP, rejectP) => {
    const tar  = spawn('tar', ['-cf', '-', UPLOADS], { stdio: ['ignore', 'pipe', 'pipe'] });
    const gzip = spawn('gzip', [], { stdio: ['pipe', 'pipe', 'pipe'] });
    const sink = createWriteStream(outPath);

    tar.stdout.pipe(gzip.stdin);
    gzip.stdout.pipe(sink);

    let stderr = '';
    tar.stderr.on('data',  d => { stderr += d.toString(); });
    gzip.stderr.on('data', d => { stderr += d.toString(); });

    let tDone = false, gDone = false, sDone = false;
    const fin = () => {
      if (!(tDone && gDone && sDone)) return;
      if (tar.exitCode !== 0 || gzip.exitCode !== 0) {
        try { unlinkSync(outPath); } catch {}
        rejectP(new Error(`tar/gzip failed: ${stderr.trim()}`));
      } else {
        resolveP();
      }
    };
    tar.on('close',  () => { tDone = true; fin(); });
    gzip.on('close', () => { gDone = true; fin(); });
    sink.on('close', () => { sDone = true; fin(); });
    sink.on('error', rejectP);
  });

  const size = statSync(outPath).size;
  console.log(`  ✓ wrote ${fmtSize(size)}`);
  return outPath;
}

function prune(outDir, keep) {
  if (keep <= 0) return;
  header(`Pruning (keep latest ${keep})`);

  const groupByPrefix = (prefix) => readdirSync(outDir)
    .filter(f => f.startsWith(prefix) && (f.endsWith('.sql.gz') || f.endsWith('.tar.gz')))
    .map(f => ({ name: f, path: join(outDir, f), mtime: statSync(join(outDir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  for (const prefix of ['db-', 'uploads-']) {
    const all = groupByPrefix(prefix);
    const toDelete = all.slice(keep);
    if (toDelete.length === 0) {
      console.log(`  ${prefix}*: ${all.length} archive(s) kept`);
      continue;
    }
    for (const f of toDelete) {
      unlinkSync(f.path);
      console.log(`  ✗ removed ${f.name}`);
    }
    console.log(`  ${prefix}*: kept ${Math.min(all.length, keep)}, removed ${toDelete.length}`);
  }
}

// =========================================================================
// Main
// =========================================================================

async function main() {
  const outDir = resolve(args.outDir);
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
    console.log(`[backup] created ${outDir}`);
  }

  console.log(`[backup] timestamp: ${ts}`);
  console.log(`[backup] output:    ${outDir}`);

  const written = [];
  try {
    if (!args.skipDb) {
      written.push(await backupDb(outDir));
    } else {
      console.log('\n(--skip-db: not dumping Postgres)');
    }

    if (!args.skipUploads) {
      const p = await backupUploads(outDir);
      if (p) written.push(p);
    } else {
      console.log('\n(--skip-uploads: not archiving uploads/)');
    }

    if (args.prune > 0) prune(outDir, args.prune);

    header('Done');
    if (written.length === 0) {
      console.log('  (nothing was written)');
    } else {
      for (const p of written) console.log(`  • ${p}`);
    }
    console.log('');
  } catch (err) {
    console.error(`\n[backup] FAILED: ${err.message}`);
    if (err.message.includes('Cannot connect to the Docker daemon')) {
      console.error('[backup] hint: start Docker first (npm run db:up)');
    }
    process.exit(1);
  }
}

main();
