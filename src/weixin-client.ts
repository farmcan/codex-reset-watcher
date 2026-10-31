import { parseWeixinApiJson } from './vendor/weixin-json';

// Official Tencent 2.4.10 text protocol; caller supplies only its own authorized owner.
// Does not read messages, store credentials, or assume a context/token lifetime.
export async function sendWeixinNotice(token: string, ownerId: string, text: string): Promise<Record<string, unknown>> {
  let result: Record<string, unknown>;
  try {
    const response = await fetch('https://ilinkai.weixin.qq.com/ilink/bot/sendmessage', {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(20_000),
      headers: { 'Content-Type': 'application/json', AuthorizationType: 'ilink_bot_token',
        Authorization: `Bearer ${token}`, 'iLink-App-Id': 'bot', 'iLink-App-ClientVersion': '132106',
        'X-WECHAT-UIN': btoa(String(crypto.getRandomValues(new Uint32Array(1))[0])) },
      body: JSON.stringify({ msg: { from_user_id: '', to_user_id: ownerId,
        client_id: `watcher-cloud-${crypto.randomUUID()}`, message_type: 2, message_state: 2,
        item_list: [{ type: 1, text_item: { text } }] },
        base_info: { channel_version: '2.4.10', bot_agent: 'CodexResetWatcher/0.1.0' } })
    });
    if (!response.ok) result = { status: response.status >= 400 && response.status < 500 ? 'failed' : 'unknown', error: `weixin_http_${response.status}` };
    else {
      const body = parseWeixinApiJson<Record<string, unknown>>(await response.text());
      const fields = [body.ret, body.errcode].filter(value => value !== undefined);
      const bad = fields.some(value => typeof value !== 'number');
      const rejected = fields.some(value => typeof value === 'number' && value !== 0);
      const id = typeof body.message_id === 'string' && body.message_id.trim() && body.message_id.length <= 128 ? body.message_id : null;
      result = bad ? { status: 'unknown', error: 'invalid_business_response' }
        : rejected ? { status: 'failed', error: 'weixin_business_rejected', business_code: fields.find(value => typeof value === 'number' && value !== 0) }
        : body.ret === 0 || body.errcode === 0 || id ? { status: 'sent', provider_receipt: id, acceptance_only: true }
        : { status: 'unknown', error: 'ambiguous_business_response' };
    }
  } catch { result = { status: 'unknown', error: 'send_outcome_unknown_do_not_replay' }; }
  return result;
}
