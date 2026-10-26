import { shortHash } from "./db";
import type { Env, Signal } from "./types";
import { DwsError, sendGroupPersonalDing, selectedDingRecipients } from './dws';

export function dingtalkConfigured(env: Env): boolean {
  if(env.DINGTALK_MODE==='personal_ding')return Boolean(env.DWS_TOKEN_KEY&&env.DINGTALK_GROUP_ID);
  return Boolean(env.DINGTALK_APP_KEY && env.DINGTALK_APP_SECRET && env.DINGTALK_GROUP_ID);
}

export async function dingTalkDestination(env:Env):Promise<string> {
  return shortHash(env.DINGTALK_MODE==='personal_ding'?`personal_ding:${env.DINGTALK_GROUP_ID}`:`${env.DINGTALK_APP_KEY}:${env.DINGTALK_GROUP_ID}`);
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

export async function sendDingTalk(env: Env, content: string, key: string = crypto.randomUUID(), group = env.DINGTALK_GROUP_ID): Promise<string> {
  if (!dingtalkConfigured(env)) throw new DeliveryError("DingTalk configuration incomplete", "failed");
  if(env.DINGTALK_MODE==='personal_ding'){
    try {return await sendGroupPersonalDing(env,group!,content,key);}
    catch(error){if(error instanceof DwsError)throw new DeliveryError(error.message,error.state);throw error;}
  }
  const token = await accessToken(env);
  let response: Response;
  try {
    response = await fetch("https://api.dingtalk.com/v1.0/robot/groupMessages/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-acs-dingtalk-access-token": token },
      body: JSON.stringify({ robotCode: env.DINGTALK_APP_KEY, openConversationId: env.DINGTALK_GROUP_ID,
        isAtAll: true, msgKey: "sampleText", msgParam: JSON.stringify({ content }) }),
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
  const destination = await dingTalkDestination(env);
  await env.DB.prepare(`INSERT OR IGNORE INTO deliveries
    (signal_id,channel,destination_hash,status,attempts,next_attempt_at,created_at)
    VALUES (?,'dingtalk',?,'pending',0,?,?)`).bind(signal.signalId, destination, now, now).run();
}

export async function dingTalkHealth(env: Env, now = new Date().toISOString()): Promise<Record<string, unknown>> {
  if (!dingtalkConfigured(env)) return {status:'disabled', unqueued_eligible:0};
  const selected=env.DINGTALK_MODE==='personal_ding'?selectedDingRecipients(env):null;
  const destination = await dingTalkDestination(env);
  const delivery = await env.DB.prepare(`SELECT
    COALESCE(SUM(status='failed'),0) AS failed, COALESCE(SUM(status='unknown'),0) AS unknown,
    COALESCE(SUM(status='pending'),0) AS pending,
    COALESCE(SUM(status='pending' AND last_error LIKE '%coverage partial%'),0) AS partial,
    MIN(CASE WHEN status IN ('pending','sending') THEN created_at END) AS oldest_pending_at,
    MAX(sent_at) AS last_signal_delivery_at
    FROM deliveries WHERE channel='dingtalk' AND destination_hash=?`).bind(destination).first<Record<string, unknown>>();
  const missing = await env.DB.prepare(`SELECT COUNT(*) AS n FROM signals s JOIN posts p ON p.post_id=s.post_id
    WHERE p.notification_eligible=1 AND s.should_notify=1 AND s.superseded_by_post_id IS NULL
    AND s.event_type!='unrelated'
    AND NOT EXISTS (SELECT 1 FROM deliveries d WHERE d.signal_id=s.signal_id AND d.channel='dingtalk' AND d.destination_hash=?)`)
    .bind(destination).first<{n:number}>();
  const stale = typeof delivery?.oldest_pending_at === 'string'
    && Date.parse(now)-Date.parse(delivery.oldest_pending_at)>20*60_000;
  const verified=env.DINGTALK_MODE==='personal_ding'
    ? await env.DB.prepare("SELECT updated_at FROM app_state WHERE key='dws_ding_last_success'").first<{updated_at:string}>():null;
  const partial=await env.DB.prepare(`SELECT last_error FROM deliveries WHERE channel='dingtalk' AND destination_hash=?
    AND status='pending' AND last_error LIKE '%coverage partial%' ORDER BY created_at DESC LIMIT 1`)
    .bind(destination).first<{last_error:string}>();
  const coverage=partial?.last_error.match(/coverage partial: (\d+)\/(\d+)/);
  return {...delivery, unqueued_eligible:missing?.n ?? 0,
    recipient_scope:selected?'selected_members':'group_members',configured_recipient_count:selected?.length??null,ding_all_requested:!selected,mentions_all_requested:true,
    cloud_ding_verified:Boolean(verified),cloud_ding_last_success_at:verified?.updated_at??null,
    coverage:coverage?{notified:Number(coverage[1]),total:Number(coverage[2]),blocked:Number(coverage[2])-Number(coverage[1]),reason:'not_colleagues_or_friends'}:undefined,
    status:Number(delivery?.failed)>0 || Number(delivery?.unknown)>0 || Number(delivery?.partial)>0 || Number(missing?.n)>0 || stale ? 'degraded' : 'healthy'};
}

interface Row {
  id: number; attempts: number; event_type: string; reset_mode: string; source_tier: string;
  author: string; text: string; url: string; effective_time: string | null;
}

export function dingTalkContent(row: Omit<Row, "id" | "attempts">, personalDing = false): string {
  const title = row.event_type === "scheduled_reset" ? "Codex 重置预告"
    : row.reset_mode === "banked_reset" ? "Codex 可储存重置权益" : row.event_type === "explicit_reset" ? "Codex 重置确认" : "Codex 新信号";
  const action = row.event_type === "scheduled_reset" && row.reset_mode === "hard_reset" && row.source_tier.startsWith("A")
    ? "一手未来 hard reset 信号；如果本来有任务，可以考虑提前安排。预告不保证执行。"
    : row.reset_mode === "banked_reset" ? "可储存/手动使用的重置权益，不等同自动 hard reset；请查看个人 Usage。"
    : row.event_type === "explicit_reset" ? "请在个人 Codex Usage 检查是否实际到账。" : "公开线索仅供留意，请核对原帖。";
  return `[Codex Reset Watcher] ${title}\n${action}\n来源：@${row.author} · ${row.source_tier}\n类型：${row.event_type} / ${row.reset_mode}${row.effective_time ? `\n预计时间：${row.effective_time}` : ""}\n\n${row.text.replace(/\s+/g, " ").slice(0, 700)}\n\n原帖：${row.url}\n雷达：https://codex-reset-watcher.weican16hit.workers.dev/\n${personalDing?'Cloudflare 云端应用内 DING':'全员 @ 普通群通知（非 DING）'}`;
}

export async function processDingTalkDeliveries(env: Env, now = new Date().toISOString()): Promise<{ sent: number; failed: number }> {
  const summary = { sent: 0, failed: 0 };
  if (!dingtalkConfigured(env)) return summary;
  // A crashed invocation may have sent already. Quarantine instead of replaying.
  const cutoff = new Date(Date.parse(now) - 5 * 60_000).toISOString();
  await env.DB.prepare(`UPDATE deliveries SET status='unknown', last_error='Interrupted send; manual reconciliation required'
    WHERE channel='dingtalk' AND status='sending' AND next_attempt_at < ?`).bind(cutoff).run();
  const destination = await dingTalkDestination(env);
  const { results } = await env.DB.prepare(`SELECT d.id,d.attempts,s.event_type,s.reset_mode,s.effective_time,p.author,p.text,p.url,p.source_tier
    FROM deliveries d JOIN signals s ON s.signal_id=d.signal_id JOIN posts p ON p.post_id=s.post_id
    WHERE d.channel='dingtalk' AND d.destination_hash=? AND d.status='pending' AND d.next_attempt_at<=?
    AND s.should_notify=1 AND s.superseded_by_post_id IS NULL ORDER BY d.created_at LIMIT 10`).bind(destination, now).all<Row>();
  for (const row of results) {
    const claim = await env.DB.prepare(`UPDATE deliveries SET status='sending',attempts=attempts+1,next_attempt_at=?
      WHERE id=? AND status='pending'`).bind(now, row.id).run();
    if (!claim.meta.changes) continue;
    let receipt: string;
    try { receipt = await sendDingTalk(env, dingTalkContent(row,env.DINGTALK_MODE==='personal_ding'),`signal-${row.id}`); }
    catch (error) {
      const attempts = row.attempts + 1;
      const state = error instanceof DeliveryError ? error.state : "unknown";
      await env.DB.prepare(`UPDATE deliveries SET status=?,next_attempt_at=?,last_error=? WHERE id=?`)
        .bind(state === "pending" && attempts >= 3 && env.DINGTALK_MODE!=='personal_ding' ? "failed" : state,
          new Date(Date.parse(now) + Math.min(60,attempts * 10) * 60_000).toISOString(),
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
    const prior=JSON.parse(existing!.value);
    if(prior.status!=='pending')return {...prior,deduplicated:true};
    const resume=await env.DB.prepare('UPDATE app_state SET value=?,updated_at=? WHERE key=? AND value=?')
      .bind(JSON.stringify({status:'unknown',note:'Resume claimed; do not replay'}),now,stateKey,existing!.value).run();
    if(!resume.meta.changes)return {...prior,deduplicated:true};
  }
  let result: Record<string, unknown>;
  try {
    const personal=env.DINGTALK_MODE==='personal_ding';
    if(personal&&!env.DINGTALK_TEST_GROUP_ID)throw new DeliveryError('An isolated DING test group is required','failed');
    const content=personal?'[Codex-Watcher 模拟验收] 此通知由 Cloudflare Worker 发出，不是本机CLI发送，也不是真实重置公告。实时网页新增信息会写入待发送账本，向测试群成员发送应用内 DING，并通过消息元数据和占位符真正 @所有人。只在本人和二四的双人测试群验收。':'[Codex Reset Watcher] Cloudflare Worker 普通群通知通道测试；非 DING，不是重置公告。';
    const receipt = await sendDingTalk(env,content,`test-${key}`,personal?env.DINGTALK_TEST_GROUP_ID:env.DINGTALK_GROUP_ID);
    result = { status: "sent", runtime:'cloudflare_worker', provider_receipt: receipt, channel: personal?'personal_app_ding':'dingtalk_group_message', true_ding: personal, mentions_all_requested: true, mention_delivery_verified: false };
  } catch (error) { result = { status: error instanceof DeliveryError ? error.state : "unknown", error: error instanceof DeliveryError ? error.message : "Unknown result" }; }
  await env.DB.prepare("UPDATE app_state SET value=?,updated_at=? WHERE key=?").bind(JSON.stringify(result), now, stateKey).run();
  return result;
}
