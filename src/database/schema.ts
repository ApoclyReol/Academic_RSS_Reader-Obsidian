export const SCHEMA_VERSION = 5;

export interface SchemaMigration {
  version: number;
  statements: readonly string[];
}

export const SCHEMA_MIGRATIONS: readonly SchemaMigration[] = [
  {
    version: 2,
    statements: [
      "ALTER TABLE feeds ADD COLUMN etag TEXT",
      "ALTER TABLE feeds ADD COLUMN last_modified TEXT",
      "ALTER TABLE feeds ADD COLUMN last_success_at TEXT",
      "ALTER TABLE feeds ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE feeds ADD COLUMN health_status TEXT NOT NULL DEFAULT 'healthy'",
      "ALTER TABLE feeds ADD COLUMN next_auto_update_at TEXT",
    ],
  },
  {
    version: 3,
    statements: [
      "ALTER TABLE recommendation_models ADD COLUMN intercept REAL NOT NULL DEFAULT 0",
      "ALTER TABLE recommendation_models ADD COLUMN training_hash TEXT",
      "ALTER TABLE recommendation_models ADD COLUMN validation_accuracy REAL",
      "ALTER TABLE recommendation_models ADD COLUMN suggested_low_threshold REAL NOT NULL DEFAULT 30",
      "ALTER TABLE recommendation_models ADD COLUMN suggested_high_threshold REAL NOT NULL DEFAULT 70",
      "ALTER TABLE recommendation_models ADD COLUMN feature_version INTEGER NOT NULL DEFAULT 1",
      "ALTER TABLE recommendation_keywords ADD COLUMN idf REAL NOT NULL DEFAULT 1",
    ],
  },
  {
    version: 4,
    statements: [
      "ALTER TABLE feeds ADD COLUMN journal_name TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE items RENAME COLUMN journal TO article_journal",
      "UPDATE feeds SET journal_name=name",
      "UPDATE items SET article_journal=NULL",
      "CREATE INDEX IF NOT EXISTS idx_items_doi ON items(doi)",
      "CREATE INDEX IF NOT EXISTS idx_items_link ON items(link)",
      "CREATE INDEX IF NOT EXISTS idx_items_identity_fallback ON items(title_norm, authors, year)",
      "CREATE INDEX IF NOT EXISTS idx_items_identity_fallback_journal ON items(title_norm, authors, year, article_journal)",
    ],
  },
  {
    version: 5,
    statements: [
      "ALTER TABLE items ADD COLUMN image_url TEXT",
    ],
  },
];

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

INSERT OR IGNORE INTO schema_migrations(version) VALUES (1);
`;
