// Configure a secret from an owner-only local handoff file; never pass it in argv.
import { readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const [channel, path, mode = 'test'] = process.argv.slice(2);
if (!['feishu', 'wecom'].includes(channel) || !path || !['test', 'production'].includes(mode)) {
  throw new Error('Usage: node scripts/configure-notification-webhook.mjs feishu|wecom /absolute/private.json test|production');
}
if ((statSync(path).mode & 0o077) !== 0) throw new Error('Private configuration must have mode 0600');
const data = JSON.parse(readFileSync(path, 'utf8'));
const value = data.webhook_url;
if (typeof value !== 'string' || !value) throw new Error('webhook_url is required');
const url = new URL(value);
const allowed = url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash
  && (channel === 'feishu' ? ['open.feishu.cn', 'open.larksuite.com'].includes(url.hostname)
    && /^\/open-apis\/bot\/v2\/hook\/[a-zA-Z0-9-]+$/.test(url.pathname) && !url.search
    : url.hostname === 'qyapi.weixin.qq.com' && url.pathname === '/cgi-bin/webhook/send'
      && [...url.searchParams.keys()].length === 1 && /^[a-zA-Z0-9_-]+$/.test(url.searchParams.get('key') ?? ''));
if (!allowed) throw new Error('Only the official channel webhook endpoint is allowed');
const prefix = `${channel.toUpperCase()}_${mode === 'test' ? 'TEST_' : ''}WEBHOOK_`;
const values = { [prefix + 'URL']: value };
if (channel === 'feishu') values[prefix + 'SECRET'] = data.signing_secret || null;
// One request avoids briefly enabling a signed destination with its old/missing key.
const result = spawnSync('node_modules/.bin/wrangler', ['secret', 'bulk'], {
  input: JSON.stringify(values), encoding: 'utf8', timeout: 90_000, maxBuffer: 1024 * 1024
});
if (result.status !== 0) throw new Error('Secret configuration failed; no values printed');
console.log(`Configured ${channel} ${mode} webhook atomically`);
