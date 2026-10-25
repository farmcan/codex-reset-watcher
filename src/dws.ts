import type { Env } from './types';
import { shortHash } from './db';

// Protocol/field names follow DingTalk's Apache-2.0 DWS CLI:
// internal/{syncdata/endpoints,helpers/ding,auth/oauth_helpers}.go (2026-10-25).
// Only these fixed DingTalk endpoints and three business tools are used.
const CHAT = 'https://mcp-gw.dingtalk.com/server/0a1609437385696b77fc4771c3ddaf5656b487f809966c0cc8d4755e7b1d3b74';
const IM = 'https://mcp-gw.dingtalk.com/server/450eede6b54d83e030140e66ec77c98a2e89a0869ef4db481f8217a98a42f821';
const AUTH_KEY = 'dws_oauth_v1';
const AAD = new TextEncoder().encode('codex-reset-watcher:dws_oauth_v1');
interface Session {access_token:string;refresh_token:string;client_id:string;expires_at:string;refresh_expires_at:string;refresh_unknown?:boolean}
export class DwsError extends Error {
  constructor(message:string, readonly state:'pending'|'failed'|'unknown') {super(message);}
}
function decode(s:string):Uint8Array<ArrayBuffer> {return Uint8Array.from(atob(s), c=>c.charCodeAt(0));}
function encode(b:Uint8Array):string {return btoa(String.fromCharCode(...b));}
async function cryptoKey(env:Env):Promise<CryptoKey> {
  if (!env.DWS_TOKEN_KEY) throw new DwsError('DWS session encryption key missing','pending');
  return crypto.subtle.importKey('raw',decode(env.DWS_TOKEN_KEY),{name:'AES-GCM'},false,['encrypt','decrypt']);
}
export async function sealDwsSession(env:Env, session:Session):Promise<string> {
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:AAD},await cryptoKey(env),new TextEncoder().encode(JSON.stringify(session)));
  const value=new Uint8Array(12+encrypted.byteLength);value.set(iv);value.set(new Uint8Array(encrypted),12);return encode(value);
}
async function loadSession(env:Env):Promise<Session> {
  const row=await env.DB.prepare('SELECT value FROM app_state WHERE key=?').bind(AUTH_KEY).first<{value:string}>();
  if(!row)throw new DwsError('DWS cloud session missing','pending');
  try {
    const bytes=decode(row.value);
    const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(0,12),additionalData:AAD},await cryptoKey(env),bytes.slice(12));
    return JSON.parse(new TextDecoder().decode(plain)) as Session;
  } catch {throw new DwsError('DWS cloud session cannot be decrypted','failed');}
}
async function saveSession(env:Env,session:Session):Promise<void> {
  await env.DB.prepare('UPDATE app_state SET value=?,updated_at=? WHERE key=?')
    .bind(await sealDwsSession(env,session),new Date().toISOString(),AUTH_KEY).run();
}
export async function dwsAccessToken(env:Env, force=false):Promise<string> {
  let session=await loadSession(env);
  if(session.refresh_unknown)throw new DwsError('DWS refresh result unknown; session reconciliation required','failed');
  if(!force && Date.parse(session.expires_at)>Date.now()+120_000)return session.access_token;
  const lock=crypto.randomUUID();const now=new Date().toISOString();
  await env.DB.prepare(`INSERT INTO app_state(key,value,updated_at) VALUES ('dws_refresh_lock',?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at WHERE updated_at<?`)
    .bind(lock,now,new Date(Date.now()-120_000).toISOString()).run();
  const owner=await env.DB.prepare("SELECT value FROM app_state WHERE key='dws_refresh_lock'").first<{value:string}>();
  if(owner?.value!==lock)throw new DwsError('DWS refresh already in progress','pending');
  try {
    session=await loadSession(env);
    if(!force && Date.parse(session.expires_at)>Date.now()+120_000)return session.access_token;
    // Persist uncertainty before consuming a rotating refresh token. A crash or
    // unreadable response requires reconciliation, never a blind second refresh.
    await saveSession(env,{...session,refresh_unknown:true});
    let response:Response;
    try {response=await fetch('https://mcp.dingtalk.com/oauth2/refreshToken',{
      method:'POST',redirect:'manual',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({clientId:session.client_id,refreshToken:session.refresh_token,grantType:'refresh_token'}),signal:AbortSignal.timeout(20_000)});}
    catch {throw new DwsError('DWS refresh result unknown; reconciliation required','failed');}
    const body=await response.json() as {accessToken?:string;refreshToken?:string;expiresIn?:number;errorCode?:string};
    if(!response.ok || body.errorCode || !body.accessToken || !body.refreshToken){
      throw new DwsError(`DWS refresh rejected HTTP ${response.status}; reauthorization required`,'failed');
    }
    const updated={...session,access_token:body.accessToken,refresh_token:body.refreshToken,refresh_unknown:false,
      expires_at:new Date(Date.now()+(body.expiresIn||7200)*1000).toISOString(),
      refresh_expires_at:new Date(Date.now()+30*24*3600_000).toISOString()};
    await saveSession(env,updated);return updated.access_token;
  } finally {await env.DB.prepare("DELETE FROM app_state WHERE key='dws_refresh_lock' AND value=?").bind(lock).run();}
}
export async function dwsSessionHealth(env:Env):Promise<Record<string,unknown>> {
  if(!env.DWS_TOKEN_KEY)return {configured:false,status:'disabled'};
  try {const s=await loadSession(env);return {configured:true,status:s.refresh_unknown || Date.parse(s.refresh_expires_at)<=Date.now()?'degraded':'healthy',
    access_expires_at:s.expires_at,refresh_expires_at:s.refresh_expires_at,automatic_refresh:true};}
  catch {return {configured:true,status:'degraded',automatic_refresh:true};}
}
export async function dwsCall(env:Env, tool:'get_group_members'|'send_personal_ding'|'send_ding_by_message'|'send_personal_message'|'query_message_send_status'|'list_ding_receiver_status', args:Record<string,unknown>):Promise<Record<string,unknown>> {
  const read=tool==='get_group_members'||tool==='query_message_send_status'||tool==='list_ding_receiver_status';
  const token=await dwsAccessToken(env);let response:Response;
  try {response=await fetch(tool==='get_group_members'||tool==='send_personal_message'?CHAT:IM,{
    method:'POST',redirect:'manual',headers:{'Content-Type':'application/json',Accept:'application/json',Authorization:`Bearer ${token}`,'x-user-access-token':token},
    body:JSON.stringify({jsonrpc:'2.0',id:crypto.randomUUID(),method:'tools/call',params:{name:tool,arguments:args}}),signal:AbortSignal.timeout(25_000)});}
  catch {throw new DwsError(read?'DWS read unavailable':'DWS write result unknown',read?'pending':'unknown');}
  if(!response.ok)throw new DwsError(`DWS ${tool} HTTP ${response.status}`,read||response.status===401||response.status===429?'pending':response.status>=400&&response.status<500?'failed':'unknown');
  let envelope:any;
  try {envelope=await response.json();}catch{throw new DwsError('DWS response unreadable',read?'pending':'unknown');}
  if(envelope.error)throw new DwsError(`DWS ${tool} RPC rejected`,'failed');
  let body:any=envelope.result?.structuredContent;
  if(!body)try {body=JSON.parse(envelope.result?.content?.find((c:any)=>c.type==='text')?.text||'{}');}catch{}
  if(envelope.result?.isError || body?.success!==true){
    const raw=String(body?.errorCode??'rejected');const code=/^[A-Za-z0-9_.-]{1,100}$/.test(raw)?raw:'rejected';
    const detail=typeof body?.errorMsg==='string'?body.errorMsg.split(token).join('[redacted]').replace(/Bearer\s+\S+|https?:\/\/\S+/gi,'[redacted]').slice(0,240):'';
    throw new DwsError(`DWS ${tool} rejected ${code}${detail?' '+detail:''}`,code.toLowerCase().includes('unknown')?'unknown':'failed');
  }
  return body.result || {};
}
interface SendState {receivers?:string[];dingIds:string[];taskId?:string;messageId?:string;strategy?:'group_message';receipts?:Record<string,string>;blocked?:Record<string,string>}
export function selectedDingRecipients(env:Env):string[]|null {
  if(env.DINGTALK_RECIPIENT_IDS===undefined)return null;
  let value:unknown;
  try {value=JSON.parse(env.DINGTALK_RECIPIENT_IDS);}catch{throw new DwsError('Invalid selected DING recipients','failed');}
  if(!Array.isArray(value)||!value.length||value.length>100||value.some(id=>typeof id!=='string'||!id.trim()||id.length>128))throw new DwsError('Invalid selected DING recipients','failed');
  return [...new Set(value as string[])].sort();
}
export async function sendGroupPersonalDing(env:Env,group:string,content:string,idempotencyKey:string):Promise<string> {
  // Production recipient preferences must never alter the isolated test group.
  const selected=group===env.DINGTALK_GROUP_ID?selectedDingRecipients(env):null;
  const key=`dws-send:${await shortHash(group+':'+idempotencyKey)}`;
  const row=await env.DB.prepare('SELECT value FROM app_state WHERE key=?').bind(key).first<{value:string}>();
  const state:SendState=row?JSON.parse(row.value):{dingIds:[]};
  const persist=async()=>{await env.DB.prepare(`INSERT INTO app_state(key,value,updated_at) VALUES (?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`).bind(key,JSON.stringify(state),new Date().toISOString()).run();};
  if(!state.receivers){
    const receivers=new Set<string>();let cursor='0';let complete=false;
    for(let page=0;page<50;page++){
      const result=await dwsCall(env,'get_group_members',{openconversation_id:group,cursor});
      for(const member of (result.list||[]) as Array<Record<string,unknown>>){
        const id=member.openDingtalkId??member.openDingTalkId;
        if(typeof id==='string'&&id.trim())receivers.add(id);
      }
      if(!result.hasMore){complete=true;break;}
      const next=String(result.nextCursor??result.cursor??'');
      if(!next||next===cursor)throw new DwsError('DWS group membership pagination incomplete','pending');cursor=next;
    }
    if(!complete||!receivers.size)throw new DwsError('DWS group membership unavailable','pending');
    state.receivers=[...receivers].sort();await persist();
  }
  const targets=selected??state.receivers;
  if(targets.some(id=>!state.receivers!.includes(id)))throw new DwsError('Selected DING recipient is missing from the group','pending');
  const ensureGroupMessage=async()=>{
    if(!state.taskId&&!state.messageId){
    const result=await dwsCall(env,'send_personal_message',{openConversationId:group,msgType:'text',
      content:JSON.stringify({content}),uuid:`watcher-${await shortHash(key)}-group`});
    if(typeof result.openTaskId==='string')state.taskId=result.openTaskId;
    if(typeof result.openMessageId==='string')state.messageId=result.openMessageId;
    if(!state.taskId&&!state.messageId)throw new DwsError('DWS group message receipt missing','unknown');
    await persist();
    }
    if(state.taskId&&!state.messageId){
    const result=await dwsCall(env,'query_message_send_status',{openTaskId:state.taskId});
    if(result.sendStatus==='SUCCESS'&&typeof result.openMessageId==='string'){
      state.messageId=result.openMessageId;await persist();
    }else if(['FAILED','FAIL'].includes(String(result.sendStatus))){
      throw new DwsError('DING accepted but group record failed; reconcile before replay','unknown');
    }else throw new DwsError('DING accepted; group record still processing','pending');
    }
  };
  if(!state.receipts){
    state.receipts={};
    // Preserve successful batches created by the first deployed version.
    for(let i=0;i<Math.min(state.receivers.length,state.dingIds.length*50);i++)state.receipts[state.receivers[i]!]=state.dingIds[Math.floor(i/50)]!;
  }
  state.blocked??={};
  // Prefer app-only personal DING. An explicit FORBIDDEN can require a source
  // group-message context. Try that DING path once; never treat its prerequisite
  // group message alone as successful notification, or retry unknown outcomes.
  const deliver=async(ids:string[]):Promise<void>=>{
    if(!ids.length)return;
    const common={receiverOpenDingTalkIds:ids,remindType:'APP',uuid:`watcher-${await shortHash(key+':'+ids.join(','))}`};
    let result:Record<string,unknown>;
    if(!state.strategy){
      try {result=await dwsCall(env,'send_personal_ding',{...common,content});}
      catch(error){
        if(!(error instanceof DwsError)||error.state!=='failed'||!error.message.includes('FORBIDDEN'))throw error;
        state.strategy='group_message';await persist();
      }
    }
    if(state.strategy){
      await ensureGroupMessage();
      try {result=await dwsCall(env,'send_ding_by_message',{...common,uuid:common.uuid+'-group',openConversationId:group,openMessageId:state.messageId});}
      catch(error){
        if(!(error instanceof DwsError)||error.state!=='failed'||!error.message.includes('neither colleagues nor friends'))throw error;
        // A single unreachable person must not prevent notifications to every
        // other member. Explicit business rejection proves this batch was not
        // accepted, so splitting it is safe; unknown results are never split.
        if(ids.length>1){const middle=Math.ceil(ids.length/2);await deliver(ids.slice(0,middle));await deliver(ids.slice(middle));}
        else {state.blocked![ids[0]!]='not_colleague_or_friend';await persist();}
        return;
      }
    }
    if(typeof result!.openDingId!=='string'||!result!.openDingId.trim())throw new DwsError('DWS DING has no openDingId; result unknown','unknown');
    state.dingIds.push(result!.openDingId);
    for(const id of ids){state.receipts![id]=result!.openDingId;delete state.blocked![id];}
    await persist();
  };
  const remaining=targets.filter(id=>!state.receipts![id]);
  for(let offset=0;offset<remaining.length;offset+=50){
    await deliver(remaining.slice(offset,offset+50));
  }
  await ensureGroupMessage();
  const delivered=targets.filter(id=>Boolean(state.receipts![id])).length;
  if(delivered!==targets.length)throw new DwsError(`DING coverage partial: ${delivered}/${targets.length}; remaining members are not colleagues or friends`,'pending');
  await env.DB.prepare(`INSERT INTO app_state(key,value,updated_at) VALUES ('dws_ding_last_success',?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`)
    .bind(JSON.stringify({recipient_count:targets.length,group_member_count:state.receivers.length,recipient_scope:selected?'selected_members':'group_members',ding_count:state.dingIds.length}),new Date().toISOString()).run();
  return JSON.stringify({openDingIds:state.dingIds,recipientCount:targets.length,groupMemberCount:state.receivers.length,recipientScope:selected?'selected_members':'group_members',
    openTaskId:state.taskId,openMessageId:state.messageId,channel:'personal_app_ding'});
}
