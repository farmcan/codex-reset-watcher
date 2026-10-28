import { describe, expect, it } from 'vitest';
import { resetTiming, sourceResetTime } from '../src/reset-time';

const row = {event_type:'explicit_reset',reset_mode:'hard_reset',source_tier:'A1',text:'Today is a reset.',created_at:'2026-10-28T02:42:53.000Z',effective_time:'2026-10-28T02:42:53.000Z'};
describe('reset time evidence',()=>{
  it('does not treat publication time or model-generated timing as the rollout time',()=>{
    expect(resetTiming(row)).toMatchObject({reset_at:null,confirmed_at:row.created_at,time_basis:'confirmation_post'});
  });
  it('reads an explicit completed reset timestamp and preserves PST versus PDT',()=>{
    expect(resetTiming({...row,text:'We have now reset Codex at 7 pm PST yesterday.'})).toMatchObject({reset_at:'2026-10-27T03:00:00.000Z',approximate:false});
    expect(sourceResetTime('Codex reset at 7 pm PDT.',row.created_at)?.at).toBe('2026-10-28T02:00:00.000Z');
  });
  it('never turns an elapsed schedule into a completed reset',()=>{
    expect(resetTiming({...row,event_type:'scheduled_reset',text:'Codex will reset at 7 pm PDT yesterday.'})).toMatchObject({phase:'scheduled',reset_at:null,confirmed_at:null,scheduled_for:'2026-10-27T02:00:00.000Z'});
  });
  it('keeps approximate relative times and personal observations separate',()=>{
    expect(resetTiming({...row,text:'We have reset Codex 5 minutes ago.'})).toMatchObject({reset_at:'2026-10-28T02:37:53.000Z',approximate:true});
    expect(resetTiming({...row,source_tier:'D',event_type:'community_observation'})).toMatchObject({phase:'observation',reset_at:null,confirmed_at:null});
  });
  it('does not invent exact hours for today, tomorrow, or soon',()=>{
    for(const text of ['Today is a reset.','Codex will reset tomorrow.','Codex reset soon.']) expect(sourceResetTime(text,row.created_at)).toBeNull();
  });
});
