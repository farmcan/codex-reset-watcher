import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initializeWebhookChannels, queueWebhookDeliveries, processWebhookDeliveries, sendWebhook,
  testWebhook, validateWebhook, webhookHealth, boundedWebhookText } from '../src/webhook-notifications';
import { handleApi } from '../src/api';
import { testWeixin } from '../src/weixin-test';

const databases = [];
afterEach(() => { vi.unstubAllGlobals(); databases.splice(0).forEach(db => db.close()); });
const now = '2026-10-31T06:00:00.000Z';
const old = '2026-10-30T06:00:00.000Z';
function fixture() {
  const sqlite = new DatabaseSync(':memory:'); databases.push(sqlite);
  for (const file of ['0001_initial.sql','0002_model_reviews.sql','0003_delivery_receipt.sql','0004_notification_eligibility.sql'])
    sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const prepare = (sql, params = []) => ({ bind: (...args) => prepare(sql,args),
    run: async () => ({ meta: sqlite.prepare(sql).run(...params) }),
    all: async () => ({ results: sqlite.prepare(sql).all(...params) }), first: async () => sqlite.prepare(sql).get(...params) });
  for (const [id,at] of [['old',old],['new',now]]) {
    sqlite.prepare(`INSERT INTO posts(post_id,author,text,created_at,url,lane,source_tier,source_weight,raw_json,first_seen_at,notification_eligible)
      VALUES (?,'thsottiaux','Next two days will be resets… banked…',?,'https://x.com/thsottiaux/status/1','official','A1',1,'{}',?,1)`).run(id,at,at);
    sqlite.prepare(`INSERT INTO signals(signal_id,post_id,event_type,reset_mode,severity,confidence,content_confidence,evidence_basis,cluster_key,should_notify,reason,created_at)
      VALUES (?,?,'scheduled_reset','banked_reset','low',1,1,'first_party','cluster',1,'reason',?)`).run(`x:${id}`,id,at);
  }
  const env = { DB: {prepare}, FEISHU_WEBHOOK_URL:'https://open.feishu.cn/open-apis/bot/v2/hook/prod-bot',
    FEISHU_TEST_WEBHOOK_URL:'https://open.feishu.cn/open-apis/bot/v2/hook/test-bot',
    WECOM_WEBHOOK_URL:'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=prod-bot',
    WECOM_TEST_WEBHOOK_URL:'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test-bot' };
  return {env,sqlite};
}
const accepted = (channel) => new Response(JSON.stringify(channel === 'feishu' ? {code:0} : {errcode:0}));

describe('cloud webhook notifications', () => {
  it('does not borrow a previous Weixin owner probe as evidence for a different production owner', async () => {
    const {env}=fixture();Object.assign(env,{WEIXIN_TEST_BOT_TOKEN:'private-test',WEIXIN_TEST_OWNER_ID:'old-owner'});
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{"message_id":"owner-probe"}')));
    await testWeixin(env,'owner-probe-key');
    Object.assign(env,{WEIXIN_BOT_TOKEN:'private-production',WEIXIN_OWNER_ID:'new-owner',WEIXIN_NOTIFICATIONS_ENABLED:'true'});
    expect((await webhookHealth(env)).weixin.cloud_probe_accepted_at).toBeNull();
  });
  it('requires explicit Weixin enablement and queues only new signals for the authorized owner', async () => {
    const {env,sqlite}=fixture();delete env.FEISHU_WEBHOOK_URL;delete env.WECOM_WEBHOOK_URL;
    env.WEIXIN_BOT_TOKEN='private-owner-token';env.WEIXIN_OWNER_ID='authorized-owner';
    expect(await queueWebhookDeliveries(env,now)).toBe(0);
    env.WEIXIN_NOTIFICATIONS_ENABLED='true';await initializeWebhookChannels(env,now);
    expect(await queueWebhookDeliveries(env,now)).toBe(1);
    const fetch=vi.fn().mockResolvedValue(new Response('{"message_id":18446744073709551615}'));vi.stubGlobal('fetch',fetch);
    expect(await processWebhookDeliveries(env,now)).toEqual({sent:1,failed:0});
    expect(await processWebhookDeliveries(env,now)).toEqual({sent:0,failed:0});
    expect(fetch).toHaveBeenCalledTimes(1);
    const body=JSON.parse(fetch.mock.calls[0][1].body);expect(body.msg.to_user_id).toBe('authorized-owner');
    expect(body.msg.item_list[0].text_item.text).toContain('尚未确认发放');
    expect(sqlite.prepare('SELECT signal_id,channel,status FROM deliveries').all()).toMatchObject([{signal_id:'x:new',channel:'weixin',status:'sent'}]);
  });
  it('retains Weixin credential rejection and ambiguous outcomes without replay', async () => {
    const {env,sqlite}=fixture();delete env.FEISHU_WEBHOOK_URL;delete env.WECOM_WEBHOOK_URL;
    Object.assign(env,{WEIXIN_BOT_TOKEN:'private-owner-token',WEIXIN_OWNER_ID:'authorized-owner',WEIXIN_NOTIFICATIONS_ENABLED:'true'});
    await initializeWebhookChannels(env,now);await queueWebhookDeliveries(env,now);
    const fetch=vi.fn().mockResolvedValue(new Response('{"ret":-14,"errmsg":"private detail"}'));vi.stubGlobal('fetch',fetch);
    expect(await processWebhookDeliveries(env,now)).toEqual({sent:0,failed:1});
    expect((await webhookHealth(env)).weixin).toMatchObject({configured:true,status:'degraded',failed:1,automatic_token_refresh:false,owner_only:true});
    expect(sqlite.prepare('SELECT last_error FROM deliveries').get().last_error).toContain('-14');
    expect(await processWebhookDeliveries(env,now)).toEqual({sent:0,failed:0});expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('requires authorization and a supported channel before touching test destinations', async () => {
    const {env}=fixture();env.WEBHOOK_TEST_TOKEN='fixture-test-token';
    const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
    expect((await handleApi(new Request('https://example.test/api/admin/test-webhook?channel=feishu',{method:'POST'}),env)).status).toBe(401);
    expect((await handleApi(new Request('https://example.test/api/admin/test-webhook?channel=qq',{
      method:'POST',headers:{Authorization:'Bearer fixture-test-token','Idempotency-Key':'auth-check-123'}}),env)).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('accepts only official HTTPS endpoints and normalizes encoded keys before isolation checks', async () => {
    expect(validateWebhook('wecom','https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=%61bc'))
      .toBe(validateWebhook('wecom','https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc'));
    for (const url of ['http://open.feishu.cn/open-apis/bot/v2/hook/key',
      'https://evil.test/open-apis/bot/v2/hook/key', 'https://open.feishu.cn.evil.test/open-apis/bot/v2/hook/key',
      'https://user:pass@open.feishu.cn/open-apis/bot/v2/hook/key', 'https://open.feishu.cn/open-apis/bot/v2/hook/key?other=secret'])
      expect(() => validateWebhook('feishu',url)).toThrow('configuration invalid');
    const {env}=fixture(); env.WECOM_WEBHOOK_URL='https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc';
    env.WECOM_TEST_WEBHOOK_URL='https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=%61bc';
    const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
    expect(await testWebhook(env,'wecom','isolated-test')).toMatchObject({error:'test_destination_must_differ_from_production'});
    expect(fetch).not.toHaveBeenCalled();
  });
  it('queues every new visible level once per channel without replaying old or repaired signals', async () => {
    const {env,sqlite}=fixture();
    await initializeWebhookChannels(env,now);
    expect(await queueWebhookDeliveries(env,now)).toBe(2);
    expect(await queueWebhookDeliveries(env,now)).toBe(0);
    expect(sqlite.prepare('SELECT DISTINCT signal_id FROM deliveries').all()).toEqual([{signal_id:'x:new'}]);
    sqlite.prepare('DELETE FROM deliveries').run();
    sqlite.prepare("INSERT INTO app_state VALUES ('historical-repair:new','{}',?)").run(now);
    expect(await queueWebhookDeliveries(env,now)).toBe(0);
  });
  it('signs Feishu requests and requests real mentions for both providers', async () => {
    const {env}=fixture(); env.FEISHU_WEBHOOK_SECRET='fixture-signing-secret';
    const fetch=vi.fn().mockResolvedValueOnce(accepted('feishu')).mockResolvedValueOnce(accepted('wecom'));vi.stubGlobal('fetch',fetch);
    await sendWebhook(env,'feishu','notice');await sendWebhook(env,'wecom','notice');
    const first=JSON.parse(fetch.mock.calls[0][1].body);
    expect(first.content.text).toBe('<at user_id="all">所有人</at>\nnotice');
    const { createHmac } = await import('node:crypto');
    expect(first.sign).toBe(createHmac('sha256',`${first.timestamp}\nfixture-signing-secret`).update('').digest('base64'));
    expect(JSON.parse(fetch.mock.calls[1][1].body).text.mentioned_list).toEqual(['@all']);
    expect(fetch.mock.calls[0][1].redirect).toBe('manual');
  });
  it('fits WeCom Chinese and emoji within 2048 UTF-8 bytes and preserves the source URL', () => {
    const url='https://x.com/thsottiaux/status/2116405414921384099';
    const text=boundedWebhookText('公告\n\n'+ '中🙂'.repeat(1000)+'\n\n'+url);
    expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(2048);
    expect(text.endsWith(url)).toBe(true);expect(text).not.toContain('�');
  });
  it('persists acceptance separately per channel and never resends a completed delivery', async () => {
    const {env,sqlite}=fixture();await initializeWebhookChannels(env,now);await queueWebhookDeliveries(env,now);
    const fetch=vi.fn().mockResolvedValueOnce(accepted('feishu')).mockResolvedValueOnce(accepted('wecom'));vi.stubGlobal('fetch',fetch);
    expect(await processWebhookDeliveries(env,now)).toEqual({sent:2,failed:0});
    expect(await processWebhookDeliveries(env,now)).toEqual({sent:0,failed:0});
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sqlite.prepare("SELECT COUNT(*) n FROM deliveries WHERE status='sent'").get()).toMatchObject({n:2});
  });
  it('quarantines network ambiguity, redacts provider errors, and retries only explicit throttles', async () => {
    const {env,sqlite}=fixture();await initializeWebhookChannels(env,now);await queueWebhookDeliveries(env,now);
    const fetch=vi.fn().mockRejectedValueOnce(new Error('secret URL in transport error'))
      .mockResolvedValueOnce(new Response(JSON.stringify({errcode:45009,errmsg:env.WECOM_WEBHOOK_URL})));vi.stubGlobal('fetch',fetch);
    expect(await processWebhookDeliveries(env,now)).toEqual({sent:0,failed:2});
    const rows=sqlite.prepare('SELECT channel,status,last_error FROM deliveries ORDER BY channel').all();
    expect(rows).toMatchObject([{channel:'feishu',status:'unknown'},{channel:'wecom',status:'pending'}]);
    expect(JSON.stringify(rows)).not.toContain('https:');
    fetch.mockResolvedValueOnce(accepted('wecom'));
    expect(await processWebhookDeliveries(env,'2026-10-31T06:11:00.000Z')).toEqual({sent:1,failed:0});
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('deduplicates test sends and reports test acceptance independently from production', async () => {
    const {env}=fixture();const fetch=vi.fn().mockResolvedValue(accepted('feishu'));vi.stubGlobal('fetch',fetch);
    expect(await testWebhook(env,'feishu','test-cloud-123')).toMatchObject({status:'sent',acceptance_only:true,runtime:'cloudflare_worker'});
    expect(await testWebhook(env,'feishu','test-cloud-123')).toMatchObject({status:'sent',deduplicated:true});
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await webhookHealth(env)).feishu).toMatchObject({cloud_verified:false,test_group_verified_at:expect.any(String),mention_delivery_verified:false,true_ding:false});
  });
});
