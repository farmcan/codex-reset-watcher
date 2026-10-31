import {buildCycles,monthSummary,monthBounds} from './cycle-model.js';
const EN=document.documentElement.lang==='en';
const tr=(zh,en)=>EN?en:zh;
const format=value=>new Intl.DateTimeFormat(EN?'en-GB':'zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));
const element=(tag,text,cls)=>{const e=document.createElement(tag);e.textContent=text;if(cls)e.className=cls;return e;};
const stageName={announcement:tr('公开预告','Announcement'),confirmation:tr('官方完成确认','Official confirmation'),discovered:tr('监测收到','Detected'),notified:tr('通知已报出','Notification sent'),evidence:tr('来源证据','Evidence')};
const kindName=k=>({hard_reset:tr('全量重置','Hard reset'),banked_reset:tr('重置卡','Banked reset'),manual_reset_used:tr('手动使用卡','Manual redemption'),weekly_refill:tr('正常周补充','Weekly refill'),reset_card_granted:tr('卡发放观察','Card grant'),quota_recovered:tr('恢复观察','Recovery observation')})[k]||tr('类型待核','Type unverified');
let timeline,cycles=[],range,expanded=false,loaded=false,paintTimer,selected;
let detail=document.getElementById('cycle-detail');

async function library(){
  if(window.vis)return;
  await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=new URL('./vendor/vis-timeline/vis-timeline.min.js',import.meta.url);s.onload=resolve;s.onerror=reject;document.head.append(s);});
}
function describe(c){
  selected=c.id;detail.replaceChildren(element('h3',`${c.date} · ${kindName(c.kind)}`));
  const description=c.kind==='manual_reset_used'?tr('已记录手动使用重置卡。这是独立的个人事件，不归为全局自动发放。','Manual reset-card redemption recorded as a separate personal event, not a global rollout.'):
    c.kind==='reset_card_granted'?tr('已记录重置卡获得；发卡与使用是两个不同事件。','Reset-card grant recorded; receiving and redeeming a card are separate events.'):
    c.arrival?tr('已观察到账号恢复 / 发卡；不代表所有账号同步到账，具体恢复原因仍待核。','Account recovery / card grant observed; not proof of universal delivery or its cause.'):
    c.observed?tr('已有历史 / 社区观察；账号归属或与本轮的关系仍待核，未计入已验证到账。','Historical / community observation exists; identity or cycle attribution remains unverified.'):
    tr('尚无经验证的个人到账终点；官方完成公告与个人到账分别记录。','No verified personal arrival endpoint; official confirmation is a separate stage.');
  detail.append(element('p',description));
  const list=document.createElement('ol');
  const all=c.nodes.map(n=>({at:n.at,label:stageName[n.stage],url:n.url}));
  for(const o of c.observations)all.push({at:o.interval_end,label:`${kindName(o.kind)} · ${o.interval_start===o.interval_end?format(o.interval_end):`${format(o.interval_start)}—${format(o.interval_end)}`} · ${o.assurance==='direct'?tr('直接记录','Direct record'):tr('历史 / 社区观察，归属待核','Historical / community observation; identity unverified')}`});
  for(const n of all.sort((a,b)=>Date.parse(a.at)-Date.parse(b.at))){const li=element('li',`${format(n.at)} · ${n.label}`);if(n.url&&/^https:\/\/x\.com\//.test(n.url)){const a=element('a',tr(' 原帖 ↗',' Source ↗'));a.href=n.url;a.target='_blank';a.rel='noopener noreferrer';li.append(a);}list.append(li);}
  detail.append(list);
  if(c.observations.some(o=>o.source==='local_quota_telemetry'))detail.append(element('p',tr('本机旧日志的窗口变化是历史观察；缺少稳定账号身份，不提升为已验证到账。','Historical local quota telemetry lacks stable account identity and is not upgraded to verified arrival.'),'quiet-note'));
}
function paint(){
  if(!timeline||!range)return;
  const start=+range.start,end=+range.end,monthly=end-start>45*86400000;
  document.getElementById('cycle-view-label').textContent=monthly?tr('月汇总 · 点击月份展开','Monthly · select a month to expand'):tr('每轮一行 · 点击查看证据','One row per cycle · select for evidence');
  const visible=cycles.filter(c=>c.start<=end&&c.end>=start);
  const items=[],groups=[];
  if(monthly){
    groups.push({id:'months',content:tr('月度概览','Monthly overview')});
    for(const m of monthSummary(cycles)){
      const [start,end]=monthBounds(m.month),a=new Date(start),b=new Date(end);
      const content=element('span',`${m.month} · ${m.rounds} ${tr('轮','cycles')} · ${m.updates} ${tr('条更新','updates')} · ${m.arrivals} ${tr('到账观察','verified arrivals')}`);
      items.push({id:'month:'+m.month,group:'months',start:a,end:b,type:'range',content,className:'cycle-month'});
    }
  } else for(const c of visible){
    const label=element('div',`${c.date.slice(5)} · ${kindName(c.kind)}`);label.title=c.date;
    groups.push({id:c.id,content:label,order:-c.start});
    const next=cycles.find(n=>n.start>c.start&&['hard_reset','banked_reset','unknown'].includes(n.kind));
    const terminal=c.arrival?Date.parse(c.arrival.interval_end):c.end;
    if(['hard_reset','banked_reset','unknown'].includes(c.kind))items.push({id:c.id,group:c.id,start:c.start,end:Math.max(c.start+60000,terminal),type:'range',content:element('span',c.arrival?tr('账号恢复观察','Account arrival observed'):c.confirmed?tr('官方完成','Officially confirmed'):tr('预告 / 证据','Announcement / evidence')),className:c.arrival?'cycle-closed':'cycle-announced'});
    if(!c.arrival&&['hard_reset','banked_reset','unknown'].includes(c.kind)){
      const until=Math.min(next?.start||Date.now(),Date.now());
      if(until>terminal)items.push({id:c.id+':waiting',group:c.id,start:terminal,end:until,type:'range',content:element('span',tr('到账待验证','Arrival unverified')),className:'cycle-waiting'});
    }
    if(expanded)for(const n of c.nodes)items.push({id:c.id+':'+n.id+':'+n.stage,group:c.id,start:n.at,type:'point',content:element('span',stageName[n.stage]),className:'cycle-node '+n.stage});
    for(const o of c.observations)items.push({id:c.id+':observation:'+o.id,group:c.id,start:o.interval_start,end:Date.parse(o.interval_end)>Date.parse(o.interval_start)?o.interval_end:undefined,type:Date.parse(o.interval_end)>Date.parse(o.interval_start)?'range':'point',content:element('span',o.assurance==='direct'?kindName(o.kind):tr('历史 / 社区观察','Historical / community observation')),className:o.assurance==='direct'?'cycle-arrival':'cycle-inferred'});
  }
  timeline.setData({items,groups});
  document.getElementById('cycle-window-summary').textContent=monthly?tr('按预告开始月份归组；无到账证据的轮次不计为到账。','Grouped by announcement month; missing evidence is never counted as an arrival.'):`${visible.length} ${tr('条周期 / 独立观察 · 横轴为北京时间','cycles / observations · time axis: Asia/Shanghai')}`;
}
function monthlyTable(){
  const table=document.getElementById('cycle-monthly');table.replaceChildren();
  for(const m of monthSummary(cycles).reverse()){
    const b=element('button',`${m.month}　${m.rounds} ${tr('轮','cycles')}　${m.updates} ${tr('条更新','updates')}　${m.confirmed} ${tr('官方完成','confirmed')}　${m.arrivals} ${tr('到账观察','verified arrivals')}`);b.type='button';
    b.onclick=()=>{const a=new Date(m.month+'-01T00:00:00+08:00');timeline.setWindow(a,new Date(+a+31*86400000));};table.append(b);
  }
}
export async function renderCycleTimeline(status,history,observationData){
  const container=document.getElementById('cycle-chart');if(!container)return;
  cycles=buildCycles(status,history,observationData?.observations||[]);
  document.getElementById('cycle-data-note').textContent=observationData?.unavailable?tr('到账观察接口暂不可读；覆盖未知。','Arrival observation feed unavailable; coverage unknown.'):tr('只统计已收录证据，不能推断完整发放次数。历史 / 社区观察单独标记。','Recorded evidence only, not a complete delivery census. Historical / community observations are labelled separately.');
  try{
    await library();
    if(!timeline){
      container.replaceChildren();
      range={start:new Date(Date.now()-21*86400000),end:new Date(Date.now()+86400000)};
      timeline=new window.vis.Timeline(container,[],[],{height:'520px',maxHeight:650,verticalScroll:true,stack:true,editable:false,selectable:true,zoomKey:'ctrlKey',zoomMin:3600000,zoomMax:370*86400000,start:range.start,end:range.end,orientation:'top',showCurrentTime:true,margin:{item:8,axis:18},moment:date=>window.vis.moment(date).utcOffset(480),format:{minorLabels:{weekday:'M/D',day:'D',month:EN?'MMM':'M月'},majorLabels:{weekday:'YYYY-MM',day:'YYYY-MM',month:'YYYY'}},groupOrder:'order'});
      timeline.on('rangechanged',r=>{range=r;clearTimeout(paintTimer);paintTimer=setTimeout(paint,80);});
      timeline.on('select',({items})=>{const id=items[0];if(!id)return;if(id.startsWith('month:')){const a=new Date(id.slice(6)+'-01T00:00:00+08:00');timeline.setWindow(a,new Date(+a+31*86400000));return;}const c=cycles.find(c=>id===c.id||id.startsWith(c.id+':'));if(c)describe(c);});
      document.querySelectorAll('[data-cycle-span]').forEach(b=>b.addEventListener('click',()=>{const days=Number(b.dataset.cycleSpan);const now=Date.now();timeline.setWindow(now-days*86400000,now+86400000);}));
      document.getElementById('cycle-zoom-in').onclick=()=>timeline.zoomIn(.5);
      document.getElementById('cycle-zoom-out').onclick=()=>timeline.zoomOut(.5);
      document.getElementById('cycle-expand').onclick=event=>{expanded=!expanded;event.currentTarget.setAttribute('aria-pressed',String(expanded));event.currentTarget.textContent=expanded?tr('收起过程节点','Collapse stages'):tr('展开过程节点','Expand stages');paint();};
      loaded=true;
    }
    paint();monthlyTable();
    const chosen=cycles.find(c=>c.id===selected)||cycles.at(-1);if(chosen)describe(chosen);
  }catch{if(!loaded)container.replaceChildren(element('p',tr('时间轴组件暂不可用，下方证据列表仍可查看。','Timeline unavailable; the evidence list below remains available.')));}
}
