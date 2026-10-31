import type { Env } from './types';
import { shortHash } from './db';

// QQ's 2026 official SDK sends proactive text without msg_id/event_id.
// Contract: tencent-connect/qqbot-nodejs 429a0f1b798f3b0fcef3679e207dbc0469a1df2d.
// An official SDK method does not establish this bot's entitlement or recipient delivery.
export async function testQQ(env: Env, key: string): Promise<Record<string, unknown>> {
  if (!env.QQ_TEST_APP_ID || !env.QQ_TEST_APP_SECRET || !env.QQ_TEST_OWNER_OPENID) {
    return { status: 'failed', error: 'owner_test_not_configured' };
  }
  const now = new Date().toISOString();
  const stateKey = `qq-cloud-test:${await shortHash(`${env.QQ_TEST_APP_ID}:${env.QQ_TEST_OWNER_OPENID}`)}:${await shortHash(key)}`;
  const claim = await env.DB.prepare('INSERT OR IGNORE INTO app_state(key,value,updated_at) VALUES (?,?,?)')
    .bind(stateKey, JSON.stringify({ status: 'unknown', note: 'Claimed; do not replay', runtime: 'cloudflare_worker' }), now).run();
  if (!claim.meta.changes) {
    const prior = await env.DB.prepare('SELECT value FROM app_state WHERE key=?').bind(stateKey).first<{ value: string }>();
    return { ...JSON.parse(prior!.value), deduplicated: true };
  }
  let result: Record<string, unknown>;
  // Token reads cannot deliver a message. Keep this distinct from ambiguous sends.
  let token: string | null = null;
  try {
    const response = await fetch('https://bots.qq.com/app/getAppAccessToken', {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(15_000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId: env.QQ_TEST_APP_ID, clientSecret: env.QQ_TEST_APP_SECRET })
    });
    const body = await response.json() as Record<string, unknown>;
    if (response.ok && typeof body.access_token === 'string' && body.access_token.trim()
      && Number(body.expires_in) > 0) token = body.access_token;
  } catch { /* No message was submitted. */ }
  if (!token) result = { status: 'failed', error: 'qq_token_unavailable_no_message_submitted' };
  else {
    try {
      const response = await fetch(`https://api.sgroup.qq.com/v2/users/${encodeURIComponent(env.QQ_TEST_OWNER_OPENID)}/messages`, {
        method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(20_000),
        headers: { 'Content-Type': 'application/json', Authorization: `QQBot ${token}` },
        body: JSON.stringify({ msg_type: 0, content: '【Cloudflare 本人测试 · 非重置公告】\nCodex-Watcher QQ 主动通知链路测试。\n\nhttps://codex-reset-watcher.weican16hit.workers.dev/' })
      });
      if (!response.ok) result = { status: response.status >= 400 && response.status < 500 ? 'failed' : 'unknown', error: `qq_send_http_${response.status}` };
      else {
        const body = await response.json() as Record<string, unknown>;
        const codes = [body.code, body.err_code].filter(value => value !== undefined);
        const malformed = codes.some(value => typeof value !== 'number');
        const rejected = codes.some(value => typeof value === 'number' && value !== 0);
        const id = typeof body.id === 'string' && body.id.trim() && body.id.length <= 256 ? body.id : null;
        result = malformed ? { status: 'unknown', error: 'invalid_business_response' }
          : rejected ? { status: 'failed', error: 'qq_business_rejected' }
          : id ? { status: 'sent', provider_receipt: id, acceptance_only: true }
          : { status: 'unknown', error: 'ambiguous_business_response' };
      }
    } catch { result = { status: 'unknown', error: 'send_outcome_unknown_do_not_replay' }; }
  }
  result.runtime = 'cloudflare_worker';
  await env.DB.prepare('UPDATE app_state SET value=?,updated_at=? WHERE key=?').bind(JSON.stringify(result), now, stateKey).run();
  return result;
}
