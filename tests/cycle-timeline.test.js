import {describe,it,expect} from 'vitest';
import {buildCycles,monthSummary,monthBounds} from '../public/cycle-model.js';
import {validateObservation} from '../src/arrival-observations';
const signal={post_id:'2115330127886463244',source_tier:'A1',event_type:'explicit_reset',reset_mode:'hard_reset',created_at:'2026-10-28T06:29:38Z',cluster_key:'oct28'};
const status={live:{signals:[signal]}};
const observation={id:'observed-test',kind:'quota_recovered',source:'account_probe',assurance:'direct',interval_start:'2026-10-28T06:30:00Z',interval_end:'2026-10-28T06:40:00Z',observed_at:'2026-10-28T06:40:00Z',signal_post_id:signal.post_id};
describe('cycle evidence boundaries',()=>{
 it('uses complete Beijing calendar months across February',()=>{
  const [start,end]=monthBounds('2026-03');expect(start).toBe(Date.parse('2026-03-01T00:00:00+08:00'));expect(end).toBe(Date.parse('2026-04-01T00:00:00+08:00'));
 });
 it('never closes a cycle from a completion post alone',()=>{
  const [c]=buildCycles(status,{});expect(c.confirmed).toBeTruthy();expect(c.arrival).toBeNull();
 });
 it('requires a source reference rather than proximity',()=>{
  const cycles=buildCycles(status,{},[{...observation,signal_post_id:null}]);expect(cycles).toHaveLength(2);expect(cycles.find(c=>c.id==='oct28').arrival).toBeNull();
 });
 it('attaches a referenced recovery and preserves the sampling interval',()=>{
  const [c]=buildCycles(status,{},[observation]);expect(c.arrival.interval_start).toBe(observation.interval_start);expect(c.end).toBe(Date.parse(observation.interval_end));
 });
 it('does not count an inferred history change or manual redemption as a public arrival',()=>{
  const cycles=buildCycles(status,{},[{...observation,assurance:'inferred'},{...observation,id:'manual',kind:'manual_reset_used'}]);
  expect(cycles.find(c=>c.id==='oct28').arrival).toBeNull();const [m]=monthSummary(cycles);expect(m.rounds).toBe(1);expect(m.arrivals).toBe(0);expect(m.personalEvents).toBe(1);
 });
 it('does not duplicate a historical cycle when its confirmation is also live',()=>{
  const history={recent_audit:{events:[{id:'historical',kind:'hard_reset',confirmed_at:signal.created_at,confirmation_post_id:signal.post_id,timeline:[]}]}};
  expect(buildCycles(status,history)).toHaveLength(1);
 });
 it('uses Beijing month boundaries',()=>{
  const cycles=buildCycles({live:{signals:[{...signal,created_at:'2026-09-30T18:00:00Z'}]}},{});expect(monthSummary(cycles)[0].month).toBe('2026-10');
 });
 it('merges a precursor through the confirmation reply chain without double-counting',()=>{
  const history={recent_audit:{events:[{id:'audit',kind:'hard_reset',confirmed_at:signal.created_at,confirmation_post_id:signal.post_id}]}};
  const precursor={...signal,post_id:'2115273253711409208',cluster_key:'unknown',reset_mode:'unknown',event_type:'scheduled_reset',created_at:'2026-10-28T02:43:00Z'};
  const data={live:{signals:[precursor,{...signal,referenced_post_ids:JSON.stringify([precursor.post_id])}]}};
  expect(buildCycles(data,history)).toHaveLength(1);
 });
});
describe('public observation privacy boundary',()=>{
 it('accepts only the minimal public schema',()=>expect(validateObservation(observation)).toEqual(observation));
 it('rejects private fields and raw historical evidence upgraded to direct',()=>{
  expect(()=>validateObservation({...observation,used_percent:40})).toThrow();
  expect(()=>validateObservation({...observation,account_id:'private'})).toThrow();
  expect(()=>validateObservation({...observation,source:'local_quota_telemetry'})).toThrow();
 });
 it('rejects invalid ranges and manual refills linked to a public announcement',()=>{
  expect(()=>validateObservation({...observation,interval_start:'2026-10-28T08:00:00Z'})).toThrow();
  expect(()=>validateObservation({...observation,kind:'manual_reset_used'})).toThrow();
 });
});
