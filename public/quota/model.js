export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
const maxGap = 6 * HOUR;
const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
const instant = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

export const poolKey = pool => JSON.stringify([pool.sourceId, pool.poolId, pool.unit]);
const cycleKey = pool => JSON.stringify([poolKey(pool), pool.cycleId]);
const stamps = ['cycleStart', 'resetsAt', 'expiresAt', 'deadlineAt'];

function validDay(day) {
  const ms = Date.parse(day);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === day;
}

export function localDay(ms, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(ms);
  const get = type => parts.find(part => part.type === type).value;
  return [get('year'), get('month'), get('day')].join('-');
}

function localMidnight(day, timezone) {
  const utc = Date.parse(day);
  if (timezone === 'UTC') return utc;
  let low = utc - 2 * DAY;
  let high = utc + 2 * DAY;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (localDay(mid, timezone) < day) low = mid;
    else high = mid;
  }
  return high;
}

function timestamp(value, field, timezone, allowDate = false) {
  if (value == null && allowDate) return null;
  if (typeof value === 'string') {
    if (allowDate && dateOnly.test(value) && validDay(value)) {
      return { value, ms: localMidnight(value, timezone), day: true };
    }
    const match = value.match(instant);
    if (match && validDay(match[1]) && Number.isFinite(Date.parse(value))) {
      return { value, ms: Date.parse(value), day: false };
    }
  }
  throw new Error(field + ' · 日期须为有效的 ISO 8601 时间并带时区，期限可仅填写日期。 / Use ISO 8601 with an offset. Deadlines may be dates.');
}

function label(value, field) {
  if (typeof value !== 'string' || !value.trim() || value.length > 100) {
    throw new Error(field + ' · 须为 1–100 字的文本。 / Expected 1–100 characters.');
  }
  return value.trim();
}

function amount(value, field) {
  if (value == null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
    throw new Error(field + ' · 须为非负数或 null。 / Expected a nonnegative number or null.');
  }
  return value;
}

export function readSnapshot(input) {
  if (input?.schemaVersion !== 1 || !Array.isArray(input.pools) || !input.pools.length || input.pools.length > 1000) {
    throw new Error('须包含 schemaVersion: 1 和 1–1000 个额度池。 / Expected schemaVersion: 1 and 1–1000 pools.');
  }
  const timezone = input.timezone == null ? 'UTC' : label(input.timezone, 'timezone');
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone });
  } catch {
    throw new Error('timezone 须为有效的 IANA 时区。 / Expected an IANA timezone.');
  }
  const pools = input.pools.map((raw, index) => {
    const field = 'pools[' + index + ']';
    if (!raw || !Array.isArray(raw.observations) || !raw.observations.length || raw.observations.length > 20000) {
      throw new Error(field + ' · 须包含 1–20000 个观测点。 / Expected 1–20000 observations.');
    }
    const pool = { zone: timezone };
    for (const key of ['sourceId', 'sourceLabel', 'poolId', 'poolLabel', 'unit']) {
      pool[key] = label(raw[key], field + '.' + key);
    }
    pool.total = amount(raw.total, field + '.total');
    if (pool.unit === 'percent') {
      if (pool.total !== null && pool.total !== 100) throw new Error(field + '.total · percent → 100 / null');
      pool.total = 100;
    }
    for (const key of stamps) pool[key] = timestamp(raw[key], field + '.' + key, timezone, true);
    pool.cycleId = raw.cycleId == null
      ? JSON.stringify(stamps.map(key => pool[key]?.value ?? null))
      : label(raw.cycleId, field + '.cycleId');
    pool.observations = raw.observations.map((obs, i) => {
      const name = field + '.observations[' + i + ']';
      if (!obs || !Object.hasOwn(obs, 'remaining')) throw new Error(name + '.remaining · 数值或 null / Number or null');
      const { ms } = timestamp(obs.observedAt, name + '.observedAt', timezone);
      const remaining = amount(obs.remaining, name + '.remaining');
      if (pool.unit === 'percent' && remaining > 100) throw new Error(name + '.remaining · percent → 0–100');
      return { ms, remaining };
    });
    return pool;
  });
  return { timezone, pools };
}

export function mergePools(previous, incoming) {
  const merged = new Map(previous.map(pool => [cycleKey(pool), pool]));
  for (const pool of incoming) {
    const key = cycleKey(pool);
    const existing = merged.get(key);
    const points = new Map(existing?.observations.map(point => [point.ms, point]));
    for (const point of pool.observations) points.set(point.ms, point);
    const observations = [...points.values()].sort((a, b) => a.ms - b.ms);
    if (existing && existing.observations.at(-1).ms > Math.max(...pool.observations.map(point => point.ms))) {
      merged.set(key, { ...existing, observations });
    } else {
      merged.set(key, { ...pool, observations });
    }
  }
  return [...merged.values()];
}

export function splitPoints(points) {
  const groups = [];
  let group = [];
  for (const point of points) {
    const previous = group.at(-1);
    if (point.remaining == null || (previous && (point.remaining > previous.remaining || point.ms - previous.ms > maxGap))) {
      if (group.length) groups.push(group);
      group = [];
    }
    if (point.remaining != null) group.push(point);
  }
  if (group.length) groups.push(group);
  return groups;
}

export function sampleGroup(group, bucket, timezone) {
  if (bucket === 'raw') return group;
  const buckets = new Map();
  for (const point of group) {
    const key = bucket === 'day' ? localDay(point.ms, timezone) : Math.floor(point.ms / HOUR);
    buckets.set(key, point);
  }
  return [...buckets.values()];
}

export function deadlines(pool) {
  return [['resetsAt', 'reset'], ['expiresAt', 'expiry'], ['deadlineAt', 'planned']]
    .filter(([field]) => pool[field])
    .map(([field, type]) => ({ ...pool[field], type }))
    .sort((a, b) => a.ms - b.ms);
}

export function forecast(pool, now) {
  const points = pool.observations.filter(point => point.ms <= now);
  const latest = points.at(-1);
  const markers = deadlines(pool);
  const deadline = markers.find(marker => marker.ms > now);
  if (!latest) return { state: 'missing' };
  if (markers.some(marker => marker.ms <= now && (marker.type !== 'planned' || latest.ms < marker.ms))) {
    return { state: 'update' };
  }
  if (latest.remaining == null) return { state: 'missing' };
  if (latest.remaining === 0) return { state: 'empty' };
  if (now - latest.ms > maxGap) return { state: 'stale' };
  const recent = splitPoints(points.filter(point => point.ms >= now - DAY)).at(-1);
  if (!recent || recent.at(-1) !== latest || recent.length < 3 || latest.ms - recent[0].ms < HOUR) {
    return { state: 'short' };
  }
  const rate = (recent[0].remaining - latest.remaining) / ((latest.ms - recent[0].ms) / HOUR);
  if (rate <= 0) return { state: 'flat' };
  const zeroAt = latest.ms + latest.remaining / rate * HOUR;
  if (!Number.isFinite(zeroAt) || zeroAt > 8.64e15) return { state: 'flat' };
  const end = Math.min(zeroAt, deadline?.ms ?? Infinity);
  const remaining = Math.max(0, latest.remaining - rate * (end - latest.ms) / HOUR);
  return { state: 'forecast', rate, zeroAt, end, remaining, latest, deadline };
}
