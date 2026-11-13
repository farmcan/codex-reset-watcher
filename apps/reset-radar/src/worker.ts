import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { ORIGIN, RADAR, VERSION, projectStatus } from './state';
interface Env { ASSETS: Fetcher; RADAR: Fetcher }
const UI = 'ui://reset-radar/panel.html';
const MIME = 'text/html;profile=mcp-app';
const CORS = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Accept, MCP-Protocol-Version, MCP-Session-Id','Access-Control-Expose-Headers':'MCP-Session-Id'};
const security = {'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Permissions-Policy':'camera=(), microphone=(), geolocation=()'};
async function panel(env: Env): Promise<Response> {
  const cache = await caches.open('reset-radar-panel-v1');
  const key = new Request(ORIGIN + '/api/panel');
  const hit = await cache.match(key);
  if (hit) return hit;
  try {
    const upstream = await env.RADAR.fetch(new Request(RADAR + '/api/status', {signal:AbortSignal.timeout(12000)}));
    if (!upstream.ok) throw new Error('Source unavailable');
    const data = await upstream.json();
    const response = Response.json(projectStatus(data), {headers:{'Cache-Control':'public, max-age=60'}});
    await cache.put(key,response.clone());
    return response;
  } catch {
    return Response.json(projectStatus(null), {status:503,headers:{'Cache-Control':'no-store'}});
  }
}
async function mcp(request: Request, env: Env): Promise<Response> {
  const server = new McpServer({name:'reset-radar',version:VERSION, title:'小猫重置雷达',icons:[{src:ORIGIN+'/icon.svg',mimeType:'image/svg+xml'}]}, {capabilities:{resources:{},tools:{}}});
  server.registerTool('open_reset_radar', {
    title:'小猫重置雷达', description:'Open the read-only reset status panel. Users open this app directly; it does not send chat messages, call an LLM, or execute tasks.',
    inputSchema:{}, annotations:{readOnlyHint:true, destructiveHint:false,openWorldHint:true},
    _meta:{ui:{resourceUri:UI,visibility:['app']},'openai/ui':{entrypoints:[{type:'global'},{type:'thread'}]},'openai/outputTemplate':UI,securitySchemes:[{type:'noauth'}]},
  }, async () => {
    const response = await panel(env);
    const data = await response.json() as Record<string, unknown>;
    return {content:[{type:'text',text:String(data.headline)}],structuredContent:data,isError:false};
  });
  server.registerResource('reset-radar-panel', UI, {mimeType:MIME,description:'Cloudflare-backed status panel; no chat or model calls.'}, async () => {
    const asset = await env.ASSETS.fetch(new Request(ORIGIN+'/index.html'));
    return {contents:[{uri:UI,mimeType:MIME,text:await asset.text(),_meta:{ui:{csp:{connectDomains:[ORIGIN],resourceDomains:[]},prefersBorder:false},'openai/widgetCSP':{connect_domains:[ORIGIN],resource_domains:[]},'openai/widgetPrefersBorder':false}}]};
  });
  const transport = new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
  await server.connect(transport);
  try {return await transport.handleRequest(request);} finally {await transport.close(); await server.close();}
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    let response: Response;
    if (request.method === 'OPTIONS') response = new Response(null,{status:204});
    else if (url.pathname === '/mcp') {
      if (Number(request.headers.get('content-length') || 0) > 65536) response = new Response('Request too large',{status:413});
      else response = await mcp(request, env);
    } else if (url.pathname === '/api/panel' && request.method === 'GET') response = await panel(env);
    else if (url.pathname === '/healthz') response = Response.json({service:'reset-radar-panel',version:VERSION,source:RADAR});
    else if (request.method === 'GET' || request.method === 'HEAD') response = await env.ASSETS.fetch(request);
    else response = new Response('Method not allowed',{status:405});
    const headers = new Headers(response.headers);
    for (const [k,v] of Object.entries({...CORS,...security})) headers.set(k,v);
    if (headers.get('content-type')?.includes('text/html')) {
      headers.set('Content-Security-Policy', `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ${ORIGIN}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`);
      headers.set('Cache-Control','no-cache');
    }
    return new Response(response.body,{status:response.status,headers});
  }
};
