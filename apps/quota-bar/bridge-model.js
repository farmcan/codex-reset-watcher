import { deadlines, forecast, mergePools, poolKey, readSnapshot, splitPoints } from '../../public/quota/model.js';
import { demo, demoNow } from '../../public/quota/demo.js';

globalThis.quotaModel = {
  merge(source, previous, now) {
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
    return JSON.stringify(mergePools(JSON.parse(previous), pools));
  },
  example() {
    return JSON.stringify(demo, null, 2);
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
        id: key, label: pool.poolLabel, unit: pool.unit, zone: pool.zone,
        total: pool.total, latest, estimate: forecast(pool, asOf),
        deadlines: deadlines(pool), groups: splitPoints(points)
      });
    }
    return JSON.stringify({ asOf, sources: [...bySource.values()] });
  }
};
