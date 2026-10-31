import type { Env } from './types';
import { shortHash } from './db';
import { sendWeixinNotice } from './weixin-client';

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
  const result = await sendWeixinNotice(env.WEIXIN_TEST_BOT_TOKEN, env.WEIXIN_TEST_OWNER_ID, '【Cloudflare 本人测试 · 非重置公告】\nCodex-Watcher 微信云端通知链路测试。\n\nhttps://codex-reset-watcher.weican16hit.workers.dev/');
  result.runtime = 'cloudflare_worker';
  // A persistence failure must not turn a completed network write into a replay.
  await env.DB.prepare('UPDATE app_state SET value=?,updated_at=? WHERE key=?').bind(JSON.stringify(result), now, stateKey).run();
  return result;
}
