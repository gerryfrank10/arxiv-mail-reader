// Postgres helpers for arxiv-mail-reader.
//
// All queries are scoped by user_id, which is resolved from the
// X-User-Email header (set by the client; we look up or create the row).
//
// If DATABASE_URL isn't set the export is a no-op `db.enabled === false`
// and the server simply doesn't mount the /api/db/* routes.

import pg from 'pg';
import { hashPassword, verifyPassword, newSessionToken, hashSessionToken } from './auth.mjs';
import { detectOrganization } from './organizations.mjs';

const { Pool } = pg;

let pool = null;

export const db = {
  get enabled() { return !!pool; },

  async init() {
    const url = process.env.DATABASE_URL;
    if (!url) {
      console.log('[db] DATABASE_URL not set — server will run without Postgres backing store');
      return false;
    }
    pool = new Pool({ connectionString: url, max: 10 });
    try {
      const r = await pool.query('SELECT 1');
      if (r.rows.length === 1) {
        console.log('[db] connected to Postgres');
        // Ensure columns for locally-uploaded paper PDFs exist. Idempotent, so
        // it works on a fresh DB and on an existing one without a manual
        // `npm run db:migrate` (initdb migrations only run on a fresh volume).
        await pool.query(`
          ALTER TABLE papers
            ADD COLUMN IF NOT EXISTS file_path         text,
            ADD COLUMN IF NOT EXISTS file_size         bigint,
            ADD COLUMN IF NOT EXISTS mime_type         text,
            ADD COLUMN IF NOT EXISTS original_filename text,
            ADD COLUMN IF NOT EXISTS uploaded_at       timestamptz,
            ADD COLUMN IF NOT EXISTS full_text         text,
            ADD COLUMN IF NOT EXISTS full_text_chars   integer,
            ADD COLUMN IF NOT EXISTS full_text_at      timestamptz,
            ADD COLUMN IF NOT EXISTS organization            text,
            ADD COLUMN IF NOT EXISTS organization_checked_at timestamptz
        `);
        await pool.query(`
          CREATE INDEX IF NOT EXISTS idx_papers_user_file
            ON papers (user_id) WHERE file_path IS NOT NULL
        `);
        // "Liked" papers — a lightweight signal distinct from the library
        // (bookmark). Mirrors the library table. Idempotent so existing DBs
        // get it without a manual migration.
        await pool.query(`
          CREATE TABLE IF NOT EXISTS likes (
            user_id   UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            paper_id  TEXT         NOT NULL,
            liked_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
            PRIMARY KEY (user_id, paper_id),
            FOREIGN KEY (user_id, paper_id) REFERENCES papers (user_id, id) ON DELETE CASCADE
          )
        `);
        // Accounts: passwords live on the user row; sessions are opaque bearer
        // tokens stored as SHA-256 hashes with an expiry.
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash text`);
        await pool.query(`
          CREATE TABLE IF NOT EXISTS sessions (
            token_hash TEXT        PRIMARY KEY,
            user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            expires_at TIMESTAMPTZ NOT NULL
          )
        `);
        await pool.query(`
          CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id)
        `);
        // Per-paper comments shown in the dashboard feed.
        await pool.query(`
          CREATE TABLE IF NOT EXISTS paper_comments (
            id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id    UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            paper_id   TEXT         NOT NULL,
            body       TEXT         NOT NULL,
            created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
          )
        `);
        await pool.query(`
          CREATE INDEX IF NOT EXISTS idx_paper_comments_user_paper
            ON paper_comments (user_id, paper_id, created_at)
        `);
        return true;
      }
    } catch (e) {
      console.error('[db] connection failed:', e.message);
      pool = null;
      return false;
    }
  },

  // ----- user resolution -----

  // ----- accounts / sessions -----

  // First-run setup: optionally adopt an existing user row (so its papers keep
  // the same user_id) and give it a password if it has none.
  async ensureSeedUser({ email, password, legacyEmail }) {
    const target = String(email).trim().toLowerCase();
    const legacy = legacyEmail ? String(legacyEmail).trim().toLowerCase() : '';
    if (legacy && legacy !== target) {
      const exists = await pool.query(`SELECT id FROM users WHERE email=$1`, [target]);
      if (exists.rows.length === 0) {
        const moved = await pool.query(
          `UPDATE users SET email=$2 WHERE email=$1 RETURNING id`,
          [legacy, target],
        );
        if (moved.rows.length > 0) {
          console.log(`[auth] renamed existing user ${legacy} → ${target} (all papers kept)`);
        }
      }
    }
    const { rows } = await pool.query(
      `SELECT id, email, password_hash FROM users WHERE email=$1`, [target],
    );
    if (rows.length === 0) {
      await pool.query(
        `INSERT INTO users (email, password_hash) VALUES ($1,$2)`,
        [target, password ? hashPassword(password) : null],
      );
      return { email: target, created: true, passwordSet: true };
    }
    if (!rows[0].password_hash && password) {
      await pool.query(`UPDATE users SET password_hash=$2 WHERE id=$1`, [rows[0].id, hashPassword(password)]);
      return { email: target, created: false, passwordSet: true };
    }
    return { email: target, created: false, passwordSet: false };
  },

  async createUser(email, password) {
    const e = String(email).trim().toLowerCase();
    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash) VALUES ($1,$2) RETURNING id, email`,
      [e, hashPassword(password)],
    );
    return rows[0];
  },

  async authenticateUser(email, password) {
    const e = String(email || '').trim().toLowerCase();
    if (!e || !password) return null;
    const { rows } = await pool.query(
      `SELECT id, email, password_hash FROM users WHERE email=$1`, [e],
    );
    const row = rows[0];
    if (!row || !verifyPassword(password, row.password_hash)) return null;
    await pool.query(`UPDATE users SET last_seen=now() WHERE id=$1`, [row.id]);
    return { id: row.id, email: row.email };
  },

  async changePassword(userId, currentPassword, nextPassword) {
    const { rows } = await pool.query(`SELECT password_hash FROM users WHERE id=$1`, [userId]);
    if (!rows[0] || !verifyPassword(currentPassword, rows[0].password_hash)) return false;
    await pool.query(`UPDATE users SET password_hash=$2 WHERE id=$1`, [userId, hashPassword(nextPassword)]);
    // Changing the password invalidates other sessions.
    await pool.query(`DELETE FROM sessions WHERE user_id=$1`, [userId]);
    return true;
  },

  async createSession(userId, days = 30) {
    const token = newSessionToken();
    await pool.query(
      `INSERT INTO sessions (token_hash, user_id, expires_at)
       VALUES ($1,$2, now() + ($3::int * interval '1 day'))`,
      [hashSessionToken(token), userId, days],
    );
    return token;
  },

  async getSessionUser(token) {
    if (!token) return null;
    const { rows } = await pool.query(
      `SELECT u.id, u.email
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash=$1 AND s.expires_at > now()`,
      [hashSessionToken(token)],
    );
    return rows[0] ?? null;
  },

  async deleteSession(token) {
    if (!token) return;
    await pool.query(`DELETE FROM sessions WHERE token_hash=$1`, [hashSessionToken(token)]);
  },

  async userIdForEmail(email) {
    if (!email) throw new Error('email required');
    const e = String(email).trim().toLowerCase();
    // upsert + return id (no ON CONFLICT DO UPDATE -- we don't need to touch the row on lookup)
    const { rows } = await pool.query(
      `INSERT INTO users (email) VALUES ($1)
       ON CONFLICT (email) DO UPDATE SET last_seen = now()
       RETURNING id`,
      [e],
    );
    return rows[0].id;
  },

  // ----- papers -----

  // Paginated list. `limit <= 0` (or omitted) returns every paper, which keeps
  // older callers working. The total row count comes back with the page so the
  // client can show "N of M" and know whether more pages exist.
  async getPapers(userId, { limit = 0, offset = 0 } = {}) {
    // Never SELECT *: full_text can be megabytes per paper. The list only
    // needs a flag + size; the text itself is fetched per-paper on demand.
    const cols = `id, arxiv_id, title, authors, author_list, categories,
              abstract, comments, url, pdf_url, size, date, email_id,
              digest_subject, digest_date, source,
              file_path, file_size, mime_type, original_filename, uploaded_at,
              (full_text IS NOT NULL) AS has_full_text,
              COALESCE(full_text_chars, 0) AS full_text_chars,
              organization`;
    const lim = Math.trunc(Number(limit) || 0);
    const off = Math.max(0, Math.trunc(Number(offset) || 0));

    // The list is paginated, but a paper the user explicitly kept (saved,
    // liked, imported, uploaded) must always be in the first window — otherwise
    // the Library/Liked panes silently lose anything older than the page.
    // Keep ids are read once and passed as an array: an EXISTS probe per row
    // made the first page ~3x slower.
    const { rows: keptRows } = await pool.query(
      `SELECT paper_id FROM library WHERE user_id=$1
       UNION
       SELECT paper_id FROM likes WHERE user_id=$1`,
      [userId],
    );
    const keptIds = keptRows.map(r => r.paper_id);
    const pinnedFirst = (param) => `(p.source IN ('import','upload') OR p.id = ANY(${param}::text[]))`;

    if (lim <= 0) {
      const { rows } = await pool.query(
        `SELECT ${cols} FROM papers p WHERE p.user_id=$1
         ORDER BY ${pinnedFirst('$2')} DESC, p.digest_date DESC, p.id DESC`,
        [userId, keptIds],
      );
      return { papers: rows.map(rowToPaper), total: rows.length };
    }

    const { rows } = await pool.query(
      `SELECT ${cols}, COUNT(*) OVER() AS total_count FROM papers p
       WHERE p.user_id=$1
       ORDER BY ${pinnedFirst('$4')} DESC, p.digest_date DESC, p.id DESC
       LIMIT $2 OFFSET $3`,
      [userId, lim, off, keptIds],
    );
    const total = rows.length > 0 ? Number(rows[0].total_count) : 0;
    return { papers: rows.map(rowToPaper), total };
  },

  // Library-wide aggregates for the Dashboard. The papers list is paginated, so
  // the client can no longer count everything itself; these queries scan only
  // the user's rows and return numbers, not paper bodies.
  async getStats(userId) {
    const [totals, reads, saves, cats, daily] = await Promise.all([
      pool.query(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE digest_date > now() - interval '30 days')::int AS last30,
                min(digest_date) AS first_date,
                max(digest_date) AS last_date
         FROM papers WHERE user_id=$1`,
        [userId],
      ),
      pool.query(`SELECT count(*)::int AS n FROM read_states WHERE user_id=$1`, [userId]),
      pool.query(`SELECT count(*)::int AS n FROM library WHERE user_id=$1`, [userId]),
      pool.query(
        `SELECT c AS category, count(*)::int AS count
         FROM papers p, unnest(p.categories) AS c
         WHERE p.user_id=$1
         GROUP BY c ORDER BY count DESC`,
        [userId],
      ),
      pool.query(
        `SELECT digest_date::date AS day, count(*)::int AS count
         FROM papers
         WHERE user_id=$1 AND digest_date > now() - interval '180 days'
         GROUP BY 1 ORDER BY 1`,
        [userId],
      ),
    ]);

    const t = totals.rows[0] ?? {};
    const total = t.total ?? 0;
    const read  = reads.rows[0]?.n ?? 0;
    const dayString = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

    return {
      total,
      read,
      unread: Math.max(0, total - read),
      saved: saves.rows[0]?.n ?? 0,
      last30: t.last30 ?? 0,
      firstDate: t.first_date ?? null,
      lastDate: t.last_date ?? null,
      categories: cats.rows.map(r => ({ category: r.category, count: r.count })),
      daily: daily.rows.map(r => ({ day: dayString(r.day), count: r.count })),
    };
  },

  // Existing rows for a set of arXiv IDs. Import uses this to dedupe against
  // the whole library, not just the page the client has loaded.
  async getExistingArxivIds(userId, arxivIds) {
    const ids = [...new Set((arxivIds ?? []).filter(Boolean))];
    if (ids.length === 0) return [];
    const { rows } = await pool.query(
      `SELECT DISTINCT regexp_replace(arxiv_id, 'v[0-9]+$', '') AS arxiv_id
       FROM papers
       WHERE user_id=$1 AND regexp_replace(arxiv_id, 'v[0-9]+$', '') = ANY($2::text[])`,
      [userId, ids.map(id => String(id).toLowerCase().replace(/v\d+$/i, ''))],
    );
    return rows.map(r => r.arxiv_id);
  },

  async upsertPapers(userId, papers) {
    if (papers.length === 0) return { inserted: 0, skipped: 0 };
    const client = await pool.connect();
    let inserted = 0;
    let skipped  = 0;
    try {
      // Fast path: one multi-row upsert per chunk (keyed on the (user_id, id)
      // PK). This turns "N papers = N round-trips" into N/CHUNK — the fix for
      // slow syncs / bulk imports, especially on a remote DB. If a chunk fails
      // (a bad row, or a different id colliding on the (user_id, arxiv_id)
      // unique constraint, which can't be handled by ON CONFLICT (id)), we fall
      // back to the per-row path for just that chunk so one row can't poison it.
      const CHUNK = 400;
      for (let i = 0; i < papers.length; i += CHUNK) {
        const chunk = papers.slice(i, i + CHUNK);
        try {
          const values = [];
          const params = [];
          for (const p of chunk) {
            const b = params.length;
            values.push(`($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10},$${b+11},$${b+12},$${b+13},$${b+14},$${b+15},$${b+16},$${b+17})`);
            params.push(
              p.id, userId, p.arxivId, p.title ?? '', p.authors ?? '', p.authorList ?? [], p.categories ?? [],
              p.abstract ?? '', p.comments ?? '', p.url ?? '', p.pdfUrl ?? '', p.size ?? '', p.date ?? '', p.emailId ?? '',
              p.digestSubject ?? '', p.digestDate ?? new Date().toISOString(), p.source ?? 'email',
            );
          }
          await client.query(
            `INSERT INTO papers (
               id, user_id, arxiv_id, title, authors, author_list, categories,
               abstract, comments, url, pdf_url, size, date, email_id,
               digest_subject, digest_date, source
             ) VALUES ${values.join(',')}
             ON CONFLICT (user_id, id) DO UPDATE SET
               arxiv_id=EXCLUDED.arxiv_id, title=EXCLUDED.title, authors=EXCLUDED.authors,
               author_list=EXCLUDED.author_list, categories=EXCLUDED.categories, abstract=EXCLUDED.abstract,
               comments=EXCLUDED.comments, url=EXCLUDED.url, pdf_url=EXCLUDED.pdf_url, size=EXCLUDED.size,
               date=EXCLUDED.date, email_id=EXCLUDED.email_id, digest_subject=EXCLUDED.digest_subject,
               digest_date=EXCLUDED.digest_date, source=EXCLUDED.source`,
            params,
          );
          inserted += chunk.length;
        } catch {
          const r = await upsertPapersPerRow(client, userId, chunk);
          inserted += r.inserted;
          skipped  += r.skipped;
        }
      }
      return { inserted, skipped };
    } finally {
      client.release();
    }
  },

  async updateAbstract(userId, paperId, abstract) {
    await pool.query(
      `UPDATE papers SET abstract=$3 WHERE user_id=$1 AND id=$2`,
      [userId, paperId, abstract],
    );
  },

  async getPaper(userId, id) {
    const { rows } = await pool.query(
      `SELECT id, arxiv_id, title, authors, author_list, categories,
              abstract, comments, url, pdf_url, size, date, email_id,
              digest_subject, digest_date, source,
              file_path, file_size, mime_type, original_filename, uploaded_at,
              (full_text IS NOT NULL) AS has_full_text,
              COALESCE(full_text_chars, 0) AS full_text_chars,
              organization
       FROM papers WHERE user_id=$1 AND id=$2`,
      [userId, id],
    );
    return rows[0] ? rowToPaper(rows[0]) : null;
  },

  async attachFileToPaper(userId, id, file) {
    await pool.query(
      `UPDATE papers
       SET file_path=$3, file_size=$4, mime_type=$5, original_filename=$6, uploaded_at=now()
       WHERE user_id=$1 AND id=$2`,
      [userId, id, file.path, file.size, file.mimetype, file.originalname],
    );
  },

  async clearPaperFile(userId, id) {
    await pool.query(
      `UPDATE papers
       SET file_path=NULL, file_size=NULL, mime_type=NULL, original_filename=NULL, uploaded_at=NULL
       WHERE user_id=$1 AND id=$2`,
      [userId, id],
    );
  },

  // Extracted plain text (from the cached PDF) is kept in its own column so
  // it can be searched / fed to AI without re-downloading or re-parsing.
  async setPaperFullText(userId, id, text) {
    // Postgres `text` rejects U+0000 — strip any that survived the extractor
    // rather than losing the whole document to an insert error.
    const body  = String(text ?? '').replace(/\u0000/g, '');
    const chars = body.length;
    await pool.query(
      `UPDATE papers
       SET full_text=$3, full_text_chars=$4, full_text_at=now(),
           organization=COALESCE(organization, $5),
           organization_checked_at=COALESCE(organization_checked_at, now())
       WHERE user_id=$1 AND id=$2`,
      [userId, id, body, chars, detectOrganization(body)],
    );
    return chars;
  },

  // Organization lookups (company/lab from the PDF's first page). A paper is
  // "checked" once we've read its first page, even if no company was found, so
  // it isn't downloaded again.
  async getOrganizations(userId, ids) {
    if (!Array.isArray(ids) || ids.length === 0) return [];
    const { rows } = await pool.query(
      `SELECT id, arxiv_id, organization, organization_checked_at
       FROM papers WHERE user_id=$1 AND id = ANY($2::text[])`,
      [userId, ids],
    );
    return rows.map(r => ({
      id: r.id,
      arxivId: r.arxiv_id,
      organization: r.organization ?? null,
      checked: !!r.organization_checked_at,
    }));
  },

  async setOrganization(userId, id, organization) {
    await pool.query(
      `UPDATE papers SET organization=$3, organization_checked_at=now()
       WHERE user_id=$1 AND id=$2`,
      [userId, id, organization ?? null],
    );
  },

  async getPaperFullText(userId, id) {
    const { rows } = await pool.query(
      `SELECT full_text, full_text_chars, full_text_at, file_path, original_filename
       FROM papers WHERE user_id=$1 AND id=$2`,
      [userId, id],
    );
    if (!rows[0]) return null;
    const r = rows[0];
    return {
      text:       r.full_text ?? '',
      ready:      r.full_text != null,
      chars:      r.full_text_chars ?? (r.full_text ? r.full_text.length : 0),
      extractedAt: r.full_text_at ? new Date(r.full_text_at).getTime() : null,
      hasFile:    !!r.file_path,
      originalFilename: r.original_filename ?? null,
    };
  },

  async clearPaperText(userId, id) {
    await pool.query(
      `UPDATE papers
       SET full_text=NULL, full_text_chars=NULL, full_text_at=NULL
       WHERE user_id=$1 AND id=$2`,
      [userId, id],
    );
  },

  // ----- library -----

  async getLibrary(userId) {
    const { rows } = await pool.query(
      `SELECT paper_id, saved_at FROM library WHERE user_id=$1`,
      [userId],
    );
    return rows.map(r => ({ paperId: r.paper_id, savedAt: r.saved_at }));
  },

  async savePaper(userId, paperId) {
    // The FK to papers means a library row can only exist if the paper
    // row exists. During a bulk migration the library list may include
    // ids whose paper rows were skipped (e.g. dedup'd duplicates), so we
    // tolerate the foreign-key violation and report it back to the caller.
    try {
      const r = await pool.query(
        `INSERT INTO library (user_id, paper_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING
         RETURNING paper_id`,
        [userId, paperId],
      );
      return { saved: r.rowCount > 0, reason: r.rowCount > 0 ? 'inserted' : 'already_saved' };
    } catch (e) {
      if (e.code === '23503') {
        console.warn(`[db] library save skipped: no paper row for id=${paperId}`);
        return { saved: false, reason: 'no_paper' };
      }
      throw e;
    }
  },

  async unsavePaper(userId, paperId) {
    await pool.query(`DELETE FROM library WHERE user_id=$1 AND paper_id=$2`, [userId, paperId]);
  },

  // ----- likes (distinct from library) -----

  async getLikes(userId) {
    const { rows } = await pool.query(
      `SELECT paper_id, liked_at FROM likes WHERE user_id=$1`,
      [userId],
    );
    return rows.map(r => ({ paperId: r.paper_id, likedAt: r.liked_at }));
  },

  async likePaper(userId, paperId) {
    try {
      const r = await pool.query(
        `INSERT INTO likes (user_id, paper_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING
         RETURNING paper_id`,
        [userId, paperId],
      );
      return { liked: r.rowCount > 0, reason: r.rowCount > 0 ? 'inserted' : 'already_liked' };
    } catch (e) {
      if (e.code === '23503') {
        console.warn(`[db] like skipped: no paper row for id=${paperId}`);
        return { liked: false, reason: 'no_paper' };
      }
      throw e;
    }
  },

  async unlikePaper(userId, paperId) {
    await pool.query(`DELETE FROM likes WHERE user_id=$1 AND paper_id=$2`, [userId, paperId]);
  },

  // ----- paper comments (dashboard feed) -----

  async getPaperComments(userId, paperId) {
    const { rows } = await pool.query(
      `SELECT id, paper_id, body, created_at
       FROM paper_comments
       WHERE user_id=$1 AND paper_id=$2
       ORDER BY created_at ASC`,
      [userId, paperId],
    );
    return rows.map(r => ({
      id: r.id,
      paperId: r.paper_id,
      body: r.body,
      createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
    }));
  },

  async addPaperComment(userId, paperId, body) {
    const text = String(body ?? '').trim().slice(0, 4000);
    if (!text) throw new Error('Comment is empty.');
    const { rows } = await pool.query(
      `INSERT INTO paper_comments (user_id, paper_id, body)
       VALUES ($1,$2,$3)
       RETURNING id, paper_id, body, created_at`,
      [userId, paperId, text],
    );
    const r = rows[0];
    return {
      id: r.id,
      paperId: r.paper_id,
      body: r.body,
      createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
    };
  },

  async deletePaperComment(userId, commentId) {
    const r = await pool.query(
      `DELETE FROM paper_comments WHERE user_id=$1 AND id=$2`,
      [userId, commentId],
    );
    return (r.rowCount ?? 0) > 0;
  },

  // Comment counts for a page of papers, in one query.
  async getCommentCounts(userId, paperIds) {
    if (!Array.isArray(paperIds) || paperIds.length === 0) return {};
    const { rows } = await pool.query(
      `SELECT paper_id, count(*)::int AS n
       FROM paper_comments
       WHERE user_id=$1 AND paper_id = ANY($2::text[])
       GROUP BY paper_id`,
      [userId, paperIds],
    );
    return Object.fromEntries(rows.map(r => [r.paper_id, r.n]));
  },

  // ----- read states -----

  async getReadIds(userId) {
    const { rows } = await pool.query(
      `SELECT paper_id FROM read_states WHERE user_id=$1`,
      [userId],
    );
    return rows.map(r => r.paper_id);
  },

  // Mark the whole library read in one statement — the client only holds a
  // window of papers, so it can't enumerate every id itself.
  async markAllRead(userId) {
    const r = await pool.query(
      `INSERT INTO read_states (user_id, paper_id)
       SELECT user_id, id FROM papers WHERE user_id=$1
       ON CONFLICT (user_id, paper_id) DO NOTHING`,
      [userId],
    );
    return r.rowCount ?? 0;
  },

  async setReadIds(userId, ids) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM read_states WHERE user_id=$1`, [userId]);
      if (ids.length > 0) {
        const values  = ids.map((_id, i) => `($1, $${i + 2})`).join(',');
        const params  = [userId, ...ids];
        await client.query(`INSERT INTO read_states (user_id, paper_id) VALUES ${values}`, params);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },

  // Incremental read-state updates. Opening a paper used to rewrite the whole
  // read_states table (tens of thousands of rows) on every click; these touch
  // only the papers that actually changed.
  async addReadIds(userId, ids) {
    if (!ids.length) return;
    // Postgres caps bind parameters at 65,535; chunk so "mark all read" on a
    // large inbox still works.
    const CHUNK = 5000;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk  = ids.slice(i, i + CHUNK);
      const values = chunk.map((_id, j) => `($1, $${j + 2})`).join(',');
      await pool.query(
        `INSERT INTO read_states (user_id, paper_id) VALUES ${values}
         ON CONFLICT (user_id, paper_id) DO NOTHING`,
        [userId, ...chunk],
      );
    }
  },

  async removeReadIds(userId, ids) {
    if (!ids.length) return;
    await pool.query(
      `DELETE FROM read_states WHERE user_id=$1 AND paper_id = ANY($2::text[])`,
      [userId, ids],
    );
  },

  // ----- trackers -----

  async getTrackers(userId) {
    const { rows } = await pool.query(
      `SELECT * FROM trackers WHERE user_id=$1 ORDER BY created_at`,
      [userId],
    );
    return rows.map(rowToTracker);
  },

  async upsertTracker(userId, t) {
    await pool.query(
      `INSERT INTO trackers (
         id, user_id, name, description, keywords, seed_arxiv_ids, enabled,
         color, min_score, auto_score_mode, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, to_timestamp($11/1000.0), to_timestamp($12/1000.0))
       ON CONFLICT (user_id, id) DO UPDATE SET
         name=$3, description=$4, keywords=$5, seed_arxiv_ids=$6, enabled=$7,
         color=$8, min_score=$9, auto_score_mode=$10, updated_at=to_timestamp($12/1000.0)`,
      [
        t.id, userId, t.name, t.description, t.keywords, t.seedArxivIds, t.enabled,
        t.color, t.minScore, t.autoScoreMode ?? 'manual', t.createdAt, t.updatedAt,
      ],
    );
  },

  async deleteTracker(userId, id) {
    await pool.query(`DELETE FROM trackers WHERE user_id=$1 AND id=$2`, [userId, id]);
  },

  // ----- scores -----

  async getScores(userId) {
    const { rows } = await pool.query(
      `SELECT paper_id, tracker_id, score, rationale, source, ts
       FROM paper_scores WHERE user_id=$1`,
      [userId],
    );
    return rows.map(r => ({
      id:        `${r.paper_id}:${r.tracker_id}`,
      paperId:   r.paper_id,
      trackerId: r.tracker_id,
      score:     r.score,
      rationale: r.rationale,
      source:    r.source,
      ts:        new Date(r.ts).getTime(),
    }));
  },

  async upsertScores(userId, scores) {
    if (scores.length === 0) return;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const s of scores) {
        await client.query(
          `INSERT INTO paper_scores (user_id, paper_id, tracker_id, score, rationale, source, ts)
           VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7/1000.0))
           ON CONFLICT (user_id, paper_id, tracker_id) DO UPDATE SET
             score=$4, rationale=$5, source=$6, ts=to_timestamp($7/1000.0)`,
          [userId, s.paperId, s.trackerId, s.score, s.rationale, s.source, s.ts],
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },

  async deleteScoresForTracker(userId, trackerId) {
    await pool.query(
      `DELETE FROM paper_scores WHERE user_id=$1 AND tracker_id=$2`,
      [userId, trackerId],
    );
  },

  // ----- books -----

  async getBooks(userId) {
    const { rows } = await pool.query(
      `SELECT * FROM books WHERE user_id=$1 ORDER BY updated_at DESC`,
      [userId],
    );
    return rows.map(rowToBook);
  },

  async upsertBook(userId, b) {
    await pool.query(
      `INSERT INTO books (
         id, user_id, title, authors, isbn, year, publisher, cover_url,
         abstract, notes, source_url, tags, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
                 to_timestamp($13/1000.0), to_timestamp($14/1000.0))
       ON CONFLICT (user_id, id) DO UPDATE SET
         title=$3, authors=$4, isbn=$5, year=$6, publisher=$7, cover_url=$8,
         abstract=$9, notes=$10, source_url=$11, tags=$12, updated_at=to_timestamp($14/1000.0)`,
      [
        b.id, userId, b.title, b.authors ?? [], b.isbn ?? null, b.year ?? null,
        b.publisher ?? null, b.coverUrl ?? null, b.abstract ?? '', b.notes ?? '',
        b.sourceUrl ?? null, b.tags ?? [], b.createdAt, b.updatedAt,
      ],
    );
  },

  async deleteBook(userId, id) {
    await pool.query(`DELETE FROM books WHERE user_id=$1 AND id=$2`, [userId, id]);
  },

  async getBook(userId, id) {
    const { rows } = await pool.query(
      `SELECT * FROM books WHERE user_id=$1 AND id=$2`,
      [userId, id],
    );
    return rows[0] ? rowToBook(rows[0]) : null;
  },

  async attachFileToBook(userId, id, file) {
    await pool.query(
      `UPDATE books
       SET file_path=$3, file_size=$4, mime_type=$5, original_filename=$6,
           uploaded_at=now(), updated_at=now()
       WHERE user_id=$1 AND id=$2`,
      [userId, id, file.path, file.size, file.mimetype, file.originalname],
    );
  },

  async clearBookFile(userId, id) {
    await pool.query(
      `UPDATE books
       SET file_path=NULL, file_size=NULL, mime_type=NULL,
           original_filename=NULL, uploaded_at=NULL, updated_at=now()
       WHERE user_id=$1 AND id=$2`,
      [userId, id],
    );
  },

  // ----- documents (Writer drafts) -----

  async getDocuments(userId) {
    const { rows } = await pool.query(
      `SELECT * FROM documents WHERE user_id=$1 ORDER BY updated_at DESC`,
      [userId],
    );
    return rows.map(rowToDocument);
  },

  async getDocument(userId, id) {
    const { rows } = await pool.query(
      `SELECT * FROM documents WHERE user_id=$1 AND id=$2`,
      [userId, id],
    );
    return rows[0] ? rowToDocument(rows[0]) : null;
  },

  async upsertDocument(userId, d) {
    const wc = wordCount(d.content ?? '');
    await pool.query(
      `INSERT INTO documents (
         id, user_id, title, content, paper_refs, book_refs, tags, status,
         word_count, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,
                 to_timestamp($10/1000.0), to_timestamp($11/1000.0))
       ON CONFLICT (user_id, id) DO UPDATE SET
         title=$3, content=$4, paper_refs=$5, book_refs=$6, tags=$7,
         status=$8, word_count=$9, updated_at=to_timestamp($11/1000.0)`,
      [
        d.id, userId, d.title ?? 'Untitled', d.content ?? '',
        d.paperRefs ?? [], d.bookRefs ?? [], d.tags ?? [], d.status ?? 'draft',
        wc, d.createdAt, d.updatedAt,
      ],
    );
  },

  async deleteDocument(userId, id) {
    await pool.query(`DELETE FROM documents WHERE user_id=$1 AND id=$2`, [userId, id]);
  },
};

function wordCount(s) {
  return String(s).trim() === '' ? 0 : String(s).trim().split(/\s+/).length;
}

// ----- collections -----

db.getCollections = async function (userId) {
  const colls = await pool.query(
    `SELECT * FROM collections WHERE user_id=$1 ORDER BY updated_at DESC`,
    [userId],
  );
  const items = await pool.query(
    `SELECT * FROM collection_items WHERE user_id=$1 ORDER BY position ASC, added_at ASC`,
    [userId],
  );
  const byColl = new Map();
  for (const r of items.rows) {
    const arr = byColl.get(r.collection_id) ?? [];
    arr.push({
      collectionId: r.collection_id,
      targetKind:   r.target_kind,
      targetId:     r.target_id,
      position:     r.position,
      status:       r.status,
      notes:        r.notes ?? '',
      addedAt:      new Date(r.added_at).getTime(),
    });
    byColl.set(r.collection_id, arr);
  }
  return colls.rows.map(r => ({
    id:          r.id,
    name:        r.name,
    description: r.description ?? '',
    color:       r.color,
    tags:        r.tags ?? [],
    kind:        r.kind,
    items:       byColl.get(r.id) ?? [],
    createdAt:   new Date(r.created_at).getTime(),
    updatedAt:   new Date(r.updated_at).getTime(),
  }));
};

db.upsertCollection = async function (userId, c) {
  await pool.query(
    `INSERT INTO collections (id, user_id, name, description, color, tags, kind,
       created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7, to_timestamp($8/1000.0), to_timestamp($9/1000.0))
     ON CONFLICT (user_id, id) DO UPDATE SET
       name=$3, description=$4, color=$5, tags=$6, kind=$7,
       updated_at=to_timestamp($9/1000.0)`,
    [c.id, userId, c.name, c.description ?? '', c.color ?? 'blue', c.tags ?? [],
     c.kind ?? 'collection', c.createdAt, c.updatedAt],
  );
};

db.deleteCollection = async function (userId, id) {
  await pool.query(`DELETE FROM collections WHERE user_id=$1 AND id=$2`, [userId, id]);
};

db.addCollectionItem = async function (userId, item) {
  // Auto-position: take max+1 within the collection unless caller supplied one
  let pos = item.position;
  if (pos == null) {
    const r = await pool.query(
      `SELECT COALESCE(MAX(position)+1, 0) AS next FROM collection_items
       WHERE user_id=$1 AND collection_id=$2`,
      [userId, item.collectionId],
    );
    pos = r.rows[0].next;
  }
  await pool.query(
    `INSERT INTO collection_items (user_id, collection_id, target_kind, target_id,
       position, status, notes, added_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7, now())
     ON CONFLICT (user_id, collection_id, target_kind, target_id) DO UPDATE SET
       position=$5, status=$6, notes=$7`,
    [userId, item.collectionId, item.targetKind, item.targetId, pos,
     item.status ?? 'unread', item.notes ?? ''],
  );
  await pool.query(
    `UPDATE collections SET updated_at=now() WHERE user_id=$1 AND id=$2`,
    [userId, item.collectionId],
  );
};

db.removeCollectionItem = async function (userId, collectionId, targetKind, targetId) {
  await pool.query(
    `DELETE FROM collection_items
     WHERE user_id=$1 AND collection_id=$2 AND target_kind=$3 AND target_id=$4`,
    [userId, collectionId, targetKind, targetId],
  );
  await pool.query(
    `UPDATE collections SET updated_at=now() WHERE user_id=$1 AND id=$2`,
    [userId, collectionId],
  );
};

db.updateCollectionItem = async function (userId, item) {
  await pool.query(
    `UPDATE collection_items
     SET status=COALESCE($5, status), notes=COALESCE($6, notes), position=COALESCE($7, position)
     WHERE user_id=$1 AND collection_id=$2 AND target_kind=$3 AND target_id=$4`,
    [userId, item.collectionId, item.targetKind, item.targetId,
     item.status ?? null, item.notes ?? null, item.position ?? null],
  );
};

// ----- links (cross-references) -----

db.getLinks = async function (userId) {
  const { rows } = await pool.query(
    `SELECT * FROM links WHERE user_id=$1 ORDER BY created_at DESC`, [userId],
  );
  return rows.map(r => ({
    sourceKind: r.source_kind,
    sourceId:   r.source_id,
    targetKind: r.target_kind,
    targetId:   r.target_id,
    rel:        r.rel,
    note:       r.note ?? '',
    createdAt:  new Date(r.created_at).getTime(),
  }));
};

db.addLink = async function (userId, link) {
  await pool.query(
    `INSERT INTO links (user_id, source_kind, source_id, target_kind, target_id, rel, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (user_id, source_kind, source_id, target_kind, target_id, rel)
       DO UPDATE SET note=$7`,
    [userId, link.sourceKind, link.sourceId, link.targetKind, link.targetId,
     link.rel ?? 'related', link.note ?? ''],
  );
};

db.deleteLink = async function (userId, link) {
  await pool.query(
    `DELETE FROM links
     WHERE user_id=$1 AND source_kind=$2 AND source_id=$3
       AND target_kind=$4 AND target_id=$5 AND rel=$6`,
    [userId, link.sourceKind, link.sourceId, link.targetKind, link.targetId, link.rel ?? 'related'],
  );
};

// (Old AI-correlations cache removed — see migration 005's paper_correlations
// table; it's now unused. The Similar Papers panel computes TF-IDF
// similarity client-side. The table is kept around to avoid a destructive
// migration; safe to DROP TABLE paper_correlations when convenient.)

// ----- magazine issues -----

db.listMagazineIssues = async function (userId, limit = 30) {
  const { rows } = await pool.query(
    `SELECT id, week_start, week_end, edition_number, title, subtitle,
            sources, ai_provider, created_at,
            jsonb_object_keys(content) AS section_key
     FROM magazine_issues
     WHERE user_id=$1
     ORDER BY week_start DESC, created_at DESC
     LIMIT $2`,
    [userId, limit],
  );
  // The jsonb_object_keys expansion creates one row per top-level key;
  // collapse back to one entry per issue with the section list.
  const byId = new Map();
  for (const r of rows) {
    let entry = byId.get(r.id);
    if (!entry) {
      entry = {
        id:            r.id,
        weekStart:     new Date(r.week_start).toISOString().slice(0, 10),
        weekEnd:       new Date(r.week_end).toISOString().slice(0, 10),
        editionNumber: r.edition_number,
        title:         r.title,
        subtitle:      r.subtitle ?? '',
        sources:       r.sources ?? [],
        aiProvider:    r.ai_provider ?? null,
        createdAt:     new Date(r.created_at).getTime(),
        sectionKeys:   [],
      };
      byId.set(r.id, entry);
    }
    if (r.section_key) entry.sectionKeys.push(r.section_key);
  }
  return [...byId.values()];
};

db.getMagazineIssue = async function (userId, id) {
  const { rows } = await pool.query(
    `SELECT * FROM magazine_issues WHERE user_id=$1 AND id=$2`,
    [userId, id],
  );
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    id:            r.id,
    weekStart:     new Date(r.week_start).toISOString().slice(0, 10),
    weekEnd:       new Date(r.week_end).toISOString().slice(0, 10),
    editionNumber: r.edition_number,
    title:         r.title,
    subtitle:      r.subtitle ?? '',
    content:       r.content,
    sources:       r.sources ?? [],
    aiProvider:    r.ai_provider ?? null,
    createdAt:     new Date(r.created_at).getTime(),
  };
};

db.nextMagazineEdition = async function (userId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(MAX(edition_number), 0) + 1 AS n
     FROM magazine_issues WHERE user_id=$1`,
    [userId],
  );
  return rows[0]?.n ?? 1;
};

db.insertMagazineIssue = async function (userId, issue) {
  // Upsert: re-saving an existing issue (e.g. attaching/regenerating an
  // editorial via PUT /api/db/magazine/:id) must update in place rather
  // than collide on the primary key. The conflict target matches the
  // table's composite primary key (user_id, id) exactly.
  await pool.query(
    `INSERT INTO magazine_issues
       (id, user_id, week_start, week_end, edition_number, title, subtitle,
        content, sources, ai_provider)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)
     ON CONFLICT (user_id, id) DO UPDATE SET
       week_start     = EXCLUDED.week_start,
       week_end       = EXCLUDED.week_end,
       edition_number = EXCLUDED.edition_number,
       title          = EXCLUDED.title,
       subtitle       = EXCLUDED.subtitle,
       content        = EXCLUDED.content,
       sources        = EXCLUDED.sources,
       ai_provider    = EXCLUDED.ai_provider`,
    [
      issue.id, userId, issue.weekStart, issue.weekEnd, issue.editionNumber,
      issue.title, issue.subtitle ?? '', JSON.stringify(issue.content),
      issue.sources ?? [], issue.aiProvider ?? null,
    ],
  );
};

db.deleteMagazineIssue = async function (userId, id) {
  await pool.query(`DELETE FROM magazine_issues WHERE user_id=$1 AND id=$2`, [userId, id]);
};

// ----- user preferences (Magazine auto-gen) -----

db.getUserMagazinePrefs = async function (userId) {
  const { rows } = await pool.query(
    `SELECT email, magazine_auto, magazine_day_of_week, magazine_hour,
            magazine_sources, magazine_last_auto_run
     FROM users WHERE id=$1`,
    [userId],
  );
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    email:        r.email,
    auto:         r.magazine_auto,
    dayOfWeek:    r.magazine_day_of_week,
    hour:         r.magazine_hour,
    sources:      r.magazine_sources ?? [],
    lastAutoRun:  r.magazine_last_auto_run ? new Date(r.magazine_last_auto_run).getTime() : null,
  };
};

db.setUserMagazinePrefs = async function (userId, prefs) {
  await pool.query(
    `UPDATE users SET
       magazine_auto         = COALESCE($2, magazine_auto),
       magazine_day_of_week  = COALESCE($3, magazine_day_of_week),
       magazine_hour         = COALESCE($4, magazine_hour),
       magazine_sources      = COALESCE($5, magazine_sources)
     WHERE id=$1`,
    [userId, prefs.auto ?? null, prefs.dayOfWeek ?? null, prefs.hour ?? null, prefs.sources ?? null],
  );
};

db.markMagazineAutoRun = async function (userId, ts = new Date()) {
  await pool.query(
    `UPDATE users SET magazine_last_auto_run=$2 WHERE id=$1`,
    [userId, ts],
  );
};

// Users due for an auto-generated issue: opted in, on the right day-of-week,
// and either never run or run >6 days ago.
db.dueMagazineUsers = async function () {
  const { rows } = await pool.query(
    `SELECT id, email, magazine_day_of_week, magazine_hour, magazine_sources,
            magazine_last_auto_run
     FROM users
     WHERE magazine_auto IS TRUE
       AND EXTRACT(ISODOW FROM now() AT TIME ZONE 'UTC') = magazine_day_of_week
       AND EXTRACT(HOUR  FROM now() AT TIME ZONE 'UTC') >= magazine_hour
       AND (magazine_last_auto_run IS NULL
            OR magazine_last_auto_run < now() - interval '6 days')`,
  );
  return rows.map(r => ({
    id:           r.id,
    email:        r.email,
    dayOfWeek:    r.magazine_day_of_week,
    hour:         r.magazine_hour,
    sources:      r.magazine_sources ?? [],
    lastAutoRun:  r.magazine_last_auto_run ? new Date(r.magazine_last_auto_run).getTime() : null,
  }));
};

// Recently-arrived papers (by digest_date) for the magazine's inbox digest.
// `limit` caps the rows returned (the magazine only renders ~6 papers and
// the AI editorial only sees the top 8) so we don't ship megabytes of
// abstracts the client will throw away. Total count is returned separately
// so the magazine header can show "X this week".
db.papersForWeek = async function (userId, weekStartIso, weekEndIso, limit = 200) {
  const cap = Math.min(Math.max(parseInt(String(limit), 10) || 200, 1), 500);
  const [rowsRes, countRes] = await Promise.all([
    pool.query(
      `SELECT id, arxiv_id, title, authors, author_list, categories,
              abstract, comments, url, pdf_url, size, date, email_id,
              digest_subject, digest_date, source
       FROM papers
       WHERE user_id=$1
         AND digest_date >= $2::date
         AND digest_date <  ($3::date + interval '1 day')
       ORDER BY digest_date DESC
       LIMIT $4`,
      [userId, weekStartIso, weekEndIso, cap],
    ),
    pool.query(
      `SELECT COUNT(*)::int AS n FROM papers
       WHERE user_id=$1
         AND digest_date >= $2::date
         AND digest_date <  ($3::date + interval '1 day')`,
      [userId, weekStartIso, weekEndIso],
    ),
  ]);
  const papers = rowsRes.rows.map(r => ({
    id:            r.id,
    arxivId:       r.arxiv_id,
    title:         r.title,
    authors:       r.authors,
    authorList:    r.author_list ?? [],
    categories:    r.categories ?? [],
    abstract:      r.abstract ?? '',
    comments:      r.comments ?? '',
    url:           r.url ?? '',
    pdfUrl:        r.pdf_url ?? '',
    size:          r.size ?? '',
    date:          r.date ?? '',
    emailId:       r.email_id ?? '',
    digestSubject: r.digest_subject ?? '',
    digestDate:    new Date(r.digest_date).toISOString(),
    source:        r.source ?? 'email',
  }));
  return { papers, total: countRes.rows[0]?.n ?? papers.length };
};

// ----- global search -----
//
// Cross-table search using ILIKE on a few high-signal fields per kind.
// We don't yet have a real text-search index — switching to tsvector
// is a clean follow-up if performance becomes a concern, but for the
// sizes we're dealing with (one user's library) ILIKE is plenty fast.
db.globalSearch = async function (userId, query, limit = 40) {
  const q = `%${query.toLowerCase()}%`;
  const { rows } = await pool.query(
    `
    WITH found AS (
      SELECT 'paper'::text       AS kind,
             id::text             AS id,
             title                AS title,
             COALESCE(abstract, '') AS snippet,
             arxiv_id             AS sub,
             EXTRACT(EPOCH FROM digest_date)*1000 AS ts
      FROM papers
      WHERE user_id = $1
        AND (lower(title) LIKE $2 OR lower(abstract) LIKE $2 OR lower(authors) LIKE $2 OR arxiv_id LIKE $2
             OR (full_text IS NOT NULL AND lower(full_text) LIKE $2))

      UNION ALL

      SELECT 'book',  id::text, title,
             COALESCE(notes, abstract, ''),
             COALESCE(array_to_string(authors, ', '), ''),
             EXTRACT(EPOCH FROM updated_at)*1000
      FROM books
      WHERE user_id = $1
        AND (lower(title) LIKE $2 OR lower(coalesce(notes,'')) LIKE $2 OR lower(coalesce(abstract,'')) LIKE $2 OR lower(array_to_string(authors, ' ')) LIKE $2)

      UNION ALL

      SELECT 'document', id::text, title, content,
             status,
             EXTRACT(EPOCH FROM updated_at)*1000
      FROM documents
      WHERE user_id = $1
        AND (lower(title) LIKE $2 OR lower(content) LIKE $2)

      UNION ALL

      SELECT 'collection', id::text, name, description,
             kind::text,
             EXTRACT(EPOCH FROM updated_at)*1000
      FROM collections
      WHERE user_id = $1
        AND (lower(name) LIKE $2 OR lower(coalesce(description,'')) LIKE $2 OR lower(array_to_string(tags, ' ')) LIKE $2)

      UNION ALL

      SELECT 'magazine', id::text, title,
             COALESCE(subtitle, ''),
             week_start::text,
             EXTRACT(EPOCH FROM created_at)*1000
      FROM magazine_issues
      WHERE user_id = $1
        AND (lower(title) LIKE $2 OR lower(coalesce(subtitle,'')) LIKE $2 OR content::text ILIKE $2)
    )
    SELECT * FROM found ORDER BY ts DESC NULLS LAST LIMIT $3
    `,
    [userId, q, limit],
  );
  return rows.map(r => ({
    kind:    r.kind,
    id:      r.id,
    title:   r.title,
    snippet: (r.snippet ?? '').slice(0, 200),
    sub:     r.sub ?? '',
    ts:      r.ts ? Number(r.ts) : null,
  }));
};


function rowToBook(r) {
  return {
    id:               r.id,
    title:            r.title,
    authors:          r.authors ?? [],
    isbn:             r.isbn,
    year:             r.year,
    publisher:        r.publisher,
    coverUrl:         r.cover_url,
    abstract:         r.abstract ?? '',
    notes:            r.notes ?? '',
    sourceUrl:        r.source_url,
    tags:             r.tags ?? [],
    filePath:         r.file_path ?? null,
    fileSize:         r.file_size ? Number(r.file_size) : null,
    mimeType:         r.mime_type ?? null,
    originalFilename: r.original_filename ?? null,
    uploadedAt:       r.uploaded_at ? new Date(r.uploaded_at).getTime() : null,
    createdAt:        new Date(r.created_at).getTime(),
    updatedAt:        new Date(r.updated_at).getTime(),
  };
}

function rowToDocument(r) {
  return {
    id:         r.id,
    title:      r.title,
    content:    r.content ?? '',
    paperRefs:  r.paper_refs ?? [],
    bookRefs:   r.book_refs ?? [],
    tags:       r.tags ?? [],
    status:     r.status,
    wordCount:  r.word_count ?? 0,
    createdAt:  new Date(r.created_at).getTime(),
    updatedAt:  new Date(r.updated_at).getTime(),
  };
}

// ----- row → typed object mappers -----

// Per-row upsert fallback for upsertPapers: tolerant of a single bad row and
// of (user_id, arxiv_id) collisions (a different id pointing at an arxiv id we
// already store), which the fast multi-row path can't resolve via ON CONFLICT.
async function upsertPapersPerRow(client, userId, papers) {
  let inserted = 0;
  let skipped  = 0;
  for (const p of papers) {
    const params = [
      p.id, userId, p.arxivId, p.title ?? '', p.authors ?? '', p.authorList ?? [], p.categories ?? [],
      p.abstract ?? '', p.comments ?? '', p.url ?? '', p.pdfUrl ?? '', p.size ?? '', p.date ?? '', p.emailId ?? '',
      p.digestSubject ?? '', p.digestDate ?? new Date().toISOString(), p.source ?? 'email',
    ];
    try {
      await client.query(
        `INSERT INTO papers (
           id, user_id, arxiv_id, title, authors, author_list, categories,
           abstract, comments, url, pdf_url, size, date, email_id,
           digest_subject, digest_date, source
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         ON CONFLICT (user_id, id) DO UPDATE SET
           arxiv_id=$3, title=$4, authors=$5, author_list=$6, categories=$7,
           abstract=$8, comments=$9, url=$10, pdf_url=$11, size=$12, date=$13,
           email_id=$14, digest_subject=$15, digest_date=$16, source=$17`,
        params,
      );
      inserted++;
    } catch (e) {
      if (e.code === '23505' && /arxiv_id/.test(e.constraint ?? '')) {
        await client.query(
          `UPDATE papers SET
             title=$3, authors=$4, author_list=$5, categories=$6,
             abstract=COALESCE(NULLIF($7, ''), abstract),
             comments=$8, url=$9, pdf_url=$10, size=$11, date=$12,
             email_id=$13, digest_subject=$14, digest_date=$15, source=$16
           WHERE user_id=$1 AND arxiv_id=$2`,
          [
            userId, p.arxivId, p.title ?? '', p.authors ?? '', p.authorList ?? [], p.categories ?? [],
            p.abstract ?? '', p.comments ?? '', p.url ?? '', p.pdfUrl ?? '', p.size ?? '', p.date ?? '', p.emailId ?? '',
            p.digestSubject ?? '', p.digestDate ?? new Date().toISOString(), p.source ?? 'email',
          ],
        );
        skipped++;
        continue;
      }
      console.warn(`[db] paper ${p.id} (arxiv:${p.arxivId}) skipped: ${e.message}`);
      skipped++;
    }
  }
  return { inserted, skipped };
}

function rowToPaper(r) {
  return {
    id:            r.id,
    arxivId:       r.arxiv_id,
    title:         r.title,
    authors:       r.authors,
    authorList:    r.author_list ?? [],
    categories:    r.categories ?? [],
    abstract:      r.abstract ?? '',
    comments:      r.comments ?? '',
    url:           r.url ?? '',
    pdfUrl:        r.pdf_url ?? '',
    size:          r.size ?? '',
    date:          r.date ?? '',
    emailId:       r.email_id ?? '',
    digestSubject: r.digest_subject ?? '',
    digestDate:    r.digest_date,
    source:        r.source ?? 'email',
    // Locally-uploaded / cached PDF (null for a paper with no document yet)
    filePath:         r.file_path ?? null,
    fileSize:         r.file_size != null ? Number(r.file_size) : null,
    mimeType:         r.mime_type ?? null,
    originalFilename: r.original_filename ?? null,
    uploadedAt:       r.uploaded_at ? new Date(r.uploaded_at).getTime() : null,
    // Extracted full text lives in the DB, but only as a flag in list payloads
    hasFullText:      !!r.has_full_text,
    fullTextChars:    Number(r.full_text_chars ?? 0),
    // Company or lab from the PDF's affiliations (null = unknown / not read yet)
    organization:     r.organization ?? null,
  };
}

function rowToTracker(r) {
  return {
    id:            r.id,
    name:          r.name,
    description:   r.description ?? '',
    keywords:      r.keywords ?? [],
    seedArxivIds:  r.seed_arxiv_ids ?? [],
    enabled:       r.enabled,
    color:         r.color,
    minScore:      r.min_score,
    autoScoreMode: r.auto_score_mode ?? 'manual',
    createdAt:     new Date(r.created_at).getTime(),
    updatedAt:     new Date(r.updated_at).getTime(),
  };
}
