import {describe,expect,it,vi} from 'vitest';
import {handleApi} from '../src/api';
import type {Env} from '../src/types';

const observation={id:'private-observation',kind:'manual_reset_used',source:'usage_reset_history',assurance:'direct',interval_start:'2026-10-29T14:19:00Z',interval_end:'2026-10-29T14:19:00Z',observed_at:'2026-10-31T07:00:00Z',signal_post_id:null};
function fixture() {
  const prepare=vi.fn(()=>({all:async()=>({results:[{value:JSON.stringify(observation)}]})}));
  return {env:{PERSONAL_OBSERVATION_TOKEN:'owner-probe-only',ADMIN_TOKEN:'different-admin',DB:{prepare}} as unknown as Env,prepare};
}
describe('private account observations',()=>{
  it('rejects anonymous and unrelated admin access before reading private rows',async()=>{
    const {env,prepare}=fixture();
    for(const path of ['/api/arrival-observations','/api/admin/arrival-observations']) {
      for(const headers of [new Headers(),new Headers({Authorization:'Bearer different-admin'})]) {
        const response=(await handleApi(new Request('https://example.com'+path,{headers}),env))!;
        expect(response.status).toBe(401);
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        expect(await response.text()).not.toContain(observation.interval_start);
      }
    }
    expect(prepare).not.toHaveBeenCalled();
  });
  it('retains the existing ledger for explicitly authenticated owner access',async()=>{
    const {env,prepare}=fixture();
    const response=(await handleApi(new Request('https://example.com/api/admin/arrival-observations',{headers:{Authorization:'Bearer owner-probe-only'}}),env))!;
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect((await response.json() as {observations:unknown[]}).observations).toEqual([observation]);
    expect(prepare).toHaveBeenCalledTimes(1);
  });
});
