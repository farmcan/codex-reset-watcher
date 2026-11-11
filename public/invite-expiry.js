export function inviteExpired(expiresAt, now = Date.now()) {
  const deadline = Date.parse(expiresAt);
  return !Number.isFinite(deadline) || now >= deadline;
}

export function refreshInvites(root = document, now = Date.now()) {
  for (const panel of root.querySelectorAll('[data-invite-expires-at]')) {
    const expired = inviteExpired(panel.dataset.inviteExpiresAt, now);
    panel.classList.toggle('is-expired', expired);
    panel.querySelector('[data-invite-status]').textContent = expired
      ? panel.dataset.inviteExpiredLabel : panel.dataset.inviteActiveLabel;
    for (const entry of panel.querySelectorAll('[data-invite-live]')) entry.hidden = expired;
    panel.querySelector('[data-invite-expired]').hidden = !expired;
  }
}

if (typeof document !== 'undefined') {
  refreshInvites();
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshInvites();
  });
  window.setInterval(() => {
    if (!document.hidden) refreshInvites();
  }, 60_000);
}
