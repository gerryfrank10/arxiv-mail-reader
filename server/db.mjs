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
    if (papers.length === 0) return { inserted: 0, skipped: 0 };
    // Each row gets its own savepoint-style attempt so duplicates or bad
    // rows don't poison the whole batch. We try the id-keyed upsert first;
    // if that hits the (user_id, arxiv_id) UNIQUE constraint (i.e. two
    // distinct internal ids pointing at the same arxiv id) we fall back to
    // an arxiv_id-keyed UPDATE that touches everything except the id.
    const client = await pool.connect();
    let inserted = 0;
    let skipped  = 0;
    try {
      for (const p of papers) {
        const params = [
          p.id, userId, p.arxivId, p.title, p.authors, p.authorList, p.categories,
          p.abstract, p.comments, p.url, p.pdfUrl, p.size, p.date, p.emailId,
          p.digestSubject, p.digestDate, p.source ?? 'email',
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
          // 23505 = unique_violation. The only one we care about here is
          // (user_id, arxiv_id) — a different internal id pointing at an
          // arxiv id we already have. Update by arxiv_id and move on.
          if (e.code === '23505' && /arxiv_id/.test(e.constraint ?? '')) {
            // Update by arxiv_id. Note we DON'T pass p.id here — PostgreSQL
            // can't infer the type of an unused $1, and we want to leave
            // the existing row's primary key alone anyway.
            await client.query(
              `UPDATE papers SET
                 title=$3, authors=$4, author_list=$5, categories=$6,
                 abstract=COALESCE(NULLIF($7, ''), abstract),
                 comments=$8, url=$9, pdf_url=$10, size=$11, date=$12,
                 email_id=$13, digest_subject=$14, digest_date=$15, source=$16
               WHERE user_id=$1 AND arxiv_id=$2`,
              [
                userId, p.arxivId, p.title, p.authors, p.authorList, p.categories,
                p.abstract, p.comments, p.url, p.pdfUrl, p.size, p.date, p.emailId,
                p.digestSubject, p.digestDate, p.source ?? 'email',
              ],
            );
            skipped++;
            continue;
          }
          // Anything else: log + skip, don't kill the whole batch
          console.warn(`[db] paper ${p.id} (arxiv:${p.arxivId}) skipped: ${e.message}`);
          skipped++;
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
        AND (lower(title) LIKE $2 OR lower(abstract) LIKE $2 OR lower(authors) LIKE $2 OR arxiv_id LIKE $2)

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
