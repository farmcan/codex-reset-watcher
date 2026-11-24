import { DAY, HOUR, deadlines, sampleGroup, splitPoints } from './model.js';

const ns = 'http://www.w3.org/2000/svg';

function shape(parent, tag, attributes, text) {
  const element = document.createElementNS(ns, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  if (text !== undefined) element.textContent = text;
  parent.append(element);
  return element;
}

function svg(width, height, label) {
  const chart = document.createElementNS(ns, 'svg');
  chart.setAttribute('class', 'chart');
  chart.setAttribute('viewBox', [0, 0, width, height].join(' '));
  chart.setAttribute('role', 'img');
  chart.setAttribute('aria-label', label);
  return chart;
}

function line(chart, x1, y1, x2, y2, name) {
  return shape(chart, 'line', { x1, y1, x2, y2, class: name });
}

export function bounds(pool, now, range, estimate) {
  const latestKnownDeadline = deadlines(pool).at(-1)?.ms;
  const start = range === 'day' ? now - DAY : range === 'week' ? now - 7 * DAY
    : pool.cycleStart?.ms ?? pool.observations[0].ms;
  const end = latestKnownDeadline ?? (estimate.state === 'forecast' ? estimate.end : now);
  return [Math.min(start, now - 5 * 60_000), Math.max(now, Math.min(end, now + 90 * DAY))];
}

export function burnChart({ histories, pool, now, domain, sampling, estimate, tr, date, number, types }) {
  const chart = svg(480, 188, tr('额度燃尽图', 'Quota burndown chart'));
  const [start, end] = domain;
  const x = ms => 53 + 416 * (ms - start) / (end - start);
  const normalized = histories.every(history => history.total > 0);
  const value = (remaining, history) => normalized ? 100 * remaining / history.total : remaining;
  let scale = normalized ? 100 : pool.total || 1;
  for (const history of histories) {
    for (const point of history.observations) {
      if (point.ms >= start && point.ms <= now) scale = Math.max(scale, value(point.remaining, history));
    }
  }
  const y = amount => 149 - 133 * amount / scale;
  const axisLabel = amount => number(amount) + (normalized ? '%' : '');
  const clipId = 'plot-' + crypto.randomUUID();
  const defs = shape(chart, 'defs', {});
  const clip = shape(defs, 'clipPath', { id: clipId });
  shape(clip, 'rect', { x: 52, y: 14, width: 420, height: 138 });
  if (now < end) shape(chart, 'rect', { x: x(now), y: 16, width: 469 - x(now), height: 133, class: 'forecast-zone' });
  for (const fraction of [1, .75, .5, .25, 0]) {
    const level = scale * fraction;
    line(chart, 53, y(level), 469, y(level), 'grid');
    shape(chart, 'text', { x: 45, y: y(level) + 4, 'text-anchor': 'end' }, axisLabel(level));
  }
  for (const fraction of [0, .5, 1]) {
    const ms = start + (end - start) * fraction;
    const anchor = fraction === 0 ? 'start' : fraction === 1 ? 'end' : 'middle';
    shape(chart, 'text', { x: x(ms), y: 171, 'text-anchor': anchor }, date(ms, end - start <= DAY ? 'time' : 'axis'));
  }
  const plot = shape(chart, 'g', { 'clip-path': 'url(#' + clipId + ')' });
  if (now < end && x(now) - 53 > 40 && 469 - x(now) > 40) {
    line(plot, x(now), 16, x(now), 149, 'now');
    shape(chart, 'text', { x: x(now) + 4, y: 28 }, tr('查看时刻', 'As of'));
  }
  for (const marker of deadlines(pool)) {
    if (marker.ms < start || marker.ms > end) continue;
    const mark = line(plot, x(marker.ms), 16, x(marker.ms), 149, 'deadline ' + marker.type);
    shape(mark, 'title', {}, types[marker.type] + ' · ' + date(marker.ms, marker.day ? 'day' : 'full'));
  }
  const reference = deadlines(pool).find(marker => marker.ms > now);
  const latest = pool.observations.filter(point => point.ms <= now).at(-1);
  if (latest?.remaining != null && reference && reference.ms > now) {
    line(plot, x(latest.ms), y(value(latest.remaining, pool)), x(reference.ms), y(0), 'guide');
  }
  for (const history of histories) {
    for (const group of splitPoints(history.observations.filter(point => point.ms <= now))) {
      const sampled = sampleGroup(group.filter(point => point.ms >= start && point.ms <= end), sampling, pool.zone);
      if (sampled.length > 1) {
        shape(plot, 'polyline', {
          class: 'actual',
          points: sampled.map(point => [x(point.ms), y(value(point.remaining, history))].join(',')).join(' ')
        });
      }
      for (const point of sampled) {
        const mark = shape(plot, 'circle', { cx: x(point.ms), cy: y(value(point.remaining, history)), r: 3, class: 'point' });
        shape(mark, 'title', {}, date(point.ms, 'full') + ' · ' + axisLabel(value(point.remaining, history)));
      }
    }
  }
  if (estimate.state === 'forecast') {
    const segment = line(plot, x(estimate.latest.ms), y(value(estimate.latest.remaining, pool)),
      x(estimate.end), y(value(estimate.remaining, pool)), 'forecast');
    segment.dataset.end = new Date(estimate.end).toISOString();
    segment.dataset.remaining = String(estimate.remaining);
    if (estimate.end <= end) shape(plot, 'circle', {
      cx: x(estimate.end), cy: y(value(estimate.remaining, pool)), r: 3, class: 'marker'
    });
  }
  return chart;
}

export function laneChart(markers, now, days, label, types, date) {
  const chart = svg(215, 35, label);
  line(chart, 6, 18, 209, 18, 'timeline');
  for (const fraction of [0, .25, .5, .75, 1]) {
    const x = 6 + 203 * fraction;
    line(chart, x, 6, x, 30, 'grid');
  }
  for (const marker of markers) {
    const fraction = (marker.ms - now) / (days * DAY);
    if (fraction < 0 || fraction > 1) continue;
    const x = 6 + 203 * fraction;
    let mark;
    if (marker.type === 'reset') mark = shape(chart, 'circle', { cx: x, cy: 18, r: 4, class: 'reset' });
    if (marker.type === 'expiry') mark = shape(chart, 'path', { d: `M${x} 12l6 6-6 6-6-6z`, class: 'marker' });
    if (marker.type === 'planned') mark = shape(chart, 'rect', { x: x - 3, y: 15, width: 6, height: 6, class: 'planned' });
    shape(mark, 'title', {}, types[marker.type] + ' · ' + date(marker.ms, marker.day ? 'day' : 'full'));
  }
  return chart;
}
