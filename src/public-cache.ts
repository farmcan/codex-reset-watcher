const PATHS = new Set(['/api/status', '/api/events', '/api/history', '/api/sources', '/healthz', '/feed.xml']);

// Cache only public successful reads. Query strings cannot bypass the shared
// cache and multiply D1 scans. Admin calls and failed health checks never cache.
export async function publicRead(request: Request, respond: () => Promise<Response>, cache?: Cache): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== 'GET' || !PATHS.has(url.pathname) || !cache) return respond();
  url.search = '';
  const key = new Request(url.toString());
  const cached = await cache.match(key);
  if (cached) return clientResponse(cached);
  const response = await respond();
  if (response.ok) {
    const saved = new Response(response.clone().body, response);
    saved.headers.set('Cache-Control', 'public, max-age=60');
    await cache.put(key, saved);
  }
  return response;
}

function clientResponse(response: Response): Response {
  const result = new Response(response.body, response);
  result.headers.set('Cache-Control', 'no-store');
  result.headers.set('X-Watcher-Cache', 'hit');
  return result;
}

export function storageFailure(error: unknown): Response | null {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.includes('D1_ERROR')) return null;
  const quota = /daily row read limit|daily row write limit/i.test(message);
  const next = new Date();
  next.setUTCHours(24, 0, 0, 0);
  return Response.json({error:quota?'storage_daily_limit':'storage_unavailable',
    message:quota?'云端数据库今日额度已用完，监控与通知暂时中断；这不代表没有重置。':'云端数据库暂不可用，当前覆盖未知。',
    coverage:'unknown', retry_after_at:quota?next.toISOString():null},
    {status:503,headers:{'Cache-Control':'no-store','Access-Control-Allow-Origin':'*'}});
}
