import { describe,it,expect,vi,afterEach } from 'vitest';
import { reviewPosts,reviewedSignal,validateReviews,safeReviewError } from '../src/model-review';
import type {RawPost,Env} from '../src/types';
const post:RawPost={postId:'1',author:'thsottiaux',text:'We will do a global reset of the usage for Astra.',createdAt:'2026-09-07T19:24:57Z',url:'https://x.com/thsottiaux/status/1',lane:'official',sourceTier:'A1',sourceWeight:1,referencedPostIds:[],referencedAuthors:[],linkedUrls:[],raw:{}};
const verdict={post_id:'1',event_type:'scheduled_reset' as const,reset_mode:'hard_reset' as const,confidence:0.95,reason:'官方预告，尚未确认完成',title_zh:'Astra 用量重置预告',title_en:'Astra reset announced',summary_zh:'宣布将重置用量',summary_en:'A future usage reset was announced',evidence:['global reset'],effective_time:null,approximate_time:false};
afterEach(()=>vi.unstubAllGlobals());
describe('Qwen review boundaries',()=>{
 it('validates exact evidence and IDs',()=>{
  expect(validateReviews({reviews:[verdict]},[post])).toHaveLength(1);
  expect(()=>validateReviews({reviews:[{...verdict,evidence:['reset completed']}]},[post])).toThrow();
  expect(()=>validateReviews({reviews:[{...verdict,post_id:'2'}]},[post])).toThrow();
  expect(()=>validateReviews({reviews:[]},[post])).toThrow();
 });
 it('keeps elapsed announcements as scheduled',()=>{
  const s=reviewedSignal(post,{...verdict,effective_time:'2026-09-08T02:00:00Z'});
  expect(s.eventType).toBe('scheduled_reset');
  expect(s.shouldNotify).toBe(false);
 });
 it('does not grant official confirmation to a community author',()=>{
  const s=reviewedSignal({...post,author:'someone',sourceTier:'D',sourceWeight:0.15,lane:'discovery'},{...verdict,event_type:'explicit_reset'});
  expect(s.eventType).toBe('community_observation');
  expect(s.evidenceBasis).toBe('account_observation');
  expect(s.severity).toBe('none');
 });
 it('preserves derivative identity',()=>{
  const s=reviewedSignal({...post,sourceTier:'B',referencedAuthors:['thsottiaux']},verdict);
  expect(s.evidenceBasis).toBe('derivative');
  expect(s.severity).toBe('none');
 });
 it('rejects malformed API replies',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({choices:[{message:{content:'{"reviews":[]}'}}]}))));
  await expect(reviewPosts({DASHSCOPE_API_KEY:'test'} as Env,[post])).rejects.toThrow('count');
 });
 it('never echoes a provider error body',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('sensitive provider details',{status:401})));
  await expect(reviewPosts({DASHSCOPE_API_KEY:'test'} as Env,[post])).rejects.toThrow(/^Qwen HTTP 401$/);
 });
 it('uses Workers-compatible manual redirects and rejects redirects',async()=>{
  const fetcher=vi.fn().mockResolvedValue(new Response(null,{status:302,headers:{Location:'https://other.example/'}}));
  vi.stubGlobal('fetch',fetcher);
  await expect(reviewPosts({DASHSCOPE_API_KEY:'test'} as Env,[post])).rejects.toThrow('Qwen HTTP 302');
  expect(fetcher.mock.calls[0]?.[1].redirect).toBe('manual');
 });
 it('retains a useful error stage without exposing a secret',()=>{
  const error=safeReviewError(new TypeError('Invalid value Bearer sk-secret'),{DASHSCOPE_API_KEY:'sk-secret'} as Env,'model');
  expect(error).toContain('model: TypeError: Invalid value');
  expect(error).not.toContain('sk-secret');
 });
});
