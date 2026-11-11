import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendQQGroupNotice } from '../src/qq-client';
afterEach(()=>vi.unstubAllGlobals());
const token=()=>new Response('{"access_token":"fixture-access","expires_in":7200}');
describe('QQ group proactive transport',()=>{
  it('uses the group endpoint with the shared proactive contract and never a C2C destination',async()=>{
    const fetch=vi.fn().mockResolvedValueOnce(token()).mockResolvedValueOnce(new Response('{"id":"group-receipt"}'));vi.stubGlobal('fetch',fetch);
    expect(await sendQQGroupNotice('app','secret','group /id','notice')).toMatchObject({status:'sent',provider_receipt:'group-receipt',acceptance_only:true});
    expect(fetch.mock.calls[1][0]).toBe('https://api.sgroup.qq.com/v2/groups/group%20%2Fid/messages');
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({msg_type:0,content:'notice'});
    expect(fetch.mock.calls[1][1].redirect).toBe('manual');
  });
  it('does not retry or fall back to C2C after an ambiguous group submission',async()=>{
    const fetch=vi.fn().mockResolvedValueOnce(token()).mockRejectedValueOnce(new Error('private'));vi.stubGlobal('fetch',fetch);
    expect(await sendQQGroupNotice('app','secret','group','notice')).toEqual({status:'unknown',error:'send_outcome_unknown_do_not_replay'});
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('preserves a platform entitlement rejection as failure rather than acceptance',async()=>{
    const fetch=vi.fn().mockResolvedValueOnce(token()).mockResolvedValueOnce(new Response('{"code":304001,"message":"private rejection"}',{status:403}));vi.stubGlobal('fetch',fetch);
    expect(await sendQQGroupNotice('app','secret','group','notice')).toEqual({status:'failed',error:'qq_send_http_403',business_code:304001});
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
