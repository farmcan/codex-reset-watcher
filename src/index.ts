import { handleApi } from "./api";
import { runPoll } from "./poll";
import { buildRss } from "./rss";
import type { Env } from "./types";

const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/__scheduled") return new Response("Not Found", { status: 404 });
    const api = await handleApi(request, env);
    if (api) return withSecurityHeaders(api);
    if (request.method === "GET" && url.pathname === "/feed.xml") return withSecurityHeaders(await buildRss(env, url.origin));
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method Not Allowed", { status: 405 });
    return withSecurityHeaders(await env.ASSETS.fetch(request));
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runPoll(env).catch((error) => {
      console.error("Scheduled poll failed", error);
    }));
  }
};

function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  if (headers.get("Content-Type")?.includes("text/html")) headers.set("Cache-Control", "public, max-age=0, must-revalidate");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
