-- Keep historical counters and actions intact. New session/daily state starts at rollout.
CREATE TABLE IF NOT EXISTS site_visit_sessions (
  visitor_id TEXT PRIMARY KEY,
  last_seen_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS site_daily_visitors (
  visitor_id TEXT NOT NULL,
  day TEXT NOT NULL,
  PRIMARY KEY (visitor_id, day)
);
CREATE INDEX IF NOT EXISTS site_daily_visitors_day ON site_daily_visitors(day);
-- Preserve today's already recorded browsers across the cutover.
INSERT OR IGNORE INTO site_daily_visitors(visitor_id,day)
  SELECT visitor_id,period FROM site_counter_actions
  WHERE kind='visits' AND period=date('now','+8 hours');
