# Security policy

## Supported version

Security fixes target the latest `main` branch and latest tagged release.

## Reporting

Do not open a public issue for leaked credentials, authentication bypass, stored X data exposure, or an email-spam path. Use GitHub's private vulnerability reporting for this repository.

## Secret boundary

Never commit `.dev.vars`, `.env`, X tokens, Cloudflare tokens, Resend keys, admin tokens or email addresses. Production credentials belong in Cloudflare Secrets. If a token is pasted into chat, logs or an issue, rotate it.

The hosted service does not need Codex/ChatGPT auth files, cookies, bearer tokens or personal usage snapshots. A change that adds them requires a separate threat model and must not silently expand this project's scope.
