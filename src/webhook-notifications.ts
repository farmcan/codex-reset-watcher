import { shortHash } from './db';
import { dingTalkContent } from './dingtalk';
import type { Env } from './types';
import { WEBHOOK_CHANNELS, WebhookError, validateWebhook, sendWebhookNotice, type WebhookChannel } from './webhook-client';
export { WEBHOOK_CHANNELS, validateWebhook, boundedWebhookText, type WebhookChannel } from './webhook-client';

export function webhookConfig(env: Env, channel: WebhookChannel, test = false): { url: string; secret?: string } | null {
  const url = channel === 'feishu'
    ? test ? env.FEISHU_TEST_WEBHOOK_URL : env.FEISHU_WEBHOOK_URL
    : test ? env.WECOM_TEST_WEBHOOK_URL : env.WECOM_WEBHOOK_URL;
  if (!url) return null;
  return { url, secret: channel === 'feishu' ? test ? env.FEISHU_TEST_WEBHOOK_SECRET : env.FEISHU_WEBHOOK_SECRET : undefined };
}

export async function webhookDestination(env: Env, channel: WebhookChannel): Promise<string> {
  return shortHash(validateWebhook(channel, webhookConfig(env, channel)!.url));
}

function activationKey(channel: WebhookChannel, hash: string): string { return `webhook-activation:${channel}:${hash}`; }

// Activate before ingesting a poll. New destinations never replay the old ledger.
export async function initializeWebhookChannels(env: Env, now: string): Promise<void> {
  for (const channel of WEBHOOK_CHANNELS) {
    if (!webhookConfig(env, channel)) continue;
    try {
      const hash = await webhookDestination(env, channel);
      await env.DB.prepare('INSERT OR IGNORE INTO app_state(key,value,updated_at) VALUES (?,?,?)')
        .bind(activationKey(channel, hash), now, now).run();
    } catch (error) { if (!(error instanceof WebhookError)) throw error; }
  }
}

export async function queueWebhookDeliveries(env: Env, now: string): Promise<number> {
  let count = 0;
  await initializeWebhookChannels(env, now);
  for (const channel of WEBHOOK_CHANNELS) {
    if (!webhookConfig(env, channel)) continue;
    let hash: string;
    try { hash = await webhookDestination(env, channel); } catch { continue; }
    const active = await env.DB.prepare('SELECT value FROM app_state WHERE key=?')
      .bind(activationKey(channel, hash)).first<{ value: string }>();
    const result = await env.DB.prepare(`INSERT OR IGNORE INTO deliveries
      (signal_id,channel,destination_hash,status,attempts,next_attempt_at,created_at)
      SELECT s.signal_id,?,?,'pending',0,?,? FROM signals s JOIN posts p ON p.post_id=s.post_id
      WHERE p.notification_eligible=1 AND p.first_seen_at>=? AND s.should_notify=1
      AND s.superseded_by_post_id IS NULL AND s.event_type!='unrelated'
      AND NOT EXISTS (SELECT 1 FROM app_state a WHERE a.key='historical-repair:'||p.post_id)
      AND (p.source_tier!='D' OR (s.event_type='community_observation' AND s.content_confidence>=0.7
        AND EXISTS (SELECT 1 FROM model_reviews r WHERE r.post_id=p.post_id AND r.status='complete')))`)
      .bind(channel, hash, now, now, active!.value).run();
    count += Number(result.meta.changes ?? 0);
  }
  return count;
}

export async function sendWebhook(env: Env, channel: WebhookChannel, text: string, test = false): Promise<string> {
  const config = webhookConfig(env, channel, test);
  if (!config) throw new WebhookError(`${channel} ${test ? 'test ' : ''}webhook not configured`, 'failed');
  return JSON.stringify({ ...await sendWebhookNotice(channel, config, text, { mentionAll: true }), runtime: 'cloudflare_worker' });
}

interface NoticeRow {
  id: number; attempts: number; event_type: string; reset_mode: string; source_tier: string;
  author: string; text: string; url: string; effective_time: string | null; created_at: string;
}
export async function processWebhookDeliveries(env: Env, now: string): Promise<{ sent: number; failed: number }> {
  const summary = { sent: 0, failed: 0 };
  for (const channel of WEBHOOK_CHANNELS) {
    if (!webhookConfig(env, channel)) continue;
    let hash: string;
    try { hash = await webhookDestination(env, channel); } catch { summary.failed++; continue; }
    await env.DB.prepare(`UPDATE deliveries SET status='unknown',last_error='Interrupted send; do not replay'
      WHERE channel=? AND status='sending' AND next_attempt_at<?`)
      .bind(channel, new Date(Date.parse(now) - 5 * 60_000).toISOString()).run();
    const { results } = await env.DB.prepare(`SELECT d.id,d.attempts,s.event_type,s.reset_mode,s.effective_time,
      p.author,p.text,p.url,p.source_tier,p.created_at FROM deliveries d
      JOIN signals s ON s.signal_id=d.signal_id JOIN posts p ON p.post_id=s.post_id
      WHERE d.channel=? AND d.destination_hash=? AND d.status='pending' AND d.next_attempt_at<=?
      AND s.should_notify=1 AND s.superseded_by_post_id IS NULL ORDER BY d.created_at LIMIT 10`)
      .bind(channel, hash, now).all<NoticeRow>();
    for (const row of results) {
      const claim = await env.DB.prepare(`UPDATE deliveries SET status='sending',attempts=attempts+1,next_attempt_at=?
        WHERE id=? AND status='pending'`).bind(now, row.id).run();
      if (!claim.meta.changes) continue;
      let receipt: string;
      try { receipt = await sendWebhook(env, channel, dingTalkContent(row)); }
      catch (error) {
        const state = error instanceof WebhookError ? error.state : 'unknown';
        await env.DB.prepare('UPDATE deliveries SET status=?,next_attempt_at=?,last_error=? WHERE id=?')
          .bind(state === 'pending' && row.attempts >= 2 ? 'failed' : state,
            new Date(Date.parse(now) + 10 * 60_000).toISOString(),
            error instanceof WebhookError ? error.message : `${channel} outcome unknown`, row.id).run();
        summary.failed++; continue;
      }
      await env.DB.prepare(`UPDATE deliveries SET status='sent',sent_at=?,provider_receipt=?,last_error=NULL WHERE id=?`)
        .bind(now, receipt, row.id).run();
      summary.sent++;
    }
  }
  return summary;
}

export async function webhookHealth(env: Env): Promise<Record<string, unknown>> {
  const health: Record<string, unknown> = {};
  for (const channel of WEBHOOK_CHANNELS) {
    const configured = Boolean(webhookConfig(env, channel));
    const test = webhookConfig(env, channel, true);
    let proof: { updated_at: string } | null = null;
    if (test) {
      try {
        const testHash = await shortHash(validateWebhook(channel, test.url));
        proof = await env.DB.prepare('SELECT updated_at FROM app_state WHERE key=?')
          .bind(`webhook-test-success:${channel}:${testHash}`).first<{ updated_at: string }>();
      } catch (error) { if (!(error instanceof WebhookError)) throw error; }
    }
    if (!configured) { health[channel] = { configured: false, status: 'disabled', cloud_verified: false,
      test_group_verified_at: proof?.updated_at ?? null }; continue; }
    let hash: string;
    try { hash = await webhookDestination(env, channel); }
    catch { health[channel] = { configured: true, status: 'invalid_configuration', cloud_verified: false }; continue; }
    const counts = await env.DB.prepare(`SELECT COALESCE(SUM(status='failed'),0) AS failed,
      COALESCE(SUM(status='unknown'),0) AS unknown,COALESCE(SUM(status='pending'),0) AS pending,
      MIN(CASE WHEN status IN ('pending','sending') THEN created_at END) AS oldest_pending_at,
      MAX(sent_at) AS last_sent_at FROM deliveries WHERE channel=? AND destination_hash=?`)
      .bind(channel, hash).first<Record<string, unknown>>();
    const stale = typeof counts?.oldest_pending_at === 'string' && Date.now() - Date.parse(counts.oldest_pending_at) > 20 * 60_000;
    health[channel] = { configured, ...counts, status: Number(counts?.failed) || Number(counts?.unknown) || stale ? 'degraded' : 'healthy',
      cloud_verified: Boolean(counts?.last_sent_at), test_group_verified_at: proof?.updated_at ?? null,
      mentions_all_requested: true, mention_delivery_verified: false, true_ding: false };
  }
  return health;
}

export async function testWebhook(env: Env, channel: WebhookChannel, key: string): Promise<Record<string, unknown>> {
  const testConfig = webhookConfig(env, channel, true);
  if (!testConfig) return { status: 'failed', error: 'isolated_test_webhook_required' };
  let target: string;
  try { target = validateWebhook(channel, testConfig.url); }
  catch { return { status: 'failed', error: 'invalid_test_configuration' }; }
  const production = webhookConfig(env, channel);
  if (production && target === validateWebhook(channel, production.url)) return { status: 'failed', error: 'test_destination_must_differ_from_production' };
  const hash = await shortHash(target);
  const stateKey = `webhook-test:${channel}:${hash}:${await shortHash(key)}`;
  const now = new Date().toISOString();
  const claim = await env.DB.prepare('INSERT OR IGNORE INTO app_state(key,value,updated_at) VALUES (?,?,?)')
    .bind(stateKey, JSON.stringify({ status: 'unknown', note: 'Claimed; do not replay' }), now).run();
  if (!claim.meta.changes) {
    const prior = await env.DB.prepare('SELECT value FROM app_state WHERE key=?').bind(stateKey).first<{ value: string }>();
    return { ...JSON.parse(prior!.value), deduplicated: true };
  }
  let result: Record<string, unknown>;
  try {
    const receipt = JSON.parse(await sendWebhook(env, channel, '【独立测试群 · 非重置公告】\nCodex-Watcher 云端通知链路测试。\n\nhttps://codex-reset-watcher.weican16hit.workers.dev/', true));
    result = { status: 'sent', ...receipt };
  } catch (error) { result = { status: error instanceof WebhookError ? error.state : 'unknown',
    error: error instanceof WebhookError ? error.message : 'outcome_unknown' }; }
  await env.DB.prepare('UPDATE app_state SET value=?,updated_at=? WHERE key=?').bind(JSON.stringify(result), now, stateKey).run();
  if (result.status === 'sent') await env.DB.prepare('INSERT OR REPLACE INTO app_state(key,value,updated_at) VALUES (?,?,?)')
    .bind(`webhook-test-success:${channel}:${hash}`, 'accepted', now).run();
  return result;
}
