import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reconcileNotificationQueue } from "../src/notification-queue";
import { sealDwsSession, dwsAccessToken, sendGroupPersonalDing } from '../src/dws';
import { processReviews } from "../src/model-review";
import { shortHash } from '../src/db';
import { queueDingTalkDelivery, processDingTalkDeliveries, testDingTalk, dingTalkContent, dingTalkHealth } from "../src/dingtalk";

const databases = [];
afterEach(() => { vi.unstubAllGlobals(); databases.splice(0).forEach(db => db.close()); });
const now = "2026-10-22T12:30:00.000Z";
function fixture() {
  const sqlite = new DatabaseSync(":memory:"); databases.push(sqlite);
  for (const file of ["0001_initial.sql", "0002_model_reviews.sql", "0003_delivery_receipt.sql", "0004_notification_eligibility.sql"]) sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  const prepare = (sql, params = []) => ({ bind: (...args) => prepare(sql, args),
    run: async () => ({meta: sqlite.prepare(sql).run(...params)}),
    all: async () => ({results: sqlite.prepare(sql).all(...params)}),
    first: async () => sqlite.prepare(sql).get(...params) });
  sqlite.prepare(`INSERT INTO posts(post_id,author,text,created_at,url,lane,source_tier,source_weight,raw_json,first_seen_at)
    VALUES ('p','tibo','reset announced',?,'https://x.com/tibo/status/1','official','A1',1,'{}',?)`).run(now, now);
  sqlite.prepare(`INSERT INTO signals(signal_id,post_id,event_type,reset_mode,severity,confidence,content_confidence,evidence_basis,cluster_key,should_notify,reason,created_at)
    VALUES ('x:p','p','scheduled_reset','hard_reset','high',1,1,'first_party','cluster',1,'reason',?)`).run(now);
  const env = { DB: {prepare}, DINGTALK_APP_KEY: crypto.randomUUID(), DINGTALK_APP_SECRET: 'fixture-secret', DINGTALK_GROUP_ID: 'fixture-group' };
  return {env, sqlite};
}
const tokenResponse = () => new Response(JSON.stringify({ accessToken: "fixture-token", expireIn: 7200 }), {status: 200});
async function queued() { const f = fixture(); await queueDingTalkDelivery(f.env, { signalId: "x:p" }, now); return f; }
const rpc = result => new Response(JSON.stringify({jsonrpc:'2.0',id:1,result:{content:[{type:'text',text:JSON.stringify({success:true,result})}]}}));
async function personalFixture() {
  const f=fixture();f.env.DINGTALK_MODE='personal_ding';f.env.DINGTALK_TEST_GROUP_ID='isolated-test-group';
  f.env.DWS_TOKEN_KEY=btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
  const value=await sealDwsSession(f.env,{access_token:'private-access',refresh_token:'private-refresh',client_id:'client',expires_at:new Date(Date.now()+3600_000).toISOString(),refresh_expires_at:new Date(Date.now()+86400_000).toISOString()});
  f.sqlite.prepare('INSERT INTO app_state(key,value,updated_at) VALUES (?,?,?)').run('dws_oauth_v1',value,now);
  return f;
}

describe("durable cloud DingTalk delivery", () => {
  it('completes the newly selected audience using existing receipts without resending or discarding the group audit',async()=>{
    const {env,sqlite}=await personalFixture();env.DINGTALK_RECIPIENT_IDS=JSON.stringify(['a','b']);
    const group=env.DINGTALK_GROUP_ID;
    const key='dws-send:'+await shortHash(group+':selected-existing');
    const state={receivers:['a','b','c'],dingIds:['ding-ab'],receipts:{a:'ding-ab',b:'ding-ab'},blocked:{c:'not_colleague_or_friend'},messageId:'existing-message',strategy:'group_message'};
    sqlite.prepare('INSERT INTO app_state(key,value,updated_at) VALUES (?,?,?)').run(key,JSON.stringify(state),now);
    const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
    expect(JSON.parse(await sendGroupPersonalDing(env,group,'notice','selected-existing'))).toMatchObject({recipientCount:2,groupMemberCount:3,recipientScope:'selected_members',openMessageId:'existing-message'});
    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.parse(sqlite.prepare('SELECT value FROM app_state WHERE key=?').get(key).value).blocked.c).toBe('not_colleague_or_friend');
    expect(await dingTalkHealth(env,now)).toMatchObject({recipient_scope:'selected_members',configured_recipient_count:2,mentions_all_requested:true,ding_all_requested:false});
  });
  it('DINGs only selected recipients while marking the group message as a real @all',async()=>{
    const {env}=await personalFixture();env.DINGTALK_RECIPIENT_IDS='["self","er24"]';
    const fetch=vi.fn().mockResolvedValueOnce(rpc({hasMore:false,list:[{openDingtalkId:'self'},{openDingtalkId:'er24'},{openDingtalkId:'other'}]}))
      .mockResolvedValueOnce(rpc({openDingId:'selected-ding'})).mockResolvedValueOnce(rpc({openTaskId:'all-task'}))
      .mockResolvedValueOnce(rpc({sendStatus:'SUCCESS',openMessageId:'all-message'}));vi.stubGlobal('fetch',fetch);
    const receipt=JSON.parse(await sendGroupPersonalDing(env,env.DINGTALK_GROUP_ID,'new update','selected-with-all'));
    const calls=fetch.mock.calls.map(c=>JSON.parse(c[1].body).params);
    expect(calls[1].arguments.receiverOpenDingTalkIds).toEqual(['er24','self']);
    expect(calls[2]).toMatchObject({name:'send_personal_message',arguments:{atAll:true,msgType:'markdown'}});
    expect(JSON.parse(calls[2].arguments.content).text).toBe('<@all>\nnew update');
    expect(receipt).toMatchObject({recipientCount:2,groupMemberCount:3,groupMentionsAllRequested:true});
  });
  it('fails closed for an empty selected audience and a selected person absent from the group',async()=>{
    const {env}=await personalFixture();env.DINGTALK_RECIPIENT_IDS='[]';
    const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
    await expect(sendGroupPersonalDing(env,env.DINGTALK_GROUP_ID,'notice','empty')).rejects.toThrow('Invalid selected');
    expect(fetch).not.toHaveBeenCalled();
    env.DINGTALK_RECIPIENT_IDS='["absent"]';fetch.mockResolvedValueOnce(rpc({hasMore:false,list:[{openDingtalkId:'present'}]}));
    await expect(sendGroupPersonalDing(env,env.DINGTALK_GROUP_ID,'notice','missing')).rejects.toThrow('missing from the group');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('does not filter new visible weak hints by email severity',async()=>{
    const {env,sqlite}=fixture();env.EMAIL_MIN_SEVERITY='high';
    Object.assign(env,{EMAIL_PROVIDER:'resend',RESEND_API_KEY:'fixture',ALERT_EMAIL_FROM:'from@example.test',ALERT_EMAIL_TO:'to@example.test'});
    sqlite.prepare("UPDATE posts SET notification_eligible=1").run();
    sqlite.prepare("UPDATE signals SET event_type='weak_hint',severity='low'").run();
    expect(await reconcileNotificationQueue(env,now)).toBe(1);
    expect(sqlite.prepare('SELECT count(*) AS n FROM deliveries').get().n).toBe(1);
    expect(sqlite.prepare('SELECT channel FROM deliveries').get().channel).toBe('dingtalk');
  });
  it('sends actual app DING to every group member before retaining the group message, exactly once',async()=>{
    const {env,sqlite}=await personalFixture();
    const fetch=vi.fn().mockResolvedValueOnce(rpc({hasMore:false,list:[{openDingtalkId:'self'},{openDingtalkId:'er24'}]}))
      .mockResolvedValueOnce(rpc({openDingId:'ding-receipt'})).mockResolvedValueOnce(rpc({openTaskId:'task'}))
      .mockResolvedValueOnce(rpc({sendStatus:'SUCCESS',openMessageId:'message'}));vi.stubGlobal('fetch',fetch);
    const result=JSON.parse(await sendGroupPersonalDing(env,'isolated-test-group','mock notice','stable-key'));
    expect(result).toMatchObject({openDingIds:['ding-receipt'],recipientCount:2,openMessageId:'message'});
    await sendGroupPersonalDing(env,'isolated-test-group','mock notice','stable-key');
    expect(fetch).toHaveBeenCalledTimes(4);
    const calls=fetch.mock.calls.map(c=>JSON.parse(c[1].body).params);
    expect(calls[1]).toMatchObject({name:'send_personal_ding',arguments:{remindType:'APP',receiverOpenDingTalkIds:['er24','self']}});
    expect(calls[2].arguments.openConversationId).toBe('isolated-test-group');
    const encrypted=sqlite.prepare("SELECT value FROM app_state WHERE key='dws_oauth_v1'").get().value;
    expect(encrypted).not.toContain('private-access');expect(encrypted).not.toContain('private-refresh');
  });
  it('never substitutes a plain group message after DING rejection',async()=>{
    const {env}=await personalFixture();const fetch=vi.fn().mockResolvedValueOnce(rpc({hasMore:false,list:[{openDingtalkId:'self'}]}))
      .mockResolvedValueOnce(new Response(JSON.stringify({result:{content:[{type:'text',text:JSON.stringify({success:false,errorCode:'DENIED'})}]}})));
    vi.stubGlobal('fetch',fetch);await expect(sendGroupPersonalDing(env,'isolated','mock','denied')).rejects.toThrow('DENIED');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('tries a source-group DING after explicit personal DING permission rejection, requiring a DING receipt',async()=>{
    const {env}=await personalFixture();const fetch=vi.fn().mockResolvedValueOnce(rpc({hasMore:false,list:[{openDingtalkId:'self'}]}))
      .mockResolvedValueOnce(new Response(JSON.stringify({result:{content:[{type:'text',text:JSON.stringify({success:false,errorCode:'FORBIDDEN'})}]}})))
      .mockResolvedValueOnce(rpc({openTaskId:'task'})).mockResolvedValueOnce(rpc({sendStatus:'SUCCESS',openMessageId:'message'}))
      .mockResolvedValueOnce(rpc({openDingId:'group-ding'}));vi.stubGlobal('fetch',fetch);
    expect(JSON.parse(await sendGroupPersonalDing(env,'isolated','notice','context'))).toMatchObject({openDingIds:['group-ding'],openMessageId:'message'});
    expect(JSON.parse(fetch.mock.calls[4][1].body).params).toMatchObject({name:'send_ding_by_message',arguments:{openConversationId:'isolated',openMessageId:'message',remindType:'APP'}});
  });
  it('isolates blocked members, notifies reachable members, and never repeats their DING on retry',async()=>{
    const {env}=await personalFixture();
    const forbidden=()=>new Response(JSON.stringify({result:{content:[{type:'text',text:JSON.stringify({success:false,errorCode:'FORBIDDEN',errorMsg:'no permission: sender and receiver are neither colleagues nor friends'})}]}}));
    const fetch=vi.fn().mockResolvedValueOnce(rpc({hasMore:false,list:[{openDingtalkId:'a'},{openDingtalkId:'b'}]}))
      .mockResolvedValueOnce(forbidden()).mockResolvedValueOnce(rpc({openTaskId:'task'}))
      .mockResolvedValueOnce(rpc({sendStatus:'SUCCESS',openMessageId:'message'})).mockResolvedValueOnce(forbidden())
      .mockResolvedValueOnce(rpc({openDingId:'ding-a'})).mockResolvedValueOnce(forbidden())
      .mockResolvedValueOnce(rpc({openDingId:'ding-b'}));vi.stubGlobal('fetch',fetch);
    await expect(sendGroupPersonalDing(env,'isolated','notice','partial')).rejects.toThrow('coverage partial: 1/2');
    expect(JSON.parse(await sendGroupPersonalDing(env,'isolated','notice','partial'))).toMatchObject({openDingIds:['ding-a','ding-b'],recipientCount:2});
    expect(JSON.parse(fetch.mock.calls[7][1].body).params.arguments.receiverOpenDingTalkIds).toEqual(['b']);
    expect(fetch).toHaveBeenCalledTimes(8);
  });
  it('refreshes the independent session and persists the rotated token encrypted',async()=>{
    const {env,sqlite}=await personalFixture();const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({accessToken:'rotated-access',refreshToken:'rotated-refresh',expiresIn:7200})));vi.stubGlobal('fetch',fetch);
    expect(await dwsAccessToken(env,true)).toBe('rotated-access');
    expect(await dwsAccessToken(env)).toBe('rotated-access');expect(fetch).toHaveBeenCalledTimes(1);
    const encrypted=sqlite.prepare("SELECT value FROM app_state WHERE key='dws_oauth_v1'").get().value;
    expect(encrypted).not.toContain('rotated-refresh');
  });
  it('requires an isolated group for personal DING tests instead of using the production group',async()=>{
    const {env}=await personalFixture();delete env.DINGTALK_TEST_GROUP_ID;const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
    expect(await testDingTalk(env,'missing-test-group')).toMatchObject({status:'failed'});expect(fetch).not.toHaveBeenCalled();
  });
  it('surfaces missing outbox rows and failed deliveries as unhealthy',async()=>{
    const {env,sqlite}=fixture();sqlite.prepare('UPDATE posts SET notification_eligible=1').run();
    expect(await dingTalkHealth(env,now)).toMatchObject({status:'degraded',unqueued_eligible:1});
    await reconcileNotificationQueue(env,now);
    expect(await dingTalkHealth(env,now)).toMatchObject({status:'healthy',unqueued_eligible:0});
    sqlite.prepare("UPDATE deliveries SET status='failed'").run();
    expect(await dingTalkHealth(env,now)).toMatchObject({status:'degraded',failed:1});
  });
  it('does not blindly consume a rotating refresh token again after an unknown refresh result',async()=>{
    const {env}=await personalFixture();const fetch=vi.fn().mockRejectedValue(new Error('network'));vi.stubGlobal('fetch',fetch);
    await expect(dwsAccessToken(env,true)).rejects.toThrow('unknown');
    await expect(dwsAccessToken(env,true)).rejects.toThrow('unknown');expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('resumes an accepted group-message task without repeating DING or group writes',async()=>{
    const {env}=await personalFixture();const fetch=vi.fn().mockResolvedValueOnce(rpc({hasMore:false,list:[{openDingtalkId:'self'}]}))
      .mockResolvedValueOnce(rpc({openDingId:'ding'})).mockResolvedValueOnce(rpc({openTaskId:'task'}))
      .mockResolvedValueOnce(rpc({sendStatus:'PROCESSING'})).mockResolvedValueOnce(rpc({sendStatus:'SUCCESS',openMessageId:'msg'}));vi.stubGlobal('fetch',fetch);
    expect(await testDingTalk(env,'pending-task')).toMatchObject({status:'pending'});
    expect(await testDingTalk(env,'pending-task')).toMatchObject({status:'sent',true_ding:true});
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(fetch.mock.calls.map(c=>JSON.parse(c[1].body).params.name).filter(n=>n==='send_personal_ding')).toHaveLength(1);
  });
  it("queues a new short reset discovered only by review, and repairs interrupted enqueue once", async () => {
    const {env,sqlite}=fixture();
    sqlite.prepare("UPDATE posts SET author='thsottiaux',text='Day 20/ Rest and reset',notification_eligible=1").run();
    sqlite.prepare("DELETE FROM signals").run();
    env.DASHSCOPE_API_KEY='fixture';
    const verdict={post_id:'p',event_type:'explicit_reset',reset_mode:'unknown',confidence:0.9,reason:'Official daily reset update',title_zh:'重置更新',title_en:'Reset update',summary_zh:'官方重置更新，模式未明',summary_en:'Official reset update; mode unspecified',evidence:['Rest and reset'],effective_time:null,approximate_time:false};
    const fetch=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({reviews:[verdict]})}}]})))
      .mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(new Response('{"processQueryKey":"review-promoted-receipt"}'));
    vi.stubGlobal('fetch',fetch);
    await processReviews(env);
    expect(sqlite.prepare('SELECT should_notify FROM signals').get().should_notify).toBe(1);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM deliveries').get().n).toBe(1);
    sqlite.prepare('DELETE FROM deliveries').run(); // simulate interruption before durable enqueue
    await reconcileNotificationQueue(env,now);
    await reconcileNotificationQueue(env,now);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM deliveries').get().n).toBe(1);
    expect(await processDingTalkDeliveries(env,now)).toEqual({sent:1,failed:0});
    await reconcileNotificationQueue(env,now);
    expect(await processDingTalkDeliveries(env,now)).toEqual({sent:0,failed:0});
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("deduplicates enqueue and accepted sends, retaining provider receipt", async () => {
    const {env,sqlite} = await queued(); await queueDingTalkDelivery(env,{signalId:'x:p'},now);
    const fetch = vi.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(new Response('{"processQueryKey":"receipt"}'));
    vi.stubGlobal('fetch',fetch);
    expect(await processDingTalkDeliveries(env,now)).toEqual({sent:1,failed:0});
    await processDingTalkDeliveries(env,now);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sqlite.prepare('SELECT status,attempts,provider_receipt FROM deliveries').get()).toMatchObject({status:'sent',attempts:1,provider_receipt:'receipt'});
    const payload=JSON.parse(fetch.mock.calls[1][1].body);
    expect(payload.openConversationId).toBe('fixture-group');
    expect(payload.isAtAll).toBe(true);
    expect(JSON.parse(payload.msgParam).content).toContain('原文 · @tibo');
    expect(JSON.parse(payload.msgParam).content).not.toContain('scheduled_reset');
  });
  it("sends a queued natural alert after review, without replaying review-only history", async () => {
    const {env,sqlite}=await queued();
    sqlite.prepare("UPDATE posts SET author='thsottiaux', text='We will reset all Codex usage limits.'").run();
    env.DASHSCOPE_API_KEY='fixture';
    const verdict={post_id:'p',event_type:'scheduled_reset',reset_mode:'hard_reset',confidence:0.95,reason:'A future reset',title_zh:'重置预告',title_en:'Reset announced',summary_zh:'将重置用量',summary_en:'Will reset usage',evidence:['reset all Codex usage limits'],effective_time:null,approximate_time:false};
    const fetch=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({reviews:[verdict]})}}]})))
      .mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(new Response('{"processQueryKey":"natural-receipt"}'));
    vi.stubGlobal('fetch',fetch);
    await processReviews(env);
    expect(sqlite.prepare('SELECT should_notify FROM signals').get().should_notify).toBe(1);
    expect(await processDingTalkDeliveries(env,now)).toEqual({sent:1,failed:0});
    // Reviewing history that was never eligible must not grant permission to send.
    sqlite.prepare("UPDATE signals SET should_notify=0").run();
    sqlite.prepare("UPDATE model_reviews SET status='pending'").run();
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({reviews:[verdict]})}}]})));
    await processReviews(env);
    expect(sqlite.prepare('SELECT should_notify FROM signals').get().should_notify).toBe(0);
    expect(await processDingTalkDeliveries(env,now)).toEqual({sent:0,failed:0});
  });
  it("cancels an eligible alert when review downgrades it instead of stranding pending work", async () => {
    const {env,sqlite}=await queued();
    sqlite.prepare("UPDATE posts SET author='thsottiaux', text='A reset might be interesting.'").run();env.DASHSCOPE_API_KEY='fixture';
    const verdict={post_id:'p',event_type:'unrelated',reset_mode:'not_applicable',confidence:0.6,reason:'Only a wish',title_zh:'弱线索',title_en:'A hint',summary_zh:'不能确认重置',summary_en:'Not a reset announcement',evidence:['reset might be interesting'],effective_time:null,approximate_time:false};
    const fetch=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({reviews:[verdict]})}}]})));vi.stubGlobal('fetch',fetch);
    await processReviews(env);expect(sqlite.prepare('SELECT should_notify FROM signals').get().should_notify).toBe(0);
    expect(sqlite.prepare('SELECT status FROM deliveries').get().status).toBe('cancelled');
    expect(await processDingTalkDeliveries(env,now)).toEqual({sent:0,failed:0});expect(fetch).toHaveBeenCalledTimes(1);
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
    const {env}=fixture();env.DINGTALK_TEST_GROUP_ID='fixture-isolated';const fetch=vi.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(new Response('{"processQueryKey":"test-receipt"}'));
    vi.stubGlobal('fetch',fetch);expect((await testDingTalk(env,'release-test-1')).status).toBe('sent');
    expect(await testDingTalk(env,'release-test-1')).toMatchObject({status:'sent',deduplicated:true});expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("preserves banked-reset action boundaries", () => {
    expect(dingTalkContent({event_type:'explicit_reset',reset_mode:'banked_reset',source_tier:'A1',author:'tibo',text:'banked',url:'https://x.com/tibo/status/1',effective_time:null})).toContain('不是自动重置');
  });
  it('never sends a test to the production group, for either notification mode',async()=>{
    for(const mode of ['personal_ding','group_message']){
      const {env}=fixture();env.DINGTALK_MODE=mode;env.DINGTALK_TEST_GROUP_ID=env.DINGTALK_GROUP_ID;
      const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
      expect(await testDingTalk(env,'same-group-'+mode)).toMatchObject({status:'failed'});
      expect(fetch).not.toHaveBeenCalled();
    }
  });
  it('notifies a later real confirmation separately from the advance notice exactly once',async()=>{
    const {env,sqlite}=await queued();
    sqlite.prepare(`INSERT INTO posts SELECT 'confirmed',author,'We have now reset Codex usage limits.',?,url,lane,source_tier,source_weight,referenced_post_ids,linked_urls,raw_json,first_seen_at,1 FROM posts WHERE post_id='p'`).run(now);
    sqlite.prepare(`INSERT INTO signals SELECT 'x:confirmed','confirmed','explicit_reset',reset_mode,severity,confidence,content_confidence,evidence_basis,NULL,0,cluster_key,NULL,1,reason,evidence,created_at FROM signals WHERE signal_id='x:p'`).run();
    await reconcileNotificationQueue(env,now);
    const fetch=vi.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(new Response('{"processQueryKey":"advance"}')).mockResolvedValueOnce(new Response('{"processQueryKey":"confirmed"}'));vi.stubGlobal('fetch',fetch);
    expect(await processDingTalkDeliveries(env,now)).toEqual({sent:2,failed:0});
    const sent=fetch.mock.calls.slice(1).map(c=>JSON.parse(JSON.parse(c[1].body).msgParam).content);
    expect(sent.join('\n')).toContain('Codex 重置已确认');
    expect(sent.join('\n')).toContain('原文未公布精确时刻');
    expect(await processDingTalkDeliveries(env,now)).toEqual({sent:0,failed:0});
  });
});
