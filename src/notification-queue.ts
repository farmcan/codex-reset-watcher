import { queueEmailDelivery, shortHash } from './db';
import { dingtalkConfigured, dingTalkDestination, queueDingTalkDelivery } from './dingtalk';
import { emailConfigured } from './notifications';
import type { Env, Signal } from './types';

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
      AND s.event_type!='unrelated'
      AND (p.source_tier!='D' OR (s.event_type='community_observation' AND s.content_confidence>=0.7
        AND EXISTS (SELECT 1 FROM model_reviews r WHERE r.post_id=p.post_id AND r.status='complete')))
      AND NOT EXISTS (SELECT 1 FROM deliveries d WHERE d.signal_id=s.signal_id AND d.channel=? AND d.destination_hash=?)
      ORDER BY s.created_at LIMIT 100`).bind(destination.channel,destination.hash).all<{signal_id:string;severity:Signal['severity']}>();
    for (const row of results) {
      await destination.queue({signalId: row.signal_id} as Signal);
      queued++;
    }
  }
  return queued;
}
