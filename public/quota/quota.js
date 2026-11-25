import { DAY, HOUR, deadlines, forecast, mergePools, poolKey, readSnapshot } from './model.js';
import { bounds, burnChart, laneChart } from './charts.js';
import { formatAgentGuide } from './agent-guide.js';
import { demo, demoNow } from './demo.js';

const $ = id => document.getElementById(id);
const desktop = window.webkit?.messageHandlers?.quota;
const en = new URLSearchParams(location.search).get('lang') === 'en';
const tr = (zh, english) => en ? english : zh;
const locale = tr('zh-CN', 'en-GB');
const storageKey = 'resetcat:quota:v1';
const themeKey = 'resetcat:quota:theme';
const indicators = { reset: tr('重置', 'Reset'), expiry: tr('到期', 'Expiry'), planned: tr('计划期限', 'Planned') };
const states = {
  missing: tr('无可用读数', 'No reading'),
  update: tr('待更新', 'Awaiting update'),
  empty: tr('已耗尽', 'Depleted'),
  stale: tr('观测已陈旧', 'Reading is stale'),
  short: tr('样本不足', 'Insufficient samples'),
  flat: tr('余额持平', 'Balance is flat')
};
const agentGuide = formatAgentGuide(en ? 'en' : 'zh');
let staleSources = new Set();

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function groupBy(items, key) {
  const groups = new Map();
  for (const item of items) {
    const value = key(item);
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(item);
  }
  return groups;
}

function number(amount) {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(amount);
}

function format(ms, zone, style = 'full') {
  const time = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', ...(style === 'observed' && { second: '2-digit' }) };
  const day = { month: '2-digit', day: '2-digit' };
  const options = style === 'time' ? time : style === 'day' ? { ...day, year: 'numeric' } : style === 'axis' ? day : { ...day, ...time };
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: zone }).format(ms);
}

function balance(pool, remaining) {
  return remaining == null ? '—' : number(remaining) + (pool.unit === 'percent' ? '%' : '');
}

function percentage(pool, remaining) {
  return pool.total > 0 && remaining != null ? 100 * remaining / pool.total : null;
}

function showNotice(message, error = false) {
  $('notice').textContent = message;
  $('notice').hidden = !message;
  $('notice').classList.toggle('error', error);
}

let saved = [];
try {
  const state = desktop ? null : JSON.parse(localStorage.getItem(storageKey));
  if (Array.isArray(state)) saved = state;
  const theme = localStorage.getItem(themeKey);
  if (theme === 'dark' || theme === 'light') document.documentElement.dataset.theme = theme;
} catch {
  showNotice(tr('无法读取本机记录。你仍可尝试导入。', 'Could not read local records. You can still try an import.'), true);
}

let demoMode = false;
let view = 'burn';
let timezone = 'UTC';
const selections = new Map();
const laneSelections = ['', ''];

function groupsOf(pools, now) {
  const active = pools.map(pool => {
    const observations = pool.observations.filter(point => point.ms <= now);
    return { ...pool, observations };
  }).filter(pool => pool.observations.length);
  return [...groupBy(active, pool => pool.sourceId).values()].map(source => {
    const series = [...groupBy(source, poolKey).values()].map(histories => {
      histories.sort((a, b) => a.observations.at(-1).ms - b.observations.at(-1).ms
        || (a.cycleStart?.ms ?? 0) - (b.cycleStart?.ms ?? 0));
      const pool = histories.at(-1);
      const estimate = staleSources.has(pool.sourceId) ? { state: 'stale' } : forecast(pool, now);
      return { pool, histories, latest: pool.observations.at(-1), estimate };
    });
    const latest = series.reduce((a, b) => a.latest.ms >= b.latest.ms ? a : b);
    return { id: latest.pool.sourceId, label: latest.pool.sourceLabel, latest, series };
  });
}

function selectOption(select, value, text) {
  select.add(new Option(text, value));
}

function detailsFor(series) {
  const { pool, histories, latest, estimate } = series;
  const details = node('details');
  const total = histories.reduce((sum, history) => sum + history.observations.length, 0);
  details.append(node('summary', tr(total + ' 个观测点 · 来源与计算说明', total + ' observations · source and calculation')));
  const info = node('div', '', 'details');
  info.append(
    node('small', tr('来源', 'Source') + ' · ' + pool.sourceLabel + ' / ' + pool.sourceId),
    node('small', tr('最近观测', 'Latest reading') + ' · ' + format(latest.ms, pool.zone) + ' · ' + pool.zone),
    ...deadlines(pool).map(marker => node('small', indicators[marker.type] + ' · ' + format(marker.ms, pool.zone, marker.day ? 'day' : 'full')
      + (marker.day ? tr('（仅日期）', ' (date only)') : ''))),
  );
  if (estimate.state === 'forecast') {
    info.append(node('small', tr('用最近连续观测的首末余额之差除以时间，按当前速度外推。', 'Projection uses the balance change between the first and last recent consecutive observations.')));
  } else {
    info.append(node('small', tr('预测', 'Projection') + ' · ' + states[estimate.state]));
  }
  details.append(info);
  return details;
}

function burnCard(group, series, now, compareDomain) {
  const { pool, histories, latest, estimate } = series;
  const card = node('article', '', 'card');
  const heading = node('div', '', 'card-head');
  heading.append(node('h2', group.label), node('small', pool.poolLabel));
  card.append(heading);
  if (group.series.length > 1) {
    const select = node('select');
    select.setAttribute('aria-label', group.label + ' · ' + tr('额度池', 'Quota pool'));
    for (const item of group.series) selectOption(select, poolKey(item.pool), item.pool.poolLabel +
      (group.series.some(other => other !== item && other.pool.poolLabel === item.pool.poolLabel) ? ' · ' + item.pool.unit : ''));
    select.value = poolKey(pool);
    select.onchange = () => {
      selections.set(group.id, select.value);
      render({ source: group.id });
    };
    card.dataset.source = group.id;
    card.append(select);
  }
  const day = (ms, style) => format(ms, pool.zone, style);
  const metrics = node('div', '', 'metrics');
  const measured = node('div');
  const pct = percentage(pool, latest.remaining);
  measured.append(node('small', tr('最近观测余额', 'Last observed balance')), node('strong', balance(pool, latest.remaining), 'balance'));
  if (pool.unit !== 'percent') {
    measured.append(node('small', pool.unit + ' · ' + (pct == null
      ? tr('比例未知', 'Share unknown') : number(pct) + tr('% 剩余', '% remaining'))));
  }
  const projected = node('div');
  projected.append(node('small', tr('预计耗尽', 'Projected depletion')));
  if (estimate.state === 'forecast') {
    projected.append(node('strong', day(estimate.zeroAt), 'zero'));
    if (estimate.deadline && estimate.zeroAt > estimate.deadline.ms) {
      projected.append(node('small', tr('晚于期限 · 理论耗尽时间', 'After deadline · theoretical')));
    }
  } else {
    projected.append(node('strong', states[estimate.state], 'zero'));
  }
  metrics.append(measured, projected);
  const timing = node('div', '', 'cycle');
  timing.append(node('span', tr('开始', 'Start') + ' · ' + (pool.cycleStart ? day(pool.cycleStart.ms, pool.cycleStart.day ? 'day' : 'full') : '—')));
  const markers = deadlines(pool);
  if (!markers.length) timing.append(node('span', tr('期限 · —', 'Deadline · —')));
  for (const marker of markers) {
    timing.append(node('span', day(marker.ms, marker.day ? 'day' : 'full') + ' · ' + indicators[marker.type]));
  }
  card.append(metrics, timing);
  if (estimate.state === 'forecast') {
    const speedUnit = pool.unit === 'percent' ? tr(' 个百分点', ' pp') : ' ' + pool.unit;
    const note = tr('平均 ', 'Average ') + number(estimate.rate) + speedUnit + tr(' / 小时', ' / hour');
    const cutoff = estimate.deadline && estimate.end === estimate.deadline.ms
      ? ' · ' + tr('预计到期限剩余 ', 'Projected at deadline: ') + balance(pool, estimate.remaining) : '';
    card.append(node('p', note + cutoff, 'estimate'));
  }
  const range = $('range').value;
  const shown = range === 'cycle' ? [pool] : histories;
  card.append(burnChart({
    histories: shown, pool, now, domain: compareDomain ?? bounds(pool, now, range, estimate),
    sampling: $('sample').value, estimate, tr, date: day, number, types: indicators
  }), detailsFor(series));
  return card;
}

function laneCard(groups, side, now) {
  const days = Number($('lane-range').value);
  const heading = node('div', '', 'lane-head');
  const title = node('div');
  title.append(node('h2', side === 0 ? tr('左侧比较', 'Left comparison') : tr('右侧比较', 'Right comparison')),
    node('p', tr('查看时刻 → 未来 ', 'As of → next ') + days + tr(' 天', ' days')));
  const select = node('select');
  select.setAttribute('aria-label', side === 0 ? tr('左侧来源', 'Left sources') : tr('右侧来源', 'Right sources'));
  selectOption(select, '', tr('默认分组', 'Default group'));
  for (const group of groups) selectOption(select, group.id, group.label);
  select.value = laneSelections[side];
  select.onchange = () => {
    laneSelections[side] = select.value;
    render({ lane: side });
  };
  heading.append(title, select);
  const card = node('article', '', 'card');
  card.dataset.lane = side;
  const axis = node('div', '', 'lane-axis');
  axis.append(node('span', tr('额度池', 'Quota pool')), node('span', tr('余额', 'Balance')));
  const dates = node('div');
  dates.append(node('span', format(now, timezone, 'axis')), node('span', format(now + days * DAY, timezone, 'axis')));
  axis.append(dates);
  card.append(heading, axis);
  const midpoint = Math.ceil(groups.length / 2);
  const visible = select.value ? groups.filter(group => group.id === select.value)
    : side === 0 ? groups.slice(0, midpoint) : groups.slice(midpoint);
  if (!visible.length) card.append(node('small', tr('任选一个来源进行比较。', 'Choose a source to compare.')));
  for (const group of visible) {
    card.append(node('h3', group.label + ' · ' + format(group.latest.latest.ms, group.latest.pool.zone), 'lane-source'));
    for (const series of group.series) {
      const { pool, latest, estimate } = series;
      const row = node('div', '', 'lane-row');
      const amount = node('div', '', 'lane-amount');
      const pct = percentage(pool, latest.remaining);
      amount.append(node('strong', balance(pool, latest.remaining)));
      if (pool.unit !== 'percent') amount.append(node('small', pool.unit + (pct == null ? '' : ' · ' + number(pct) + '%')));
      if (pct != null) {
        const meter = node('progress');
        meter.max = 100;
        meter.value = pct;
        meter.setAttribute('aria-label', tr('剩余比例', 'Remaining share') + ' · ' + number(pct) + '%');
        amount.append(meter);
      }
      const track = node('div', '', 'lane-track');
      const markers = deadlines(pool);
      const day = (ms, style) => format(ms, pool.zone, style);
      track.append(laneChart(markers, now, days, pool.poolLabel, indicators, day));
      if (!markers.length) track.append(node('small', tr('期限未知', 'Deadline unknown')));
      for (const marker of markers) {
        let status = '';
        if (marker.ms < now) status = ' · ' + tr('已过', 'Passed');
        else if (marker.ms > now + days * DAY) status = ' · ' + tr('超出当前范围', 'Outside range');
        track.append(node('small', day(marker.ms, marker.day ? 'day' : 'full') + ' · ' + indicators[marker.type] + status));
      }
      if (['update', 'stale'].includes(estimate.state)) track.append(node('small', states[estimate.state]));
      row.append(node('strong', pool.poolLabel, 'lane-pool'), amount, track);
      card.append(row, detailsFor(series));
    }
  }
  return card;
}

function renderLegend() {
  const items = view === 'burn' ? [
    ['', tr('实线 · 观测余额', 'Solid · Observed')],
    ['prediction', tr('虚线 · 近期速度外推', 'Dashed · Projection')],
    ['guide', tr('点线 · 均匀使用参考', 'Dotted · Even-use guide')]
  ] : [
    ['', tr('● 重置', '● Reset')], ['prediction', tr('◆ 到期', '◆ Expiry')], ['planned', tr('■ 计划期限', '■ Planned')],
    ['', tr('短条表示余额比例，横轴表示期限', 'Short bars show remaining share. The axis shows deadlines.')]
  ];
  $('legend').replaceChildren(...items.map(([style, label]) => {
    const element = node('span');
    if (view === 'burn') element.append(node('i', '', style));
    element.append(document.createTextNode(label));
    return element;
  }));
}

function render(focus = {}) {
  const now = demoMode ? demoNow : Date.now();
  const pools = demoMode ? mergePools([], readSnapshot(demo).pools) : saved;
  const groups = groupsOf(pools, now);
  $('empty').hidden = groups.length !== 0;
  $('dashboard').hidden = groups.length === 0;
  $('clear').hidden = !saved.length;
  $('back').hidden = !demoMode;
  if (!groups.length) return;
  const active = groups.reduce((count, group) => count + Number(group.series.some(series => series.latest.remaining != null)), 0);
  const mostRecent = Math.max(...groups.map(group => group.latest.latest.ms));
  timezone = groups.find(group => group.latest.latest.ms === mostRecent).latest.pool.zone;
  $('summary').textContent = (demoMode ? tr('演示数据 · ', 'Demo data · ') : '') +
    active + ' / ' + groups.length + tr(' 个来源有读数', ' sources with readings');
  $('updated').textContent = (demoMode ? tr('演示查看时刻', 'Demo as of') : tr('最新观测', 'Last observed'))
    + ' · ' + format(demoMode ? now : mostRecent, timezone, demoMode ? 'full' : 'observed') + ' · ' + timezone;
  $('burn-controls').hidden = view !== 'burn';
  $('lane-range').hidden = view !== 'lanes';
  $('burn').setAttribute('aria-pressed', String(view === 'burn'));
  $('lanes').setAttribute('aria-pressed', String(view === 'lanes'));
  renderLegend();
  if (view === 'lanes') {
    $('cards').replaceChildren(laneCard(groups, 0, now), laneCard(groups, 1, now));
    if (focus.lane !== undefined) $('cards').children[focus.lane].querySelector('select').focus();
    return;
  }
  const chosen = groups.map(group => group.series.find(series => poolKey(series.pool) === selections.get(group.id)) ?? group.series[0]);
  let domain;
  if ($('range').value === 'compare') {
    const domains = chosen.map(series => bounds(series.pool, now, 'cycle', series.estimate));
    domain = [Math.min(...domains.map(item => item[0])), Math.max(...domains.map(item => item[1]))];
  }
  $('cards').replaceChildren(...groups.map((group, i) => burnCard(group, chosen[i], now, domain)));
  if (focus.source) Array.from($('cards').children).find(card => card.dataset.source === focus.source)?.querySelector('select').focus();
}

function setView(value) {
  view = value;
  render();
}

$('burn').onclick = () => setView('burn');
$('lanes').onclick = () => setView('lanes');
for (const id of ['range', 'sample', 'lane-range']) $(id).onchange = () => render();
$('import').onclick = () => desktop ? desktop.postMessage('import') : $('file').click();
$('file').onchange = async () => {
  const file = $('file').files[0];
  if (!file) return;
  try {
    if (file.size > 4 * 1024 * 1024) throw new Error(tr('文件请小于 4 MB。', 'Choose a file smaller than 4 MB.'));
    let input;
    try {
      input = JSON.parse((await file.text()).replace(/^\uFEFF/, ''));
    } catch {
      throw new Error(tr('文件不是有效的 JSON。', 'The file is not valid JSON.'));
    }
    const { pools } = readSnapshot(input);
    const now = Date.now();
    if (pools.some(pool => pool.observations.some(point => point.ms > now))) {
      throw new Error(tr('观测时间不能晚于当前时间。', 'Observation times cannot be in the future.'));
    }
    const merged = mergePools(saved, pools);
    try {
      localStorage.setItem(storageKey, JSON.stringify(merged));
    } catch {
      throw new Error(tr('浏览器无法保存记录。请检查储存空间或浏览器设置。', 'Storage is unavailable or full.'));
    }
    saved = merged;
    demoMode = false;
    render();
    showNotice(tr('快照已导入并保存在当前浏览器。', 'Snapshot imported and saved in this browser.'));
  } catch (error) {
    showNotice(error.message, true);
  } finally {
    $('file').value = '';
  }
};
$('demo').onclick = () => {
  if (desktop) return desktop.postMessage('demo');
  demoMode = true;
  setView('burn');
  showNotice('');
};
$('back').onclick = () => {
  if (desktop) return desktop.postMessage('live');
  demoMode = false;
  render();
  showNotice('');
};
$('clear').onclick = () => {
  if (desktop) return desktop.postMessage('clear');
  if (!confirm(tr('清除当前浏览器保存的所有额度快照？', 'Clear all quota snapshots saved in this browser?'))) return;
  try {
    localStorage.removeItem(storageKey);
  } catch {
    showNotice(tr('浏览器无法清除记录。', 'Could not clear browser storage.'), true);
    return;
  }
  saved = [];
  demoMode = false;
  selections.clear();
  render();
  showNotice(tr('已清除本机记录。', 'Local records cleared.'));
};
$('theme').onclick = () => {
  const current = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem(themeKey, next); } catch { /* Theme stays active on this page. */ }
};
$('copy').onclick = async () => {
  if (desktop) {
    desktop.postMessage('copy-agent-guide');
    showNotice('已复制 Agent 接入指令。');
    return;
  }
  try {
    await navigator.clipboard.writeText(agentGuide);
    showNotice(tr('已复制 Agent 指令和 JSON 示例。', 'Agent instructions and JSON example copied.'));
  } catch {
    $('guide').closest('details').open = true;
    $('guide').hidden = false;
    $('guide').scrollIntoView({ block: 'nearest' });
    showNotice(tr('浏览器未允许自动复制，请手动选择指令。', 'Clipboard unavailable. Select and copy the text manually.'));
  }
};
$('show-guide').onclick = () => { $('guide').hidden = !$('guide').hidden; };
$('guide').textContent = agentGuide;
$('example').onclick = () => {
  if (desktop) return desktop.postMessage('example');
  const url = URL.createObjectURL(new Blob([JSON.stringify(demo, null, 2) + '\n'], { type: 'application/json' }));
  const download = node('a');
  download.href = url;
  download.download = 'quota-snapshot.json';
  download.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
if (en) {
  document.documentElement.lang = 'en';
  document.title = 'Personal quota · Codex Reset Watcher';
  for (const element of document.querySelectorAll('[data-en]')) element.textContent = element.dataset.en;
  $('language').href = './';
  $('language').lang = 'zh-CN';
  $('language').textContent = '中文';
  document.querySelector('.brand').href = '../en/';
}
if (desktop) {
  window.showQuotaBarState = state => {
    saved = state.saved;
    demoMode = state.demo;
    staleSources = new Set(state.stale ?? []);
    render();
  };
  document.querySelector('.brand').href = 'https://resetcat.pages.dev/';
  document.querySelector('.intro p').textContent = '查看快照余额、消耗速度和下次重置。记录保存在这台 Mac。';
  $('language').hidden = true;
  desktop.postMessage('ready');
} else {
  render();
}
setInterval(() => {
  if (!demoMode && saved.length && !document.activeElement?.closest('#dashboard')) render();
}, 60_000);
