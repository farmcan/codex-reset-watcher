import type { Env } from './types';
import { shortHash } from './db';
import { sendQQNotice, sendQQGroupNotice } from './qq-client';

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
  const result = await sendQQNotice(env.QQ_TEST_APP_ID, env.QQ_TEST_APP_SECRET, env.QQ_TEST_OWNER_OPENID,
    '【Cloudflare 本人测试 · 非重置公告】\nCodex-Watcher QQ 主动通知链路测试。\n\nhttps://codex-reset-watcher.weican16hit.workers.dev/');
  result.runtime = 'cloudflare_worker';
  await env.DB.prepare('UPDATE app_state SET value=?,updated_at=? WHERE key=?').bind(JSON.stringify(result), now, stateKey).run();
  return result;
}

// Explicit, once-only commissioning test for the just-bound project group.
// Continuous group notifications must remain disabled until API acceptance and
// client readback are both checked; this probe never writes signal deliveries.
export async function testQQGroup(env: Env, key: string): Promise<Record<string, unknown>> {
  if (!env.QQ_APP_ID || !env.QQ_APP_SECRET || !env.QQ_GROUP_OPENID) {
    return { status: 'failed', error: 'group_test_not_configured' };
  }
  if (env.QQ_GROUP_NOTIFICATIONS_ENABLED === 'true') {
    return { status: 'failed', error: 'commissioning_test_requires_group_notifications_disabled' };
  }
  const now = new Date().toISOString();
  const stateKey = `qq-group-cloud-test:${await shortHash(`${env.QQ_APP_ID}:${env.QQ_GROUP_OPENID}`)}:${await shortHash(key)}`;
  const claim = await env.DB.prepare('INSERT OR IGNORE INTO app_state(key,value,updated_at) VALUES (?,?,?)')
    .bind(stateKey, JSON.stringify({ status: 'unknown', note: 'Claimed; do not replay', runtime: 'cloudflare_worker' }), now).run();
  if (!claim.meta.changes) {
    const prior = await env.DB.prepare('SELECT value FROM app_state WHERE key=?').bind(stateKey).first<{ value: string }>();
    return { ...JSON.parse(prior!.value), deduplicated: true };
  }
  const result = await sendQQGroupNotice(env.QQ_APP_ID, env.QQ_APP_SECRET, env.QQ_GROUP_OPENID,
    '【新建项目群连通测试 · 非重置公告】\nCodex Reset Watcher QQ 群通知链路测试。正式信号会与钉钉使用相同内容。\n\n查看雷达：https://codex-reset-watcher.weican16hit.workers.dev/');
  result.runtime = 'cloudflare_worker';
  result.scope = 'group';
  await env.DB.prepare('UPDATE app_state SET value=?,updated_at=? WHERE key=?').bind(JSON.stringify(result), now, stateKey).run();
  return result;
}
