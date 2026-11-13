import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// Run against `npm run dev -- --local --port 8795` after local D1 migrations.
// The full suite writes only to LOCAL D1; production accepts a two-tap smoke check.
const origin = process.env.CAT_WHIP_ORIGIN || 'http://localhost:8795';
const smoke = process.env.CAT_WHIP_SMOKE === '1';
assert.ok(smoke || ['localhost', '127.0.0.1'].includes(new URL(origin).hostname), 'Full suite requires local D1');
const output = process.env.CAT_WHIP_OUTPUT || '.wrangler/cat-whip-acceptance';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { origin, checked_at: new Date().toISOString(), smoke, results: [] };
const number = (value) => Number(value.replace(/[^0-9]/g, ''));

async function pageFor(options = {}, videoFailure = false) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ...options });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  if (videoFailure) await page.route('**/media/cat-whip.mp4', route => route.abort());
  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => /^\d/.test(document.querySelector('#like-count').textContent));
  await page.evaluate(() => {
    window.whipTest = { plays: 0, seeks: 0, ends: 0, audioPlays: 0, accepted: 0 };
    const video = document.querySelector('.cat-whip');
    video.addEventListener('play', () => whipTest.plays++);
    video.addEventListener('playing', () => { whipTest.started ??= performance.now(); });
    video.addEventListener('seeking', () => whipTest.seeks++);
    video.addEventListener('ended', () => { whipTest.ends++; whipTest.duration_ms = performance.now() - whipTest.started; });
    document.querySelector('#whip-audio').addEventListener('playing', () => whipTest.audioPlays++);
  });
  page.on('response', async response => {
    if (response.url().endsWith('/api/engagement/like') && response.ok()) {
      await response.finished();
      await page.evaluate(() => whipTest.accepted++).catch(() => {});
    }
  });
  return { context, page, errors };
}

try {
  const { context, page, errors } = await pageFor();
  const before = number(await page.locator('#like-count').textContent());
  const box = await page.locator('.hero-visual').boundingBox();
  const metadata = await page.locator('video').evaluate(video => ({ duration: video.duration, rate: video.playbackRate, muted: video.muted, inline: video.playsInline, loop: video.loop, controls: video.controls }));
  assert.ok(Math.abs(metadata.duration / metadata.rate - .75) < .001);
  assert.ok(metadata.muted && metadata.inline && !metadata.loop && !metadata.controls);
  assert.equal(await page.locator('.is-whipping').count(), 0);
  await page.screenshot({ path: `${output}/desktop-static.png` });
  const burst = smoke ? 2 : 100;
  await page.locator('#cat-button').click();
  await page.waitForFunction(() => whipTest.started !== undefined);
  await page.waitForTimeout(150);
  const progress = await page.locator('video').evaluate(video => video.currentTime);
  const seeks = await page.evaluate(() => whipTest.seeks);
  const immediate = await page.evaluate(count => {
    for (let i = 1; i < count; i++) document.querySelector('#cat-button').click();
    return document.querySelector('#like-count').textContent;
  }, burst);
  assert.equal(number(immediate), before + burst, 'All rapid taps increment immediately');
  await page.waitForTimeout(100);
  assert.ok(await page.locator('video').evaluate((video, previous) => video.currentTime > previous, progress), 'Extra taps advance past the first frame');
  assert.equal(await page.evaluate(() => whipTest.seeks), seeks, 'Extra taps never seek');
  await page.screenshot({ path: `${output}/desktop-playing.png` });
  await page.waitForFunction(() => whipTest.ends === 1);
  await page.waitForFunction(count => whipTest.accepted === count, burst);
  await page.waitForTimeout(850);
  const playback = await page.evaluate(() => whipTest);
  assert.equal(playback.plays, 1, 'No queued playback after the burst');
  assert.equal(playback.audioPlays, 1, 'No overlapping sounds during the burst');
  assert.ok(playback.duration_ms >= 600 && playback.duration_ms < 1050, `Round took ${playback.duration_ms}ms`);
  assert.equal(await page.locator('.is-whipping').count(), 0);
  assert.equal(await page.locator('.cat-plus').count(), 0);
  assert.equal(await page.locator('video').evaluate(video => getComputedStyle(video).opacity), '0');
  assert.equal(number(await page.locator('#like-count').textContent()), before + burst);
  const backend = await page.evaluate(async () => (await fetch('/api/engagement')).json());
  assert.equal(backend.likes, before + burst, 'Real backend persisted every tap');
  assert.deepEqual(await page.locator('.hero-visual').boundingBox(), box, 'No logo layout shift');
  report.results.push({ name: 'rapid taps + playback + audio + real D1', taps: burst, before, after: backend.likes, metadata, playback });

  if (!smoke) {
    await page.locator('#whip-sound').click();
    await page.locator('#like-button').click();
    await page.waitForFunction(() => whipTest.ends === 2);
    assert.equal(await page.evaluate(() => whipTest.audioPlays), 1, 'Mute switch works');
    report.results.push({ name: 'New round and secondary action use the same counter; mute works', passed: true });
    assert.deepEqual(errors, []);
    await context.close();

    for (const width of [390, 320]) {
      const mobile = await pageFor({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
      const start = number(await mobile.page.locator('#like-count').textContent());
      await mobile.page.locator('#cat-button').tap();
      await mobile.page.waitForFunction(() => whipTest.ends === 1 && whipTest.accepted === 1);
      assert.equal(number(await mobile.page.locator('#like-count').textContent()), start + 1);
      assert.equal(await mobile.page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await mobile.page.screenshot({ path: `${output}/mobile-${width}.png` });
      assert.deepEqual(mobile.errors, []);
      report.results.push({ name: `Mobile touch ${width}px`, passed: true });
      await mobile.context.close();
    }

    const failed = await pageFor({}, true);
    const failedBefore = number(await failed.page.locator('#like-count').textContent());
    await failed.page.locator('#cat-button').click();
    await failed.page.waitForFunction(() => whipTest.accepted === 1);
    assert.equal(number(await failed.page.locator('#like-count').textContent()), failedBefore + 1);
    assert.equal(await failed.page.locator('.is-whipping').count(), 0);
    assert.ok(await failed.page.locator('#cat-button img').evaluate(img => img.complete && img.naturalWidth === 960));
    assert.deepEqual(failed.errors, []);
    report.results.push({ name: 'Failed video retains original image and real counting', passed: true });
    await failed.context.close();

    const reduced = await pageFor({ reducedMotion: 'reduce' });
    await reduced.page.locator('#cat-button').click();
    await reduced.page.waitForFunction(() => whipTest.accepted === 1);
    assert.equal(await reduced.page.locator('.is-whipping').count(), 0);
    assert.deepEqual(reduced.errors, []);
    report.results.push({ name: 'Reduced motion retains static image and counting', passed: true });
    await reduced.context.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(`${output}/acceptance.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
