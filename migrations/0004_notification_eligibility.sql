-- Historical imports remain silent; only an incremental poll opts a new post in.
ALTER TABLE posts ADD COLUMN notification_eligible INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_posts_notification_eligible ON posts(notification_eligible, first_seen_at);
