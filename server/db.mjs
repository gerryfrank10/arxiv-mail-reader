// Postgres helpers for arxiv-mail-reader.
//
// All queries are scoped by user_id, which is resolved from the
// X-User-Email header (set by the client; we look up or create the row).
//
// If DATABASE_URL isn't set the export is a no-op `db.enabled === false`
// and the server simply doesn't mount the /api/db/* routes.

import pg from 'pg';

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
        return true;
      }
    } catch (e) {
      console.error('[db] connection failed:', e.message);
      pool = null;
      return false;
    }
  },

  // ----- user resolution -----

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

  async getPapers(userId) {
    const { rows } = await pool.query(
      `SELECT * FROM papers WHERE user_id=$1 ORDER BY digest_date DESC`,
      [userId],
    );
    return rows.map(rowToPaper);
  },

  async upsertPapers(userId, papers) {
    if (papers.length === 0) return;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const p of papers) {
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
          [
            p.id, userId, p.arxivId, p.title, p.authors, p.authorList, p.categories,
            p.abstract, p.comments, p.url, p.pdfUrl, p.size, p.date, p.emailId,
            p.digestSubject, p.digestDate, p.source ?? 'email',
          ],
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

  async updateAbstract(userId, paperId, abstract) {
    await pool.query(
      `UPDATE papers SET abstract=$3 WHERE user_id=$1 AND id=$2`,
      [userId, paperId, abstract],
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
    await pool.query(
      `INSERT INTO library (user_id, paper_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [userId, paperId],
    );
  },

  async unsavePaper(userId, paperId) {
    await pool.query(`DELETE FROM library WHERE user_id=$1 AND paper_id=$2`, [userId, paperId]);
  },

  // ----- read states -----

  async getReadIds(userId) {
    const { rows } = await pool.query(
      `SELECT paper_id FROM read_states WHERE user_id=$1`,
      [userId],
    );
    return rows.map(r => r.paper_id);
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
         color, min_score, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, to_timestamp($10/1000.0), to_timestamp($11/1000.0))
       ON CONFLICT (user_id, id) DO UPDATE SET
         name=$3, description=$4, keywords=$5, seed_arxiv_ids=$6, enabled=$7,
         color=$8, min_score=$9, updated_at=to_timestamp($11/1000.0)`,
      [
        t.id, userId, t.name, t.description, t.keywords, t.seedArxivIds, t.enabled,
        t.color, t.minScore, t.createdAt, t.updatedAt,
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
};

// ----- row → typed object mappers -----

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
  };
}

function rowToTracker(r) {
  return {
    id:           r.id,
    name:         r.name,
    description:  r.description ?? '',
    keywords:     r.keywords ?? [],
    seedArxivIds: r.seed_arxiv_ids ?? [],
    enabled:      r.enabled,
    color:        r.color,
    minScore:     r.min_score,
    createdAt:    new Date(r.created_at).getTime(),
    updatedAt:    new Date(r.updated_at).getTime(),
  };
}
