import {describe,it,expect} from 'vitest';
import {projectStatus,sourceUrl} from '../src/state';
const now=Date.parse('2026-11-13T09:00:00Z');
function status(signals:any[]=[], extra={}){return {live:{source_status:'healthy',official_last_success_at:'2026-11-13T08:50:00Z',expected_poll_seconds:1200,signals,...extra}}}
function signal(extra={}){return {signal_id:'one',event_type:'scheduled_reset',reset_mode:'hard_reset',source_tier:'A1',created_at:'2026-11-13T08:00:00Z',title_zh:'官方预告',summary_zh:'摘要',severity:'high',url:'https://x.com/thsottiaux/status/12345',reset_timing:{scheduled_for:'2026-11-13T10:00:00Z'},...extra}}
describe('public panel projection',()=>{
  it('requires a fresh successful source check',()=>{expect(projectStatus(status(),now).sourceStatus).toBe('healthy');const p=projectStatus(status([],{official_last_success_at:'2026-11-13T06:00:00Z'}),now);expect(p.tone).toBe('unknown');expect(p.headline).not.toContain('暂无')});
  it('distinguishes scheduled hard resets, expired notices and completion',()=>{expect(projectStatus(status([signal()]),now).tone).toBe('upcoming');expect(projectStatus(status([signal({reset_timing:{scheduled_for:'2026-11-13T08:30:00Z'}})]),now).tone).toBe('pending');expect(projectStatus(status([signal({event_type:'explicit_reset'})]),now).tone).toBe('confirmed')});
  it('keeps banked rights separate from automatic hard resets',()=>{const p=projectStatus(status([signal({event_type:'explicit_reset',reset_mode:'banked_reset'})]),now);expect(p.tone).toBe('banked');expect(p.description).toContain('手动');expect(p.headline).not.toContain('到账')});
  it('excludes superseded, future-dated and unrelated evidence',()=>{expect(projectStatus(status([signal({superseded_by_post_id:'2'}),signal({created_at:'2026-12-01T00:00:00Z'}),signal({event_type:'unrelated'})]),now).events).toEqual([])});
  it('does not revive a preannouncement after later confirmation',()=>{const p=projectStatus(status([signal(),signal({signal_id:'two',created_at:'2026-11-13T08:20:00Z',event_type:'explicit_reset'})]),now);expect(p.tone).toBe('confirmed')});
  it('strips private diagnostics and rejects off-domain source links',()=>{const p=projectStatus(status([signal({owner_token:'SECRET'})],{dingtalk:{token:'SECRET'},poll_runs:[{debug:'SECRET'}]}),now);expect(JSON.stringify(p)).not.toContain('SECRET');expect(sourceUrl('javascript:alert(1)')).toContain('/#latest');expect(sourceUrl('https://x.com.evil.test/abc/status/123')).toContain('/#latest')});
  it('missing or invalid data never becomes a healthy empty result',()=>{for(const input of [null,{}, {live:{signals:[],source_status:'healthy'}}])expect(projectStatus(input,now).sourceStatus).not.toBe('healthy')});
});
