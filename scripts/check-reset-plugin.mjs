// Real HTTP/MCP acceptance. No OpenAI client or model request is involved.
import {Client} from '../apps/reset-radar/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import {StreamableHTTPClientTransport} from '../apps/reset-radar/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js';
import assert from 'node:assert/strict';
const base=process.env.RESET_PANEL_URL || 'https://codex-reset-radar.weican16hit.workers.dev';
const response=await fetch(base+'/api/panel',{signal:AbortSignal.timeout(20000)});
assert.equal(response.status,200);
const state=await response.json();assert.equal(state.version,'0.1.0');assert.ok(Array.isArray(state.events));
const text=JSON.stringify(state);for(const forbidden of ['poll_runs','arrival_observations','owner_token','delivery_counts'])assert.ok(!text.includes(forbidden));
const client=new Client({name:'reset-radar-acceptance',version:'0.1.0'});
try{
 await client.connect(new StreamableHTTPClientTransport(new URL(base+'/mcp')));
 const {tools}=await client.listTools();assert.equal(tools.length,1);const tool=tools[0];
 assert.deepEqual(tool._meta.ui.visibility,['app']);assert.deepEqual(tool._meta['openai/ui'].entrypoints,[{type:'global'},{type:'thread'}]);
 const call=await client.callTool({name:'open_reset_radar',arguments:{}});assert.equal(call.structuredContent.version,'0.1.0');
 const resource=await client.readResource({uri:'ui://reset-radar/panel.html'});assert.equal(resource.contents[0].mimeType,'text/html;profile=mcp-app');
 assert.ok(resource.contents[0].text.includes('小猫重置雷达'));
 for(const path of ['/api/admin/poll','/api/arrival-observations']){const r=await fetch(base+path);assert.equal(r.status,404);}
 console.log(JSON.stringify({passed:true,version:state.version,sourceStatus:state.sourceStatus,lastSourceSuccessAt:state.lastSourceSuccessAt,bytes:Buffer.byteLength(text),events:state.events.length,staticEntrypoints:['global','thread'],mcpResourceBytes:Buffer.byteLength(resource.contents[0].text)},null,2));
}finally{await client.close();}
