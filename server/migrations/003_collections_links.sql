-- v3: Collections (themed bundles of papers + books + documents) and Links
-- (generic typed cross-references between any two entities).
--
-- Together these unlock the "research workstation" use cases: build
-- learning paths, group related work, and surface "what links to what"
-- in every detail view.

CREATE TABLE IF NOT EXISTS collections (
  id           TEXT         NOT NULL,
  user_id      UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT         NOT NULL,
  description  TEXT         NOT NULL DEFAULT '',
  color        TEXT         NOT NULL DEFAULT 'blue',
  tags         TEXT[]       NOT NULL DEFAULT '{}',
  kind         TEXT         NOT NULL DEFAULT 'collection',  -- 'collection' | 'learning_path'
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS idx_collections_user_updated ON collections (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS collection_items (
  user_id        UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  collection_id  TEXT         NOT NULL,
  target_kind    TEXT         NOT NULL CHECK (target_kind IN ('paper','book','document')),
  target_id      TEXT         NOT NULL,
  position       INTEGER      NOT NULL DEFAULT 0,
  status         TEXT         NOT NULL DEFAULT 'unread',  -- 'unread' | 'in_progress' | 'done'
  notes          TEXT         NOT NULL DEFAULT '',
  added_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, collection_id, target_kind, target_id),
  FOREIGN KEY (user_id, collection_id) REFERENCES collections (user_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_collection_items_user_coll_pos
  ON collection_items (user_id, collection_id, position);
CREATE INDEX IF NOT EXISTS idx_collection_items_target
  ON collection_items (user_id, target_kind, target_id);

-- Generic typed cross-references. Bi-directional traversal happens at the
-- query layer (we just join twice). Same (source, target, rel) cannot
-- repeat — that's what the PRIMARY KEY enforces.
CREATE TABLE IF NOT EXISTS links (
  user_id      UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_kind  TEXT         NOT NULL CHECK (source_kind IN ('paper','book','document')),
  source_id    TEXT         NOT NULL,
  target_kind  TEXT         NOT NULL CHECK (target_kind IN ('paper','book','document')),
  target_id    TEXT         NOT NULL,
  rel          TEXT         NOT NULL DEFAULT 'related',  -- 'related' | 'cites' | 'extends' | 'contradicts' | 'background'
  note         TEXT         NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, source_kind, source_id, target_kind, target_id, rel)
);
CREATE INDEX IF NOT EXISTS idx_links_source ON links (user_id, source_kind, source_id);
CREATE INDEX IF NOT EXISTS idx_links_target ON links (user_id, target_kind, target_id);
