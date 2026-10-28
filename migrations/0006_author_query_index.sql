-- Case-folded author predicates must not scan all historic reviews/posts.
-- post_id covers the join used by reviewHealth without changing its results.
CREATE INDEX IF NOT EXISTS idx_posts_author_folded ON posts(lower(author), post_id);
