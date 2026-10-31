import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { testQQ } from '../src/qq-test';
import { handleApi } from '../src/api';
const databases=[];
afterEach(()=>{vi.unstubAllGlobals();databases.splice(0).forEach(db=>db.close());});
function fixture(){
  const db=new DatabaseSync(':memory:');databases.push(db);db.exec('CREATE TABLE app_state(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL)');
  const prepare=(sql,p=[])=>({bind:(...a)=>prepare(sql,a),run:async()=>({meta:db.prepare(sql).run(...p)}),first:async()=>db.prepare(sql).get(...p)});
  return {DB:{prepare},QQ_TEST_APP_ID:'fixture-app',QQ_TEST_APP_SECRET:'fixture-private',QQ_TEST_OWNER_OPENID:'fixture-owner',WEBHOOK_TEST_TOKEN:'fixture-auth'};
}
const token=()=>new Response('{"access_token":"fixture-access","expires_in":7200}');
describe('owner-only QQ proactive cloud probe',()=>{
  it('requires configured owner and route authorization before touching QQ',async()=>{
    const env=fixture();const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
    expect(await testQQ({...env,QQ_TEST_OWNER_OPENID:undefined},'missing-owner')).toMatchObject({status:'failed'});
    expect((await handleApi(new Request('https://example.test/api/admin/test-qq',{method:'POST'}),env)).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('performs a proactive fixed-owner request without a passive-reply message ID, exactly once',async()=>{
    const env=fixture();const fetch=vi.fn().mockResolvedValueOnce(token()).mockResolvedValueOnce(new Response('{"id":"qq-receipt"}'));vi.stubGlobal('fetch',fetch);
    expect(await testQQ(env,'one-probe')).toMatchObject({status:'sent',runtime:'cloudflare_worker',acceptance_only:true});
    expect(await testQQ(env,'one-probe')).toMatchObject({status:'sent',deduplicated:true});
    expect(fetch).toHaveBeenCalledTimes(2);
    const [url,options]=fetch.mock.calls[1];expect(url).toBe('https://api.sgroup.qq.com/v2/users/fixture-owner/messages');
    const body=JSON.parse(options.body);expect(body).not.toHaveProperty('msg_id');expect(body).not.toHaveProperty('event_id');
    expect(body.content).toContain('非重置公告');expect(options.redirect).toBe('manual');expect(options.headers.Authorization).toBe('QQBot fixture-access');
  });
  it('does not submit a message on token failure',async()=>{
    const env=fixture();const fetch=vi.fn().mockRejectedValue(new Error('private detail'));vi.stubGlobal('fetch',fetch);
    expect(await testQQ(env,'token-fail')).toMatchObject({status:'failed',error:'qq_token_unavailable_no_message_submitted'});
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('quarantines an ambiguous send and never retries it',async()=>{
    const env=fixture();const fetch=vi.fn().mockResolvedValueOnce(token()).mockRejectedValueOnce(new Error('private detail'));vi.stubGlobal('fetch',fetch);
    expect(await testQQ(env,'unknown-send')).toMatchObject({status:'unknown'});
    expect(await testQQ(env,'unknown-send')).toMatchObject({status:'unknown',deduplicated:true});
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('does not turn a business error into acceptance even when an ID exists',async()=>{
    const env=fixture();vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(token()).mockResolvedValueOnce(new Response('{"id":"not-proof","code":304001,"message":"private detail"}')));
    expect(await testQQ(env,'rejected-send')).toMatchObject({status:'failed',error:'qq_business_rejected'});
  });
});
