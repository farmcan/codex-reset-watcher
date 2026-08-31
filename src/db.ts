import { QUERY_SPECS } from "./config";
import type { Env, PollSummary, RawPost, Signal, SourceStateRow } from "./types";

export async function ensureSourceState(db: D1Database): Promise<void> {
  const statement = db.prepare(`
    INSERT OR IGNORE INTO source_state (name, lane, query, poll_seconds)
    VALUES (?, ?, ?, ?)
  `);
  await db.batch(QUERY_SPECS.map((spec) => statement.bind(spec.name, spec.lane, spec.query, spec.pollSeconds)));

  const update = db.prepare(`
    UPDATE source_state SET lane = ?, query = ?, poll_seconds = ? WHERE name = ?
  `);
  await db.batch(QUERY_SPECS.map((spec) => update.bind(spec.lane, spec.query, spec.pollSeconds, spec.name)));
}

export async function getDueSourceStates(db: D1Database, now: string): Promise<SourceStateRow[]> {
  await ensureSourceState(db);
  const { results } = await db.prepare(`
    SELECT * FROM source_state
    WHERE next_poll_at IS NULL OR next_poll_at <= ?
    ORDER BY CASE lane WHEN 'official' THEN 1 WHEN 'scout' THEN 2 WHEN 'rumor' THEN 3 ELSE 4 END
  `).bind(now).all<SourceStateRow>();
  return results;
}

export async function markSourceAttempt(db: D1Database, name: string, now: string): Promise<void> {
  await db.prepare("UPDATE source_state SET last_attempt_at = ? WHERE name = ?").bind(now, name).run();
}

export async function markSourceSuccess(
  db: D1Database,
  state: SourceStateRow,
  now: string,
  newestId: string | null
): Promise<void> {
  const next = new Date(Date.parse(now) + state.poll_seconds * 1000).toISOString();
  await db.prepare(`
    UPDATE source_state
    SET since_id = COALESCE(?, since_id),
        primed_at = COALESCE(primed_at, ?),
        last_success_at = ?,
        last_error = NULL,
        consecutive_failures = 0,
        next_poll_at = ?
    WHERE name = ?
  `).bind(newestId, now, now, next, state.name).run();
}

export async function markSourceFailure(db: D1Database, state: SourceStateRow, now: string, error: string): Promise<void> {
  const failures = state.consecutive_failures + 1;
  const backoffSeconds = Math.min(1800, Math.max(state.poll_seconds, 60) * (2 ** Math.min(failures - 1, 4)));
  const next = new Date(Date.parse(now) + backoffSeconds * 1000).toISOString();
  await db.prepare(`
    UPDATE source_state
    SET last_error = ?, consecutive_failures = ?, next_poll_at = ?
    WHERE name = ?
  `).bind(error.slice(0, 2000), failures, next, state.name).run();
}

export async function insertPost(db: D1Database, post: RawPost, firstSeenAt: string): Promise<boolean> {
  const result = await db.prepare(`
    INSERT OR IGNORE INTO posts (
      post_id, author, text, created_at, url, lane, source_tier, source_weight,
      referenced_post_ids, linked_urls, raw_json, first_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    post.postId,
    post.author,
    post.text,
    post.createdAt,
    post.url,
    post.lane,
    post.sourceTier,
    post.sourceWeight,
    JSON.stringify(post.referencedPostIds),
    JSON.stringify(post.linkedUrls),
    JSON.stringify(post.raw),
    firstSeenAt
  ).run();
  return (result.meta.changes ?? 0) > 0;
}

export async function insertSignal(db: D1Database, signal: Signal): Promise<boolean> {
  const result = await db.prepare(`
    INSERT OR IGNORE INTO signals (
      signal_id, post_id, event_type, reset_mode, severity, confidence,
      content_confidence, evidence_basis, effective_time, approximate_time,
      cluster_key, superseded_by_post_id, should_notify, reason, evidence, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    signal.signalId,
    signal.postId,
    signal.eventType,
    signal.resetMode,
    signal.severity,
    signal.confidence,
    signal.contentConfidence,
    signal.evidenceBasis,
    signal.effectiveTime,
    signal.approximateTime ? 1 : 0,
    signal.clusterKey,
    signal.supersededByPostId,
    signal.shouldNotify ? 1 : 0,
    signal.reason,
    JSON.stringify(signal.evidence),
    signal.createdAt
  ).run();
  return (result.meta.changes ?? 0) > 0;
}

export async function inhibitWeakerSignals(db: D1Database, official: Signal): Promise<number> {
  if (!official.shouldNotify || !["explicit_reset", "scheduled_reset"].includes(official.eventType)) return 0;
  const lowerBound = new Date(Date.parse(official.createdAt) - 72 * 3_600_000).toISOString();
  const result = await db.prepare(`
    UPDATE signals
    SET superseded_by_post_id = ?, should_notify = 0
    WHERE event_type = 'community_rumor'
      AND cluster_key = ?
      AND created_at >= ?
      AND created_at <= ?
      AND superseded_by_post_id IS NULL
  `).bind(official.postId, official.clusterKey, lowerBound, official.createdAt).run();
  return result.meta.changes ?? 0;
}

export async function inhibitRumorWithExistingOfficial(db: D1Database, signal: Signal): Promise<Signal> {
  if (signal.eventType !== "community_rumor") return signal;
  const official = await db.prepare(`
    SELECT post_id
    FROM signals
    WHERE evidence_basis = 'first_party'
      AND event_type IN ('explicit_reset', 'scheduled_reset')
      AND cluster_key = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).bind(signal.clusterKey).first<{ post_id: string }>();
  if (!official?.post_id) return signal;
  await db.prepare(`
    UPDATE signals
    SET superseded_by_post_id = ?, should_notify = 0
    WHERE signal_id = ?
  `).bind(official.post_id, signal.signalId).run();
  return { ...signal, supersededByPostId: official.post_id, shouldNotify: false };
}

export async function promoteCorroboratedRumor(db: D1Database, signal: Signal): Promise<Signal> {
  if (signal.eventType !== "community_rumor" || signal.evidenceBasis !== "independent_rumor") return signal;
  const lowerBound = new Date(Date.parse(signal.createdAt) - 6 * 3_600_000).toISOString();
  const row = await db.prepare(`
    SELECT COUNT(DISTINCT p.author) AS authors
    FROM signals s
    JOIN posts p ON p.post_id = s.post_id
    WHERE s.event_type = 'community_rumor'
      AND s.evidence_basis = 'independent_rumor'
      AND s.reset_mode = ?
      AND s.cluster_key = ?
      AND p.source_tier IN ('B', 'C')
      AND s.created_at BETWEEN ? AND ?
  `).bind(signal.resetMode, signal.clusterKey, lowerBound, signal.createdAt).first<{ authors: number }>();
  if (Number(row?.authors ?? 0) < 2) return signal;

  await db.prepare(`
    UPDATE signals SET severity = 'medium', should_notify = 1,
      reason = 'At least two independent community authors mentioned a compatible reset within six hours.'
    WHERE signal_id = ?
  `).bind(signal.signalId).run();
  return {
    ...signal,
    severity: "medium",
    shouldNotify: true,
    reason: "At least two independent community authors mentioned a compatible reset within six hours."
  };
}

export async function createPollRun(db: D1Database, startedAt: string, queryNames: string[]): Promise<number> {
  const result = await db.prepare(`
    INSERT INTO poll_runs (started_at, status, query_names) VALUES (?, 'running', ?)
  `).bind(startedAt, JSON.stringify(queryNames)).run();
  return Number(result.meta.last_row_id);
}

export async function finishPollRun(db: D1Database, runId: number, summary: PollSummary): Promise<void> {
  await db.prepare(`
    UPDATE poll_runs
    SET finished_at = ?, status = ?, fetched_count = ?, inserted_count = ?,
        relevant_count = ?, notified_count = ?, error = ?
    WHERE id = ?
  `).bind(
    summary.finishedAt,
    summary.status,
    summary.fetchedCount,
    summary.insertedCount,
    summary.relevantCount,
    summary.notifiedCount,
    summary.errors.length ? summary.errors.join("; ").slice(0, 4000) : null,
    runId
  ).run();
}

export async function acquirePollLock(db: D1Database, token: string, now: string): Promise<boolean> {
  await db.prepare(`
    INSERT OR IGNORE INTO app_state (key, value, updated_at) VALUES ('poll_lock', ?, ?)
  `).bind(token, now).run();
  const staleBefore = new Date(Date.parse(now) - 90_000).toISOString();
  await db.prepare(`
    UPDATE app_state SET value = ?, updated_at = ?
    WHERE key = 'poll_lock' AND updated_at < ?
  `).bind(token, now, staleBefore).run();
  const row = await db.prepare("SELECT value FROM app_state WHERE key = 'poll_lock'").first<{ value: string }>();
  return row?.value === token;
}

export async function releasePollLock(db: D1Database, token: string): Promise<void> {
  await db.prepare("DELETE FROM app_state WHERE key = 'poll_lock' AND value = ?").bind(token).run();
}

export async function queueEmailDelivery(env: Env, signal: Signal, now: string): Promise<boolean> {
  if (!env.ALERT_EMAIL_TO || !env.RESEND_API_KEY || !env.ALERT_EMAIL_FROM) return false;
  const destinationHash = await shortHash(env.ALERT_EMAIL_TO.trim().toLowerCase());
  const result = await env.DB.prepare(`
    INSERT OR IGNORE INTO deliveries (
      signal_id, channel, destination_hash, status, attempts, next_attempt_at, created_at
    ) VALUES (?, 'email', ?, 'pending', 0, ?, ?)
  `).bind(signal.signalId, destinationHash, now, now).run();
  return (result.meta.changes ?? 0) > 0;
}

export async function shortHash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].slice(0, 12).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function dashboardData(db: D1Database): Promise<Record<string, unknown>> {
  const batchResults = await db.batch([
    db.prepare("SELECT name, lane, poll_seconds, primed_at, last_attempt_at, last_success_at, last_error, consecutive_failures, next_poll_at FROM source_state ORDER BY CASE lane WHEN 'official' THEN 1 WHEN 'scout' THEN 2 WHEN 'rumor' THEN 3 ELSE 4 END"),
    db.prepare(`
      SELECT s.*, p.author, p.text, p.url, p.source_tier, p.lane
      FROM signals s JOIN posts p ON p.post_id = s.post_id
      WHERE s.event_type != 'unrelated'
        AND p.source_tier != 'D'
      ORDER BY s.created_at DESC LIMIT 100
    `),
    db.prepare("SELECT * FROM poll_runs ORDER BY started_at DESC LIMIT 20"),
    db.prepare("SELECT channel, status, COUNT(*) AS count FROM deliveries GROUP BY channel, status")
  ]);
  const sources = batchResults[0]!;
  const signals = batchResults[1]!;
  const runs = batchResults[2]!;
  const deliveryCounts = batchResults[3]!;
  return {
    sources: sources.results,
    signals: signals.results,
    poll_runs: runs.results,
    deliveries: deliveryCounts.results
  };
}
