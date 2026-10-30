import type { RawPost } from './types';

// Follow only persisted X reference edges, at most three levels. A completion
// can reply to a timing reply ("by midnight") rather than to the root notice.
export async function withResetContext(db:D1Database, post:RawPost):Promise<RawPost> {
  if (!post.referencedPostIds.length) return post;
  const raw=post.raw as Record<string,unknown>;
  const original=(raw.reset_context ?? []) as Array<Record<string,unknown>>;
  const seeds=[...post.referencedPostIds,...original.filter(parent=>post.referencedPostIds.includes(String(parent.postId))
    && parent.author===post.author).flatMap(parent=>(parent.referencedPostIds ?? []) as string[])];
  const {results}=await db.prepare(`WITH RECURSIVE refs(id,depth) AS (
    SELECT value,1 FROM json_each(?)
    UNION SELECT edge.value,refs.depth+1 FROM refs JOIN posts parent ON parent.post_id=refs.id,
      json_each(parent.referenced_post_ids) edge WHERE refs.depth<3
  ) SELECT p.post_id,p.author,p.text,p.created_at,p.referenced_post_ids FROM posts p
    WHERE p.post_id IN (SELECT id FROM refs) LIMIT 12`).bind(JSON.stringify([...new Set(seeds)])).all<{
      post_id:string;author:string;text:string;created_at:string;referenced_post_ids:string
    }>();
  const contexts=results.map(parent=>({postId:parent.post_id,author:parent.author,text:parent.text,createdAt:parent.created_at,
    referencedPostIds:JSON.parse(parent.referenced_post_ids)}));
  return {...post,raw:{...raw,reset_context:[...contexts,...original.filter(p=>!contexts.some(c=>c.postId===p.postId))]}};
}
