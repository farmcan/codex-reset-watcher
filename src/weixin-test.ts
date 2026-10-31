import type { Env } from './types';
import { shortHash } from './db';
import { parseWeixinApiJson } from './vendor/weixin-json';

// Isolated owner-only cloud probe. No inbound polling, automatic reset, or task execution.
// The recipient and text cannot be supplied by the HTTP caller.
export async function testWeixin(env: Env, key: string): Promise<Record<string, unknown>> {
  if (!env.WEIXIN_TEST_BOT_TOKEN || !env.WEIXIN_TEST_OWNER_ID) return { status: 'failed', error: 'owner_test_not_configured' };
  const now = new Date().toISOString();
  const stateKey = `weixin-cloud-test:${await shortHash(env.WEIXIN_TEST_OWNER_ID)}:${await shortHash(key)}`;
  const claim = await env.DB.prepare('INSERT OR IGNORE INTO app_state(key,value,updated_at) VALUES (?,?,?)')
    .bind(stateKey, JSON.stringify({ status: 'unknown', runtime: 'cloudflare_worker', note: 'Claimed; do not replay' }), now).run();
  if (!claim.meta.changes) {
    const prior = await env.DB.prepare('SELECT value FROM app_state WHERE key=?').bind(stateKey).first<{ value: string }>();
    return { ...JSON.parse(prior!.value), deduplicated: true };
  }
  let result: Record<string, unknown>;
  try {
    const response = await fetch('https://ilinkai.weixin.qq.com/ilink/bot/sendmessage', {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(20_000),
      headers: { 'Content-Type': 'application/json', AuthorizationType: 'ilink_bot_token',
        Authorization: `Bearer ${env.WEIXIN_TEST_BOT_TOKEN}`, 'iLink-App-Id': 'bot', 'iLink-App-ClientVersion': '132106',
        'X-WECHAT-UIN': btoa(String(crypto.getRandomValues(new Uint32Array(1))[0])) },
      body: JSON.stringify({ msg: { from_user_id: '', to_user_id: env.WEIXIN_TEST_OWNER_ID,
        client_id: `watcher-cloud-${crypto.randomUUID()}`, message_type: 2, message_state: 2,
        item_list: [{ type: 1, text_item: { text: '【Cloudflare 本人测试 · 非重置公告】\nCodex-Watcher 微信云端通知链路测试。\n\nhttps://codex-reset-watcher.weican16hit.workers.dev/' } }] },
        base_info: { channel_version: '2.4.10', bot_agent: 'CodexResetWatcher/0.1.0 (personal-test)' } })
    });
    if (!response.ok) result = { status: response.status >= 400 && response.status < 500 ? 'failed' : 'unknown', error: `weixin_http_${response.status}` };
    else {
      const body = parseWeixinApiJson<Record<string, unknown>>(await response.text());
      const fields = [body.ret, body.errcode].filter(value => value !== undefined);
      const bad = fields.some(value => typeof value !== 'number');
      const rejected = fields.some(value => typeof value === 'number' && value !== 0);
      const id = typeof body.message_id === 'string' && body.message_id.trim() && body.message_id.length <= 128 ? body.message_id : null;
      result = bad ? { status: 'unknown', error: 'invalid_business_response' }
        : rejected ? { status: 'failed', error: 'weixin_business_rejected' }
        : body.ret === 0 || body.errcode === 0 || id ? { status: 'sent', provider_receipt: id, acceptance_only: true }
        : { status: 'unknown', error: 'ambiguous_business_response' };
    }
  } catch { result = { status: 'unknown', error: 'send_outcome_unknown_do_not_replay' }; }
  result.runtime = 'cloudflare_worker';
  // A persistence failure must not turn a completed network write into a replay.
  await env.DB.prepare('UPDATE app_state SET value=?,updated_at=? WHERE key=?').bind(JSON.stringify(result), now, stateKey).run();
  return result;
}
