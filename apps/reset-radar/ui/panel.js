import {App} from '@modelcontextprotocol/ext-apps';
const API = 'https://codex-reset-radar.weican16hit.workers.dev';
const $ = id => document.getElementById(id);
let app, hostReady = false, state, busy = false, timer, audio;
const memory = new Map();
const prefs = {get(key){try{return localStorage.getItem('reset-radar:'+key) ?? memory.get(key)}catch{return memory.get(key)}},set(key,value){memory.set(key,value);try{localStorage.setItem('reset-radar:'+key,value)}catch{}}};
let lastRead = Number(prefs.get('readAt') || 0), latestNotified = '', sound = prefs.get('sound') === 'on';
const format = (value, full=false) => value ? new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',...(full?{year:'numeric'}:{})}).format(new Date(value)) : '尚无记录';
$('timezone').textContent = Intl.DateTimeFormat().resolvedOptions().timeZone || '本地时间';
function notice(message){$('notice').textContent=message;$('notice').hidden=!message;}
function theme(mode){document.documentElement.classList.toggle('dark',mode==='dark');$('theme').setAttribute('aria-label',mode==='dark'?'切换浅色外观':'切换深色外观');}
theme(prefs.get('theme') || (matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'));
$('theme').onclick=()=>{const mode=document.documentElement.classList.contains('dark')?'light':'dark';prefs.set('theme',mode);theme(mode)};
function soundButton(){$('sound').setAttribute('aria-pressed',String(sound));$('sound').setAttribute('aria-label',sound?'关闭面板提示音':'开启面板提示音');}
function chirp(){if(!audio)return;try{const start=audio.currentTime;[659.25,783.99].forEach((f,i)=>{const o=audio.createOscillator(),g=audio.createGain();o.type='sine';o.frequency.value=f;g.gain.setValueAtTime(0,start+i*.14);g.gain.linearRampToValueAtTime(.07,start+i*.14+.02);g.gain.exponentialRampToValueAtTime(.001,start+i*.14+.28);o.connect(g).connect(audio.destination);o.start(start+i*.14);o.stop(start+i*.14+.3)})}catch{}}
document.addEventListener('pointerdown',()=>{if(sound&&!audio){try{audio=new (window.AudioContext||window.webkitAudioContext)();audio.resume().catch(()=>{});}catch{}}});
$('sound').onclick=async()=>{sound=!sound;prefs.set('sound',sound?'on':'off');soundButton();if(sound){try{audio ||= new (window.AudioContext||window.webkitAudioContext)();await audio.resume();chirp();notice('提示音已开启，仅在面板打开且有新事件时播放。')}catch{notice('当前环境不支持播放提示音。')}}else notice('提示音已关闭。')};soundButton();
function isFresh(s){return s.sourceStatus==='healthy' && s.lastSourceSuccessAt && Date.now()-Date.parse(s.lastSourceSuccessAt)<=s.staleAfterSeconds*1000;}
function label(e){if(e.mode==='banked_reset')return ['Banked reset','banked'];return ({scheduled_reset:['重置预告','hint'],explicit_reset:['官方确认','confirmed'],weak_hint:['弱信号','hint'],community_rumor:['社区传闻','hint'],community_observation:['个人观察','hint'],rate_limit_change:['额度规则','hint']})[e.type]||['新动态','hint'];}
function el(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
function safeUrl(value){try{const u=new URL(value);if(u.protocol==='https:'&&['x.com','twitter.com','codex-reset-watcher.weican16hit.workers.dev','codex-reset-radar.weican16hit.workers.dev'].includes(u.hostname)&&!u.username&&!u.password)return u.href;}catch{}return API+'/';}
function render(s){
  const fresh=isFresh(s);document.querySelector('.hero').dataset.tone=fresh?s.tone:'unknown';
  $('headline').textContent=fresh?s.headline:'暂时无法确认最新状态';
  $('description').textContent=fresh?s.description:'来源检查已过期或暂不可用。以下保留最近记录，不代表没有新消息。';
  $('state-label').textContent=fresh?'最新公开信号':'当前覆盖未知';
  $('health').replaceChildren(el('i','health-dot'),document.createTextNode(fresh?'一手来源正常':'来源检查待恢复'));
  $('health').style.color=fresh?'var(--accent)':'var(--orange)';
  $('source-time').textContent='最近检查 '+format(s.lastSourceSuccessAt);
  $('poll-cadence').textContent='面板每分钟刷新 · 来源约每 '+Math.round(s.pollSeconds/60)+' 分钟检查';
  $('events').replaceChildren();
  const unread=s.events.filter(e=>Date.parse(e.publishedAt)>lastRead).length;$('unread').textContent=unread+' 条未读';$('unread').hidden=!unread;
  for(const e of s.events.slice(0,5)){
    const row=el('article','event'),meta=el('div','event-meta'),[name,cls]=label(e),title=el('h3');
    meta.append(el('span','badge '+cls,name),el('span','', ['A1','A2'].includes(e.tier)?'一手来源':'社区来源'));
    const time=el('time','',format(e.publishedAt));time.dateTime=e.publishedAt;time.title='原帖发布：'+format(e.publishedAt,true);meta.append(time);
    if(Date.parse(e.publishedAt)>lastRead)title.append(el('span','new-dot'));title.append(document.createTextNode(e.title));
    const bottom=el('div','event-bottom');
    if(e.scheduledFor){bottom.append(el('span','',(e.approximate?'预计约 ':'预计 ')+format(e.scheduledFor)));}
    else if(e.type==='explicit_reset')bottom.append(el('span','',e.resetAt?'执行 '+format(e.resetAt):'执行时刻未公布'));
    const link=el('a','external','查看原帖 ↗');link.href=safeUrl(e.url);link.target='_blank';link.rel='noopener noreferrer';bottom.append(link);
    row.append(meta,title,el('p','',e.summary),bottom);$('events').append(row);
  }
  if(!s.events.length)$('events').append(el('p','empty',fresh?'暂未取得可展示的新信号。':'当前无法读取动态，请稍后刷新。'));
  $('radar-link').href=safeUrl(s.links.radar);
}
async function refresh(){
  if(busy)return;busy=true;$('refresh').disabled=true;$('refresh').setAttribute('aria-busy','true');
  try{
    let data;
    if(hostReady){const result=await app.callServerTool({name:'open_reset_radar',arguments:{}},{timeout:15000});data=result.structuredContent;}
    else{const r=await fetch(API+'/api/panel',{signal:AbortSignal.timeout(15000),cache:'no-cache'});data=await r.json();}
    if(!data || !Array.isArray(data.events) || !data.links)throw new Error('Invalid response');
    if(!lastRead){lastRead=Date.now();prefs.set('readAt',String(lastRead));}
    const newest=data.events[0];
    if(state&&isFresh(data)&&newest&&newest.id!==latestNotified&&Date.parse(newest.publishedAt)>lastRead){notice('有新的公开信号，查看下方最近动态。');if(sound)chirp();}
    latestNotified=newest?.id||'';state=data;render(data);
    if(!isFresh(data))notice('云端数据暂不可用或已过期，恢复后会自动重新检查。');
    else if($('notice').textContent.startsWith('云端')||$('notice').textContent.startsWith('连接'))notice('');
  }catch{
    notice('连接暂时中断，正在保留最近记录；稍后自动重试。');
    if(state){state={...state,sourceStatus:'unknown'};render(state);}
    else{$('headline').textContent='暂时连不上云端';$('description').textContent='稍后自动重试，也可以打开完整雷达。';$('state-label').textContent='连接中断';document.querySelector('.hero').dataset.tone='unknown';$('events').replaceChildren(el('p','empty','动态暂不可用。'));$('health').textContent='连接待恢复';}
  }finally{busy=false;$('refresh').disabled=false;$('refresh').setAttribute('aria-busy','false');}
}
$('refresh').onclick=refresh;
$('mark-read').onclick=()=>{lastRead=Date.now();prefs.set('readAt',String(lastRead));if(state)render(state);notice('当前动态已标为已读。已读记录仅保存在当前设备。');};
document.addEventListener('click',async event=>{const a=event.target.closest('a.external');if(!a)return;if(a.classList.contains('privacy-link'))a.href=API+'/privacy.html';if(hostReady){event.preventDefault();try{await app.openLink({url:a.href})}catch{notice('当前客户端未能打开链接，请在浏览器访问完整雷达。')}}});
async function start(){
  if(window.parent!==window){
    try{app=new App({name:'reset-radar-panel',version:'0.1.0'},{});app.ontoolresult=result=>{if(result.structuredContent){state=result.structuredContent;if(!lastRead){lastRead=Date.now();prefs.set('readAt',String(lastRead))}render(state)}};await Promise.race([app.connect(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Host unavailable')),5000))]);hostReady=true;}catch{hostReady=false;}
  }
  await refresh();timer=setInterval(()=>{if(!document.hidden)refresh()},60000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh()});
  window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});
}
start();
