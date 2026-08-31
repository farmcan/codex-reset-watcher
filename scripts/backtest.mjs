#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const dataset = JSON.parse(await readFile(new URL("../data/reset-events.json", import.meta.url), "utf8"));
const events = dataset.events;
const count = (predicate) => events.filter(predicate).length;
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

const report = {
  schema_version: dataset.schema_version,
  as_of: dataset.as_of,
  computed,
  lead_time: {
    minimum_minutes: leadMinutes[0] ?? null,
    maximum_minutes: leadMinutes.at(-1) ?? null,
    typical_observed_range_hours: "10–23",
    note: "The maximum is a hidden-reply case; the range is descriptive, not a forecast."
  },
  conclusion_zh: "一手源在 10 次中全部完成确认；9 次出现某种提前信号，但只有 6 次足够清楚。社区层补回的第 10 次只是单账号低置信猜测，不能与官方排期等价。",
  limitations: [
    "Event-conditioned samples do not provide the full false-positive denominator for community accounts.",
    "Lead time is not a probability and should not be extrapolated into an exact next-reset timestamp."
  ]
};

console.log(JSON.stringify(report, null, 2));
if (process.argv.includes("--check") && mismatches.length) {
  console.error("Dataset summary mismatch:", mismatches);
  process.exit(1);
}
