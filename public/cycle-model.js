// Evidence model: announcement, notification, confirmation and account observation
// are independent stages. No publication timestamp is promoted to account arrival.
const time = value => Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
const day = value => new Date(new Date(value).getTime()+8*3600000).toISOString().slice(0,10);
export function monthBounds(month) {
  const [year,index]=month.split('-').map(Number);
  return [Date.UTC(year,index-1,1)-8*3600000,Date.UTC(year,index,1)-8*3600000];
}
export function buildCycles(status, history, observations=[]) {
  const cycles=[], membership=new Map();
  const add=(id,kind)=>{let c=cycles.find(c=>c.id===id);if(!c){c={id,kind,nodes:[],observations:[],postIds:[]};cycles.push(c);}return c;};
  const node=(c,n)=>{if(!time(n.at))return;if(!c.nodes.some(x=>x.id===n.id&&x.stage===n.stage))c.nodes.push(n);if(n.postId){membership.set(n.postId,c);if(!c.postIds.includes(n.postId))c.postIds.push(n.postId);}};
  for(const event of [...(history?.events||[]),...(history?.recent_audit?.events||[])]) {
    const post=event.confirmation_post_id||event.confirmation?.post_id;
    let c=post&&membership.get(post);
    c ||= add(event.id,event.kind);
    for(const n of event.timeline||[]) {
      const stage=['announcement','timing_update','official_advance','earliest_signal','actionable_signal'].includes(n.stage)?'announcement':
        ['confirmation','official_confirmation'].includes(n.stage)?'confirmation':'evidence';
      node(c,{id:n.post_id||`${event.id}:${n.stage}:${n.at}`,postId:n.post_id,stage,at:n.at||n.created_at,url:n.url});
    }
    const at=event.confirmed_at||event.confirmation?.created_at;
    if(at)node(c,{id:post||event.id,postId:post,stage:'confirmation',at,url:event.confirmation_url||event.confirmation?.url});
    const advance=event.earliest_first_party_signal;
    if(advance)node(c,{id:advance.post_id,postId:advance.post_id,stage:'announcement',at:advance.created_at,url:advance.url});
    if(event.observed_available_at)c.observations.push({id:event.id+':community',kind:'reset_card_granted',assurance:'account_unverified',source:'public_community_report',interval_start:event.observed_available_at,interval_end:event.observed_available_at,observed_at:event.observed_available_at});
  }
  const signals=(status?.live?.signals||[]).filter(s=>['A1','A2'].includes(s.source_tier)&&!s.superseded_by_post_id&&['scheduled_reset','explicit_reset'].includes(s.event_type));
  for(const s of [...signals].sort((a,b)=>time(a.created_at)-time(b.created_at))) {
    let refs=[];try{refs=JSON.parse(s.referenced_post_ids||'[]');}catch{}
    let c=membership.get(s.post_id)||refs.map(id=>membership.get(id)).find(Boolean);
    c ||= cycles.find(c=>c.id===s.cluster_key);
    c ||= add(s.cluster_key||'post:'+s.post_id,s.reset_mode);
    for(const ref of refs) {
      const other=membership.get(ref);
      if(other&&other!==c&&(other.kind==='unknown'||c.kind==='unknown'||other.kind===c.kind)) {
        for(const n of other.nodes)node(c,n);
        c.observations.push(...other.observations);
        for(const p of other.postIds)membership.set(p,c);
        cycles.splice(cycles.indexOf(other),1);
      }
    }
    if(s.reset_mode!=='unknown')c.kind=s.reset_mode;
    node(c,{id:s.post_id,postId:s.post_id,stage:s.event_type==='explicit_reset'?'confirmation':'announcement',at:s.created_at,url:s.url});
    if(s.first_seen_at&&s.notification_eligible===1)node(c,{id:s.post_id+':seen',stage:'discovered',at:s.first_seen_at});
    if(s.notified_at)node(c,{id:s.post_id+':sent',stage:'notified',at:s.notified_at});
  }
  for(const observation of observations) {
    // An explicit source reference is required; never close a nearby cycle by
    // choosing whichever announcement happens to be closest in time.
    const c=observation.signal_post_id&&membership.get(observation.signal_post_id);
    const compatible=c&&!(observation.kind==='reset_card_granted'&&c.kind==='hard_reset')&&!(observation.kind==='quota_recovered'&&c.kind==='banked_reset');
    if(compatible&&!['manual_reset_used','weekly_refill'].includes(observation.kind))c.observations.push(observation);
    else {const own=add('observation:'+observation.id,observation.kind);own.observations.push(observation);}
  }
  for(const c of cycles) {
    c.nodes.sort((a,b)=>time(a.at)-time(b.at));
    const starts=c.nodes.filter(n=>n.stage==='announcement').map(n=>time(n.at));
    c.start=Math.min(...(starts.length?starts:c.nodes.map(n=>time(n.at))),...(!c.nodes.length?c.observations.map(o=>time(o.interval_start)):[]));
    c.confirmed=c.nodes.find(n=>n.stage==='confirmation')?.at||null;
    c.arrival=c.observations.find(o=>o.assurance==='direct'&&['quota_recovered','reset_card_granted'].includes(o.kind))||null;
    c.observed=c.observations.length>0;
    c.end=c.arrival?time(c.arrival.interval_end):Math.max(c.start,...c.nodes.map(n=>time(n.at)),...c.observations.map(o=>time(o.interval_end)));
    c.date=Number.isFinite(c.start)?day(c.start):'';
  }
  return cycles.filter(c=>Number.isFinite(c.start)).sort((a,b)=>a.start-b.start);
}

export function monthSummary(cycles) {
  const map=new Map();
  for(const c of cycles) {
    const key=c.date.slice(0,7);
    if(!map.has(key))map.set(key,{month:key,rounds:0,confirmed:0,arrivals:0,observations:0,updates:0,personalEvents:0,cycles:[]});
    const m=map.get(key);m.cycles.push(c);
    if(['hard_reset','banked_reset','unknown'].includes(c.kind)) {m.rounds++;m.confirmed+=+Boolean(c.confirmed);m.arrivals+=+Boolean(c.arrival);}
    else m.personalEvents++;
    m.observations+=c.observations.length;
    m.updates+=c.postIds.length;
  }
  return [...map.values()].sort((a,b)=>a.month.localeCompare(b.month));
}
