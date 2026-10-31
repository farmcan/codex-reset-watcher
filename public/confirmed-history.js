// Public source-post chronology only. No account observations or inferred dates.
export function publicConfirmations(history, signals = []) {
  const rows = new Map();
  const add = row => {
    if (!row.postId || !/^\d{10,25}$/.test(row.postId) || !Number.isFinite(Date.parse(row.at))) return;
    if (!/^https:\/\/x\.com\/[^/]+\/status\/\d+$/.test(row.url || '') || !row.url.endsWith('/' + row.postId)) return;
    if (!rows.has(row.postId)) rows.set(row.postId, row);
  };
  for (const event of history?.recent_audit?.events || []) {
    add({ postId: event.confirmation_post_id, at: event.confirmed_at, url: event.confirmation_url, kind: event.kind });
  }
  for (const signal of signals) {
    if (signal.event_type !== 'explicit_reset' || !['A1', 'A2'].includes(signal.source_tier) || signal.superseded_by_post_id) continue;
    add({ postId: signal.post_id, at: signal.created_at, url: signal.url, kind: signal.reset_mode });
  }
  return [...rows.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}
