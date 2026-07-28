export const SCHEMA_VERSION = 1;

export const CREATE_SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS feeds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_checked_at TEXT,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stable_guid TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  title_norm TEXT NOT NULL,
  authors TEXT,
  journal TEXT,
  year TEXT,
  doi TEXT,
  link TEXT,
  pub_date TEXT,
  summary TEXT,
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  item_status TEXT NOT NULL DEFAULT 'unread'
);

CREATE TABLE IF NOT EXISTS item_feeds (
  item_id INTEGER NOT NULL,
  feed_id INTEGER NOT NULL,
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (item_id, feed_id),
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
  FOREIGN KEY (feed_id) REFERENCES feeds(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS recommendation_scores (
  item_id INTEGER PRIMARY KEY,
  keyword_score REAL,
  keyword_tier TEXT,
  final_tier TEXT,
  llm_tier TEXT,
  llm_error TEXT,
  matched_keywords TEXT NOT NULL DEFAULT '[]',
  model_version TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  scored_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  llm_reviewed_at TEXT,
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS recommendation_keywords (
  keyword TEXT PRIMARY KEY,
  auto_weight REAL NOT NULL DEFAULT 0,
  positive_count INTEGER NOT NULL DEFAULT 0,
  negative_count INTEGER NOT NULL DEFAULT 0,
  manual_direction TEXT,
  manual_weight REAL,
  is_disabled INTEGER NOT NULL DEFAULT 0,
  model_version TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS recommendation_models (
  model_version TEXT PRIMARY KEY,
  positive_count INTEGER NOT NULL,
  negative_count INTEGER NOT NULL,
  unread_count INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS translations (
  item_id INTEGER NOT NULL,
  field TEXT NOT NULL CHECK(field IN ('title', 'abstract')),
  source_text TEXT NOT NULL,
  translated_text TEXT,
  source_language TEXT,
  target_language TEXT NOT NULL,
  provider TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'translating', 'succeeded', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  translated_at INTEGER,
  PRIMARY KEY (item_id, field, target_language),
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS app_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_items_title_norm ON items(title_norm);
CREATE INDEX IF NOT EXISTS idx_items_status ON items(item_status);
CREATE INDEX IF NOT EXISTS idx_item_feeds_feed ON item_feeds(feed_id);
CREATE INDEX IF NOT EXISTS idx_recommendation_scores_tier
  ON recommendation_scores(final_tier);
CREATE INDEX IF NOT EXISTS idx_translations_status
  ON translations(status, field);

INSERT OR IGNORE INTO schema_migrations(version) VALUES (${SCHEMA_VERSION});
`;
