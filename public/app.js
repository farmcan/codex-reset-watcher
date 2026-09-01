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
    const key = `${signal.author}|${signal.event_type}|${String(signal.text).trim().toLowerCase()}`;
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
    body.append(el("p", "", status.live.overall === "healthy" ? "系统会继续轮询；没有新信号不等于预测下一次不会重置。" : "请先看下方监控健康状态，缺失数据不会被显示为“无事发生”。"));
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

function renderHistory(history) {
  const container = document.querySelector("#history-list");
  container.replaceChildren();
  history.events.forEach((event) => {
    const item = el("article", "timeline-item");
    const date = el("div", "timeline-date");
    date.append(el("strong", "", formatTime(event.confirmed_at).split(" ")[0]));
    date.append(el("span", "", event.kind === "hard_reset" ? "hard reset" : "banked reset"));
    const body = el("div", "timeline-body");
    const title = el("h3", "", event.confirmation.summary_zh);
    const quality = el("span", `pill ${event.advance_quality}`, event.advance_quality === "clear" ? "清楚预警" : event.advance_quality === "weak" ? "弱暗示" : "无一手预告");
    title.prepend(quality, document.createTextNode(" "));
    body.append(title);
    if (event.earliest_first_party_signal) {
      const hours = Math.floor(event.earliest_first_party_signal.lead_minutes / 60);
      const minutes = event.earliest_first_party_signal.lead_minutes % 60;
      body.append(el("p", "", `最早一手信号约提前 ${hours} 小时 ${minutes} 分：${event.earliest_first_party_signal.summary_zh}`));
    } else if (event.community_signal) {
      const hours = Math.floor(event.community_signal.lead_minutes / 60);
      const minutes = event.community_signal.lead_minutes % 60;
      body.append(el("p", "", `未找到可用一手预告。社区单账号约提前 ${hours} 小时 ${minutes} 分猜中，但不能据此计算预测准确率。`));
    }
    body.append(el("p", "", event.community_note_zh));
    const links = el("div", "timeline-links");
    links.append(link("确认原帖", event.confirmation.url));
    if (event.earliest_first_party_signal) links.append(link("最早一手信号", event.earliest_first_party_signal.url));
    if (event.community_signal) links.append(link("社区样本", event.community_signal.url));
    body.append(links);
    item.append(date, body);
    container.append(item);
  });
}

function renderSignals(status) {
  const container = document.querySelector("#signal-list");
  container.replaceChildren();
  const signals = validSignals(status).slice(0, 20);
  if (!signals.length) {
    container.append(el("p", "empty", "尚无实时信号；可能仍在首次建基线。"));
    return;
  }
  signals.forEach((signal) => {
    const row = el("article", "signal-row");
    row.append(el("time", "", formatTime(signal.created_at)));
    const body = el("div");
    body.append(el("h3", "", eventLabel(signal)));
    body.append(el("p", "", `${signal.text} · ${signal.reason}`));
    row.append(body, link("看原帖 →", signal.url));
    container.append(row);
  });
}

function renderSources(scorecard) {
  const container = document.querySelector("#source-list");
  container.replaceChildren();
  scorecard.sources.forEach((source) => {
    const card = el("article", "source-card");
    const header = el("header");
    header.append(el("h3", "", `@${source.handle}`), el("span", `pill ${source.tier}`, `${source.tier} · ${source.role}`));
    card.append(header, el("p", "", source.conclusion_zh));
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
  }
}

load();
