// Isolated personal test harness for Tencent/openclaw-weixin.
// Protocol/source: https://github.com/Tencent/openclaw-weixin/tree/874637a0dbc24050f72d1385add4fc6170a2d726 (MIT).
// No OpenClaw gateway, Worker configuration, or existing chat state is changed.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
const dir=path.join(os.homedir(),'.config/codex-reset-watcher/weixin-personal-test');
fs.mkdirSync(dir,{recursive:true,mode:0o700}); fs.chmodSync(dir,0o700);
const read=(name)=>{try{return JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'))}catch(e){if(e.code==='ENOENT')return {};throw e}};
const write=(name,data)=>{const p=path.join(dir,name);fs.writeFileSync(p,JSON.stringify(data,null,2)+'\n',{mode:0o600});fs.chmodSync(p,0o600)};
const common={'iLink-App-Id':'bot','iLink-App-ClientVersion':String((2<<16)|(4<<8)|10)};
const base_info={channel_version:'2.4.10',bot_agent:'CodexResetWatcher/0.1.0 (personal-test)'};
const now=()=>new Date().toISOString();
function origin(raw){const u=new URL(raw);if(u.protocol!=='https:'||!/(^|\.)weixin\.qq\.com$/.test(u.hostname)||u.port||u.username||u.password)throw Error('Refusing non-Tencent API origin');return u.origin}
async function api(base,endpoint,body,token){
 const h={...common};if(body!==undefined)Object.assign(h,{'Content-Type':'application/json',AuthorizationType:'ilink_bot_token','X-WECHAT-UIN':Buffer.from(String(crypto.randomBytes(4).readUInt32BE())).toString('base64')});
 if(token)h.Authorization=`Bearer ${token}`;
 const r=await fetch(new URL(endpoint,origin(base)),{method:body===undefined?'GET':'POST',headers:h,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(40000),redirect:'error'});
 const raw=await r.text();const data=JSON.parse(raw,(key,value,ctx)=>['message_id','msg_id','svr_id'].includes(key)&&typeof value==='number'?ctx?.source??String(value):value);const shape=Object.fromEntries(Object.entries(data).map(([k,v])=>[k,Array.isArray(v)?'array:'+v.length:typeof v]));evidence('response_shape',{endpoint:endpoint.split('?')[0],http_status:r.status,shape});if(endpoint==='/ilink/bot/sendmessage')write('last-send-response.json',data);if(!r.ok)throw Error(`HTTP ${r.status}`);return data;
}
function evidence(kind,data){const p=path.join(dir,'evidence.jsonl');fs.appendFileSync(p,JSON.stringify({at:now(),kind,...data})+'\n',{mode:0o600});fs.chmodSync(p,0o600)}
const cmd=process.argv[2];
try{
 if(cmd==='qr'){
  if(read('account.json').bot_token)throw Error('Already bound; refuse creating a replacement session');
  const q=await api('https://ilinkai.weixin.qq.com','/ilink/bot/get_bot_qrcode?bot_type=3',{local_token_list:[]});
  if(!q.qrcode||!q.qrcode_img_content)throw Error('Invalid QR response');
  write('qr.json',{...q,created_at:now(),poll_origin:'https://ilinkai.weixin.qq.com'});evidence('qr_created',{has_qr:true});console.log(JSON.stringify({status:'qr_created',private_state_dir:dir}));
 }else if(cmd==='poll'){
  const q=read('qr.json');if(!q.qrcode)throw Error('No QR');
  const verify=read('verify.json').code;
  if(Date.now()-Date.parse(q.created_at)>5*60_000)throw Error('Local five-minute QR safety deadline exceeded; request a fresh QR');
  const u='/ilink/bot/get_qrcode_status?qrcode='+encodeURIComponent(q.qrcode)+(verify?'&verify_code='+encodeURIComponent(verify):'');
  const d=await api(q.poll_origin,u);
  if(d.status==='scaned_but_redirect'&&d.redirect_host){q.poll_origin=origin('https://'+d.redirect_host);write('qr.json',q)}
  if(d.status==='confirmed'){
   if(!d.bot_token||!d.ilink_bot_id||!d.ilink_user_id||!d.baseurl)throw Error('Incomplete confirmed login');
   origin(d.baseurl);write('account.json',{bot_token:d.bot_token,bot_id:d.ilink_bot_id,owner_id:d.ilink_user_id,base_url:d.baseurl,bound_at:now()});
   for(const f of ['verify.json','qr.json','qr.png','qr-2.png'])fs.rmSync(path.join(dir,f),{force:true});
  }
  evidence('qr_status',{status:d.status});console.log(JSON.stringify({status:d.status,bound:!!read('account.json').bot_token}));
 }else if(cmd==='start'||cmd==='stop'){
  const a=read('account.json');if(!a.bot_token)throw Error('Not bound');const d=await api(a.base_url,'/ilink/bot/msg/notify'+cmd,{base_info},a.bot_token);const summary={operation:cmd,ret:d.ret??null,errcode:d.errcode??null,explicit_error:(d.ret!==undefined&&d.ret!==0)||(d.errcode!==undefined&&d.errcode!==0)};evidence('lifecycle',summary);console.log(JSON.stringify(summary));
 }else if(cmd==='receive'){
  const a=read('account.json');if(!a.bot_token)throw Error('Not bound');const s=read('conversation.json');
  const d=await api(a.base_url,'/ilink/bot/getupdates',{get_updates_buf:s.cursor||'',base_info},a.bot_token);
  const summary={ret:d.ret??null,errcode:d.errcode??null,owner_messages:0,ignored_messages:0,context_updated:false,marker_received:false,ack_received:false};
  if((d.ret!==undefined&&d.ret!==0)||d.errcode){evidence('receive',summary);console.log(JSON.stringify(summary));process.exit(0)}
  for(const m of d.msgs||[]){
   if(m.group_id||m.from_user_id!==a.owner_id||m.message_type!==1){summary.ignored_messages++;continue}
   summary.owner_messages++;
   if(m.context_token){s.context_token=m.context_token;s.context_received_at=now();s.message_created_at_ms=m.create_time_ms;summary.context_updated=true}
   // Inspect only the exact test phrases from the QR-scanning owner, never persist chat text.
   for(const item of m.item_list||[]){if(item.type!==1)continue;const text=item.text_item?.text?.trim();
    if(text==='重置通知绑定测试'){summary.marker_received=true;s.marker_received_at=now();if(!s.probe_context_token&&m.context_token){s.probe_context_token=m.context_token;s.probe_context_observed_at=now()}}
    if(text==='收到重置测试'){const accepted=(read('sends.json').attempts||[]).filter(x=>x.mode==='context'&&x.status==='api_accepted').at(-1);if(accepted&&Number(m.create_time_ms)>=Date.parse(accepted.at)){summary.ack_received=true;s.ack_received_at=now();s.ack_for_client_id=accepted.client_id;const l=read('sends.json');const attempt=l.attempts.find(x=>x.client_id===accepted.client_id);attempt.recipient_confirmed=true;attempt.recipient_confirmed_at=now();attempt.recipient_confirmation_source='owner bot reply after send';write('sends.json',l)}}
   }
  }
  if(d.get_updates_buf)s.cursor=d.get_updates_buf;write('conversation.json',s);evidence('receive',summary);console.log(JSON.stringify(summary));
 }else if(cmd==='send'){
  const mode=process.argv[3];if(!['context','no-context','request-marker'].includes(mode))throw Error('Specify context, no-context or request-marker');
  const a=read('account.json'),s=read('conversation.json'),ledger=read('sends.json'),frozen=read('probe-context.json');const probeToken=frozen.context_token||s.probe_context_token;const probeObservedAt=frozen.observed_at||s.probe_context_observed_at;if(!a.bot_token||!a.owner_id)throw Error('Not bound');
  if(mode==='context'&&(!probeToken||(!s.marker_received_at&&!frozen.basis)))throw Error('No owner test marker/context');
  if((ledger.attempts||[]).some(x=>x.status==='unknown'&&!x.recipient_confirmed))throw Error('Previous send outcome unknown; inspect before any further sends');
  if(mode==='context'&&(ledger.attempts||[]).some(x=>x.mode==='context')&&process.argv[4]!=='delayed')throw Error('Fresh context test already attempted; do not replay');
  if(mode==='context'&&process.argv[4]==='delayed'&&(Date.now()-Date.parse(probeObservedAt)<180000||Date.now()-Date.parse(s.context_received_at)<180000))throw Error('Wait until frozen context and last observed owner inbound are both at least 180 seconds old');
  if((ledger.attempts||[]).length>=4)throw Error('Personal test cap of four send attempts reached');
  const client_id='codex-reset-personal-'+crypto.randomUUID();
  const msg={from_user_id:'',to_user_id:a.owner_id,client_id,message_type:2,message_state:2,item_list:[{type:1,text_item:{text:mode==='request-marker'?'【本人链路测试】这不是重置信号。为验证入站，请直接在这个ClawBot私聊回复：重置通知绑定测试':mode==='context'?`【本人测试·第${(ledger.attempts||[]).length+1}次】重置通知链路测试 WX-20261031；这不是重置信号。看到后请回复：收到重置测试`:'【本人测试】无上下文主动通知测试 WX-20261031；这不是重置信号。'}}]};
  if(mode==='context')msg.context_token=probeToken;
  const attempt={at:now(),mode,client_id,status:'unknown',context_age_ms:mode==='context'&&probeObservedAt?Date.now()-Date.parse(probeObservedAt):null,owner_inbound_idle_ms:s.context_received_at?Date.now()-Date.parse(s.context_received_at):null};
  ledger.attempts??=[];ledger.attempts.push(attempt);write('sends.json',ledger);
  const d=await api(a.base_url,'/ilink/bot/sendmessage',{msg,base_info},a.bot_token);
  attempt.ret=d.ret??null;attempt.errcode=d.errcode??null;attempt.server_message_id_present=!!d.message_id;attempt.provider_message_id=d.message_id?String(d.message_id):null;
  const businessError=(d.ret!==undefined&&d.ret!==0)||(d.errcode!==undefined&&d.errcode!==0);attempt.status=businessError?'rejected':d.ret===0||d.message_id?'api_accepted':'unknown';
  write('sends.json',ledger);evidence('send',attempt);console.log(JSON.stringify(attempt));
 }else if(cmd==='status'){
  const a=read('account.json'),s=read('conversation.json'),l=read('sends.json');console.log(JSON.stringify({bound:!!a.bot_token,bound_at:a.bound_at||null,has_owner_id:!!a.owner_id,has_context:!!s.context_token,context_received_at:s.context_received_at||null,marker_received:!!s.marker_received_at,ack_received:!!s.ack_received_at,attempts:l.attempts||[],private_state_dir:dir}));
 }else throw Error('Commands: qr, poll, start, stop, receive, send context|no-context|request-marker, status');
}catch(e){evidence('error',{command:cmd,error_name:e.name,network_code:e.cause?.code||null});console.error(JSON.stringify({status:'error',command:cmd,error_name:e.name,network_code:e.cause?.code||null}));process.exitCode=1}
