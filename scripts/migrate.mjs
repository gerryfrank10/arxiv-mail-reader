#!/usr/bin/env node
/**
 * scripts/migrate.mjs
 *
 * Incremental migration runner for the local Postgres. Designed to fix the
 * gap left by docker-entrypoint-initdb.d: that mechanism only runs on a
 * FRESH volume, so adding a new server/migrations/*.sql file to an existing
 * database silently does nothing. This script tracks which migrations have
 * been applied (in a schema_migrations table) and runs only the pending
 * ones, in a transaction per file.
 *
 * Usage:
 *   npm run db:migrate              # apply pending migrations
 *   npm run db:migrate -- --status  # list applied vs pending
 *   npm run db:migrate -- --dry-run # show what WOULD run, change nothing
 *
 * First-run behaviour:
 *   If schema_migrations does NOT exist but the `users` table does, we
 *   assume docker-entrypoint already ran 001..N during the initial volume
 *   bootstrap. In that case we create schema_migrations and record every
 *   currently-checked-in migration as already applied, so only NEW files
 *   added after this point will run on the next invocation.
 *
 *   If neither schema_migrations NOR users exists, we run every migration
 *   from scratch — the same effect as docker-entrypoint, but in-process
 *   so we can be sure it actually happened.
 */
import 'dotenv/config';
import pg from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';

// =========================================================================
// CLI args
// =========================================================================

const args = (() => {
  const out = { status: false, dryRun: false };
  for (const a of process.argv.slice(2)) {
    const k = a.startsWith('--') ? a.slice(2) : a;
    switch (k) {
      case 'status':  out.status = true; break;
      case 'dry-run': out.dryRun = true; break;
      case 'help':
      case 'h':
        printHelp(); process.exit(0);
      default: console.warn(`[migrate] unknown arg: ${a}`);
    }
  }
  return out;
})();

function printHelp() {
  console.log(`
Usage: npm run db:migrate -- [options]

Options:
  --status     Print applied / pending migrations and exit (no changes)
  --dry-run    Show what would be applied, change nothing
  --help       Show this message
`);
}

// =========================================================================
// Config
// =========================================================================

if (!process.env.DATABASE_URL) {
  console.error('[migrate] error: DATABASE_URL is not set. Check your .env.');
  process.exit(1);
}

const __dirname     = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '..', 'server', 'migrations');

function loadMigrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort()  // lexical = chronological because of NNN_ prefix
    .map(f => ({ name: f, path: join(MIGRATIONS_DIR, f) }));
}

// =========================================================================
// Schema-migrations table
// =========================================================================

const SCHEMA_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  name        TEXT        PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
`.trim();

async function ensureSchemaTable(client) {
  await client.query(SCHEMA_TABLE_SQL);
}

async function tableExists(client, tableName) {
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
    [tableName],
  );
  return rows.length > 0;
}

async function fetchApplied(client) {
  const { rows } = await client.query(`SELECT name FROM schema_migrations ORDER BY name`);
  return new Set(rows.map(r => r.name));
}

// =========================================================================
// Helpers
// =========================================================================

function fmtList(items) {
  return items.length === 0 ? '    (none)' : items.map(s => `    • ${s}`).join('\n');
}

// =========================================================================
// Main
// =========================================================================

async function main() {
  const files = loadMigrationFiles();
  if (files.length === 0) {
    console.log('[migrate] no migration files found.');
    return;
  }

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    // Detect first-run scenario before creating schema_migrations
    const schemaTableExisted = await tableExists(client, 'schema_migrations');
    const usersTableExists   = await tableExists(client, 'users');
    const adoptExisting      = !schemaTableExisted && usersTableExists;

    await ensureSchemaTable(client);

    if (adoptExisting && !args.dryRun) {
      // Database was bootstrapped by docker-entrypoint-initdb.d. Mark every
      // checked-in migration as already applied so we don't try to re-run
      // them and crash on duplicate-table errors.
      console.log('[migrate] existing database detected (users table present).');
      console.log('[migrate] marking checked-in migrations as applied without running them:');
      for (const f of files) {
        await client.query(
          `INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
          [f.name],
        );
        console.log(`    ✓ recorded ${f.name}`);
      }
      console.log('[migrate] adoption complete. Future migrations will apply incrementally.\n');
    }

    const applied = await fetchApplied(client);
    const pending = files.filter(f => !applied.has(f.name));

    if (args.status) {
      console.log('\n[migrate] applied:');
      console.log(fmtList([...applied].sort()));
      console.log('\n[migrate] pending:');
      console.log(fmtList(pending.map(p => p.name)));
      console.log('');
      return;
    }

    if (pending.length === 0) {
      console.log('[migrate] up to date — no pending migrations.');
      return;
    }

    console.log(`[migrate] ${pending.length} pending migration(s):`);
    for (const p of pending) console.log(`    • ${p.name}`);

    if (args.dryRun) {
      console.log('\n[migrate] --dry-run: not applying anything.');
      return;
    }

    for (const m of pending) {
      const sql = readFileSync(m.path, 'utf8');
      process.stdout.write(`[migrate] applying ${m.name} … `);
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(
          `INSERT INTO schema_migrations (name) VALUES ($1)`,
          [m.name],
        );
        await client.query('COMMIT');
        console.log('ok');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.log('FAILED');
        console.error(`[migrate] ${m.name}: ${err.message}`);
        throw err;
      }
    }

    console.log(`[migrate] applied ${pending.length} migration(s).`);
  } finally {
    await client.end();
  }
}

main().catch(err => {
  console.error(`\n[migrate] FAILED: ${err.message}`);
  process.exit(1);
});
