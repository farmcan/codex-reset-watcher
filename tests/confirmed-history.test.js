import {expect,it} from 'vitest';
import {publicConfirmations} from '../public/confirmed-history.js';
const row={confirmation_post_id:'2112432076767289678',confirmed_at:'2026-10-20T06:33:48Z',confirmation_url:'https://x.com/thsottiaux/status/2112432076767289678',kind:'hard_reset'};
it('lists sourced completion times without promoting announcements or private observations',()=>{
  const signals=[{post_id:row.confirmation_post_id,created_at:row.confirmed_at,url:row.confirmation_url,reset_mode:'hard_reset',event_type:'explicit_reset',source_tier:'A1'},
    {post_id:'2112432076767289679',created_at:row.confirmed_at,url:'https://x.com/person/status/2112432076767289679',event_type:'community_observation',source_tier:'B'},
    {post_id:'2112432076767289680',created_at:row.confirmed_at,url:'https://x.com/thsottiaux/status/2112432076767289680',event_type:'scheduled_reset',source_tier:'A1'}];
  const rows=publicConfirmations({recent_audit:{events:[row]},observations:[{kind:'manual_reset_used'}]},signals);
  expect(rows).toHaveLength(1);expect(rows[0].at).toBe(row.confirmed_at);expect(rows[0]).not.toHaveProperty('reset_at');
});
it('omits missing times and sources instead of inventing an endpoint',()=>{
  expect(publicConfirmations({recent_audit:{events:[{...row,confirmed_at:null},{...row,confirmation_url:null}]}})).toEqual([]);
});
