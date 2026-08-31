CREATE TABLE IF NOT EXISTS source_state (
  name TEXT PRIMARY KEY,
  lane TEXT NOT NULL,
  query TEXT NOT NULL,
  poll_seconds INTEGER NOT NULL,
  since_id TEXT,
  primed_at TEXT,
  last_attempt_at TEXT,
  last_success_at TEXT,
  last_error TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  next_poll_at TEXT
);

CREATE TABLE IF NOT EXISTS posts (
  post_id TEXT PRIMARY KEY,
  author TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  url TEXT NOT NULL,
  lane TEXT NOT NULL,
  source_tier TEXT NOT NULL,
  source_weight REAL NOT NULL,
  referenced_post_ids TEXT NOT NULL DEFAULT '[]',
  linked_urls TEXT NOT NULL DEFAULT '[]',
  raw_json TEXT NOT NULL,
  first_seen_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author, created_at DESC);

CREATE TABLE IF NOT EXISTS signals (
  signal_id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts(post_id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  reset_mode TEXT NOT NULL,
  severity TEXT NOT NULL,
  confidence REAL NOT NULL,
  content_confidence REAL NOT NULL,
  evidence_basis TEXT NOT NULL,
  effective_time TEXT,
  approximate_time INTEGER NOT NULL DEFAULT 0,
  cluster_key TEXT NOT NULL,
  superseded_by_post_id TEXT,
  should_notify INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  evidence TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_signals_created_at ON signals(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signals_cluster ON signals(cluster_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signals_notify ON signals(should_notify, severity, created_at DESC);

CREATE TABLE IF NOT EXISTS deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  signal_id TEXT NOT NULL REFERENCES signals(signal_id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  destination_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  last_error TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  UNIQUE(signal_id, channel, destination_hash)
);

CREATE INDEX IF NOT EXISTS idx_deliveries_pending ON deliveries(status, next_attempt_at);

CREATE TABLE IF NOT EXISTS poll_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  query_names TEXT NOT NULL DEFAULT '[]',
  fetched_count INTEGER NOT NULL DEFAULT 0,
  inserted_count INTEGER NOT NULL DEFAULT 0,
  relevant_count INTEGER NOT NULL DEFAULT 0,
  notified_count INTEGER NOT NULL DEFAULT 0,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_poll_runs_started ON poll_runs(started_at DESC);

CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
