import assert from 'node:assert/strict';
import './bridge-model.js';
import { demo, demoNow } from '../../public/quota/demo.js';

const model = globalThis.quotaModel;
const asOf = demoNow;
const example = model.panel('[]', true, asOf);
const panel = JSON.parse(example);
assert.equal(panel.sources.length, 4);
const weekly = panel.sources[0].pools[0];
assert.equal(panel.sources[0].pools.filter(pool => pool.kind !== 'reset-credit').length, 3);
const cards = panel.sources[0].pools.filter(pool => pool.kind === 'reset-credit');
assert.equal(cards.length, 2);
assert.ok(cards.every(card => card.estimate.state === 'inventory'));
assert.notEqual(cards[0].deadlines[0].ms, cards[1].deadlines[0].ms);
assert.equal(weekly.latest.remaining, 50);
assert.equal(weekly.estimate.remaining, 40);
assert.equal(weekly.estimate.end, Date.parse('2026-11-24T09:00:00+08:00'));

const credits = panel.sources.find(source => source.id === 'demo-b').pools[0];
assert.equal(credits.estimate.zeroAt, Date.parse('2026-11-24T09:00:00+08:00'));
assert.equal((credits.estimate.zeroAt - asOf) / 60_000, 55);
assert.equal(credits.estimate.deadline.type, 'expiry');
assert.match(model.agentGuide(), /每 5 分钟/);
assert.equal(JSON.parse(model.template()).schemaVersion, 1);

const snapshot = { ...demo, pools: [demo.pools[0]] };
let saved = model.merge(JSON.stringify(snapshot), '[]', asOf);
saved = model.merge(JSON.stringify(snapshot), saved, asOf);
assert.equal(JSON.parse(saved)[0].observations.length, 3);
assert.throws(() => model.merge('{', saved, asOf), /JSON/);
const newPoint = { observedAt: new Date(asOf).toISOString(), remaining: 0 };
snapshot.pools = [{ ...snapshot.pools[0], observations: [newPoint] }];
saved = model.merge(JSON.stringify(snapshot), saved, asOf);
const current = JSON.parse(model.panel(saved, false, asOf)).sources[0].pools[0];
assert.equal(current.latest.remaining, 0);
assert.equal(current.estimate.state, 'empty');
assert.equal(JSON.parse(saved)[0].observations.length, 4);

const zeroCards = { ...demo, pools: [{
  ...demo.pools.find(pool => pool.kind === 'reset-credit'), poolId: 'reset-card-summary', expiresAt: null,
  observations: [{ observedAt: new Date(asOf).toISOString(), remaining: 0 }]
}] };
const stock = model.merge(JSON.stringify(demo), '[]', asOf);
const changed = model.merge(JSON.stringify(zeroCards), stock, asOf, 'codex');
const currentStock = JSON.parse(model.panel(changed, false, asOf)).sources[0].pools;
assert.equal(currentStock.filter(pool => pool.kind === 'reset-credit').length, 1);
assert.equal(currentStock.find(pool => pool.kind === 'reset-credit').latest.remaining, 0);
assert.equal(currentStock.filter(pool => pool.kind !== 'reset-credit').length, 3);

console.log('Quota Bar model · forecast, inventory replacement, merge and invalid input passed');
