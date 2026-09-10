CREATE TABLE model_reviews (
  post_id TEXT PRIMARY KEY REFERENCES posts(post_id),
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  reviewed_at TEXT,
  model TEXT,
  prompt_version TEXT,
  result_json TEXT,
  last_error TEXT
);
CREATE INDEX idx_reviews_pending ON model_reviews(status, next_attempt_at);
