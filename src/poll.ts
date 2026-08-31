import { classifyPost, isRelevant } from "./classifier";
import { QUERY_SPECS, SEVERITY_RANK } from "./config";
import {
  acquirePollLock,
  createPollRun,
  finishPollRun,
  getDueSourceStates,
  inhibitRumorWithExistingOfficial,
  inhibitWeakerSignals,
  insertPost,
  insertSignal,
  markSourceAttempt,
  markSourceFailure,
  markSourceSuccess,
  promoteCorroboratedRumor,
  queueEmailDelivery,
  releasePollLock
} from "./db";
import { processPendingDeliveries, severityAtLeast } from "./notifications";
import type { Env, PollSummary, Signal, SourceStateRow } from "./types";
import { fetchXQuery } from "./x-source";

export async function runPoll(env: Env, now = new Date()): Promise<PollSummary> {
  const startedAt = now.toISOString();
  const lockToken = crypto.randomUUID();
  if (!await acquirePollLock(env.DB, lockToken, startedAt)) {
    return {
      status: "skipped",
      startedAt,
      finishedAt: new Date().toISOString(),
      queryNames: [],
      fetchedCount: 0,
      insertedCount: 0,
      relevantCount: 0,
      notifiedCount: 0,
      errors: ["Another poll is still running."]
    };
  }

  try {
    return await runPollWithLock(env, startedAt);
  } finally {
    await releasePollLock(env.DB, lockToken);
  }
}

async function runPollWithLock(env: Env, startedAt: string): Promise<PollSummary> {
  const states = await getDueSourceStates(env.DB, startedAt);
  const queryNames = states.map((state) => state.name);
  const runId = await createPollRun(env.DB, startedAt, queryNames);
  const errors: string[] = [];
  let fetchedCount = 0;
  let insertedCount = 0;
  let relevantCount = 0;

  if (!env.X_BEARER_TOKEN) {
    for (const state of states) {
      await markSourceAttempt(env.DB, state.name, startedAt);
      await markSourceFailure(env.DB, state, startedAt, "X_BEARER_TOKEN is not configured.");
    }
    errors.push("X_BEARER_TOKEN is not configured.");
  } else {
    await Promise.all(states.map((state) => markSourceAttempt(env.DB, state.name, startedAt)));
    const settled = await Promise.allSettled(states.map(async (state) => {
      const spec = QUERY_SPECS.find((candidate) => candidate.name === state.name);
      if (!spec) throw new Error(`Unknown source query: ${state.name}`);
      return { state, result: await fetchXQuery(spec, env.X_BEARER_TOKEN!, state.since_id) };
    }));

    for (let index = 0; index < settled.length; index += 1) {
      const outcome = settled[index];
      const state = states[index];
      if (!outcome || !state) continue;
      if (outcome.status === "rejected") {
        const message = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
        errors.push(`${state.name}: ${message}`);
        await markSourceFailure(env.DB, state, startedAt, message);
        continue;
      }

      const { result } = outcome.value;
      fetchedCount += result.resultCount;
      const priming = state.primed_at === null;
      for (const post of [...result.posts].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
        if (!await insertPost(env.DB, post, startedAt)) continue;
        insertedCount += 1;
        let signal = classifyPost(post);
        if (!isRelevant(signal)) continue;
        relevantCount += 1;
        if (!await insertSignal(env.DB, signal)) continue;

        if (post.sourceTier === "A1" || post.sourceTier === "A2") {
          await inhibitWeakerSignals(env.DB, signal);
        } else {
          if (post.sourceTier === "B" || post.sourceTier === "C") {
            signal = await promoteCorroboratedRumor(env.DB, signal);
          }
          signal = await inhibitRumorWithExistingOfficial(env.DB, signal);
        }
        await maybeQueueEmail(env, signal, priming, startedAt);
      }
      await markSourceSuccess(env.DB, state, startedAt, result.newestId);
    }
  }

  const deliveries = await processPendingDeliveries(env, new Date().toISOString());
  const finishedAt = new Date().toISOString();
  const succeeded = states.length - errors.length;
  const status: PollSummary["status"] = states.length === 0
    ? "skipped"
    : succeeded === states.length
      ? "success"
      : succeeded > 0
        ? "partial"
        : "failed";
  const summary: PollSummary = {
    status,
    startedAt,
    finishedAt,
    queryNames,
    fetchedCount,
    insertedCount,
    relevantCount,
    notifiedCount: deliveries.sent,
    errors
  };
  await finishPollRun(env.DB, runId, summary);
  return summary;
}

async function maybeQueueEmail(env: Env, signal: Signal, priming: boolean, now: string): Promise<void> {
  if (priming || !signal.shouldNotify || signal.supersededByPostId) return;
  const minimum = env.EMAIL_MIN_SEVERITY in SEVERITY_RANK ? env.EMAIL_MIN_SEVERITY : "medium";
  if (!severityAtLeast(signal.severity, minimum)) return;
  await queueEmailDelivery(env, signal, now);
}
