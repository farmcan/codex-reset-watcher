import type { Env } from './types';

// Retains historical totals; each reset wish is independent, retries are idempotent.
const visitorPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const headers = { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store' };
const json = (data:unknown, status=200) => new Response(JSON.stringify(data),{status,headers});

export async function handleEngagement(request:Request, env:Env, now=new Date()):Promise<Response|null> {
  const path=new URL(request.url).pathname;
  if(!['/api/engagement','/api/engagement/visit','/api/engagement/like'].includes(path))return null;
  const read=request.method==='GET' && path==='/api/engagement';
  if(!read && !(request.method==='POST' && path!=='/api/engagement'))return json({error:'method_not_allowed'},405);
  let visitor=request.headers.get('X-Visitor-ID') ?? '';
  let eventId = '';
  if(!read){
    const origin=request.headers.get('Origin');
    if(request.headers.get('Sec-Fetch-Site')==='cross-site' || (origin && origin!==new URL(request.url).origin))return json({error:'cross_site_request'},403);
    if(!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))return json({error:'json_required'},415);
    try {
      if(Number(request.headers.get('Content-Length'))>1024)return json({error:'invalid_request'},400);
      const body=await request.text();
      if(body.length>1024)return json({error:'invalid_request'},400);
      const payload=JSON.parse(body);
      visitor=payload.visitor_id;
      eventId=payload.event_id ?? '';
      if(eventId && (typeof eventId !== 'string' || !visitorPattern.test(eventId))) return json({error:'invalid_event'},400);
    }catch{return json({error:'invalid_request'},400);}
    if(typeof visitor!=='string' || !visitorPattern.test(visitor))return json({error:'invalid_visitor'},400);
  }
  if(!visitorPattern.test(visitor))visitor='';
  const kind=path.endsWith('/like')?'likes':'visits';
  const day=new Date(now.getTime()+8*3600_000).toISOString().slice(0,10);
  const bot=/bot|crawler|spider|slurp|preview|facebookexternalhit|whatsapp/i.test(request.headers.get('User-Agent')??'');
  try {
    const statements=[];
    if(!read && !bot && kind==='visits') {
      // Batch executes atomically: concurrent page loads cannot open two sessions.
      statements.push(env.DB.prepare(`INSERT OR IGNORE INTO site_counter_actions(kind,visitor_id,period)
        SELECT 'visits',?,? WHERE NOT EXISTS
        (SELECT 1 FROM site_visit_sessions WHERE visitor_id=? AND last_seen_ms>?)`)
        .bind(visitor,`session:${eventId || crypto.randomUUID()}`,visitor,now.getTime()-30*60_000));
      statements.push(env.DB.prepare(`INSERT INTO site_visit_sessions(visitor_id,last_seen_ms) VALUES (?,?)
        ON CONFLICT(visitor_id) DO UPDATE SET last_seen_ms=MAX(last_seen_ms,excluded.last_seen_ms)`)
        .bind(visitor,now.getTime()));
      statements.push(env.DB.prepare('INSERT OR IGNORE INTO site_daily_visitors(visitor_id,day) VALUES (?,?)').bind(visitor,day));
    }
    if(!read && !bot && kind==='likes') statements.push(env.DB.prepare('INSERT OR IGNORE INTO site_counter_actions(kind,visitor_id,period) VALUES (?,?,?)')
      .bind(kind,visitor,`tap:${eventId || crypto.randomUUID()}`));
    statements.push(env.DB.prepare('SELECT name,count,started_at FROM site_counters ORDER BY name'));
    statements.push(env.DB.prepare("SELECT 1 AS liked FROM site_counter_actions WHERE kind='likes' AND visitor_id=? LIMIT 1").bind(visitor));
    statements.push(env.DB.prepare("SELECT COUNT(*) AS daily_visitors FROM site_daily_visitors WHERE day=?").bind(day));
    const results=await env.DB.batch(statements);
    const rows=results[results.length-3]!.results as Array<{name:string;count:number;started_at:string}>;
    return json({visits:rows.find(r=>r.name==='visits')?.count??0,likes:rows.find(r=>r.name==='likes')?.count??0,
      liked:results[results.length-2]!.results.length>0, daily_visitors:(results[results.length-1]!.results[0] as {daily_visitors:number}).daily_visitors, started_at:rows[0]?.started_at??null,
      visit_dedupe:'browser_30_minute_inactivity',like_dedupe:'visitor_event_id'});
  }catch{return json({error:'engagement_unavailable'},503);}
}
