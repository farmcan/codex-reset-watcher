---
name: track-codex-reset-signals
description: Check the deployed Codex Reset Watcher for current public X signals, official future hard-reset notices, confirmed resets, banked resets, community rumors, watcher health, email status, or the audited last ten reset events. Use when the user asks whether Codex may reset soon, whether to accelerate existing work before a reset, what Tibo/UsageReset/community accounts said, whether an alert is trustworthy, or asks for the recent reset history. Do not use this as a substitute for the user's private Codex Usage page.
---

# Track Codex Reset Signals

Use the deployed watcher as the normalized evidence source. Do not reconstruct a forecast from remembered dates when the API is available.

## Workflow

1. Read `GET $CODEX_RESET_WATCHER_URL/api/status` with `scripts/check.sh status`, or the configured default URL in that script.
2. Check `live.overall`, `live.official_last_success_at`, and `live.official_age_seconds` before interpreting signals.
3. Ignore signals with `superseded_by_post_id`. Treat `evidence_basis=derivative` as a relay, not independent corroboration.
4. Open the canonical X URL for any signal used in the answer when link access is available.
5. For a history or credibility question, also read `scripts/check.sh history` and `scripts/check.sh sources`.

## Decision language

- `scheduled_reset + hard_reset + A1/A2`: say an official future hard-reset signal exists. You may say, “如果本来就有任务，可以考虑提前安排,” while stating that execution is not guaranteed.
- `explicit_reset + hard_reset`: say the reset was confirmed; tell the user to check their own Codex Usage for delivery. Do not advise front-loading after the event.
- `banked_reset`: explain that it is saved/manual and not the same as an automatic hard reset.
- `weak_hint`: describe it as an official weak hint, not a schedule.
- `community_rumor + medium`: describe it as cross-community chatter, still unofficial.
- `community_rumor + low`: say it is a single-source rumor and not an action signal.
- `community_observation`: never generalize one account's result to all users.

## Required answer shape

Lead with one of these outcomes:

- `当前有明确官方预告`
- `重置已被确认`
- `只有弱暗示/社区风声`
- `暂未发现新的有效信号`
- `监控数据不健康，无法可靠判断`

Then give:

1. the strongest non-superseded evidence and original link;
2. its source tier, event type, publication time, and effective time if present;
3. a short action boundary appropriate to the event type;
4. watcher health and last successful official poll.

For the ten-event history, report both `9/10 any advance signal` and `6/10 clear/actionable`; never collapse them into one success rate. State that the community-only tenth event lacks a complete false-positive denominator.

## Hard boundaries

- Do not output an exact next-reset probability or timestamp from historical spacing alone.
- Do not call `@UsageReset` or a relay independent evidence when it points to the same Tibo post.
- Do not read or request Codex auth files, cookies, account tokens, or personal usage data for this task.
- Do not say a global reset reached the user; only their Codex Usage can prove that.
- If the API is stale/down, report the health failure instead of converting missing data into “no reset.”

See `references/evidence-contract.md` for the tier and event glossary.
