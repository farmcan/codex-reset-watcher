// Official proactive text contract: tencent-connect/qqbot-nodejs
// 429a0f1b798f3b0fcef3679e207dbc0469a1df2d. No Gateway or inbound message reads.
// An accepted send does not establish quota, recipient display, or long-term delivery.
export async function sendQQNotice(appId: string, appSecret: string, ownerOpenid: string, text: string): Promise<Record<string, unknown>> {
  let token: string | null = null;
  let tokenResponse: Response;
  // Token acquisition cannot deliver a message. No credential or free-text error is retained.
  try {
    tokenResponse = await fetch('https://bots.qq.com/app/getAppAccessToken', {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(15_000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId, clientSecret: appSecret })
    });
  } catch {
    // This request cannot submit a message, so a bounded retry cannot duplicate delivery.
    return { status: 'pending', error: 'qq_token_temporarily_unavailable_no_message_submitted' };
  }
  if (tokenResponse.status === 429 || tokenResponse.status >= 500) {
    return { status: 'pending', error: 'qq_token_temporarily_unavailable_no_message_submitted' };
  }
  try {
    const body = await tokenResponse.json() as Record<string, unknown>;
    if (tokenResponse.ok && typeof body.access_token === 'string' && body.access_token.trim()
      && Number.isFinite(Number(body.expires_in)) && Number(body.expires_in) > 0) token = body.access_token;
  } catch { /* A malformed credential response needs attention; no message was submitted. */ }
  if (!token) return { status: 'failed', error: 'qq_token_unavailable_no_message_submitted' };
  try {
    const response = await fetch(`https://api.sgroup.qq.com/v2/users/${encodeURIComponent(ownerOpenid)}/messages`, {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(20_000),
      headers: { 'Content-Type': 'application/json', Authorization: `QQBot ${token}` },
      body: JSON.stringify({ msg_type: 0, content: text })
    });
    let body: Record<string, unknown>;
    try { body = await response.json() as Record<string, unknown>; }
    catch { return { status: response.status >= 400 && response.status < 500 ? 'failed' : 'unknown', error: `qq_send_http_${response.status}_unreadable` }; }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { status: 'unknown', error: 'invalid_business_response' };
    const codes = [body.code, body.err_code].filter(value => value !== undefined);
    const malformed = codes.some(value => typeof value !== 'number' || !Number.isSafeInteger(value));
    const rejected = codes.find(value => typeof value === 'number' && Number.isSafeInteger(value) && value !== 0);
    if (malformed) return { status: 'unknown', error: 'invalid_business_response' };
    // A 5xx may be an intermediary failure after acceptance. Never make it retryable.
    if (!response.ok) return { status: response.status >= 400 && response.status < 500 ? 'failed' : 'unknown',
      error: `qq_send_http_${response.status}`, ...(rejected !== undefined ? { business_code: rejected } : {}) };
    if (rejected !== undefined) return { status: 'failed', error: 'qq_business_rejected', business_code: rejected };
    const id = typeof body.id === 'string' && body.id.trim() && body.id.length <= 256 ? body.id : null;
    return id ? { status: 'sent', provider_receipt: id, acceptance_only: true }
      : { status: 'unknown', error: 'ambiguous_business_response' };
  } catch { return { status: 'unknown', error: 'send_outcome_unknown_do_not_replay' }; }
}
