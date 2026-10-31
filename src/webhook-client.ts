// SPDX-License-Identifier: MIT
// Portable Fetch/Web Crypto adapter. No runtime, database, or credential storage assumptions.
export const WEBHOOK_CHANNELS = ['feishu', 'wecom'] as const;
export type WebhookChannel = typeof WEBHOOK_CHANNELS[number];
type State = 'pending' | 'failed' | 'unknown';
export class WebhookError extends Error {
  readonly state: State;
  constructor(message: string, state: State) { super(message); this.state = state; }
}

// Secrets must never become general-purpose HTTP destinations or redirect credentials.
export function validateWebhook(channel: WebhookChannel, value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new WebhookError(`${channel} webhook configuration invalid`, 'failed'); }
  const base = url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash;
  const valid = channel === 'feishu'
    ? ['open.feishu.cn', 'open.larksuite.com'].includes(url.hostname)
      && /^\/open-apis\/bot\/v2\/hook\/[a-zA-Z0-9-]+$/.test(url.pathname) && !url.search
    : url.hostname === 'qyapi.weixin.qq.com' && url.pathname === '/cgi-bin/webhook/send'
      && [...url.searchParams.keys()].length === 1 && /^[a-zA-Z0-9_-]+$/.test(url.searchParams.get('key') ?? '');
  if (!base || !valid) throw new WebhookError(`${channel} webhook configuration invalid`, 'failed');
  if (channel === 'wecom') url.search = new URLSearchParams({ key: url.searchParams.get('key')! }).toString();
  return url.href;
}

export function boundedWebhookText(text: string, limit = 2048): string {
  const encoder = new TextEncoder();
  if (encoder.encode(text).length <= limit) return text;
  const source = text.match(/\n\n(https:\/\/\S+)\s*$/)?.[1];
  const tail = source ? `…\n\n${source}` : '…';
  const body = source ? text.slice(0, text.lastIndexOf('\n\n')) : text;
  const budget = limit - encoder.encode(tail).length;
  let out = '', used = 0;
  for (const char of body) {
    const size = encoder.encode(char).length;
    if (used + size > budget) break;
    out += char; used += size;
  }
  return out + tail;
}

export interface WebhookReceipt { provider: WebhookChannel; business_code: 0; acceptance_only: true; mentions_all_requested: boolean }

export async function sendWebhookNotice(channel: WebhookChannel, config: { url: string; secret?: string }, text: string, options: { mentionAll?: boolean } = {}): Promise<WebhookReceipt> {
  const url = validateWebhook(channel, config.url);
  if (channel === 'wecom') text = boundedWebhookText(text);
  // Both payloads request an actual all-member mention, rather than plain '@all' text.
  const payload: Record<string, unknown> = channel === 'feishu'
    ? { msg_type: 'text', content: { text: options.mentionAll ? `<at user_id="all">所有人</at>\n${text}` : text } }
    : { msgtype: 'text', text: { content: text, mentioned_list: options.mentionAll ? ['@all'] : [] } };
  if (channel === 'feishu' && config.secret) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(`${timestamp}\n${config.secret}`),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    payload.timestamp = timestamp;
    payload.sign = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', key, new Uint8Array()))));
  }
  let response: Response;
  try {
    response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), redirect: 'manual', signal: AbortSignal.timeout(20_000) });
  } catch { throw new WebhookError(`${channel} send outcome unknown; do not replay`, 'unknown'); }
  // No provider free-text error is retained: it can echo the secret URL or message.
  if (response.status === 429) throw new WebhookError(`${channel} rate limited`, 'pending');
  if (!response.ok) throw new WebhookError(`${channel} HTTP ${response.status}`,
    response.status >= 400 && response.status < 500 ? 'failed' : 'unknown');
  let body: Record<string, unknown>;
  try { body = await response.json() as Record<string, unknown>; }
  catch { throw new WebhookError(`${channel} response unreadable; do not replay`, 'unknown'); }
  const code = channel === 'feishu' ? body.code ?? body.StatusCode : body.errcode;
  if (code !== 0) {
    const throttle = channel === 'feishu' ? code === 11232 : code === 45009;
    throw new WebhookError(`${channel} business response ${typeof code === 'number' ? code : 'invalid'}`,
      throttle ? 'pending' : typeof code === 'number' ? 'failed' : 'unknown');
  }
  // Webhook APIs acknowledge acceptance, not recipient read or @all delivery.
  return { provider: channel, business_code: 0, acceptance_only: true, mentions_all_requested: Boolean(options.mentionAll) };
}
