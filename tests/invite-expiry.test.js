import { describe, expect, it } from 'vitest';
import { inviteExpired } from '../public/invite-expiry.js';

describe('dated group invitations', () => {
  it('expires before November 19 in Beijing rather than waiting for UTC midnight', () => {
    const deadline = '2026-11-19T00:00:00+08:00';
    expect(inviteExpired(deadline, Date.parse('2026-11-18T15:59:59.999Z'))).toBe(false);
    expect(inviteExpired(deadline, Date.parse('2026-11-18T16:00:00Z'))).toBe(true);
    expect(inviteExpired(deadline, Date.parse('2026-11-19T00:00:00Z'))).toBe(true);
  });
  it('does not keep an invitation available when its deadline is missing or invalid', () => {
    expect(inviteExpired('', Date.parse('2026-11-12T00:00:00+08:00'))).toBe(true);
    expect(inviteExpired('not-a-date', Date.parse('2026-11-12T00:00:00+08:00'))).toBe(true);
  });
});
