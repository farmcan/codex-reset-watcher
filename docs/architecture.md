# Architecture

## Design goals

1. Faster than a 15-minute relay without pretending that rumors are official.
2. At-least-once scheduled execution must not create duplicate posts or emails.
3. Missing, stale, and failed data must remain visibly different from “no signal”.
4. Every human-facing conclusion must link back to a canonical X post.
5. The public repository must not contain credentials or personal Codex data.

## Pipeline

```text
Cron -> due query selection -> X Recent Search -> author validation -> normalization
     -> deterministic classification -> evidence grouping / inhibition
     -> D1 event ledger -> notification outbox -> Resend
     -> dashboard / JSON / RSS / health
```

### Source state

Every query has its own `since_id`, cadence, `primed_at`, last attempt/success, error count and next due time. A failed query never advances its cursor. The first successful response silently primes that query so a fresh deployment does not replay old alerts.

### Evidence semantics

- `first_party`: A1/A2 author.
- `derivative`: community post references or links to the same first-party post; it is not independent corroboration.
- `independent_rumor`: community prediction with no first-party dependency found.
- `account_observation`: one user reports their own account; never generalized to provider-wide reset.

Two independent B/C community authors within six hours and the same event-day cluster can upgrade the newest compatible rumor to medium. A matching official scheduled/confirmed signal inhibits community rumors in that cluster. D-tier full-network discovery remains an internal candidate pool: it is stored for review but excluded from the public dashboard, API and RSS.

### Idempotency

- `posts.post_id` is unique.
- `signals.signal_id` is unique and derived from source + post ID.
- `deliveries(signal_id, channel, destination_hash)` is unique.
- Resend receives `Idempotency-Key: codex-reset/<signal>/<destination>`.
- A short-lived D1 lock keeps overlapping cron deliveries from racing.

### Health

The official query is expected every 120 seconds. The site becomes stale after three missed periods plus 60 seconds. `/healthz` returns `503` for initializing, stale, or down states so an external uptime monitor can watch the watcher.

## D1 tables

- `source_state`: cursor, cadence and health per query.
- `posts`: canonical public post and normalized author/link evidence.
- `signals`: deterministic classification and supersession state.
- `deliveries`: notification outbox and retry audit.
- `poll_runs`: run-level counts and errors.
- `app_state`: short-lived coordination state.

## Security

The Worker secrets are `X_BEARER_TOKEN`, `ADMIN_TOKEN`, and optional Resend/email values. The web APIs do not expose them. Admin routes require a constant-time hash comparison. Static responses use CSP, frame denial, a restrictive permissions policy and no third-party scripts.
