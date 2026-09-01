# GitHub and product research

Research snapshot: 2026-08-31. Star counts are only adoption signals, not quality guarantees.

## Directly related projects

| Project | Adoption at review | What works | Boundary for this project |
| --- | ---: | --- | --- |
| [`jordan-edai/codex-reset-watcher`](https://github.com/jordan-edai/codex-reset-watcher) | 106 stars | Honest live/partial/cached/stale states; read-only account model | Tracks personal local usage and internal endpoints, not public X early warning; no code copied |
| [`whmc76/codex-reset-radar`](https://github.com/whmc76/codex-reset-radar) | 3 stars | Source weights, strict advice priority, timezone handling | We do not adopt the 72-hour exact-looking probability grid without calibration data |
| [`Chloride233/tibo-reset-watch`](https://github.com/Chloride233/tibo-reset-watch) | 0 stars | Quiet first baseline, upcoming/confirmed upgrade, canonical author checks, bounded backoff | Its public upstream feed is described as roughly 15-minute sync; this project queries official X API directly |
| [`yuenovaw/tibo-codex-reset-watcher`](https://github.com/yuenovaw/tibo-codex-reset-watcher) | 0 stars | Small X search/classifier/storage/notification baseline | Original is one-author oriented; multi-source independence and event grouping are added here |
| [`beeswaxcrazylover-design/tibo-codex-reset-watcher`](https://github.com/beeswaxcrazylover-design/tibo-codex-reset-watcher) | 0 stars | Email after successful match; state advances carefully | Local SMTP/Task Scheduler design does not provide a shared web history or source credibility layer |

No direct project had both a public evidence dashboard, official X API cursors, a ten-event audit, independent-rumor grouping, visible health and server-side email. That combination is why a separate repository is justified.

## Mature patterns borrowed conceptually

| Mature project | Adoption at review | Pattern used here |
| --- | ---: | --- |
| [`prometheus/alertmanager`](https://github.com/prometheus/alertmanager) | 8.6k stars | Fingerprint dedupe, grouping, routing, repeat control and inhibition. Official evidence suppresses weaker community alerts. |
| [`caronc/apprise`](https://github.com/caronc/apprise) | 17.2k stars | One normalized notification payload with provider-specific delivery. Email is a provider, not classifier code. |
| [`dgtlmoon/changedetection.io`](https://github.com/dgtlmoon/changedetection.io) | 33.4k stars | Notification queue/outbox, send errors and retry state stay separate from successful detection. |
| [`healthchecks/healthchecks`](https://github.com/healthchecks/healthchecks) | 10.3k stars | Expected period + grace time, last-success visibility and a live event log. |
| [`DIYgod/RSSHub`](https://github.com/DIYgod/RSSHub) | 45.9k stars | Source adapters normalize different inputs before consumers; RSS stays a first-class output. |
| [`google/timesketch`](https://github.com/google/timesketch) | 3.3k stars | Normalize multi-source events onto one chronological timeline, while retaining tags, comments and raw evidence. |
| [`MISP/misp-taxonomies`](https://github.com/MISP/misp-taxonomies/tree/main/admiralty-scale) | 296 stars | Admiralty Scale separates source reliability from information credibility; the dashboard uses plain-language equivalents. |
| [`OpenCTI-Platform/opencti`](https://github.com/OpenCTI-Platform/opencti/blob/master/docs/docs/reference/data-processing.md) | mature CTI platform | Dedupe and merge without losing relationship integrity; confidence and provenance stay attached to each item. |
| [`bellingcat/auto-archiver`](https://github.com/bellingcat/auto-archiver) | 1.1k stars | Preserve original evidence and archive status. This project currently retains post IDs/URLs; full content archiving remains a policy-reviewed follow-up. |

## Similar web products

| Page | Strong point | Gap / decision here |
| --- | --- | --- |
| [`codex-reset.com`](https://codex-reset.com/) | Polished tracker, public APIs, personal reset calculator and clear caveats | Broad feature surface. This dashboard stays focused on “current signal → evidence → ten-event history → health”. |
| [`codexreset.app`](https://codexreset.app/) | Clean separation of personal weekly, global public and earned/banked reset; history and methodology are easy to find | Forecast remains the headline. This project makes confidence class and source evidence more prominent than a probability. |
| [`codex-reset-radar.pages.dev`](https://codex-reset-radar.pages.dev/en/) | Large community dashboard and historical time distribution | Reset information competes with model IQ, pricing and configuration content. This project intentionally has one job. |
| [`tibo-reset-watch` PWA](https://chloride233.github.io/tibo-reset-watch/) | Possible vs confirmed is simple; browser notifications are approachable | Browser notifications work only while the page is active. This project adds server-side email and persistent delivery audit. |

## Final product choices

- Page order: current decision, ten-event proof, live signals, source credibility, watcher health.
- No exact next-reset probability until a complete prediction ledger provides false positives and calibration.
- No personal auth ingestion in the hosted service.
- Personal arrival or account-anomaly reports stay visible in a separate weak-observation lane. They can increase attention, but cannot alone create a global-reset conclusion.
- Live and historical views use the same event progression: earliest signal → relay/amplification → first-party confirmation → delivery/anomaly observation.
- Source history and per-post content strength are separate. A useful scout can still produce a stale or ambiguous post.
- Email defaults to medium/high, while low rumors remain visible through web/API/RSS.
- Every signal keeps a canonical source link and an explicit data-state label.
