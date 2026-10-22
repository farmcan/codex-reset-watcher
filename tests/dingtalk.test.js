import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { queueDingTalkDelivery, processDingTalkDeliveries, testDingTalk, dingTalkContent } from "../src/dingtalk";

const databases = [];
afterEach(() => { vi.unstubAllGlobals(); databases.splice(0).forEach(db => db.close()); });
const now = "2026-10-22T12:30:00.000Z";
function fixture() {
  const sqlite = new DatabaseSync(":memory:"); databases.push(sqlite);
  for (const file of ["0001_initial.sql", "0002_model_reviews.sql", "0003_delivery_receipt.sql"]) sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  const prepare = (sql, params = []) => ({ bind: (...args) => prepare(sql, args),
    run: async () => ({meta: sqlite.prepare(sql).run(...params)}),
    all: async () => ({results: sqlite.prepare(sql).all(...params)}),
    first: async () => sqlite.prepare(sql).get(...params) });
  sqlite.prepare(`INSERT INTO posts(post_id,author,text,created_at,url,lane,source_tier,source_weight,raw_json,first_seen_at)
    VALUES ('p','tibo','reset announced',?,'https://x.com/tibo/status/1','official','A1',1,'{}',?)`).run(now, now);
  sqlite.prepare(`INSERT INTO signals(signal_id,post_id,event_type,reset_mode,severity,confidence,content_confidence,evidence_basis,cluster_key,should_notify,reason,created_at)
    VALUES ('s','p','scheduled_reset','hard_reset','high',1,1,'first_party','cluster',1,'reason',?)`).run(now);
  const env = { DB: {prepare}, DINGTALK_APP_KEY: crypto.randomUUID(), DINGTALK_APP_SECRET: 'fixture-secret', DINGTALK_GROUP_ID: 'fixture-group' };
  return {env, sqlite};
}
const tokenResponse = () => new Response(JSON.stringify({ accessToken: "fixture-token", expireIn: 7200 }), {status: 200});
async function queued() { const f = fixture(); await queueDingTalkDelivery(f.env, { signalId: "s" }, now); return f; }

describe("durable cloud DingTalk delivery", () => {
  it("deduplicates enqueue and accepted sends, retaining provider receipt", async () => {
    const {env,sqlite} = await queued(); await queueDingTalkDelivery(env,{signalId:'s'},now);
    const fetch = vi.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(new Response('{"processQueryKey":"receipt"}'));
    vi.stubGlobal('fetch',fetch);
    expect(await processDingTalkDeliveries(env,now)).toEqual({sent:1,failed:0});
    await processDingTalkDeliveries(env,now);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sqlite.prepare('SELECT status,attempts,provider_receipt FROM deliveries').get()).toMatchObject({status:'sent',attempts:1,provider_receipt:'receipt'});
    const payload=JSON.parse(fetch.mock.calls[1][1].body);
    expect(payload.openConversationId).toBe('fixture-group');
    expect(JSON.parse(payload.msgParam).content).toContain('非 DING');
  });
  it("quarantines ambiguous network results and never retries them", async () => {
    const {env,sqlite}=await queued(); const fetch=vi.fn().mockResolvedValueOnce(tokenResponse()).mockRejectedValueOnce(new Error('timeout'));
    vi.stubGlobal('fetch',fetch);await processDingTalkDeliveries(env,now);await processDingTalkDeliveries(env,'2026-10-22T14:30:00.000Z');
    expect(sqlite.prepare('SELECT status FROM deliveries').get().status).toBe('unknown');expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("does not replay a send interrupted before receipt persistence", async () => {
    const {env,sqlite}=await queued();sqlite.prepare("UPDATE deliveries SET status='sending',next_attempt_at='2026-10-22T12:00:00Z'").run();
    const fetch=vi.fn();vi.stubGlobal('fetch',fetch);await processDingTalkDeliveries(env,now);
    expect(sqlite.prepare('SELECT status FROM deliveries').get().status).toBe('unknown');expect(fetch).not.toHaveBeenCalled();
  });
  it("retries token failures at most twice after the original attempt", async () => {
    const {env,sqlite}=await queued();const fetch=vi.fn().mockRejectedValue(new Error('offline'));vi.stubGlobal('fetch',fetch);
    for(const time of [now,'2026-10-22T13:00:00Z','2026-10-22T14:00:00Z','2026-10-22T15:00:00Z'])await processDingTalkDeliveries(env,time);
    expect(fetch).toHaveBeenCalledTimes(3);expect(sqlite.prepare('SELECT status,attempts FROM deliveries').get()).toMatchObject({status:'failed',attempts:3});
  });
  it("requires a receipt and isolates unknown business outcomes", async () => {
    const {env,sqlite}=await queued();vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(new Response('{}')));
    await processDingTalkDeliveries(env,now);expect(sqlite.prepare('SELECT status FROM deliveries').get().status).toBe('unknown');
  });
  it("does not send superseded or suppressed signals", async () => {
    const {env,sqlite}=await queued();sqlite.prepare('UPDATE signals SET should_notify=0').run();const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
    await processDingTalkDeliveries(env,now);expect(fetch).not.toHaveBeenCalled();
  });
  it("persists test idempotency so a repeated admin request sends once", async () => {
    const {env}=fixture();const fetch=vi.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(new Response('{"processQueryKey":"test-receipt"}'));
    vi.stubGlobal('fetch',fetch);expect((await testDingTalk(env,'release-test-1')).status).toBe('sent');
    expect(await testDingTalk(env,'release-test-1')).toMatchObject({status:'sent',deduplicated:true});expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("preserves banked-reset action boundaries", () => {
    expect(dingTalkContent({event_type:'explicit_reset',reset_mode:'banked_reset',source_tier:'A1',author:'tibo',text:'banked',url:'https://x.com/tibo/status/1',effective_time:null})).toContain('不等同自动 hard reset');
  });
});
