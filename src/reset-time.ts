// Publication time is evidence of an announcement, not the rollout timestamp.
export interface TimedReset {
  event_type: string;
  reset_mode: string;
  source_tier: string;
  text: string;
  created_at: string;
  effective_time?: string | null;
  approximate_time?: number | boolean;
}

export function sourceResetTime(text: string, publishedAt: string): { at: string; approximate: boolean } | null {
  const published = Date.parse(publishedAt);
  if (!Number.isFinite(published)) return null;
  const normalized = text.toLowerCase().replace(/[’]/g, "'");
  // Require the timestamp to describe the reset, rather than another launch in
  // the same post. Broad day words (today/soon) never manufacture an exact hour.
  const iso = normalized.match(/\breset(?:s|ting)?\b[^.!?\n]{0,100}?\b(\d{4}-\d{2}-\d{2}t\d{2}:\d{2}(?::\d{2})?(?:z|[+-]\d{2}:\d{2}))/i);
  if (iso && Number.isFinite(Date.parse(iso[1]!))) return { at: new Date(iso[1]!).toISOString(), approximate: /\baround\b/.test(iso[0]) };
  const clock = normalized.match(/\b(?:reset(?:s|ting)?\b[^.!?\n]{0,100}?|lands?\s+)(?:at|around)\s+(1[0-2]|[1-9])(?::([0-5]\d))?\s*(am|pm)\s+(pst|pdt|utc)\b/);
  if (clock) {
    const offset = clock[4] === 'pst' ? -8 : clock[4] === 'pdt' ? -7 : 0;
    const local = new Date(published + offset * 3_600_000);
    const explicitDate = normalized.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
    const dayOffset = /\btomorrow\b/.test(normalized) ? 1 : /\byesterday\b/.test(normalized) ? -1 : 0;
    const hour = Number(clock[1]) % 12 + (clock[3] === 'pm' ? 12 : 0);
    const at = Date.UTC(explicitDate ? Number(explicitDate[1]) : local.getUTCFullYear(),
      explicitDate ? Number(explicitDate[2]) - 1 : local.getUTCMonth(),
      explicitDate ? Number(explicitDate[3]) : local.getUTCDate() + dayOffset, hour - offset, Number(clock[2] ?? 0));
    return { at: new Date(at).toISOString(), approximate: /\baround\b/.test(clock[0]) };
  }
  const ago = normalized.match(/\breset(?:s|ting)?\b[^.!?\n]{0,70}?\b(\d{1,3})\s+(minutes?|hours?)\s+ago\b/);
  if (ago) return { at: new Date(published - Number(ago[1]) * (ago[2]!.startsWith('hour') ? 3_600_000 : 60_000)).toISOString(), approximate: true };
  return null;
}

export function resetTiming(row: TimedReset) {
  const official = ['A1', 'A2'].includes(row.source_tier);
  const completed = official && row.event_type === 'explicit_reset';
  const scheduled = official && row.event_type === 'scheduled_reset';
  const sourceTime = sourceResetTime(row.text, row.created_at);
  const occurred = completed && sourceTime && Date.parse(sourceTime.at) <= Date.parse(row.created_at) ? sourceTime : null;
  return {
    phase: completed ? 'confirmed' : scheduled ? 'scheduled' : row.event_type === 'community_observation' ? 'observation' : 'unknown',
    published_at: row.created_at,
    scheduled_for: scheduled ? sourceTime?.at ?? null : null,
    reset_at: occurred?.at ?? null,
    confirmed_at: completed ? row.created_at : null,
    approximate: (completed ? occurred : scheduled ? sourceTime : null)?.approximate ?? false,
    time_basis: occurred ? 'source_timestamp' : completed ? 'confirmation_post' : scheduled && sourceTime ? 'source_timestamp' : 'unknown'
  };
}
