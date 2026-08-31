# Email alerts

Email is optional. The Worker uses Resend's HTTPS API because Cloudflare Workers cannot assume access to a user's SMTP server, while Resend supports explicit idempotency keys for safe retries.

## Required secrets

```bash
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put ALERT_EMAIL_FROM
npx wrangler secret put ALERT_EMAIL_TO
```

- `ALERT_EMAIL_FROM`: for example `Codex Reset Watcher <alerts@example.com>`. The domain must be verified in Resend.
- `ALERT_EMAIL_TO`: one address or comma-separated addresses.
- `EMAIL_MIN_SEVERITY`: non-secret Worker variable; default is `medium`.

No address is committed. D1 stores only a short SHA-256 destination fingerprint in the outbox.

## Delivery semantics

1. A new signal is committed before notification is queued.
2. First-run historical posts are never queued.
3. Derivative relays and superseded rumors are not delivered.
4. A delivery is unique by signal, channel and destination fingerprint.
5. Failures retry after 1, 2, 4, 8 and 15 minutes; the fifth failed attempt becomes terminal.
6. Resend receives a stable idempotency key, so retrying the same payload within its idempotency window does not send twice.

## Test

Set a long random `ADMIN_TOKEN`, deploy, then call:

```bash
curl -X POST https://YOUR_WORKER/api/admin/test-email \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

The public `/api/status` reports only whether email is configured, never the address.
