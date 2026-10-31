import { describe, expect, it, vi } from 'vitest';
import { publicRead, storageFailure } from '../src/public-cache';

describe('bounded public D1 reads',()=>{
  const cache = () => {
    const rows = new Map<string,Response>();
    return {match:vi.fn(async(r:Request)=>rows.get(r.url)?.clone()),put:vi.fn(async(r:Request,s:Response)=>{rows.set(r.url,s.clone());})} as unknown as Cache;
  };
  it('shares successful public reads across arbitrary query strings',async()=>{
    const c=cache();const query=vi.fn(async()=>Response.json({generated_at:'fixed-source-time'}));
    await publicRead(new Request('https://example.com/api/status?a=1'),query,c);
    const hit=await publicRead(new Request('https://example.com/api/status?a=2'),query,c);
    expect(query).toHaveBeenCalledTimes(1);
    expect(await hit.json()).toEqual({generated_at:'fixed-source-time'});
    expect(hit.headers.get('Cache-Control')).toBe('no-store');
  });
  it('does not cache a failure or an admin send',async()=>{
    const c=cache();const failed=vi.fn(async()=>new Response('unknown',{status:503}));
    for(let i=0;i<2;i++)await publicRead(new Request('https://example.com/healthz'),failed,c);
    expect(failed).toHaveBeenCalledTimes(2);expect(c.put).not.toHaveBeenCalled();
    await publicRead(new Request('https://example.com/api/admin/test-dingtalk',{method:'POST'}),async()=>Response.json({sent:true}),c);
    expect(c.put).not.toHaveBeenCalled();
  });
  it('never serves or caches account observations, including a stale formerly public entry',async()=>{
    const c=cache();
    await c.put(new Request('https://example.com/api/arrival-observations'),Response.json({private:'old cached account record'}));
    const respond=vi.fn(async()=>Response.json({error:'unauthorized'},{status:401}));
    const response=await publicRead(new Request('https://example.com/api/arrival-observations'),respond,c);
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain('old cached account record');
    expect(c.match).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledTimes(1);
  });
  it('reports quota exhaustion as unknown coverage, without claiming delivery or exposing diagnostics',async()=>{
    const r=storageFailure(new Error("D1_ERROR: Your account has exceeded D1's free tier daily row read limit. private diagnostic"))!;
    expect(r.status).toBe(503);
    const body=await r.json() as Record<string,unknown>;
    expect(body.error).toBe('storage_daily_limit');expect(body.coverage).toBe('unknown');
    expect(JSON.stringify(body)).not.toContain('private diagnostic');
    expect(storageFailure(new Error('other'))).toBeNull();
  });
});
