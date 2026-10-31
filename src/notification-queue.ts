import { queueEmailDelivery, shortHash } from './db';
import { SEVERITY_RANK } from './config';
import { dingtalkConfigured, dingTalkDestination, queueDingTalkDelivery } from './dingtalk';
import { emailConfigured } from './notifications';
import type { Env, Signal } from './types';
import { queueWebhookDeliveries } from './webhook-notifications';

// Reconcile after every review pass, including polls without new X results.
// The persistent ingest flag prevents historical replay. Per-destination NOT
// EXISTS and the outbox unique key repair interrupted queueing safely.
export async function reconcileNotificationQueue(env: Env, now: string): Promise<number> {
  const destinations: Array<{channel: string; hash: string; queue: (signal: Signal) => Promise<unknown>}> = [];
  if (dingtalkConfigured(env)) destinations.push({channel: 'dingtalk',
    hash: await dingTalkDestination(env),
    queue: signal => queueDingTalkDelivery(env, signal, now)});
  if (emailConfigured(env)) destinations.push({channel: 'email',
    hash: await shortHash(env.ALERT_EMAIL_TO!.trim().toLowerCase()),
    queue: signal => queueEmailDelivery(env, signal, now)});
  let queued = 0;
  for (const destination of destinations) {
    const {results} = await env.DB.prepare(`SELECT s.signal_id,s.severity FROM signals s JOIN posts p ON p.post_id=s.post_id
      WHERE p.notification_eligible=1 AND s.should_notify=1 AND s.superseded_by_post_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM app_state a WHERE a.key='historical-repair:'||p.post_id)
      AND s.event_type!='unrelated'
      AND (p.source_tier!='D' OR (s.event_type='community_observation' AND s.content_confidence>=0.7
        AND EXISTS (SELECT 1 FROM model_reviews r WHERE r.post_id=p.post_id AND r.status='complete')))
      AND NOT EXISTS (SELECT 1 FROM deliveries d WHERE d.signal_id=s.signal_id AND d.channel=? AND d.destination_hash=?)
      ORDER BY s.created_at LIMIT 100`).bind(destination.channel,destination.hash).all<{signal_id:string;severity:Signal['severity']}>();
    for (const row of results) {
      // The user's all-visible policy applies to DingTalk. Preserve the
      // separately configured email threshold when that optional channel is on.
      const minimum=env.EMAIL_MIN_SEVERITY in SEVERITY_RANK?env.EMAIL_MIN_SEVERITY:'medium';
      if(destination.channel==='email'&&SEVERITY_RANK[row.severity]<SEVERITY_RANK[minimum])continue;
      await destination.queue({signalId: row.signal_id} as Signal);
      queued++;
    }
  }
  return queued + await queueWebhookDeliveries(env, now);
}
