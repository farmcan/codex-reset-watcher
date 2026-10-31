import type { Env } from './types';

const KEYS = ['id','kind','source','assurance','interval_start','interval_end','observed_at','signal_post_id'];
export interface ArrivalObservation {
  id: string;
  kind: 'quota_recovered'|'reset_card_granted'|'manual_reset_used'|'weekly_refill';
  source: 'account_probe'|'local_quota_telemetry'|'usage_reset_history';
  assurance: 'direct'|'account_unverified'|'inferred';
  interval_start: string;
  interval_end: string;
  observed_at: string;
  signal_post_id: string|null;
}

export function validateObservation(input: unknown): ArrivalObservation {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('invalid_observation');
  const row = input as Record<string,unknown>;
  if (Object.keys(row).length !== KEYS.length || Object.keys(row).some(k=>!KEYS.includes(k))) throw new Error('unexpected_fields');
  if (typeof row.id !== 'string' || !/^[a-z0-9:_-]{5,100}$/.test(row.id)) throw new Error('invalid_id');
  if (!['quota_recovered','reset_card_granted','manual_reset_used','weekly_refill'].includes(String(row.kind))) throw new Error('invalid_kind');
  if (!['account_probe','local_quota_telemetry','usage_reset_history'].includes(String(row.source))) throw new Error('invalid_source');
  if (!['direct','account_unverified','inferred'].includes(String(row.assurance))) throw new Error('invalid_assurance');
  for (const key of ['interval_start','interval_end','observed_at']) {
    if (typeof row[key] !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(row[key] as string) || !Number.isFinite(Date.parse(row[key] as string))) throw new Error('invalid_time');
  }
  if (Date.parse(row.interval_start as string)>Date.parse(row.interval_end as string) || Date.parse(row.interval_end as string)>Date.parse(row.observed_at as string)+60000 || Date.parse(row.observed_at as string)>Date.now()+60000) throw new Error('invalid_interval');
  if (row.signal_post_id !== null && (typeof row.signal_post_id !== 'string'||!/^\d{10,25}$/.test(row.signal_post_id))) throw new Error('invalid_post');
  if (row.source==='local_quota_telemetry' && row.assurance==='direct') throw new Error('historical_identity_unverified');
  // Manual use and normal weekly refill never claim to close a public rollout.
  if (['manual_reset_used','weekly_refill'].includes(String(row.kind)) && row.signal_post_id!==null) throw new Error('unrelated_refill');
  return row as unknown as ArrivalObservation;
}

export async function readObservations(env: Env) {
  const {results} = await env.DB.prepare("SELECT value FROM app_state WHERE key>='arrival:' AND key<'arrival;' ORDER BY key LIMIT 500").all<{value:string}>();
  const observations: ArrivalObservation[]=[];
  for(const row of results) {
    try {observations.push(validateObservation(JSON.parse(row.value)));} catch {/* Never expose malformed legacy data. */}
  }
  return {observations, coverage:'recorded_observations_only', generated_at:new Date().toISOString()};
}

export async function writeObservations(env: Env, input: unknown) {
  if(!Array.isArray(input)||!input.length||input.length>20) throw new Error('invalid_batch');
  const rows=input.map(validateObservation);
  const result=await env.DB.batch(rows.map(row=>env.DB.prepare('INSERT OR IGNORE INTO app_state(key,value,updated_at) VALUES (?,?,?)')
    .bind('arrival:'+row.id,JSON.stringify(row),new Date().toISOString())));
  return {accepted:rows.length,inserted:result.reduce((n,r)=>n+Number(r.meta.changes??0),0)};
}
