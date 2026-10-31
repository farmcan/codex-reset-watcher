import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { testWeixin } from '../src/weixin-test';
import { handleApi } from '../src/api';
import { parseWeixinApiJson } from '../src/vendor/weixin-json';
const databases=[];
afterEach(()=>{vi.unstubAllGlobals();databases.splice(0).forEach(db=>db.close());});
function fixture(){
  const sqlite=new DatabaseSync(':memory:');databases.push(sqlite);
  sqlite.exec('CREATE TABLE app_state(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL)');
  const prepare=(sql,params=[])=>({bind:(...args)=>prepare(sql,args),run:async()=>({meta:sqlite.prepare(sql).run(...params)}),first:async()=>sqlite.prepare(sql).get(...params)});
  return {DB:{prepare},WEIXIN_TEST_BOT_TOKEN:'fixture-private-token',WEIXIN_TEST_OWNER_ID:'fixture-owner',WEBHOOK_TEST_TOKEN:'fixture-test-auth'};
}
describe('owner-only Weixin cloud probe',()=>{
  it('preserves uint64 message IDs and ignores message_id text inside strings',()=>{
    const body=parseWeixinApiJson('{"message_id":18446744073709551615,"text":"message_id: 18446744073709551615"}');
    expect(body.message_id).toBe('18446744073709551615');
    expect(body.text).toBe('message_id: 18446744073709551615');
  });
  it('accepts the observed omitted-ret response and permanently deduplicates the probe',async()=>{
    const env=fixture();const fetch=vi.fn().mockResolvedValue(new Response('{"message_id":18446744073709551615}'));vi.stubGlobal('fetch',fetch);
    expect(await testWeixin(env,'same-probe')).toMatchObject({status:'sent',runtime:'cloudflare_worker',acceptance_only:true,provider_receipt:'18446744073709551615'});
    expect(await testWeixin(env,'same-probe')).toMatchObject({status:'sent',deduplicated:true});
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('quarantines unknown transport outcomes and never sends a duplicate',async()=>{
    const env=fixture();const fetch=vi.fn().mockRejectedValue(new Error('private transport details'));vi.stubGlobal('fetch',fetch);
    expect(await testWeixin(env,'unknown-probe')).toMatchObject({status:'unknown'});
    expect(await testWeixin(env,'unknown-probe')).toMatchObject({status:'unknown',deduplicated:true});
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('does not accept message ID over an explicit rejection or malformed business field',async()=>{
    const env=fixture();const fetch=vi.fn().mockResolvedValueOnce(new Response('{"ret":-2,"message_id":"123","errmsg":"private detail"}'))
      .mockResolvedValueOnce(new Response('{"ret":"0","message_id":"123"}'));vi.stubGlobal('fetch',fetch);
    expect(await testWeixin(env,'reject-probe')).toMatchObject({status:'failed',error:'weixin_business_rejected'});
    expect(await testWeixin(env,'malformed-probe')).toMatchObject({status:'unknown'});
  });
  it('fails closed without configuration or authentication and fixes recipient and text server-side',async()=>{
    const env=fixture();const fetch=vi.fn().mockResolvedValue(new Response('{"ret":0}'));vi.stubGlobal('fetch',fetch);
    expect(await testWeixin({...env,WEIXIN_TEST_BOT_TOKEN:undefined},'missing-config')).toMatchObject({status:'failed'});
    expect((await handleApi(new Request('https://example.test/api/admin/test-weixin',{method:'POST'}),env)).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
    const response=await handleApi(new Request('https://example.test/api/admin/test-weixin',{method:'POST',
      headers:{Authorization:'Bearer fixture-test-auth','Idempotency-Key':'owner-only-test'},body:JSON.stringify({to_user_id:'other-person',text:'arbitrary-message'})}),env);
    expect(response.status).toBe(200);
    const [url,options]=fetch.mock.calls[0];const body=JSON.parse(options.body);
    expect(url).toBe('https://ilinkai.weixin.qq.com/ilink/bot/sendmessage');expect(options.redirect).toBe('manual');
    expect(body.msg.to_user_id).toBe('fixture-owner');expect(body.msg.item_list[0].text_item.text).toContain('Cloudflare 本人测试');
    expect(body.msg).not.toHaveProperty('context_token');expect(options.headers.AuthorizationType).toBe('ilink_bot_token');
  });
});
