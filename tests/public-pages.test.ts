import { describe, expect, it } from "vitest";
import history from "../data/reset-events.json";
import app from "../public/app.js?raw";
import english from "../public/en/index.html?raw";
import chinese from "../public/index.html?raw";

describe("public bilingual dashboard", () => {
  it("keeps the requested homepage copy and language switches", () => {
    expect(chinese).toContain("找到重置机会，<br>站起来猛蹬。");
    expect(chinese).not.toContain("找到 Reset 机会");
    expect(chinese).toContain('href="en/"');
    expect(english).toContain("Catch the Reset window.<br>Crack the whip.");
    expect(english).toContain('href="../" lang="zh-CN"');
    for (const page of [chinese, english]) {
      expect(page).toContain('class="github-star"');
      expect(page).toContain('href="https://github.com/farmcan/codex-reset-watcher"');
      expect(page).toContain("GitHub Star");
      expect(page).toContain('href="https://chatgpt.com/codex/settings/usage"');
      expect(page).toContain('target="_blank" rel="noreferrer noopener"');
    }
    expect(chinese).toContain("查看我的 Codex 额度");
    expect(english).toContain("Check my Codex usage");
    expect(chinese).toContain('class="hero-visual"');
    expect(chinese).toContain('src="brand-zh.png"');
    expect(english).toContain('class="hero-visual"');
    expect(english).toContain('src="../brand-en.png"');
    expect(chinese).toContain("距离上次已确认重置权益的时间");
    expect(english).toContain("Time since the last confirmed reset benefit");
  });

  it("renders the cadence context on both pages", () => {
    for (const page of [chinese, english]) {
      expect(page).toContain('id="reset-clock-phase"');
      expect(page).toContain('id="reset-clock-progress"');
      expect(page).toContain('id="reset-progress-fill"');
      expect(page).toContain('id="reset-clock-context"');
    }
    expect(app).toContain("context, not a forecast");
    expect(app).toContain("不预测下次重置");
  });

  it("keeps an open dashboard synchronized with live status", () => {
    expect(app).toContain("const LIVE_REFRESH_MS = 60_000");
    expect(app).toContain("async function refreshLive()");
    expect(app).toContain('document.addEventListener("visibilitychange"');
    expect(app).toContain("最近轮询");
    expect(app).toContain("Auto-refresh failed · showing last data");
    expect(app).toContain('signal.evidence_basis === "account_observation" || personalSignal(signal)');
  });

  it("derives a stable historical median across all reset benefits", () => {
    const outcomes = history.events
      .map((event) => Date.parse(event.outcome_at))
      .sort((left, right) => left - right);
    const gaps = outcomes.slice(1).map((timestamp, index) => timestamp - outcomes[index]!).sort((left, right) => left - right);
    const middle = Math.floor(gaps.length / 2);
    const median = gaps.length % 2 ? gaps[middle]! : (gaps[middle - 1]! + gaps[middle]!) / 2;
    const medianHours = median / 3_600_000;
    expect(medianHours).toBeCloseTo(52.14, 1);
  });
});
