import { deadlines, forecast, mergePools, poolKey, readSnapshot, splitPoints } from '../../public/quota/model.js';
import { agentTemplate, formatAgentGuide } from '../../public/quota/agent-guide.js';
import { demo, demoNow } from '../../public/quota/demo.js';

globalThis.quotaModel = {
  merge(source, previous, now, inventorySource = null) {
    let input;
    try {
      input = JSON.parse(source.replace(/^\uFEFF/, ''));
    } catch {
      throw new Error('文件不是有效的 JSON。');
    }
    const { pools } = readSnapshot(input);
    if (pools.some(pool => pool.observations.some(point => point.ms > now))) {
      throw new Error('观测时间不能晚于当前时间。');
    }
    const stored = JSON.parse(previous);
    const inventoryReturned = inventorySource && pools.some(pool => pool.sourceId === inventorySource && pool.kind === 'reset-credit');
    const preserved = inventoryReturned
      ? stored.filter(pool => pool.sourceId !== inventorySource || pool.kind !== 'reset-credit')
      : stored;
    return JSON.stringify(mergePools(preserved, pools));
  },
  example() {
    return JSON.stringify(demo, null, 2);
  },
  agentGuide() { return formatAgentGuide(); },
  template() { return agentTemplate; },
  sources(source) {
    const { pools } = readSnapshot(JSON.parse(source.replace(/^\uFEFF/, '')));
    return JSON.stringify([...new Set(pools.map(pool => pool.sourceId))]);
  },
  panel(data, demoMode, now) {
    const pools = demoMode ? mergePools([], readSnapshot(demo).pools) : JSON.parse(data);
    const asOf = demoMode ? demoNow : now;
    const bySource = new Map();
    const seen = new Map();
    for (const pool of pools) {
      const latest = pool.observations.at(-1);
      const key = poolKey(pool);
      if (!latest || latest.ms > asOf || (seen.has(key) && seen.get(key).observations.at(-1).ms > latest.ms)) continue;
      seen.set(key, pool);
    }
    for (const [key, pool] of seen) {
      const latest = pool.observations.at(-1);
      const points = pool.observations.slice(-90);
      if (!bySource.has(pool.sourceId)) {
        bySource.set(pool.sourceId, { id: pool.sourceId, label: pool.sourceLabel, pools: [] });
      }
      bySource.get(pool.sourceId).pools.push({
        id: key, label: pool.poolLabel, unit: pool.unit, zone: pool.zone, kind: pool.kind,
        total: pool.total, latest, estimate: forecast(pool, asOf),
        deadlines: deadlines(pool), groups: splitPoints(points)
      });
    }
    return JSON.stringify({ asOf, sources: [...bySource.values()] });
  }
};
