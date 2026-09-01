#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";

const dataset = JSON.parse(await readFile(new URL("../data/reset-events.json", import.meta.url), "utf8"));
const scorecard = JSON.parse(await readFile(new URL("../data/source-scorecard.json", import.meta.url), "utf8"));
const events = dataset.events;
const count = (predicate) => events.filter(predicate).length;
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[midpoint] : Math.round((sorted[midpoint - 1] + sorted[midpoint]) / 2);
};
const computed = {
  events: events.length,
  first_party_confirmation: count((event) => Boolean(event.confirmation?.post_id)),
  any_first_party_advance_signal: count((event) => Boolean(event.earliest_first_party_signal)),
  clear_actionable_advance_signal: count((event) => event.advance_quality === "clear"),
  weak_or_ambiguous_advance_signal: count((event) => event.advance_quality === "weak"),
  no_usable_first_party_advance_signal: count((event) => event.advance_quality === "none"),
  community_incremental_recall: count((event) => !event.earliest_first_party_signal && Boolean(event.community_signal))
};

const mismatches = Object.entries(computed).filter(([key, value]) => dataset.summary[key] !== value);
const leadMinutes = events
  .map((event) => event.earliest_first_party_signal?.lead_minutes)
  .filter((value) => Number.isFinite(value))
  .sort((a, b) => a - b);
const clearLeadMinutes = events
  .filter((event) => event.advance_quality === "clear")
  .map((event) => event.actionable_first_party_signal?.lead_minutes)
  .filter((value) => Number.isFinite(value));

const timelineErrors = [];
const eventLeadTimes = events.map((event) => {
  const timeline = event.timeline ?? [];
  const timestamps = timeline.map((node) => Date.parse(node.published_at));
  if (timeline.length < 2) timelineErrors.push(`${event.id}: timeline has fewer than two nodes`);
  if (timestamps.some((value) => !Number.isFinite(value))) timelineErrors.push(`${event.id}: invalid timeline timestamp`);
  if (timestamps.some((value, index) => index > 0 && value < timestamps[index - 1])) timelineErrors.push(`${event.id}: timeline is not chronological`);
  if (!timeline.some((node) => node.timing === "outcome")) timelineErrors.push(`${event.id}: missing outcome node`);
  const earliest = timeline[0] ?? null;
  return {
    event_id: event.id,
    outcome_at: event.outcome_at,
    first_source: earliest?.author ?? null,
    first_source_role: earliest?.role ?? null,
    first_signal_at: earliest?.published_at ?? null,
    first_lead_minutes: earliest?.timing === "before" ? earliest.distance_minutes : null,
    clear_first_party_lead_minutes: event.actionable_first_party_signal?.lead_minutes ?? null,
    advance_quality: event.advance_quality,
    timeline_nodes: timeline.length,
    evidence_gaps: event.timeline_gaps?.length ?? 0
  };
});

if (dataset.summary.median_any_first_party_lead_minutes !== median(leadMinutes)) {
  mismatches.push(["median_any_first_party_lead_minutes", median(leadMinutes)]);
}
if (dataset.summary.median_clear_first_party_lead_minutes !== median(clearLeadMinutes)) {
  mismatches.push(["median_clear_first_party_lead_minutes", median(clearLeadMinutes)]);
}

const report = {
  schema_version: dataset.schema_version,
  as_of: dataset.as_of,
  computed,
  lead_time: {
    minimum_minutes: leadMinutes[0] ?? null,
    maximum_minutes: leadMinutes.at(-1) ?? null,
    median_any_first_party_minutes: median(leadMinutes),
    median_clear_first_party_minutes: median(clearLeadMinutes),
    note: "The maximum is a hidden-reply case. Medians describe this ten-event sample; they are not a next-reset forecast."
  },
  event_lead_times: eventLeadTimes,
  source_scorecard: scorecard.sources
    .filter((source) => source.display_group === "measured")
    .map((source) => ({
      handle: source.handle,
      evaluated_events: source.metrics.evaluated_events,
      useful_advance_events: source.metrics.useful_advance_events,
      recorded_posts: source.metrics.recorded_posts,
      median_advance_lead_minutes: source.metrics.median_advance_lead_minutes,
      false_positive_denominator_complete: source.metrics.false_positive_denominator_complete
    })),
  conclusion_zh: "一手源在 10 次中全部完成确认；9 次出现某种提前信号，但只有 6 次足够清楚。社区层补回的第 10 次只是单账号低置信猜测，不能与官方排期等价。",
  limitations: [
    "Event-conditioned samples do not provide the full false-positive denominator for community accounts.",
    "Lead time is not a probability and should not be extrapolated into an exact next-reset timestamp."
  ]
};

if (process.argv.includes("--check") && (mismatches.length || timelineErrors.length)) {
  console.error("Dataset validation failed:", { mismatches, timelineErrors });
  process.exit(1);
}
const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (process.argv.includes("--write")) {
  await writeFile(new URL("../reports/backtest-summary.json", import.meta.url), serialized, "utf8");
}
console.log(serialized.trimEnd());
