CREATE TABLE IF NOT EXISTS site_counters (
  name TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO site_counters(name) VALUES ('visits'), ('likes');

CREATE TABLE IF NOT EXISTS site_counter_actions (
  kind TEXT NOT NULL CHECK (kind IN ('visits', 'likes')),
  visitor_id TEXT NOT NULL,
  period TEXT NOT NULL,
  PRIMARY KEY(kind, visitor_id, period)
);
CREATE TRIGGER IF NOT EXISTS site_counter_increment
AFTER INSERT ON site_counter_actions BEGIN
  UPDATE site_counters SET count = count + 1 WHERE name = NEW.kind;
END;
