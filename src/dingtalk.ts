import { shortHash } from "./db";
import type { Env, Signal } from "./types";
import { DwsError, sendGroupPersonalDing, selectedDingRecipients } from './dws';
import { resetTiming } from './reset-time';

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
      body: JSON.stringify({ robotCode: env.DINGTALK_APP_KEY, openConversationId: group,
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
    AND NOT EXISTS (SELECT 1 FROM app_state a WHERE a.key='historical-repair:'||p.post_id)
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
  author: string; text: string; url: string; effective_time: string | null; created_at: string;
}

export function dingTalkContent(row: Omit<Row, "id" | "attempts">, personalDing = false): string {
  const timing = resetTiming(row);
  const title = timing.phase === 'scheduled' ? row.reset_mode === 'banked_reset' ? 'Codex 可储存重置预告' : 'Codex 重置预告'
    : timing.phase === 'confirmed' ? row.reset_mode === 'banked_reset' ? 'Codex 重置卡已公布' : 'Codex 重置已确认' : 'Codex 有新消息';
  const format = (at: string) => Number.isFinite(Date.parse(at)) ? new Intl.DateTimeFormat('zh-CN', {
    timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false
  }).format(new Date(at)) + '（北京时间）' : '未提供';
  const time = timing.reset_at ? `重置时间：${timing.approximate ? '约 ' : ''}${format(timing.reset_at)}`
    : timing.phase === 'confirmed' ? '重置时间：原文未公布精确时刻'
    : timing.scheduled_for ? `预计重置：${timing.approximate ? '约 ' : ''}${format(timing.scheduled_for)}` : '';
  const action = row.reset_mode === 'banked_reset' ? timing.phase === 'scheduled'
    ? '这是可储存重置的预告，尚未确认发放。'
    : timing.phase === 'confirmed' ? '这是可储存重置的确认公告，不是自动重置；请在额度页核对到账与使用说明。'
    : '原文涉及可储存重置，尚不能确认发放状态；以原帖及账户显示为准。'
    : timing.phase === 'confirmed' ? '可以去看看你的 Codex 额度是否到账了。'
    : timing.phase === 'scheduled' ? '有计划好的任务，可以提前安排起来。' : '有新线索，点开原文看看。';
  // Keep one canonical source link, even when the quoted post contains t.co links.
  // The stored source text remains unchanged; this only shortens the notice excerpt.
  const original = row.text.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/https?:\/\/\S+/gi,'').trim();
  const quote = (original.length > 1000 ? original.slice(0,997) + '…' : original).split('\n').map(line=>`> ${line}`).join('\n');
  return `${title}\n\n时间：${format(row.created_at)}${timing.phase === 'confirmed' ? ' · 确认公告' : ' · 原帖发布'}${time ? '\n'+time : ''}\n\n原文节选 · @${row.author}：\n${quote}\n\n${action}\n\n${row.url}`;
}

export async function processDingTalkDeliveries(env: Env, now = new Date().toISOString()): Promise<{ sent: number; failed: number }> {
  const summary = { sent: 0, failed: 0 };
  if (!dingtalkConfigured(env)) return summary;
  // A crashed invocation may have sent already. Quarantine instead of replaying.
  const cutoff = new Date(Date.parse(now) - 5 * 60_000).toISOString();
  await env.DB.prepare(`UPDATE deliveries SET status='unknown', last_error='Interrupted send; manual reconciliation required'
    WHERE channel='dingtalk' AND status='sending' AND next_attempt_at < ?`).bind(cutoff).run();
  const destination = await dingTalkDestination(env);
  const { results } = await env.DB.prepare(`SELECT d.id,d.attempts,s.event_type,s.reset_mode,s.effective_time,p.author,p.text,p.url,p.source_tier,p.created_at
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
    if (!env.DINGTALK_TEST_GROUP_ID || env.DINGTALK_TEST_GROUP_ID === env.DINGTALK_GROUP_ID) throw new DeliveryError('An isolated test group distinct from production is required','failed');
    const mockRow = {event_type:'scheduled_reset',reset_mode:'banked_reset',source_tier:'A1',author:'thsottiaux',text:'Next two days will be resets… banked…',url:'https://x.com/thsottiaux/status/2116405414921384099',effective_time:null,created_at:'2026-10-31T05:42:26.000Z'};
    const content=`【测试群专用 · 历史样例，不是新公告】\n${dingTalkContent(mockRow, personal)}`;
    const receipt = await sendDingTalk(env,content,`test-${key}`,env.DINGTALK_TEST_GROUP_ID);
    result = { status: "sent", runtime:'cloudflare_worker', provider_receipt: receipt, channel: personal?'personal_app_ding':'dingtalk_group_message', true_ding: personal, mentions_all_requested: true, mention_delivery_verified: false };
  } catch (error) { result = { status: error instanceof DeliveryError ? error.state : "unknown", error: error instanceof DeliveryError ? error.message : "Unknown result" }; }
  await env.DB.prepare("UPDATE app_state SET value=?,updated_at=? WHERE key=?").bind(JSON.stringify(result), now, stateKey).run();
  return result;
}
