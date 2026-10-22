import { shortHash } from "./db";
import type { Env, Signal } from "./types";

export function dingtalkConfigured(env: Env): boolean {
  return Boolean(env.DINGTALK_APP_KEY && env.DINGTALK_APP_SECRET && env.DINGTALK_GROUP_ID);
}

class DeliveryError extends Error {
  constructor(message: string, readonly state: "pending" | "failed" | "unknown") { super(message); }
}

let cachedToken: { key: string; token: string; until: number } | undefined;

async function accessToken(env: Env): Promise<string> {
  const key = await shortHash(`${env.DINGTALK_APP_KEY}:${env.DINGTALK_APP_SECRET}`);
  if (cachedToken?.key === key && cachedToken.until > Date.now()) return cachedToken.token;
  // A token request cannot deliver a message, so bounded retries are safe here.
  try {
    const response = await fetch("https://api.dingtalk.com/v1.0/oauth2/accessToken", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appKey: env.DINGTALK_APP_KEY, appSecret: env.DINGTALK_APP_SECRET }),
      signal: AbortSignal.timeout(15_000)
    });
    const body = await response.json() as { accessToken?: string; expireIn?: number; code?: string };
    if (!response.ok || !body.accessToken) {
      throw new DeliveryError(`DingTalk token HTTP ${response.status}`, response.status >= 500 || response.status === 429 ? "pending" : "failed");
    }
    cachedToken = { key, token: body.accessToken, until: Date.now() + Math.max(0, Number(body.expireIn ?? 7200) - 120) * 1000 };
    return body.accessToken;
  } catch (error) {
    if (error instanceof DeliveryError) throw error;
    throw new DeliveryError("DingTalk token unavailable", "pending");
  }
}

export async function sendDingTalk(env: Env, content: string): Promise<string> {
  if (!dingtalkConfigured(env)) throw new DeliveryError("DingTalk configuration incomplete", "failed");
  const token = await accessToken(env);
  let response: Response;
  try {
    response = await fetch("https://api.dingtalk.com/v1.0/robot/groupMessages/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-acs-dingtalk-access-token": token },
      body: JSON.stringify({ robotCode: env.DINGTALK_APP_KEY, openConversationId: env.DINGTALK_GROUP_ID,
        msgKey: "sampleText", msgParam: JSON.stringify({ content }) }),
      signal: AbortSignal.timeout(20_000)
    });
  } catch {
    throw new DeliveryError("DingTalk send result unknown; manual reconciliation required", "unknown");
  }
  let body: { processQueryKey?: string; code?: string };
  try { body = await response.json() as typeof body; }
  catch { throw new DeliveryError("DingTalk response unreadable; result unknown", "unknown"); }
  if (response.ok && typeof body.processQueryKey === "string" && body.processQueryKey.trim()) return body.processQueryKey;
  if (response.status === 401) cachedToken = undefined;
  // Retry only explicit authentication/throttle rejection. Server errors and
  // unknown.send.result may follow acceptance, so never replay them blindly.
  const state = response.status === 401 || response.status === 429 ? "pending"
    : response.status >= 400 && response.status < 500 && body.code && !body.code.includes("unknown") ? "failed" : "unknown";
  const code = typeof body.code === "string" && /^[a-zA-Z0-9_.-]{1,120}$/.test(body.code) ? ` ${body.code}` : "";
  throw new DeliveryError(`DingTalk send HTTP ${response.status}${code}`, state);
}

export async function queueDingTalkDelivery(env: Env, signal: Signal, now: string): Promise<void> {
  if (!dingtalkConfigured(env)) return;
  const destination = await shortHash(`${env.DINGTALK_APP_KEY}:${env.DINGTALK_GROUP_ID}`);
  await env.DB.prepare(`INSERT OR IGNORE INTO deliveries
    (signal_id,channel,destination_hash,status,attempts,next_attempt_at,created_at)
    VALUES (?,'dingtalk',?,'pending',0,?,?)`).bind(signal.signalId, destination, now, now).run();
}

interface Row {
  id: number; attempts: number; event_type: string; reset_mode: string; source_tier: string;
  author: string; text: string; url: string; effective_time: string | null;
}

export function dingTalkContent(row: Omit<Row, "id" | "attempts">): string {
  const title = row.event_type === "scheduled_reset" ? "Codex 重置预告"
    : row.reset_mode === "banked_reset" ? "Codex 可储存重置权益" : row.event_type === "explicit_reset" ? "Codex 重置确认" : "Codex 新信号";
  const action = row.event_type === "scheduled_reset" && row.reset_mode === "hard_reset" && row.source_tier.startsWith("A")
    ? "一手未来 hard reset 信号；如果本来有任务，可以考虑提前安排。预告不保证执行。"
    : row.reset_mode === "banked_reset" ? "可储存/手动使用的重置权益，不等同自动 hard reset；请查看个人 Usage。"
    : row.event_type === "explicit_reset" ? "请在个人 Codex Usage 检查是否实际到账。" : "公开线索仅供留意，请核对原帖。";
  return `[Codex Reset Watcher] ${title}\n${action}\n来源：@${row.author} · ${row.source_tier}\n类型：${row.event_type} / ${row.reset_mode}${row.effective_time ? `\n预计时间：${row.effective_time}` : ""}\n\n${row.text.replace(/\s+/g, " ").slice(0, 700)}\n\n原帖：${row.url}\n雷达：https://codex-reset-watcher.weican16hit.workers.dev/\n普通机器人群通知（非 DING）`;
}

export async function processDingTalkDeliveries(env: Env, now = new Date().toISOString()): Promise<{ sent: number; failed: number }> {
  const summary = { sent: 0, failed: 0 };
  if (!dingtalkConfigured(env)) return summary;
  // A crashed invocation may have sent already. Quarantine instead of replaying.
  const cutoff = new Date(Date.parse(now) - 5 * 60_000).toISOString();
  await env.DB.prepare(`UPDATE deliveries SET status='unknown', last_error='Interrupted send; manual reconciliation required'
    WHERE channel='dingtalk' AND status='sending' AND next_attempt_at < ?`).bind(cutoff).run();
  const destination = await shortHash(`${env.DINGTALK_APP_KEY}:${env.DINGTALK_GROUP_ID}`);
  const { results } = await env.DB.prepare(`SELECT d.id,d.attempts,s.event_type,s.reset_mode,s.effective_time,p.author,p.text,p.url,p.source_tier
    FROM deliveries d JOIN signals s ON s.signal_id=d.signal_id JOIN posts p ON p.post_id=s.post_id
    WHERE d.channel='dingtalk' AND d.destination_hash=? AND d.status='pending' AND d.next_attempt_at<=?
    AND s.should_notify=1 AND s.superseded_by_post_id IS NULL ORDER BY d.created_at LIMIT 10`).bind(destination, now).all<Row>();
  for (const row of results) {
    const claim = await env.DB.prepare(`UPDATE deliveries SET status='sending',attempts=attempts+1,next_attempt_at=?
      WHERE id=? AND status='pending'`).bind(now, row.id).run();
    if (!claim.meta.changes) continue;
    let receipt: string;
    try { receipt = await sendDingTalk(env, dingTalkContent(row)); }
    catch (error) {
      const attempts = row.attempts + 1;
      const state = error instanceof DeliveryError ? error.state : "unknown";
      await env.DB.prepare(`UPDATE deliveries SET status=?,next_attempt_at=?,last_error=? WHERE id=?`)
        .bind(state === "pending" && attempts >= 3 ? "failed" : state,
          new Date(Date.parse(now) + attempts * 10 * 60_000).toISOString(),
          error instanceof DeliveryError ? error.message : "DingTalk result unknown", row.id).run();
      summary.failed++;
      continue;
    }
    // Keep success persistence outside the network catch: DB failure must not
    // turn an accepted message into a retryable network failure.
    await env.DB.prepare(`UPDATE deliveries SET status='sent',sent_at=?,provider_receipt=?,last_error=NULL WHERE id=?`)
      .bind(now, receipt, row.id).run();
    summary.sent++;
  }
  return summary;
}

export async function testDingTalk(env: Env, key: string): Promise<Record<string, unknown>> {
  const stateKey = `dingtalk-test:${await shortHash(key)}`;
  const now = new Date().toISOString();
  const claim = await env.DB.prepare(`INSERT OR IGNORE INTO app_state(key,value,updated_at) VALUES (?, ?, ?)`)
    .bind(stateKey, JSON.stringify({ status: "unknown", note: "Test claimed; do not replay" }), now).run();
  if (!claim.meta.changes) {
    const existing = await env.DB.prepare("SELECT value FROM app_state WHERE key=?").bind(stateKey).first<{ value: string }>();
    return { ...JSON.parse(existing!.value), deduplicated: true };
  }
  let result: Record<string, unknown>;
  try {
    const receipt = await sendDingTalk(env, "[Codex Reset Watcher] Cloudflare Worker 生产通道测试成功。怎么蹬中英文已上线；后续新信号由云端定时任务和D1待发送账本推送，无需本机在线。普通机器人群消息，非 DING；这不是重置公告。https://codex-reset-watcher.weican16hit.workers.dev/#pedal");
    result = { status: "sent", provider_receipt: receipt, channel: "dingtalk_group_message", true_ding: false };
  } catch (error) { result = { status: error instanceof DeliveryError ? error.state : "unknown", error: error instanceof DeliveryError ? error.message : "Unknown result" }; }
  await env.DB.prepare("UPDATE app_state SET value=?,updated_at=? WHERE key=?").bind(JSON.stringify(result), now, stateKey).run();
  return result;
}
