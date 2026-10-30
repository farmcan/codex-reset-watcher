import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {expect, it} from 'vitest';

it('keeps case-insensitive review totals while indexing the historic-review join',()=>{
  const db=new DatabaseSync(':memory:');
  try {
    for(const file of ['0001_initial.sql','0002_model_reviews.sql'])
      db.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
    const post=db.prepare(`INSERT INTO posts(post_id,author,text,created_at,url,lane,source_tier,source_weight,raw_json,first_seen_at)
      VALUES(?,?, 'TESTONLY', '2026-10-28T00:00:00Z', 'https://example.com', 'official', 'A1', 1, '{}', '2026-10-28T00:00:00Z')`);
    const review=db.prepare(`INSERT INTO model_reviews(post_id,status,next_attempt_at,reviewed_at) VALUES(?,?,'2026-10-28T00:00:00Z',?)`);
    db.exec('BEGIN');
    for(let i=0;i<1000;i++) {post.run('other-'+i,'other');review.run('other-'+i,'complete',null);}
    post.run('official-1','Thsottiaux');review.run('official-1','complete','2026-10-28T01:00:00Z');
    post.run('official-2','THSOTTIAUX');review.run('official-2','pending',null);
    post.run('official-3','thsottiaux');review.run('official-3','complete','2026-10-28T01:00:00Z');
    db.prepare("UPDATE model_reviews SET model='source-evidence-review' WHERE post_id='official-3'").run();
    db.exec('COMMIT');
    const source=readFileSync(new URL('../src/model-review.ts',import.meta.url),'utf8').split('export async function reviewHealth')[1];
    const sql=source.match(/prepare\(`([\s\S]*?)`\)/)[1];
    const before={...db.prepare(sql).get()};
    expect(before).toEqual({total:3,completed:2,model_completed:1,source_reviewed:1,pending:1,retrying:0,last_success_at:'2026-10-28T01:00:00Z'});
    db.exec(readFileSync(new URL('../migrations/0006_author_query_index.sql',import.meta.url),'utf8'));
    expect({...db.prepare(sql).get()}).toEqual(before);
    expect(db.prepare('EXPLAIN QUERY PLAN '+sql).all().map(row=>row.detail).join('\n')).toContain('idx_posts_author_folded');
  } finally {db.close();}
});
