export const VERSION = '0.1.0';
export const ORIGIN = 'https://codex-reset-radar.weican16hit.workers.dev';
export const RADAR = 'https://codex-reset-watcher.weican16hit.workers.dev';
type Row = Record<string, any>;
export interface PanelEvent {
  id: string; title: string; summary: string; type: string; mode: string;
  tier: string; url: string; publishedAt: string; scheduledFor: string | null;
  confirmedAt: string | null; resetAt: string | null; approximate: boolean;
}
export interface PanelState {
  version: string; fetchedAt: string; lastSourceSuccessAt: string | null;
  pollSeconds: number; staleAfterSeconds: number; sourceStatus: string;
  headline: string; description: string; tone: string; events: PanelEvent[];
  links: {radar: string; notifications: string; rss: string; install: string};
}
function iso(value: unknown): string | null {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}
function text(value: unknown, fallback: string, max = 320): string {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : fallback;
}
export function sourceUrl(value: unknown): string {
  try {
    const url = new URL(String(value));
    if (url.protocol === 'https:' && ['x.com','twitter.com'].includes(url.hostname) && /^\/[^/]+\/status\/\d+$/.test(url.pathname)) return url.origin + url.pathname;
  } catch { /* Discard untrusted URLs. */ }
  return RADAR + '/#latest';
}
export function projectStatus(input: unknown, now = Date.now()): PanelState {
  const raw = input && typeof input === 'object' ? input as Row : {};
  const live: Row = raw.live && typeof raw.live === 'object' ? raw.live : {};
  const pollSeconds = Number.isFinite(Number(live.expected_poll_seconds)) && Number(live.expected_poll_seconds) >= 60 ? Math.min(Number(live.expected_poll_seconds), 86400) : 1200;
  const staleAfterSeconds = pollSeconds * 3 + 60;
  const lastSourceSuccessAt = iso(live.official_last_success_at);
  const fresh = lastSourceSuccessAt !== null && now - Date.parse(lastSourceSuccessAt) <= staleAfterSeconds * 1000 && Date.parse(lastSourceSuccessAt) <= now + 60000;
  const sourceStatus = fresh && live.source_status === 'healthy' ? 'healthy' : !fresh && lastSourceSuccessAt ? 'stale' : 'unknown';
  const events: PanelEvent[] = (Array.isArray(live.signals) ? live.signals : [])
    .filter((s: Row) => s && !s.superseded_by_post_id && s.event_type !== 'unrelated' && s.severity !== 'none' && iso(s.created_at) && Date.parse(s.created_at) <= now + 60000)
    .sort((a: Row,b: Row) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0,8).map((s: Row) => ({
      id: text(s.signal_id || s.post_id, 'unknown', 100),
      title: text(s.title_zh, '新的重置信号', 100),
      summary: text(s.summary_zh, '查看原帖了解完整信息。'),
      type: text(s.event_type, 'unknown', 40), mode: text(s.reset_mode, 'unknown', 40),
      tier: text(s.source_tier, '?', 8), url: sourceUrl(s.url), publishedAt: iso(s.created_at)!,
      scheduledFor: iso(s.reset_timing?.scheduled_for), confirmedAt: iso(s.reset_timing?.confirmed_at),
      resetAt: iso(s.reset_timing?.reset_at), approximate: Boolean(s.reset_timing?.approximate),
    }));
  let headline = '暂无明确官方重置预告', description = '一手来源持续检查中。有明确消息，会显示在这里。', tone = 'quiet';
  const official = events.filter(s => ['A1','A2'].includes(s.tier));
  const confirmed = official.find(s => s.type === 'explicit_reset' && s.mode === 'hard_reset');
  const future = official.find(s => s.type === 'scheduled_reset' && s.mode === 'hard_reset' &&
    (s.scheduledFor ? Date.parse(s.scheduledFor) > now : now - Date.parse(s.publishedAt) < 48 * 3600000) &&
    (!confirmed || Date.parse(s.publishedAt) > Date.parse(confirmed.publishedAt)));
  const latest = official[0];
  if (future) { headline = '有新的官方重置预告'; description = future.scheduledFor ? '官方给出了预计时间，实际执行仍待确认。' : '官方已发出预告，尚未公布明确执行时间。'; tone = 'upcoming'; }
  else if (latest && now - Date.parse(latest.publishedAt) < 7 * 86400000) {
    if (latest.mode === 'banked_reset') { headline = latest.type === 'explicit_reset' ? 'Banked reset 已宣布激活' : '有 Banked reset 新消息'; description = '这是可储存或手动使用的重置权益。具体是否到账，请查看自己的 Codex。'; tone = 'banked'; }
    else if (latest.type === 'explicit_reset' && latest.mode === 'hard_reset') { headline = '最近一次重置已获官方确认'; description = '这里显示公开确认；个人账号的到账情况请在 Codex 中查看。'; tone = 'confirmed'; }
    else if (latest.type === 'scheduled_reset' && latest.scheduledFor && Date.parse(latest.scheduledFor) <= now) { headline = '预告时间已过，等待确认'; description = '尚未取得新的完成确认，不把预告自动视为已经重置。'; tone = 'pending'; }
    else if (latest.type === 'weak_hint') { headline = '有官方暗示，尚无明确预告'; description = '目前只有线索，没有可确认的重置时间。'; tone = 'hint'; }
  }
  if (sourceStatus !== 'healthy') { headline = '暂时无法确认最新状态'; description = '来源检查已过期或暂不可用。下面保留最近记录，不代表没有新消息。'; tone = 'unknown'; }
  return {version:VERSION, fetchedAt:new Date(now).toISOString(), lastSourceSuccessAt, pollSeconds, staleAfterSeconds, sourceStatus, headline, description, tone, events,
    links:{radar:RADAR+'/', notifications:RADAR+'/#subscribe', rss:RADAR+'/feed.xml', install:ORIGIN+'/install'}};
}
