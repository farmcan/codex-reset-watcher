const TZ = "Asia/Shanghai";
const ENGLISH = document.documentElement.lang.toLowerCase().startsWith("en");
const PAGES_SNAPSHOT = location.hostname.endsWith("github.io") || new URLSearchParams(location.search).has("snapshot");
const endpoint = (name) => PAGES_SNAPSHOT ? `${ENGLISH ? "../" : ""}snapshots/${name}.json` : `/api/${name}`;
const ui = (zh, en) => ENGLISH ? en : zh;

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
  if (!value) return ui("未知", "Unknown");
  return new Intl.DateTimeFormat(ENGLISH ? "en-GB" : "zh-CN", {
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
  if (!Number.isFinite(totalMinutes)) return ui("未知", "Unknown");
  const minutes = Math.max(0, Math.round(totalMinutes));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const remaining = minutes % 60;
  if (ENGLISH) {
    if (days) return `${days}d ${hours}h ${remaining}m`;
    if (hours) return `${hours}h ${remaining}m`;
    return `${remaining}m`;
  }
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
  if (signal.event_type === "explicit_reset" && signal.reset_mode === "hard_reset") return ui("官方确认：重置已经发生", "Official confirmation: reset completed");
  if (signal.event_type === "scheduled_reset" && signal.reset_mode === "hard_reset") return ui("官方预告：未来全量重置", "Official notice: hard reset ahead");
  if (signal.reset_mode === "banked_reset") return ui("可储存重置消息", "Banked reset update");
  if (signal.event_type === "community_rumor" && signal.severity === "medium") return ui("社区交叉风声", "Corroborated community signal");
  if (signal.event_type === "community_rumor") return ui("单一社区风声", "Single-source community signal");
  if (signal.event_type === "weak_hint") return ui("官方弱暗示", "Weak first-party hint");
  return ui("额度相关动态", "Usage-limit update");
}

function actionText(signal) {
  if (signal.event_type === "scheduled_reset" && signal.reset_mode === "hard_reset" && String(signal.source_tier).startsWith("A")) {
    return ui("一手来源明确指向未来全量重置。如果本来就有任务，可以考虑提前安排；它仍不是执行保证。", "A first-party source points to an upcoming hard reset. You may want to bring forward work you already planned, but execution is not guaranteed.");
  }
  if (signal.event_type === "explicit_reset" && signal.reset_mode === "hard_reset") {
    return ui("一手来源已经确认。现在更重要的是检查你自己的 Codex Usage 是否实际到账。", "A first-party source has confirmed it. Check your own Codex Usage to see whether the reset has reached your account.");
  }
  if (signal.reset_mode === "banked_reset") return ui("这是可保存或手动使用的重置，不等同自动全量重置。", "This is a reset you can bank or apply manually; it is not an automatic hard reset.");
  return ui("目前只值得留意，不建议为了风声强行消耗额度。", "Worth watching, but not strong enough to justify burning usage on rumor alone.");
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

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function historicalMedianGap(history) {
  const outcomes = (history.events || [])
    .filter((event) => event.kind === "hard_reset")
    .map((event) => Date.parse(event.outcome_at || event.confirmed_at))
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  return median(outcomes.slice(1).map((timestamp, index) => timestamp - outcomes[index]));
}

function resetPhase(ratio) {
  if (ratio < 0.5) return ["cooling", ui("刚重置完 · 冷却中", "Fresh reset · cooling")];
  if (ratio < 1) return ["warming", ui("节奏升温 · 可以留意", "Cadence warming up")];
  if (ratio < 1.5) return ["window", ui("进入历史常见窗口", "Inside the typical window")];
  return ["overdue", ui("已超出常见节奏", "Beyond the typical cadence")];
}

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
  return ENGLISH
    ? `${days}d ${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`
    : `${days} 天 ${pad(hours)} 小时 ${pad(minutes)} 分 ${pad(seconds)} 秒`;
}

function renderResetClock(status, history) {
  window.clearInterval(resetClockTimer);
  const card = document.querySelector("#reset-clock");
  const value = document.querySelector("#reset-clock-value");
  const anchor = document.querySelector("#reset-clock-anchor");
  const phase = document.querySelector("#reset-clock-phase");
  const progress = document.querySelector("#reset-clock-progress");
  const progressFill = document.querySelector("#reset-progress-fill");
  const context = document.querySelector("#reset-clock-context");
  const resetAt = latestConfirmedGlobalReset(status, history);
  const medianGap = historicalMedianGap(history);
  if (!resetAt) {
    card.className = "reset-clock error";
    value.textContent = ui("暂无确认记录", "No confirmed reset");
    anchor.textContent = ui("不会用社区传闻代替一手确认", "Community rumors are never used as the clock anchor");
    phase.textContent = "";
    progress.textContent = "";
    progressFill.style.width = "0";
    context.textContent = ui("历史节奏只作参照，不预测下次重置", "Historical cadence is context, not a forecast");
    return;
  }
  card.className = "reset-clock";
  anchor.textContent = ui(
    `上次确认：${formatTime(new Date(resetAt).toISOString(), true)} · 全局全量重置`,
    `Last confirmed: ${formatTime(new Date(resetAt).toISOString(), true)} · global hard reset`
  );
  context.textContent = Number.isFinite(medianGap)
    ? ui(
      `历史中位间隔 ${formatDuration(medianGap / 60_000)} · 只作节奏参照，不预测下次重置`,
      `Historical median gap ${formatDuration(medianGap / 60_000)} · cadence context, not a forecast`
    )
    : ui("历史样本不足，暂不显示节奏", "Not enough history to show cadence");
  const update = () => {
    const elapsed = Date.now() - resetAt;
    value.textContent = formatElapsed(elapsed);
    if (!Number.isFinite(medianGap) || medianGap <= 0) return;
    const ratio = elapsed / medianGap;
    const percentage = Math.max(0, Math.round(ratio * 100));
    const [phaseKey, phaseLabel] = resetPhase(ratio);
    card.dataset.phase = phaseKey;
    phase.textContent = phaseLabel;
    progress.textContent = ui(`历史节奏 ${percentage}%`, `${percentage}% of median cadence`);
    progressFill.style.width = `${Math.min(100, percentage)}%`;
  };
  update();
  resetClockTimer = window.setInterval(update, 1000);
}

function renderHealth(status) {
  const snapshotAgeMs = PAGES_SNAPSHOT ? Date.now() - Date.parse(status.live.generated_at) : 0;
  const health = PAGES_SNAPSHOT && snapshotAgeMs > 20 * 60_000 ? "stale" : status.live.overall || "initializing";
  const dot = document.querySelector("#health-dot");
  dot.className = `status-dot ${health}`;
  const labels = ENGLISH
    ? { healthy: "X monitoring healthy", initializing: "Building the first baseline", stale: "Data is stale", down: "X monitoring unavailable" }
    : { healthy: "X 监控正常", initializing: "首次基线建立中", stale: "数据已过期", down: "X 监控异常" };
  const prefix = PAGES_SNAPSHOT ? ui("备用快照 · ", "Fallback snapshot · ") : "";
  document.querySelector("#health-label").textContent = `${prefix}${labels[health] || ui("状态未知", "Unknown status")}`;
}

function renderCurrent(status) {
  const card = document.querySelector("#current-card");
  card.replaceChildren();
  const signal = currentSignals(status)[0];
  const body = el("div");
  body.append(el("span", "signal-kicker", ui("当前判断", "Current assessment")));
  if (!signal) {
    card.className = "current-card clear";
    body.append(el("h2", "", status.live.overall === "healthy" ? ui("暂未发现新的有效信号", "No new actionable signal") : ui("监控数据还没有准备好", "Monitoring data is not ready")));
    const latestConfirmed = validSignals(status).find((candidate) => candidate.event_type === "explicit_reset" && candidate.reset_mode === "hard_reset");
    const healthyMessage = latestConfirmed
      ? ui(`系统会继续轮询。最近一次官方确认在 ${formatTime(latestConfirmed.created_at)}，已经不再算作当前行动信号。`, `Polling continues. The latest official confirmation was at ${formatTime(latestConfirmed.created_at)} and is no longer treated as a current action signal.`)
      : ui("系统会继续轮询；没有新信号不等于预测下一次不会重置。", "Polling continues. No new signal is not a prediction that another reset will not happen.");
    body.append(el("p", "", status.live.overall === "healthy" ? healthyMessage : ui("请先看下方监控健康状态，缺失数据不会被显示为“无事发生”。", "Check monitoring health below; missing data is never presented as an all-clear.")));
    card.append(body);
    return;
  }
  card.className = `current-card ${signal.severity || "low"}`;
  body.append(el("h2", "", eventLabel(signal)));
  body.append(el("p", "", actionText(signal)));
  const meta = el("div", "card-meta");
  meta.append(el("span", `pill ${signal.severity}`, signal.severity === "high" ? ui("高优先级", "High priority") : signal.severity === "medium" ? ui("中等置信", "Medium confidence") : ui("低置信", "Low confidence")));
  meta.append(el("span", `pill ${signal.source_tier}`, `@${signal.author} · ${signal.source_tier}`));
  meta.append(el("span", "pill", formatTime(signal.created_at)));
  body.append(meta);
  card.append(body, link(ui("打开原帖 →", "Open original post →"), signal.url, "primary-link"));
}

function renderHistoryMetrics(history) {
  const container = document.querySelector("#history-metrics");
  const summary = history.summary;
  const metrics = [
    [`${summary.first_party_confirmation}/${summary.events}`, ui("最终一手确认", "First-party confirmations"), ui("用来判断是否真的发生", "Used to determine whether it happened")],
    [`${summary.any_first_party_advance_signal}/${summary.events}`, ui("出现提前线索", "Advance signals"), ui("包含暗语和模糊说法", "Includes ambiguous or coded hints")],
    [`${summary.clear_actionable_advance_signal}/${summary.events}`, ui("清楚、可操作", "Clear and actionable"), ui(`中位提前 ${formatDuration(summary.median_clear_first_party_lead_minutes)}`, `Median lead ${formatDuration(summary.median_clear_first_party_lead_minutes)}`)],
    [`${summary.no_usable_first_party_advance_signal}/${summary.events}`, ui("无可用一手预告", "No usable first-party warning"), ui("只找到单账号社区样本", "Only one community account was found")]
  ];
  container.replaceChildren();
  metrics.forEach(([value, label, note], index) => {
    const card = el("article", index === 2 ? "accent" : "");
    card.append(el("strong", "", value), el("span", "", label), el("small", "", note));
    container.append(card);
  });
}

const EVENT_OUTCOMES_EN = {
  "reset-2026-08-31-hard": "First-party confirmation: the global usage reset began rolling out to paid ChatGPT Work and Codex users.",
  "reset-2026-08-30-hard": "First-party confirmation: paid-user usage was reset after several usage-consumption fixes.",
  "reset-2026-08-28-hard": "First-party confirmation: ChatGPT Work and Codex users received fresh usage.",
  "reset-2026-08-24-hard": "First-party confirmation: the fix propagated and the global usage reset completed.",
  "reset-2026-08-21-banked": "Community accounts later observed the banked reset. It must be saved or applied manually and is not an automatic hard reset.",
  "reset-2026-08-13-hard": "First-party confirmation: the 15M milestone reset was due to land within the next hour.",
  "reset-2026-08-11-hard": "First-party confirmation: usage had been reset for all paid users.",
  "reset-2026-08-09-hard": "First-party confirmation: the GPT-5.6 Sol celebration reset was executed.",
  "reset-2026-08-01-hard": "First-party confirmation: the efficiency-weekend reset was executed.",
  "reset-2026-07-29-hard": "First-party confirmation: usage was reset after the Sol efficiency fix."
};

const NODE_SUMMARIES_EN = {
  "2093573991965557198": "Mentioned an approaching milestone and told users to “hold on to your Codex.” The direction was right, but no reset time was given.",
  "2094037516391198915": "Inferred a next-day reset from the milestone and reset-button context. This was a derivative inference, not independent evidence.",
  "2094039588113432669": "Relayed the message plainly as “reset tomorrow,” which improved discovery but still depended on the same first-party hint.",
  "2094144275957350900": "A first-party post specified 6pm PST that day, the first point at which the warning became actionable.",
  "2094144533923602740": "Relayed the explicit warning about 61 seconds after the first-party source.",
  "2094251180121854309": "First-party confirmation that the global reset had been executed.",
  "2094254074711732469": "A user reported the reset on their own account. Useful delivery evidence, but not proof of global coverage by itself.",
  "2094255997170630819": "A confirmation relay reporting that execution had been observed.",
  "2093551005711679557": "Said only “soon, but not today.” It may have referred to this reset or the next one, so it was not a clear schedule.",
  "2093592104383512849": "Turned the first-party “soon” into a possible-reset alert, while the event attribution remained ambiguous.",
  "2093594757683613833": "Relayed it as “reset tomorrow.” The wording was clearer, but it added no new first-party evidence.",
  "2093605406719279562": "Amplified the next-day reset claim and added speculation about motive; the motive had no first-party support.",
  "2093667781904679375": "Repeated the reset claim and guessed the milestone count, another amplification of the same upstream source.",
  "2093801758665715784": "First-party confirmation of the fixes and reset.",
  "2092862554632826968": "A first-party reset-button hint. Repeated history made it recognizable, but it was still not a formal schedule.",
  "2092888428392444384": "Converted the hint into “probably reset tomorrow,” improving discovery while explicitly retaining uncertainty.",
  "2093014447833116908": "First-party confirmation that users had received brand-new usage.",
  "2093041141138526615": "A confirmation relay posted 1h 46m after the first-party confirmation.",
  "2093051462834172132": "Posted another incoming-reset alert after this reset had already happened, so it is marked stale.",
  "2091407991736332689": "A first-party source explicitly said a full reset would happen the next day.",
  "2091688655828246890": "First-party confirmation that the fix had propagated and the reset was complete.",
  "2090766694897619318": "Announced a 20M-milestone banked reset for that day.",
  "reset-2026-08-21-banked:1": "Community accounts observed that the banked reset was available. The retained slice has the delivery time but no verifiable post ID.",
  "2087423996115681767": "Promised a surprise the next day. In the prior milestone-and-reset context, this counted as a contextual but clear hint.",
  "2087706104814023111": "Named the 15M milestone and said the reset would land within the next hour.",
  "2086189414292865249": "A reply explicitly said another reset would happen on Monday. This hidden reply was a high-value advance signal.",
  "2086972933566857393": "First-party confirmation that all paid users had been reset.",
  "2085845171363791135": "“Theo needs a reset” was a pun. It proved directionally correct afterward but was not a formal schedule beforehand.",
  "2086188036493344823": "First-party confirmation of the celebration reset.",
  "2083053369351090257": "Listed resets as one of the signs. Directionally right, but without a clear schedule.",
  "2083395449814229287": "First-party confirmation of the efficiency-weekend reset.",
  "2081705220174930026": "A single community account estimated a July 29 reset. It got the date right without first-party support.",
  "2082317452755751098": "First-party confirmation of the Sol fix and reset."
};

const COMMUNITY_NOTES_EN = {
  "reset-2026-08-31-hard": "@UsageReset relayed the explicit warning only 61 seconds later; its earlier inference still came from the same first-party clue.",
  "reset-2026-08-30-hard": "@UsageReset relayed the claim about 14 hours early, but attribution to this specific event was ambiguous.",
  "reset-2026-08-28-hard": "@hqmank relayed it about eight hours early; @UsageReset posted an incoming alert after the reset and is marked stale.",
  "reset-2026-08-24-hard": "@UsageReset relayed it about 14 hours early, roughly 4.5 hours after the first-party post.",
  "reset-2026-08-21-banked": "@UsageReset did not cover it; @hqmank later supplied a delivery observation, not an advance prediction.",
  "reset-2026-08-13-hard": "@hqmank relayed it about 14 hours early; @UsageReset was not yet online.",
  "reset-2026-08-11-hard": "@hqmank quickly amplified the hidden reply about 47 hours early, its strongest community-scout example.",
  "reset-2026-08-09-hard": "Most community accounts relayed only after confirmation; the pun must not be upgraded into a schedule.",
  "reset-2026-08-01-hard": "@hqmank first relayed a July 31 reset, then guessed there would be no reset that week: useful discovery, unstable judgment.",
  "reset-2026-07-29-hard": "The community account got the date right, but without first-party evidence or a complete false-positive denominator it remains a weak-signal sample."
};

function zhTerms(value) {
  return String(value || "")
    .replace(/banked\s+reset/gi, "可储存重置")
    .replace(/hard\s+reset/gi, "全量重置")
    .replace(/full\s+reset/gi, "全量重置")
    .replace(/reset[- ]button/gi, "重置按钮")
    .replace(/\breset(?:s)?\b/gi, "重置");
}

function eventOutcome(event) {
  if (ENGLISH) return EVENT_OUTCOMES_EN[event.id] || "Confirmed reset event.";
  return zhTerms(event.outcome_summary_zh || event.confirmation?.summary_zh);
}

function nodeSummary(event, node, index) {
  if (ENGLISH) return NODE_SUMMARIES_EN[node.post_id || `${event.id}:${index}`] || "Open the original post for the full wording.";
  return zhTerms(node.summary_zh);
}

function communityNote(event) {
  if (ENGLISH) return COMMUNITY_NOTES_EN[event.id] || "Community coverage remains secondary to first-party evidence.";
  return zhTerms(event.community_note_zh);
}

const historicalRoleLabels = ENGLISH ? {
  first_party: "First party",
  scout: "Community scout",
  relay: "Relay",
  rumor: "Community rumor",
  personal_observation: "Personal report"
} : {
  first_party: "一手来源",
  scout: "社区侦察",
  relay: "转发分发",
  rumor: "社区传闻",
  personal_observation: "个人反馈"
};

const historicalStageLabels = ENGLISH ? {
  earliest_signal: "Earliest signal",
  actionable_signal: "Actionable warning",
  community_inference: "Community inference",
  relay: "Fast relay",
  official_announcement: "Official announcement",
  official_confirmation: "Official confirmation",
  verification_relay: "Confirmation relay",
  individual_observation: "Personal delivery",
  observed_delivery: "Observed delivery",
  stale_signal: "Stale alert"
} : {
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
  if (node.timing === "outcome") return ui("最终结果", "Outcome");
  if (node.timing === "after") return ui(`结果后 ${formatDuration(node.distance_minutes)}`, `${formatDuration(node.distance_minutes)} after outcome`);
  return ui(`提前 ${formatDuration(node.distance_minutes)}`, `${formatDuration(node.distance_minutes)} early`);
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
    date.append(el("span", "", event.kind === "hard_reset" ? ui("全量重置", "hard reset") : ui("可储存重置", "banked reset")));

    const headline = el("div", "timeline-headline");
    const titleRow = el("div", "timeline-title-row");
    titleRow.append(
      el("span", `pill ${event.advance_quality}`, event.advance_quality === "clear" ? ui("清楚预警", "Clear warning") : event.advance_quality === "weak" ? ui("弱暗示", "Weak hint") : ui("社区补位", "Community-only lead")),
      el("h3", "", eventOutcome(event))
    );
    headline.append(titleRow);
    if (firstNode) {
      const firstText = firstNode.timing === "before"
        ? ui(`@${firstNode.author} 最先出现 · ${timingLabel(firstNode)}`, `@${firstNode.author} appeared first · ${timingLabel(firstNode)}`)
        : ui(`@${firstNode.author} 首次记录`, `First recorded by @${firstNode.author}`);
      headline.append(el("p", "", firstText));
    }
    if (event.actionable_first_party_signal && event.earliest_first_party_signal?.post_id !== event.actionable_first_party_signal.post_id) {
      headline.append(el("small", "", ui(`真正明确的预告：提前 ${formatDuration(event.actionable_first_party_signal.lead_minutes)}`, `First truly actionable warning: ${formatDuration(event.actionable_first_party_signal.lead_minutes)} early`)));
    }
    summary.append(date, headline, el("span", "timeline-toggle", ui("查看证据时间轴", "View evidence timeline")));

    const body = el("div", "timeline-body");
    const outcome = el("div", "outcome-box");
    outcome.append(el("span", "", ui("最后结果", "Outcome")), el("strong", "", eventOutcome(event)), el("time", "", formatTime(event.outcome_at || event.confirmed_at, true)));
    body.append(outcome);

    const track = el("ol", "evidence-track");
    (event.timeline || []).forEach((node, nodeIndex) => {
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
      content.append(header, el("p", "", nodeSummary(event, node, nodeIndex)));
      if (node.url) content.append(link(ui("打开原帖 →", "Open original post →"), node.url, "node-link"));
      else content.append(el("small", "evidence-missing", ui("当前切片未保留原帖 ID；不作为强确认。", "This slice has no retained post ID, so it is not treated as strong confirmation.")));
      row.append(marker, time, content);
      track.append(row);
    });
    body.append(track);

    if (event.timeline_gaps?.length) {
      const gaps = el("div", "timeline-gaps");
      gaps.append(el("strong", "", ui("证据缺口", "Evidence gaps")));
      event.timeline_gaps.forEach((gap) => gaps.append(el("p", "", ENGLISH
        ? "Some relay or delivery timestamps could not be verified from retained post IDs, so no synthetic timeline node was added."
        : zhTerms(gap))));
      body.append(gaps);
    }
    body.append(el("p", "community-note", communityNote(event)));
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
  if (lane === "personal") return [ui("个人弱观察", "Weak personal observation"), "personal"];
  if (lane === "official" && signal.event_type === "explicit_reset") return [ui("官方确认", "Official confirmation"), "high"];
  if (lane === "official" && signal.event_type === "scheduled_reset") return [ui("明确预告", "Clear warning"), "high"];
  if (lane === "official") return [ui("一手弱暗示", "Weak first-party hint"), "medium"];
  if (lane === "relay") return [ui("同源转述", "Same-source relay"), "relay"];
  return [signal.severity === "medium" ? ui("社区交叉风声", "Corroborated chatter") : ui("单一社区风声", "Single-source chatter"), signal.severity === "medium" ? "medium" : "weak"];
}

function signalTitle(signal) {
  const lane = signalLane(signal);
  if (lane === "personal") {
    return /error|missing|lost|failed|unable|not reset|异常|消失|没到账/i.test(signal.text)
      ? ui("个人账户异常反馈", "Personal account anomaly")
      : ui("个人账户到账反馈", "Personal account delivery report");
  }
  if (lane === "relay") return signal.event_type === "community_observation" ? ui("确认后的社区转述", "Post-confirmation community relay") : ui("社区侦察 / 转发", "Community scout / relay");
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
    [String(todaySignals.length), ui("今日相关节点", "Relevant nodes today"), ui("去重后时间轴记录", "Deduplicated timeline records")],
    [String(personal), ui("个人到账 / 异常", "Personal delivery / anomaly"), ui("默认弱证据，不单独升级", "Weak by default; never upgrades alone")],
    [String(scheduled), ui("一手未来预告", "First-party future warnings"), ui("明确指向尚未发生的重置", "Clearly points to a reset not yet executed")],
    [hasCurrentGlobal ? ui("有", "Yes") : ui("无", "No"), ui("新一轮全局信号", "New global signal"), hasCurrentGlobal ? ui("请回看顶部当前判断", "See the current assessment above") : ui("个人反馈不能替代官方确认", "Personal reports cannot replace official confirmation")]
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
    container.append(el("p", "empty", ui("这个筛选下暂无节点。个人反馈为 0 时，只表示当前监控窗口没有收录，不代表所有账号都正常。", "No nodes match this filter. Zero personal reports only means none were captured in the current window; it does not prove every account is healthy.")));
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
    meta.append(
      el("span", "", ui(`信源 ${signal.source_tier}`, `Source ${signal.source_tier}`)),
      el("span", "", signal.evidence_basis === "derivative" ? ui("来自同一上游", "Same upstream source") : signal.evidence_basis === "account_observation" ? ui("个人账户观察", "Personal account observation") : ui("独立说法 / 待核验", "Independent claim / unverified"))
    );
    if (signal.url) meta.append(link(ui("打开原帖 →", "Open original post →"), signal.url));
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

const SOURCE_COPY_EN = {
  thsottiaux: {
    role: "First-party confirmation",
    reliability: "Most reliable for outcomes",
    conclusion: "Use this account to determine whether a reset actually happened: it confirmed all 10 events. Advance signals were common, but only 6 of 9 were clear enough to act on.",
    caveat: "Both posts and replies must be monitored. A weak hint is not a schedule."
  },
  hqmank: {
    role: "Community scout",
    reliability: "Often discovers signals early",
    conclusion: "Provided an earlier, plainer relay in at least 7 of 10 events. Across three samples with exact timestamps, the median lead was about 13h 43m. Hidden-reply discovery is its main value.",
    caveat: "The account has produced contradictory judgments, and many posts relay the same official clue. Relay volume is not independent confirmation."
  },
  UsageReset: {
    role: "Automated relay and delivery",
    reliability: "Useful notification backstop",
    conclusion: "Of five evaluable events since launch, three had useful early alerts. Those samples appeared about 13h 53m before confirmation. Its strength is rapid distribution, not independent discovery.",
    caveat: "It missed one event and posted one stale incoming alert. Same-source relays do not add independent credibility."
  },
  rezoundous: {
    role: "Community rumor",
    reliability: "Too little evidence to judge",
    conclusion: "One July 29 sample landed about 40h 33m early and filled a first-party warning gap.",
    caveat: "This is one event-day hit with no complete non-event false-positive denominator. It cannot be called 1/1 accurate."
  },
  kimmonismus: { role: "Community amplifier", reliability: "Watch only", conclusion: "Useful for sensing community chatter; dates, reset type, and motive claims remain unstable." },
  TokenGremlin: { role: "Community candidate", reliability: "Watch only", conclusion: "Used only to discover possibly relevant discussion; never triggers a high-confidence alert alone." },
  argofowl: { role: "Community amplifier", reliability: "Watch only", conclusion: "Can amplify news quickly, but the current sample is mostly same-source relaying." }
};

function recordedPostsLabel(source) {
  const value = source.metrics?.recorded_posts;
  if (!Number.isFinite(value)) return ui("不足", "Insufficient");
  return source.metrics.recorded_posts_qualifier?.startsWith("at_least") ? `≥${value}` : String(value);
}

function sourceQualityMetric(source) {
  const metrics = source.metrics;
  if (Number.isFinite(metrics.clear_advance_events)) return [ui("清楚预警", "Clear warnings"), `${metrics.clear_advance_events}/${metrics.evaluated_events}`];
  if (Number.isFinite(metrics.stale_events)) return [ui("漏掉 / 迟到", "Missed / stale"), `${metrics.missed_events || 0} / ${metrics.stale_events}`];
  if (Number.isFinite(metrics.contradiction_events)) return [ui("矛盾样本", "Contradictions"), String(metrics.contradiction_events)];
  return [ui("清楚预警", "Clear warnings"), ui("未完整标注", "Not fully labelled")];
}

function renderSources(scorecard) {
  const method = document.querySelector("#source-method");
  method.replaceChildren();
  method.append(
    el("strong", "", ui("先看两件不同的事", "Separate source reliability from post credibility")),
    el("p", "", ui(`${scorecard.rating_method.source_dimension_zh} ${scorecard.rating_method.content_dimension_zh}`, "Source reliability asks how close an account usually is to the facts. Content strength asks how clearly this specific post speaks.")),
    el("p", "", ui(scorecard.sample_scope.warning_zh, "These are coverage statistics inside events that happened, not prediction accuracy. Without a complete record of false alarms on non-reset days, accuracy cannot be calculated."))
  );

  const container = document.querySelector("#source-list");
  const watchContainer = document.querySelector("#watch-source-list");
  container.replaceChildren();
  watchContainer.replaceChildren();
  scorecard.sources.forEach((source) => {
    const englishCopy = SOURCE_COPY_EN[source.handle] || {};
    if (source.display_group === "watch_only") {
      const watch = el("article", "watch-source");
      watch.append(el("strong", "", `@${source.handle}`), el("span", "", ENGLISH ? englishCopy.role : source.role_label_zh), el("p", "", ENGLISH ? englishCopy.conclusion : zhTerms(source.conclusion_zh)));
      watchContainer.append(watch);
      return;
    }
    const metrics = source.metrics;
    const card = el("article", "source-card");
    const header = el("header");
    const identity = el("div");
    identity.append(el("h3", "", `@${source.handle}`), el("small", "", ENGLISH ? `${englishCopy.role} · ${englishCopy.reliability}` : `${source.role_label_zh} · ${source.reliability_label_zh}`));
    header.append(identity, el("span", `pill ${source.tier}`, source.tier));
    const stats = el("div", "source-stats");
    const [qualityLabel, qualityValue] = sourceQualityMetric(source);
    const usefulAdvanceValue = metrics.false_positive_denominator_complete === false && metrics.evaluated_events === 1
      ? ui("1 个样本", "1 sample")
      : `${metrics.useful_advance_events}/${metrics.evaluated_events}`;
    const metricRows = [
      [ui("收录信号", "Recorded signals"), recordedPostsLabel(source)],
      [ui("有用提前", "Useful advance"), usefulAdvanceValue],
      [qualityLabel, qualityValue],
      [ui("通常提前", "Typical lead"), formatDuration(metrics.median_advance_lead_minutes)]
    ];
    metricRows.forEach(([label, value]) => {
      const metric = el("div");
      metric.append(el("strong", "", value), el("span", "", label));
      stats.append(metric);
    });
    card.append(
      header,
      stats,
      el("p", "source-conclusion", ENGLISH ? englishCopy.conclusion : zhTerms(source.conclusion_zh)),
      el("p", "source-caveat", ENGLISH ? englishCopy.caveat : zhTerms(source.caveat_zh))
    );
    container.append(card);
  });
}

function renderSystem(status) {
  const container = document.querySelector("#system-grid");
  container.replaceChildren();
  const official = (status.live.sources || []).find((source) => source.name === "official-first-party") || {};
  const cards = [
    [ui("整体状态", "Overall status"), status.live.overall === "healthy" ? ui("正常", "Healthy") : status.live.overall === "initializing" ? ui("初始化", "Initializing") : ui("需关注", "Needs attention"), PAGES_SNAPSHOT ? ui(`备用页面约每 10 分钟同步；实时源每 ${status.live.expected_poll_seconds || 120} 秒检查`, `Fallback page syncs about every 10 minutes; live source checks every ${status.live.expected_poll_seconds || 120} seconds`) : ui(`官方源每 ${status.live.expected_poll_seconds || 120} 秒检查`, `First-party source checks every ${status.live.expected_poll_seconds || 120} seconds`)],
    [ui("官方源最后成功", "Last first-party success"), official.last_success_at ? formatTime(official.last_success_at, true) : ui("尚未成功", "No success yet"), official.last_error || ui("没有记录错误", "No recorded error")],
    [ui("邮件提醒", "Email alerts"), status.live.email.configured ? ui("已启用", "Enabled") : ui("未配置", "Not configured"), status.live.email.configured ? ui(`最低 ${status.live.email.minimum_severity} 才发送`, `Sends at ${status.live.email.minimum_severity} severity or above`) : ui("补收件人、发件域名和 Resend Secret 后启用", "Add recipient, verified sender domain, and Resend secret to enable")],
    [ui("实时记录", "Live records"), ui(`${(status.live.signals || []).length} 条`, `${(status.live.signals || []).length} items`), ui("页面显示最近 100 条有效信号", "The page shows the latest 100 valid signals")]
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
    document.querySelector("#health-label").textContent = ui("页面无法读取监控 API", "The page cannot read the monitoring API");
    const card = document.querySelector("#current-card");
    card.className = "current-card high";
    card.replaceChildren(el("div", "", PAGES_SNAPSHOT ? ui("备用快照加载失败。请稍后刷新。", "Fallback snapshot failed to load. Refresh in a moment.") : ui("加载失败。请稍后刷新，或查看 /healthz。", "Loading failed. Refresh in a moment or check /healthz.")));
    const clock = document.querySelector("#reset-clock");
    clock.className = "reset-clock error";
    document.querySelector("#reset-clock-value").textContent = ui("计时不可用", "Clock unavailable");
    document.querySelector("#reset-clock-anchor").textContent = ui("历史记录未能加载", "History could not be loaded");
  }
}

load();
