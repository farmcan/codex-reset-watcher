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
  const lastObservation = pool.observations.at(-1).ms;
  if (range === 'cycle' && latestKnownDeadline >= lastObservation && latestKnownDeadline < now) {
    return [Math.min(start, latestKnownDeadline - 1), latestKnownDeadline];
  }
  const end = latestKnownDeadline ?? (estimate.state === 'forecast' ? estimate.end : now);
  return [start, Math.max(now, Math.min(end, now + 90 * DAY), start + 1)];
}

export function burnChart({ histories, pool, now, domain, range, sampling, estimate, tr, date, number, types, balance }) {
  const chart = svg(480, 197, tr('额度燃尽图', 'Quota burndown chart'));
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
  if (now < end) {
    const forecastStart = x(Math.max(start, now));
    shape(chart, 'rect', { x: forecastStart, y: 16, width: 469 - forecastStart, height: 133, class: 'forecast-zone' });
  }
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
  if (range === 'cycle') {
    const startLabel = pool.cycleStart ? (pool.cycleStartBasis === 'window-length'
      ? tr('按窗口长度推算', 'Inferred from window length') : tr('周期开始', 'Cycle start'))
      : tr('首笔观测', 'First observation');
    shape(chart, 'text', { x: 53, y: 187, 'text-anchor': 'start', class: 'cycle-origin' }, startLabel);
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
    if (estimate.end >= start && estimate.end <= end) {
      const px = x(estimate.end);
      const py = y(value(estimate.remaining, pool));
      const atDeadline = estimate.remaining > 0 && estimate.end === estimate.deadline?.ms;
      const when = date(estimate.end, end - start <= DAY ? 'time' : 'full');
      const text = atDeadline
        ? tr(types[estimate.deadline.type] + '时预计剩 ' + balance(pool, estimate.remaining),
          balance(pool, estimate.remaining) + ' at ' + types[estimate.deadline.type])
        : tr('预计耗尽 ' + when, 'Projected depletion ' + when);
      const labelY = py < 43 ? py + 21 : py - 13;
      const anchor = px > 261 ? 'end' : 'start';
      line(chart, px, py, px, py < 43 ? labelY - 10 : labelY + 4, 'forecast-tick');
      const mark = shape(chart, 'circle', { cx: px, cy: py, r: 4, class: 'marker', tabindex: 0,
        'aria-label': text + ' · ' + date(estimate.end, 'full') });
      shape(mark, 'title', {}, text + ' · ' + date(estimate.end, 'full'));
      shape(chart, 'text', { x: px + (anchor === 'end' ? -5 : 5), y: labelY,
        'text-anchor': anchor, class: 'forecast-label' }, text);
      chart.setAttribute('aria-label', chart.getAttribute('aria-label') + ' · ' + text);
    }
  }
  return chart;
}

export function laneChart(markers, now, days, label, markerLabel) {
  const chart = svg(268, 32 * markers.length, [label, ...markers.map(markerLabel)].join(' · '));
  markers.forEach((marker, index) => {
    const fraction = (marker.ms - now) / (days * DAY);
    const x = 8 + 252 * Math.max(0, Math.min(1, fraction));
    const y = 23 + index * 32;
    const classes = 'lane-marker ' + marker.type + (fraction < 0 ? ' elapsed' : '');
    line(chart, 8, y, 260, y, 'timeline');
    for (const tick of [0, .25, .5, .75, 1]) line(chart, 8 + 252 * tick, y - 5, 8 + 252 * tick, y + 5, 'grid');
    if (marker.type === 'reset' || marker.type === 'observed-reset') {
      shape(chart, 'circle', { cx: x, cy: y, r: 4, class: classes });
    } else if (marker.type === 'expiry') {
      shape(chart, 'path', { d: `M${x} ${y - 5}l5 5-5 5-5-5z`, class: classes });
    } else {
      shape(chart, 'rect', { x: x - 4, y: y - 4, width: 8, height: 8, class: classes });
    }
    const text = markerLabel(marker);
    const width = Math.min(252, Array.from(text).reduce((sum, char) => sum + (char.codePointAt(0) > 127 ? 12 : 6.2), 0));
    const labelX = Math.min(260 - width, Math.max(8, x - width / 2));
    shape(chart, 'text', { x: labelX, y: y - 9, class: 'lane-label' }, text);
  });
  return chart;
}
