#!/usr/bin/env node
/**
 * scripts/restore.mjs
 *
 * Restore a Postgres dump created by scripts/backup.mjs back into the
 * local arxiv_reader database. THIS IS DESTRUCTIVE — the target database
 * is overwritten (the dump is taken with --clean --if-exists, so existing
 * objects get dropped before being recreated).
 *
 * Usage:
 *   npm run db:restore -- --file=backups/db-2026-05-26_12-00-00.sql.gz
 *   npm run db:restore -- --file=... --yes     # skip the confirmation prompt
 *
 * Restoring uploads/ is intentionally a manual step (it's just a tarball):
 *   tar -xzf backups/uploads-<ts>.tar.gz
 */
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import process from 'node:process';

// =========================================================================
// CLI args
// =========================================================================

const args = (() => {
  const out = { file: '', yes: false };
  for (const a of process.argv.slice(2)) {
    const [k, vRaw] = a.startsWith('--') ? a.slice(2).split('=') : [a, ''];
    const v = vRaw ?? '';
    switch (k) {
      case 'file': out.file = v; break;
      case 'yes':  out.yes  = true; break;
      case 'help':
      case 'h':
        printHelp(); process.exit(0);
      default: console.warn(`[restore] unknown arg: ${a}`);
    }
  }
  return out;
})();

function printHelp() {
  console.log(`
Usage: npm run db:restore -- --file=<path-to-.sql.gz> [--yes]

Restore arxiv_reader from a gzipped pg_dump archive.

Options:
  --file=<path>   Required. Path to a .sql.gz produced by db:backup.
  --yes           Skip the "are you sure" confirmation prompt.
  --help          Show this message.
`);
}

if (!args.file) {
  console.error('[restore] error: --file=<path> is required');
  printHelp();
  process.exit(1);
}

const filePath = resolve(args.file);
if (!existsSync(filePath)) {
  console.error(`[restore] error: file not found: ${filePath}`);
  process.exit(1);
}
if (!filePath.endsWith('.sql.gz')) {
  console.error('[restore] error: expected a .sql.gz file');
  process.exit(1);
}

// =========================================================================
// Constants
// =========================================================================

const CONTAINER = 'arxiv-reader-db';
const DB_USER   = 'arxiv';
const DB_NAME   = 'arxiv_reader';

// =========================================================================
// Confirm
// =========================================================================

async function confirm() {
  if (args.yes) return true;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => {
    rl.question(
      `\nThis will OVERWRITE the "${DB_NAME}" database in container "${CONTAINER}".\n` +
      `Source: ${filePath} (${(statSync(filePath).size / 1024).toFixed(1)} KB)\n` +
      `Type "yes" to continue: `,
      (ans) => { rl.close(); res(ans.trim().toLowerCase() === 'yes'); }
    );
  });
}

// =========================================================================
// Restore
// =========================================================================

async function restore() {
  return new Promise((resolveP, rejectP) => {
    const src   = createReadStream(filePath);
    const gunzip = spawn('gunzip', ['-c'], { stdio: ['pipe', 'pipe', 'pipe'] });
    const psql  = spawn('docker', ['exec', '-i', CONTAINER, 'psql', '-U', DB_USER, '-d', DB_NAME, '-v', 'ON_ERROR_STOP=1'],
                        { stdio: ['pipe', 'pipe', 'inherit'] });

    src.pipe(gunzip.stdin);
    gunzip.stdout.pipe(psql.stdin);

    let gunzipErr = '';
    gunzip.stderr.on('data', d => { gunzipErr += d.toString(); });

    let gDone = false, pDone = false;
    const fin = () => {
      if (!(gDone && pDone)) return;
      if (gunzip.exitCode !== 0) return rejectP(new Error(`gunzip failed: ${gunzipErr.trim()}`));
      if (psql.exitCode   !== 0) return rejectP(new Error(`psql failed (exit ${psql.exitCode})`));
      resolveP();
    };
    gunzip.on('close', () => { gDone = true; fin(); });
    psql.on('close',   () => { pDone = true; fin(); });
    src.on('error', rejectP);
  });
}

// =========================================================================
// Main
// =========================================================================

async function main() {
  if (!(await confirm())) {
    console.log('[restore] cancelled');
    process.exit(0);
  }
  console.log('\n[restore] restoring…');
  try {
    await restore();
    console.log('[restore] ✓ done');
  } catch (err) {
    console.error(`[restore] FAILED: ${err.message}`);
    if (err.message.includes('Cannot connect to the Docker daemon')) {
      console.error('[restore] hint: start Docker first (npm run db:up)');
    }
    process.exit(1);
  }
}

main();
