import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { readSnapshot, mergePools, forecast, splitPoints, HOUR } from '../public/quota/model.js';
import { demo, demoNow } from '../public/quota/demo.js';

const origin = process.env.QUOTA_ORIGIN ?? 'http://127.0.0.1:8793';
const demoPools = mergePools([], readSnapshot(demo).pools);
const weekly = demoPools[0];
const estimate = forecast(weekly, demoNow);
assert.equal(estimate.rate, 10);
assert.equal(estimate.zeroAt, Date.parse('2026-11-24T13:00:00+08:00'));
assert.equal(estimate.end, Date.parse('2026-11-24T09:00:00+08:00'));
assert.equal(estimate.remaining, 40);
assert.equal(forecast(weekly, estimate.end).state, 'update');
assert.equal(forecast({ ...weekly, observations: weekly.observations.slice(1) }, demoNow).state, 'short');
assert.equal(forecast({ ...weekly, observations: weekly.observations.map(point => ({ ...point, remaining: 60 })) }, demoNow).state, 'flat');
assert.equal(forecast({ ...weekly, resetsAt: null }, demoNow + 7 * HOUR).state, 'stale');
const points = [
  { ms: 0, remaining: 4 }, { ms: HOUR, remaining: 6 }, { ms: 8 * HOUR, remaining: 5 },
  { ms: 9 * HOUR, remaining: null }, { ms: 10 * HOUR, remaining: 3 }
];
assert.deepEqual(splitPoints(points).map(group => group.length), [1, 1, 1, 1]);

const example = structuredClone(demo);
const onlyPoint = demo.pools[0].observations.at(-1);
example.pools = [{
  ...example.pools[0], sourceId: 'custom-source', sourceLabel: '本地验收来源',
  observations: [onlyPoint], deadlineAt: null
}];
const withHistory = structuredClone(example);
withHistory.pools[0].observations = demo.pools[0].observations;
const nextCycle = structuredClone(example);
nextCycle.pools[0].cycleId = 'next';
nextCycle.pools[0].cycleStart = null;
nextCycle.pools[0].resetsAt = '2026-11-25';
nextCycle.pools[0].observations = [{ observedAt: '2026-11-24T09:01:00+08:00', remaining: null }];
const merged = mergePools(mergePools([], readSnapshot(example).pools), readSnapshot(withHistory).pools);
assert.equal(merged[0].observations.length, 3);
assert.equal(mergePools(merged, readSnapshot(withHistory).pools)[0].observations.length, 3);
assert.equal(mergePools(merged, readSnapshot(nextCycle).pools).length, 2);
assert.equal(readSnapshot(nextCycle).pools[0].resetsAt.ms, Date.parse('2026-11-25T00:00:00+08:00'));

const browser = await chromium.launch({ channel: 'chrome' });
try {
  const context = await browser.newContext({
    viewport: { width: 1160, height: 980 }, permissions: ['clipboard-read', 'clipboard-write']
  });
  const page = await context.newPage();
  const errors = [];
  const submissions = [];
  const resources = [];
  let trackQuota = false;
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (!trackQuota) return;
    resources.push(request.url());
    if (request.method() !== 'GET' || ['fetch', 'xhr', 'websocket'].includes(request.resourceType())) {
      submissions.push(request.url());
    }
  });
  const screenshot = process.env.QUOTA_SCREENSHOT_PREFIX;
  const shown = selector => page.locator(selector).waitFor({ state: 'visible' });
  async function upload(value) {
    const before = resources.length;
    await page.locator('#file').setInputFiles({
      name: 'quota-snapshot.json', mimeType: 'application/json',
      buffer: Buffer.from(typeof value === 'string' ? value : JSON.stringify(value))
    });
    await shown('#notice');
    await page.waitForFunction(() => document.querySelector('#file').value === '');
    assert.equal(resources.length, before, 'import did not trigger network requests');
  }

  await page.goto(origin + '/');
  assert.equal(await page.locator('a[href="quota/"]').first().textContent(), '个人额度');
  await page.locator('header a[href="quota/"]').click();
  await page.waitForLoadState('load');
  await shown('#empty');
  trackQuota = true;
  await page.getByRole('button', { name: '复制给 AI Agent' }).click();
  await page.getByText('已复制 Agent 指令和 JSON 示例。', { exact: true }).waitFor();
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /schemaVersion/);
  if (process.env.QUOTA_REAL_SNAPSHOT) {
    const real = JSON.parse(await readFile(process.env.QUOTA_REAL_SNAPSHOT, 'utf8'));
    await upload(real);
    await shown('.balance');
    assert.equal(await page.locator('.balance').textContent(),
      new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(real.pools[0].observations[0].remaining) + '%');
    assert.match(await page.locator('.cycle').textContent(), /重置/);
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#clear').click();
    await shown('#empty');
  }
  await upload(example);
  await shown('.balance');
  assert.equal(await page.locator('.balance').textContent(), '50%');
  assert.match(await page.locator('.cycle').textContent(), /09:00.*重置/);
  await upload('{');
  assert.match(await page.locator('#notice').textContent(), /有效的 JSON/);
  assert.equal(await page.locator('.balance').textContent(), '50%');
  await upload(withHistory);
  await upload(withHistory);
  assert.equal(await page.locator('.chart .point').count(), 3);
  await page.reload();
  await shown('.balance');
  assert.equal(await page.locator('.chart .point').count(), 3);
  await upload(nextCycle);
  assert.equal(await page.locator('.balance').textContent(), '—');
  assert.match(await page.locator('.cycle').textContent(), /2026.*11.*25/);

  await page.locator('#demo').click();
  assert.equal(await page.locator('.card').count(), 4);
  const codex = page.locator('.card').first();
  assert.equal(await codex.locator('.zero').textContent().then(text => text.slice(-5)), '13:00');
  assert.match(await codex.locator('.estimate').textContent(), /10 个百分点.*40%/);
  assert.equal(await codex.locator('line.forecast').getAttribute('data-end'), '2026-11-24T01:00:00.000Z');
  assert.equal(await codex.locator('line.forecast').getAttribute('data-remaining'), '40');
  if (screenshot) await page.screenshot({ path: screenshot + '-burndown.png', fullPage: true });
  await codex.locator('select').selectOption({ label: '短时额度' });
  assert.equal(await codex.locator('.balance').textContent(), '76%');
  await page.locator('#range').selectOption('compare');
  assert.deepEqual(await page.locator('.card').evaluateAll(cards => cards.map(card =>
    Array.from(card.querySelectorAll('.chart text')).slice(5, 8).map(text => text.textContent)
  )), Array(4).fill(await codex.locator('.chart text').allTextContents().then(labels => labels.slice(5, 8))));
  await page.locator('#range').selectOption('day');
  await page.locator('#sample').selectOption('day');
  assert.equal(await codex.locator('.point').count(), 1);
  await page.locator('#lanes').click();
  assert.equal(await page.locator('.lane-row').count(), 5);
  await page.locator('#lane-range').selectOption('7');
  assert.match(await page.locator('.lane-head').first().textContent(), /7 天/);
  if (screenshot) await page.screenshot({ path: screenshot + '-swimlanes.png', fullPage: true });
  await page.locator('#theme').click();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  await page.setViewportSize({ width: 375, height: 820 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.locator('#back').click();
  assert.equal(await page.locator('.lane-row').count(), 1);
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#clear').click();
  await shown('#empty');
  await page.reload();
  await shown('#empty');
  assert.equal(await page.evaluate(() => localStorage.getItem('resetcat:quota:v1')), null);
  await page.locator('#language').click();
  await page.getByRole('heading', { name: 'Personal quota', exact: true }).waitFor();
  assert.deepEqual(submissions, []);
  assert.deepEqual(errors, []);
  console.log('OK · model, import, invalid file, dedupe, cycles, storage, demo, chart modes, mobile, privacy, English'
    + (process.env.QUOTA_REAL_SNAPSHOT ? ', private real observation' : ''));
} finally {
  await browser.close();
}
