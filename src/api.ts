import historical from "../data/reset-events.json";
import scorecard from "../data/source-scorecard.json";
import { dashboardData, ensureSourceState } from "./db";
import { emailConfigured, sendTestEmail } from "./notifications";
import { runPoll } from "./poll";
import type { Env } from "./types";
import { processReviews, reviewHealth } from "./model-review";
import { acquirePollLock, releasePollLock } from "./db";
import { dingtalkConfigured, dingTalkHealth, processDingTalkDeliveries, testDingTalk } from "./dingtalk";
import { dwsAccessToken, dwsSessionHealth } from './dws';
import { reconcileNotificationQueue } from './notification-queue';

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*"
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), { status, headers: JSON_HEADERS });
}

async function healthSnapshot(env: Env): Promise<Record<string, unknown>> {
  await ensureSourceState(env.DB);
  const live = await dashboardData(env.DB);
  const sources = live.sources as Array<Record<string, unknown>>;
  const official = sources.find((source) => source.name === "official-first-party");
  const lastSuccess = typeof official?.last_success_at === "string" ? Date.parse(official.last_success_at) : null;
  const pollSeconds = Number(official?.poll_seconds ?? 3600);
  const staleAfterMs = pollSeconds * 3 * 1000 + 60_000;
  const ageMs = lastSuccess === null ? null : Date.now() - lastSuccess;
  const sourceStatus = lastSuccess === null
    ? (official?.last_error ? "down" : "initializing")
    : ageMs !== null && ageMs > staleAfterMs
      ? "stale"
      : "healthy";
  const dingHealth = await dingTalkHealth(env);
  const personal=env.DINGTALK_MODE==='personal_ding';
  const session=personal?await dwsSessionHealth(env):undefined;
  const overall = sourceStatus === "healthy" && (dingHealth.status === 'degraded'||session?.status==='degraded') ? 'degraded' : sourceStatus;
  return {
    overall,
    generated_at: new Date().toISOString(),
    source_status: sourceStatus,
    official_last_success_at: official?.last_success_at ?? null,
    official_age_seconds: ageMs === null ? null : Math.max(0, Math.round(ageMs / 1000)),
    expected_poll_seconds: pollSeconds,
    grace_seconds: Math.round(staleAfterMs / 1000),
    x_token_configured: Boolean(env.X_BEARER_TOKEN),
    model_review: await reviewHealth(env),
    email: {
      configured: emailConfigured(env),
      provider: env.EMAIL_PROVIDER,
      minimum_severity: env.EMAIL_MIN_SEVERITY,
      recipient_configured: Boolean(env.ALERT_EMAIL_TO)
    },
    dingtalk: {
      configured: dingtalkConfigured(env), channel: personal?'personal_app_ding':"robot_group_message", true_ding: personal, mentions_all_requested: true, mention_delivery_verified: !personal,
      mention_verification_basis: personal?"cloud_business_receipt":"recipient_confirmed_2026-10-22",
      delivery_counts: (live.deliveries as Array<{channel: string; status: string; count: number}>).filter(row => row.channel === "dingtalk"),
      automatic_token_refresh: true,
      ...dingHealth, session, notification_scope:'all_new_visible_signals'
    },
    ...live
  };
}

async function authorized(request: Request, env: Env): Promise<boolean> {
  if (!env.ADMIN_TOKEN) return false;
  const value = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const [left, right] = await Promise.all([value, env.ADMIN_TOKEN].map(async (input) => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
    return new Uint8Array(digest);
  }));
  if (!left || !right || left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return mismatch === 0;
}

export async function handleApi(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
    return new Response(null, { headers: { ...JSON_HEADERS, "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type" } });
  }
  if (request.method === "GET" && url.pathname === "/api/status") {
    return json({
      project: "codex-reset-watcher",
      unofficial: true,
      historical_summary: historical.summary,
      live: await healthSnapshot(env)
    });
  }
  if (request.method === "GET" && url.pathname === "/api/events") {
    return json((await dashboardData(env.DB)).signals);
  }
  if (request.method === "GET" && url.pathname === "/api/history") return json(historical);
  if (request.method === "GET" && url.pathname === "/api/sources") return json(scorecard);
  if (request.method === "GET" && url.pathname === "/healthz") {
    const health = await healthSnapshot(env);
    return json(health, health.overall === "healthy" ? 200 : 503);
  }
  if (request.method === "POST" && url.pathname === "/api/admin/poll") {
    if (!await authorized(request, env)) return json({ error: "unauthorized" }, 401);
    return json(await runPoll(env));
  }
  if (request.method === "POST" && url.pathname === "/api/admin/review") {
    if (!await authorized(request, env) && !await authorized(request, {...env, ADMIN_TOKEN:env.REVIEW_ADMIN_TOKEN})) return json({error:'unauthorized'},401);
    const lock = crypto.randomUUID();
    if (!await acquirePollLock(env.DB,lock,new Date().toISOString())) return json({error:'poll_in_progress'},409);
    try {
      const requestedLimit = Number(url.searchParams.get('limit') || 1);
      await processReviews(env, Number.isInteger(requestedLimit) ? requestedLimit : 1);
      return json(await reviewHealth(env));
    } finally { await releasePollLock(env.DB,lock); }
  }
  if (request.method === "POST" && url.pathname === "/api/admin/test-email") {
    if (!await authorized(request, env)) return json({ error: "unauthorized" }, 401);
    try {
      await sendTestEmail(env);
      return json({ status: "sent" });
    } catch (error) {
      return json({ status: "failed", error: error instanceof Error ? error.message : String(error) }, 502);
    }
  }
  if (request.method === "POST" && url.pathname === "/api/admin/test-dingtalk") {
    if (!await authorized(request, env) && !await authorized(request, { ...env, ADMIN_TOKEN: env.DINGTALK_TEST_TOKEN })) return json({error: "unauthorized"}, 401);
    const key = request.headers.get("Idempotency-Key") ?? "";
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(key)) return json({error: "Idempotency-Key required (8-100 alphanumeric characters)"}, 400);
    const result = await testDingTalk(env, key);
    return json(result, result.status === "sent" ? 200 : 502);
  }
  if (request.method === "POST" && url.pathname === "/api/admin/refresh-dws") {
    if (!await authorized(request, env) && !await authorized(request, { ...env, ADMIN_TOKEN: env.DINGTALK_TEST_TOKEN })) return json({error:'unauthorized'},401);
    try {await dwsAccessToken(env,true);return json(await dwsSessionHealth(env));}
    catch {return json({status:'failed',error:'DWS refresh failed; inspect session health'},502);}
  }
  if (request.method === "POST" && url.pathname === "/api/admin/reconcile-notifications") {
    if (!await authorized(request, env) && !await authorized(request, { ...env, ADMIN_TOKEN: env.DINGTALK_TEST_TOKEN })) return json({error:'unauthorized'},401);
    const lock=crypto.randomUUID();
    if(!await acquirePollLock(env.DB,lock,new Date().toISOString()))return json({error:'poll_in_progress'},409);
    try {
      const queued=await reconcileNotificationQueue(env,new Date().toISOString());
      const delivered=await processDingTalkDeliveries(env);
      return json({queued,...delivered,dingtalk:await dingTalkHealth(env)});
    } finally {await releasePollLock(env.DB,lock);}
  }
  return null;
}

export { historical, scorecard };
