import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { handleEngagement } from '../src/engagement';

const databases=[];
afterEach(()=>databases.splice(0).forEach(db=>db.close()));
function fixture(){
  const sqlite=new DatabaseSync(':memory:');databases.push(sqlite);
  sqlite.exec(readFileSync(new URL('../migrations/0005_site_engagement.sql',import.meta.url),'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0010_engagement_sessions.sql',import.meta.url),'utf8'));
  const prepare=(sql,params=[])=>({sql,params,bind:(...args)=>prepare(sql,args)});
  return {DB:{prepare,batch:async statements=>{
    sqlite.exec('BEGIN');
    try {
      const rows=statements.map(s=>({results:s.sql.startsWith('SELECT')?sqlite.prepare(s.sql).all(...s.params):(sqlite.prepare(s.sql).run(...s.params),[])}));
      sqlite.exec('COMMIT');return rows;
    }catch(e){sqlite.exec('ROLLBACK');throw e;}
  }}};
}
const id='550e8400-e29b-41d4-a716-446655440000';
const second='550e8400-e29b-41d4-a716-446655440001';
const post=(action,visitor=id,headers={},eventId)=>new Request(`https://watcher.test/api/engagement/${action}`,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify({visitor_id:visitor,event_id:eventId})});
const get=()=>new Request('https://watcher.test/api/engagement',{headers:{'X-Visitor-ID':id}});
const now=new Date('2026-10-25T15:59:00Z');

describe('persistent engagement',()=>{
  it('counts sessions after 30 minutes of inactivity and daily browsers separately',async()=>{
    const env=fixture();
    expect(await (await handleEngagement(post('visit'),env,now)).json()).toMatchObject({visits:1,daily_visitors:1});
    expect((await (await handleEngagement(post('visit'),env,new Date(now.getTime()+29*60_000))).json()).visits).toBe(1);
    expect((await (await handleEngagement(post('visit'),env,new Date(now.getTime()+59*60_000))).json()).visits).toBe(2);
    expect(await (await handleEngagement(post('visit',second),env,now)).json()).toMatchObject({visits:3,daily_visitors:2});
  });
  it('counts repeated taps from the same browser, without a daily limit',async()=>{
    const env=fixture();
    for (let i=1;i<=5;i++) {
      expect(await (await handleEngagement(post('like'),env,now)).json()).toMatchObject({likes:i,liked:true,like_dedupe:'visitor_event_id'});
    }
    expect(await (await handleEngagement(get(),env,now)).json()).toMatchObject({likes:5,liked:true});
  });
  it('counts a retried event only once, and distinct events independently',async()=>{
    const env=fixture();
    const event='550e8400-e29b-41d4-a716-446655440010';
    expect((await (await handleEngagement(post('like',id,{},event),env,now)).json()).likes).toBe(1);
    expect((await (await handleEngagement(post('like',id,{},event),env,new Date(now.getTime()+86400_000))).json()).likes).toBe(1);
    expect((await (await handleEngagement(post('like',id,{},second),env,now)).json()).likes).toBe(2);
    expect((await (await handleEngagement(post('like',second,{},event),env,now)).json()).likes).toBe(3);
  });
  it('retains old totals and today's support at the cutover',async()=>{
    const env=fixture();
    const old=env.DB.prepare("INSERT INTO site_counter_actions(kind,visitor_id,period) VALUES ('likes',?,'2026-10-25')").bind(id);
    await env.DB.batch([old]);
    expect(await (await handleEngagement(post('like'),env,now)).json()).toMatchObject({likes:2,liked:true});
  });
  it('rejects cross-origin requests and malformed visitors without incrementing',async()=>{
    const env=fixture();
    expect((await handleEngagement(post('like',id,{Origin:'https://other.test'}),env)).status).toBe(403);
    expect((await handleEngagement(post('visit','invalid'),env)).status).toBe(400);
    expect((await handleEngagement(new Request('https://watcher.test/api/engagement/like'),env)).status).toBe(405);
    expect(await (await handleEngagement(get(),env)).json()).toMatchObject({likes:0,visits:0});
  });
  it('does not count previews or turn storage failures into zero totals',async()=>{
    const env=fixture();
    expect((await (await handleEngagement(post('visit',id,{'User-Agent':'Googlebot'}),env)).json()).visits).toBe(0);
    env.DB.batch=async()=>{throw new Error('offline');};
    const result=await handleEngagement(get(),env);
    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({error:'engagement_unavailable'});
  });
});
