import { afterEach, expect, it, vi } from 'vitest';
import { fetchXPostsByIds } from '../src/x-source';
import { QUERY_SPECS } from '../src/config';
afterEach(()=>vi.unstubAllGlobals());
it('retains verified parent text and restricts imports to the configured first-party author',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({data:[{id:'2115330127886463244',author_id:'official',text:"And it's done.",created_at:'2026-10-28T06:29:00Z',referenced_tweets:[{id:'2115273064481218829',type:'replied_to'}]}],includes:{users:[{id:'official',username:'thsottiaux'},{id:'other',username:'someone'}],tweets:[{id:'2115273064481218829',author_id:'official',text:'Today is a reset.',created_at:'2026-10-28T02:42:00Z'},{id:'9999999999999999999',author_id:'other',text:'My account reset.',created_at:'2026-10-28T03:00:00Z'}]}})));
  const result=await fetchXPostsByIds(QUERY_SPECS[0]!,'test-secret',['2115330127886463244']);
  expect(result.posts).toHaveLength(2);
  expect(result.posts[0]?.raw).toMatchObject({reset_context:[{postId:'2115273064481218829',author:'thsottiaux',text:'Today is a reset.'}]});
  expect(result.posts.every(post=>post.author==='thsottiaux')).toBe(true);
});
