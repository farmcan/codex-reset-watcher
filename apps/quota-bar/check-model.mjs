import assert from 'node:assert/strict';
import './bridge-model.js';
import { demo, demoNow } from '../../public/quota/demo.js';

const model = globalThis.quotaModel;
const asOf = demoNow;
const example = model.panel('[]', true, asOf);
const panel = JSON.parse(example);
assert.equal(panel.sources.length, 4);
const weekly = panel.sources[0].pools[0];
assert.equal(panel.sources[0].pools.length, 2);
assert.equal(weekly.latest.remaining, 50);
assert.equal(weekly.estimate.remaining, 40);
assert.equal(weekly.estimate.end, Date.parse('2026-11-24T09:00:00+08:00'));

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
console.log('Quota Bar model · shared forecast, multi-pool, merge, zero and invalid input passed');
