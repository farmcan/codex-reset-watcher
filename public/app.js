const TZ = "Asia/Shanghai";
const PAGES_SNAPSHOT = location.hostname.endsWith("github.io") || new URLSearchParams(location.search).has("snapshot");
const endpoint = (name) => PAGES_SNAPSHOT ? `snapshots/${name}.json` : `/api/${name}`;

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const link = (label, url, className = "") => {
  const anchor = el("a", className, label);
  if (/^https:\/\//.test(url) || url.startsWith("/")) anchor.href = url;
  if (/^https:\/\//.test(url)) {
    anchor.target = "_blank";
    anchor.rel = "noreferrer noopener";
  }
  return anchor;
};

function formatTime(value, withYear = false) {
  if (!value) return "未知";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: TZ,
    year: withYear ? "numeric" : undefined,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(value));
}

function formatDuration(totalMinutes) {
  if (!Number.isFinite(totalMinutes)) return "未知";
  const minutes = Math.max(0, Math.round(totalMinutes));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const remaining = minutes % 60;
  if (days) return `${days} 天 ${hours} 小时 ${remaining} 分`;
  if (hours) return `${hours} 小时 ${remaining} 分`;
  return `${remaining} 分`;
}

function localDay(value) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(value));
}

function compactText(value, maximum = 260) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  return normalized.length > maximum ? `${normalized.slice(0, maximum - 1)}…` : normalized;
}

function eventLabel(signal) {
  if (signal.event_type === "explicit_reset" && signal.reset_mode === "hard_reset") return "官方确认：重置已经发生";
  if (signal.event_type === "scheduled_reset" && signal.reset_mode === "hard_reset") return "官方预告：未来 hard reset";
  if (signal.reset_mode === "banked_reset") return "Banked reset 消息";
  if (signal.event_type === "community_rumor" && signal.severity === "medium") return "社区交叉风声";
  if (signal.event_type === "community_rumor") return "单一社区风声";
  if (signal.event_type === "weak_hint") return "官方弱暗示";
  return "额度相关动态";
}

function actionText(signal) {
  if (signal.event_type === "scheduled_reset" && signal.reset_mode === "hard_reset" && String(signal.source_tier).startsWith("A")) {
    return "一手来源明确指向未来 hard reset。如果本来就有任务，可以考虑提前安排；它仍不是执行保证。";
  }
  if (signal.event_type === "explicit_reset" && signal.reset_mode === "hard_reset") {
    return "一手来源已经确认。现在更重要的是检查你自己的 Codex Usage 是否实际到账。";
  }
  if (signal.reset_mode === "banked_reset") return "这是可保存或手动使用的 reset，不等同自动 hard reset。";
  return "目前只值得留意，不建议为了风声强行消耗额度。";
}

function validSignals(status) {
  const seen = new Set();
  return (status.live.signals || []).filter((signal) => {
    if (signal.superseded_by_post_id || signal.event_type === "community_observation" || signal.severity === "none") return false;
    if (signal.event_type === "community_rumor" && Number(signal.confidence) < 0.25) return false;
    if (signal.event_type === "community_rumor" && /no (?:new )?(?:usage )?reset|not an announcement|joke,? not|没有.{0,8}(?:确认|宣布)/i.test(signal.text)) return false;
    const normalizedPrefix = String(signal.text).trim().toLowerCase().replace(/\s+/g, " ").slice(0, 120);
    const key = `${signal.author}|${signal.event_type}|${signal.reset_mode}|${normalizedPrefix}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function currentSignals(status) {
  const now = Date.now();
  const maximumAgeHours = {
    explicit_reset: 24,
    scheduled_reset: 72,
    weak_hint: 48,
    rate_limit_change: 24,
    community_rumor: 48
  };
  return validSignals(status).filter((signal) => {
    const ageHours = (now - Date.parse(signal.created_at)) / 3_600_000;
    return ageHours >= 0 && ageHours <= (maximumAgeHours[signal.event_type] || 24);
  });
}

let resetClockTimer;

function latestConfirmedGlobalReset(status, history) {
  const candidates = [];
  (status.live.signals || []).forEach((signal) => {
    if (signal.event_type !== "explicit_reset" || signal.reset_mode !== "hard_reset") return;
    if (!String(signal.source_tier || "").startsWith("A")) return;
    const timestamp = Date.parse(signal.created_at);
    if (Number.isFinite(timestamp) && timestamp <= Date.now()) candidates.push(timestamp);
  });
  (history.events || []).forEach((event) => {
    if (event.kind !== "hard_reset") return;
    const timestamp = Date.parse(event.outcome_at || event.confirmed_at);
    if (Number.isFinite(timestamp) && timestamp <= Date.now()) candidates.push(timestamp);
  });
  candidates.sort((left, right) => left - right);
  const eventStarts = [];
  candidates.forEach((timestamp) => {
    const current = eventStarts.at(-1);
    if (current && timestamp - current.latest <= 2 * 60 * 60 * 1000) {
      current.latest = timestamp;
      return;
    }
    eventStarts.push({ first: timestamp, latest: timestamp });
  });
  return eventStarts.at(-1)?.first || null;
}

function formatElapsed(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value) => String(value).padStart(2, "0");
  return `${days} 天 ${pad(hours)} 小时 ${pad(minutes)} 分 ${pad(seconds)} 秒`;
}

function renderResetClock(status, history) {
  window.clearInterval(resetClockTimer);
  const card = document.querySelector("#reset-clock");
  const value = document.querySelector("#reset-clock-value");
  const anchor = document.querySelector("#reset-clock-anchor");
  const resetAt = latestConfirmedGlobalReset(status, history);
  if (!resetAt) {
    card.className = "reset-clock error";
    value.textContent = "暂无确认记录";
    anchor.textContent = "不会用社区传闻代替一手确认";
    return;
  }
  card.className = "reset-clock";
  anchor.textContent = `上次确认：${formatTime(new Date(resetAt).toISOString(), true)} · 全局 hard reset`;
  const update = () => {
    value.textContent = formatElapsed(Date.now() - resetAt);
  };
  update();
  resetClockTimer = window.setInterval(update, 1000);
}

function renderHealth(status) {
  const snapshotAgeMs = PAGES_SNAPSHOT ? Date.now() - Date.parse(status.live.generated_at) : 0;
  const health = PAGES_SNAPSHOT && snapshotAgeMs > 20 * 60_000 ? "stale" : status.live.overall || "initializing";
  const dot = document.querySelector("#health-dot");
  dot.className = `status-dot ${health}`;
  const labels = { healthy: "X 监控正常", initializing: "首次基线建立中", stale: "数据已过期", down: "X 监控异常" };
  const prefix = PAGES_SNAPSHOT ? "备用快照 · " : "";
  document.querySelector("#health-label").textContent = `${prefix}${labels[health] || "状态未知"}`;
}

function renderCurrent(status) {
  const card = document.querySelector("#current-card");
  card.replaceChildren();
  const signal = currentSignals(status)[0];
  const body = el("div");
  body.append(el("span", "signal-kicker", "当前判断"));
  if (!signal) {
    card.className = "current-card clear";
    body.append(el("h2", "", status.live.overall === "healthy" ? "暂未发现新的有效信号" : "监控数据还没有准备好"));
    const latestConfirmed = validSignals(status).find((candidate) => candidate.event_type === "explicit_reset" && candidate.reset_mode === "hard_reset");
    const healthyMessage = latestConfirmed
      ? `系统会继续轮询。最近一次官方确认在 ${formatTime(latestConfirmed.created_at)}，已经不再算作当前行动信号。`
      : "系统会继续轮询；没有新信号不等于预测下一次不会重置。";
    body.append(el("p", "", status.live.overall === "healthy" ? healthyMessage : "请先看下方监控健康状态，缺失数据不会被显示为“无事发生”。"));
    card.append(body);
    return;
  }
  card.className = `current-card ${signal.severity || "low"}`;
  body.append(el("h2", "", eventLabel(signal)));
  body.append(el("p", "", actionText(signal)));
  const meta = el("div", "card-meta");
  meta.append(el("span", `pill ${signal.severity}`, signal.severity === "high" ? "高优先级" : signal.severity === "medium" ? "中等置信" : "低置信"));
  meta.append(el("span", `pill ${signal.source_tier}`, `@${signal.author} · ${signal.source_tier}`));
  meta.append(el("span", "pill", formatTime(signal.created_at)));
  body.append(meta);
  card.append(body, link("打开原帖 →", signal.url, "primary-link"));
}

function renderHistoryMetrics(history) {
  const container = document.querySelector("#history-metrics");
  const summary = history.summary;
  const metrics = [
    [`${summary.first_party_confirmation}/${summary.events}`, "最终一手确认", "用来判断是否真的发生"],
    [`${summary.any_first_party_advance_signal}/${summary.events}`, "出现提前线索", "包含暗语和模糊说法"],
    [`${summary.clear_actionable_advance_signal}/${summary.events}`, "清楚、可操作", `中位提前 ${formatDuration(summary.median_clear_first_party_lead_minutes)}`],
    [`${summary.no_usable_first_party_advance_signal}/${summary.events}`, "无可用一手预告", "只找到单账号社区样本"]
  ];
  container.replaceChildren();
  metrics.forEach(([value, label, note], index) => {
    const card = el("article", index === 2 ? "accent" : "");
    card.append(el("strong", "", value), el("span", "", label), el("small", "", note));
    container.append(card);
  });
}

const historicalRoleLabels = {
  first_party: "一手来源",
  scout: "社区侦察",
  relay: "转发分发",
  rumor: "社区传闻",
  personal_observation: "个人反馈"
};

const historicalStageLabels = {
  earliest_signal: "最早线索",
  actionable_signal: "明确预告",
  community_inference: "社区判断",
  relay: "快速转发",
  official_announcement: "官方宣布",
  official_confirmation: "官方确认",
  verification_relay: "确认转发",
  individual_observation: "个人到账",
  observed_delivery: "观察到账",
  stale_signal: "迟到提醒"
};

function timingLabel(node) {
  if (node.timing === "outcome") return "最终结果";
  if (node.timing === "after") return `结果后 ${formatDuration(node.distance_minutes)}`;
  return `提前 ${formatDuration(node.distance_minutes)}`;
}

function renderHistory(history) {
  renderHistoryMetrics(history);
  const container = document.querySelector("#history-list");
  container.replaceChildren();
  history.events.forEach((event, index) => {
    const item = el("details", `timeline-item ${event.advance_quality}`);
    if (index === 0) item.open = true;

    const firstNode = event.timeline?.[0];
    const summary = el("summary", "timeline-summary");
    const date = el("div", "timeline-date");
    date.append(el("strong", "", formatTime(event.outcome_at || event.confirmed_at).split(" ")[0]));
    date.append(el("span", "", event.kind === "hard_reset" ? "hard reset" : "banked reset"));

    const headline = el("div", "timeline-headline");
    const titleRow = el("div", "timeline-title-row");
    titleRow.append(
      el("span", `pill ${event.advance_quality}`, event.advance_quality === "clear" ? "清楚预警" : event.advance_quality === "weak" ? "弱暗示" : "社区补位"),
      el("h3", "", event.outcome_summary_zh || event.confirmation.summary_zh)
    );
    headline.append(titleRow);
    if (firstNode) {
      const firstText = firstNode.timing === "before"
        ? `@${firstNode.author} 最先出现 · ${timingLabel(firstNode)}`
        : `@${firstNode.author} 首次记录`;
      headline.append(el("p", "", firstText));
    }
    if (event.actionable_first_party_signal && event.earliest_first_party_signal?.post_id !== event.actionable_first_party_signal.post_id) {
      headline.append(el("small", "", `真正明确的预告：提前 ${formatDuration(event.actionable_first_party_signal.lead_minutes)}`));
    }
    summary.append(date, headline, el("span", "timeline-toggle", "查看证据时间轴"));

    const body = el("div", "timeline-body");
    const outcome = el("div", "outcome-box");
    outcome.append(el("span", "", "最后结果"), el("strong", "", event.outcome_summary_zh || event.confirmation.summary_zh), el("time", "", formatTime(event.outcome_at || event.confirmed_at, true)));
    body.append(outcome);

    const track = el("ol", "evidence-track");
    (event.timeline || []).forEach((node) => {
      const row = el("li", `evidence-node ${node.role} ${node.signal_quality}`);
      const marker = el("span", "evidence-marker");
      const time = el("time", "evidence-time", formatTime(node.published_at, true));
      const content = el("div", "evidence-content");
      const header = el("div", "evidence-header");
      header.append(
        el("span", `node-stage ${node.role}`, historicalStageLabels[node.stage] || node.stage),
        el("strong", "", `@${node.author}`),
        el("span", "node-role", historicalRoleLabels[node.role] || node.role),
        el("span", `timing-badge ${node.timing}`, timingLabel(node))
      );
      content.append(header, el("p", "", node.summary_zh));
      if (node.url) content.append(link("打开原帖 →", node.url, "node-link"));
      else content.append(el("small", "evidence-missing", "当前切片未保留原帖 ID；不作为强确认。"));
      row.append(marker, time, content);
      track.append(row);
    });
    body.append(track);

    if (event.timeline_gaps?.length) {
      const gaps = el("div", "timeline-gaps");
      gaps.append(el("strong", "", "证据缺口"));
      event.timeline_gaps.forEach((gap) => gaps.append(el("p", "", gap)));
      body.append(gaps);
    }
    body.append(el("p", "community-note", event.community_note_zh));
    item.append(summary, body);
    container.append(item);
  });
}

let activeSignalFilter = "all";
let latestMonitorSignals = [];

function personalSignal(signal) {
  const text = String(signal.text || "");
  const accountPattern = /(?:(?:reset|usage|limit).{0,30}for me|my (?:usage|limit|reset)|went from\s+\d+%?\s+to\s+\d+%?|i (?:got|lost|have|had).{0,30}(?:reset|usage|limit)|我的.{0,12}(?:额度|reset)|到账|个人账户)/i;
  return signal.source_tier !== "A1" && accountPattern.test(text);
}

function signalLane(signal) {
  if (String(signal.source_tier).startsWith("A")) return "official";
  if (personalSignal(signal)) return "personal";
  if (signal.evidence_basis === "derivative" || signal.event_type === "community_observation") return "relay";
  return "rumor";
}

function monitorRelevant(signal) {
  if (!signal?.post_id || signal.superseded_by_post_id && signal.event_type === "community_observation") return false;
  if (String(signal.source_tier).startsWith("A")) return true;
  if (personalSignal(signal)) return true;
  if (signal.event_type === "community_rumor" && Number(signal.confidence) < 0.2) return false;
  if (["scheduled_reset", "explicit_reset", "weak_hint", "community_rumor", "rate_limit_change"].includes(signal.event_type)) {
    const evidence = String(signal.evidence || "");
    return signal.reset_mode !== "unknown" || /reset|usage|limit|额度/i.test(`${evidence} ${signal.text}`);
  }
  return signal.event_type === "community_observation" && signal.reset_mode !== "unknown";
}

function monitorSignals(status) {
  const seen = new Set();
  return [...(status.live.signals || [])]
    .filter(monitorRelevant)
    .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))
    .filter((signal) => {
      if (seen.has(signal.post_id)) return false;
      seen.add(signal.post_id);
      return true;
    })
    .slice(0, 40);
}

function signalLevel(signal) {
  const lane = signalLane(signal);
  if (lane === "personal") return ["个人弱观察", "personal"];
  if (lane === "official" && signal.event_type === "explicit_reset") return ["官方确认", "high"];
  if (lane === "official" && signal.event_type === "scheduled_reset") return ["明确预告", "high"];
  if (lane === "official") return ["一手弱暗示", "medium"];
  if (lane === "relay") return ["同源转述", "relay"];
  return [signal.severity === "medium" ? "社区交叉风声" : "单一社区风声", signal.severity === "medium" ? "medium" : "weak"];
}

function signalTitle(signal) {
  const lane = signalLane(signal);
  if (lane === "personal") {
    return /error|missing|lost|failed|unable|not reset|异常|消失|没到账/i.test(signal.text) ? "个人账户异常反馈" : "个人账户到账反馈";
  }
  if (lane === "relay") return signal.event_type === "community_observation" ? "确认后的社区转述" : "社区侦察 / 转发";
  return eventLabel(signal);
}

function signalMatchesFilter(signal, filter) {
  const lane = signalLane(signal);
  if (filter === "all") return true;
  if (filter === "core") return lane === "official" || signal.severity === "high" || signal.severity === "medium";
  return lane === filter;
}

function renderSignalSummary(status, signals) {
  const container = document.querySelector("#signal-summary");
  const today = localDay(new Date());
  const todaySignals = signals.filter((signal) => localDay(signal.created_at) === today);
  const personal = todaySignals.filter((signal) => signalLane(signal) === "personal").length;
  const scheduled = todaySignals.filter((signal) => signal.event_type === "scheduled_reset" && String(signal.source_tier).startsWith("A")).length;
  const hasCurrentGlobal = currentSignals(status).some((signal) => ["explicit_reset", "scheduled_reset"].includes(signal.event_type) && signal.reset_mode === "hard_reset");
  const cards = [
    [String(todaySignals.length), "今日相关节点", "去重后时间轴记录"],
    [String(personal), "个人到账 / 异常", "默认弱证据，不单独升级"],
    [String(scheduled), "一手未来预告", "明确指向尚未发生的 reset"],
    [hasCurrentGlobal ? "有" : "无", "新一轮全局信号", hasCurrentGlobal ? "请回看顶部当前判断" : "个人反馈不能替代官方确认"]
  ];
  container.replaceChildren();
  cards.forEach(([value, label, note]) => {
    const card = el("article");
    card.append(el("strong", "", value), el("span", "", label), el("small", "", note));
    container.append(card);
  });
}

function renderSignalRows() {
  const container = document.querySelector("#signal-list");
  container.replaceChildren();
  const signals = latestMonitorSignals.filter((signal) => signalMatchesFilter(signal, activeSignalFilter));
  if (!signals.length) {
    container.append(el("p", "empty", "这个筛选下暂无节点。个人反馈为 0 时，只表示当前监控窗口没有收录，不代表所有账号都正常。"));
    return;
  }
  signals.forEach((signal) => {
    const lane = signalLane(signal);
    const [levelLabel, levelClass] = signalLevel(signal);
    const row = el("article", `monitor-node ${lane}`);
    row.append(el("span", "monitor-marker"));
    const time = el("time", "monitor-time", formatTime(signal.created_at, true));
    const body = el("div", "monitor-body");
    const header = el("div", "monitor-header");
    header.append(el("span", `pill ${levelClass}`, levelLabel), el("h3", "", signalTitle(signal)), el("span", "monitor-author", `@${signal.author}`));
    body.append(header, el("p", "", compactText(signal.text)));
    const meta = el("div", "monitor-meta");
    meta.append(el("span", "", `信源 ${signal.source_tier}`), el("span", "", signal.evidence_basis === "derivative" ? "来自同一上游" : signal.evidence_basis === "account_observation" ? "个人账户观察" : "独立说法 / 待核验"));
    if (signal.url) meta.append(link("打开原帖 →", signal.url));
    body.append(meta);
    row.append(time, body);
    container.append(row);
  });
}

function setupSignalFilters() {
  const controls = document.querySelector("#signal-filters");
  if (controls.dataset.ready) return;
  controls.dataset.ready = "true";
  controls.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-filter]");
    if (!button) return;
    activeSignalFilter = button.dataset.filter;
    controls.querySelectorAll("button").forEach((candidate) => candidate.classList.toggle("active", candidate === button));
    renderSignalRows();
  });
}

function renderSignals(status) {
  latestMonitorSignals = monitorSignals(status);
  renderSignalSummary(status, latestMonitorSignals);
  setupSignalFilters();
  renderSignalRows();
}

function recordedPostsLabel(source) {
  const value = source.metrics?.recorded_posts;
  if (!Number.isFinite(value)) return "不足";
  return source.metrics.recorded_posts_qualifier?.startsWith("at_least") ? `≥${value}` : String(value);
}

function sourceQualityMetric(source) {
  const metrics = source.metrics;
  if (Number.isFinite(metrics.clear_advance_events)) return ["清楚预警", `${metrics.clear_advance_events}/${metrics.evaluated_events}`];
  if (Number.isFinite(metrics.stale_events)) return ["漏掉 / 迟到", `${metrics.missed_events || 0} / ${metrics.stale_events}`];
  if (Number.isFinite(metrics.contradiction_events)) return ["矛盾样本", String(metrics.contradiction_events)];
  return ["清楚预警", "未完整标注"];
}

function renderSources(scorecard) {
  const method = document.querySelector("#source-method");
  method.replaceChildren();
  method.append(
    el("strong", "", "先看两件不同的事"),
    el("p", "", `${scorecard.rating_method.source_dimension_zh} ${scorecard.rating_method.content_dimension_zh}`),
    el("p", "", scorecard.sample_scope.warning_zh)
  );

  const container = document.querySelector("#source-list");
  const watchContainer = document.querySelector("#watch-source-list");
  container.replaceChildren();
  watchContainer.replaceChildren();
  scorecard.sources.forEach((source) => {
    if (source.display_group === "watch_only") {
      const watch = el("article", "watch-source");
      watch.append(el("strong", "", `@${source.handle}`), el("span", "", source.role_label_zh), el("p", "", source.conclusion_zh));
      watchContainer.append(watch);
      return;
    }
    const metrics = source.metrics;
    const card = el("article", "source-card");
    const header = el("header");
    const identity = el("div");
    identity.append(el("h3", "", `@${source.handle}`), el("small", "", `${source.role_label_zh} · ${source.reliability_label_zh}`));
    header.append(identity, el("span", `pill ${source.tier}`, source.tier));
    const stats = el("div", "source-stats");
    const [qualityLabel, qualityValue] = sourceQualityMetric(source);
    const usefulAdvanceValue = metrics.false_positive_denominator_complete === false && metrics.evaluated_events === 1
      ? "1 个样本"
      : `${metrics.useful_advance_events}/${metrics.evaluated_events}`;
    const metricRows = [
      ["收录信号", recordedPostsLabel(source)],
      ["有用提前", usefulAdvanceValue],
      [qualityLabel, qualityValue],
      ["通常提前", formatDuration(metrics.median_advance_lead_minutes)]
    ];
    metricRows.forEach(([label, value]) => {
      const metric = el("div");
      metric.append(el("strong", "", value), el("span", "", label));
      stats.append(metric);
    });
    card.append(header, stats, el("p", "source-conclusion", source.conclusion_zh), el("p", "source-caveat", source.caveat_zh));
    container.append(card);
  });
}

function renderSystem(status) {
  const container = document.querySelector("#system-grid");
  container.replaceChildren();
  const official = (status.live.sources || []).find((source) => source.name === "official-first-party") || {};
  const cards = [
    ["整体状态", status.live.overall === "healthy" ? "正常" : status.live.overall === "initializing" ? "初始化" : "需关注", PAGES_SNAPSHOT ? `备用页面约每 10 分钟同步；实时源每 ${status.live.expected_poll_seconds || 120} 秒检查` : `官方源每 ${status.live.expected_poll_seconds || 120} 秒检查`],
    ["官方源最后成功", official.last_success_at ? formatTime(official.last_success_at, true) : "尚未成功", official.last_error || "没有记录错误"],
    ["邮件提醒", status.live.email.configured ? "已启用" : "未配置", status.live.email.configured ? `最低 ${status.live.email.minimum_severity} 才发送` : "补收件人、发件域名和 Resend Secret 后启用"],
    ["实时记录", `${(status.live.signals || []).length} 条`, "页面显示最近 100 条有效信号"]
  ];
  cards.forEach(([label, value, note]) => {
    const card = el("article", "system-card");
    card.append(el("span", "", label), el("strong", "", value), el("small", "", note));
    container.append(card);
  });
}

async function load() {
  try {
    document.querySelector("#status-api-link").href = endpoint("status");
    document.querySelector("#history-api-link").href = endpoint("history");
    const [status, history, sources] = await Promise.all([
      fetch(endpoint("status"), { cache: "no-store" }).then((response) => response.json()),
      fetch(endpoint("history"), { cache: "no-store" }).then((response) => response.json()),
      fetch(endpoint("sources"), { cache: "no-store" }).then((response) => response.json())
    ]);
    renderHealth(status);
    renderCurrent(status);
    renderResetClock(status, history);
    renderHistory(history);
    renderSignals(status);
    renderSources(sources);
    renderSystem(status);
  } catch (error) {
    document.querySelector("#health-dot").className = "status-dot down";
    document.querySelector("#health-label").textContent = "页面无法读取监控 API";
    const card = document.querySelector("#current-card");
    card.className = "current-card high";
    card.replaceChildren(el("div", "", PAGES_SNAPSHOT ? "备用快照加载失败。请稍后刷新。" : "加载失败。请稍后刷新，或查看 /healthz。"));
    const clock = document.querySelector("#reset-clock");
    clock.className = "reset-clock error";
    document.querySelector("#reset-clock-value").textContent = "计时不可用";
    document.querySelector("#reset-clock-anchor").textContent = "历史记录未能加载";
  }
}

load();
