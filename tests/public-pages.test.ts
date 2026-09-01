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
    }
  });

  it("renders the cadence context on both pages", () => {
    for (const page of [chinese, english]) {
      expect(page).toContain('id="reset-clock-phase"');
      expect(page).toContain('id="reset-clock-progress"');
      expect(page).toContain('id="reset-progress-fill"');
      expect(page).toContain('id="reset-clock-context"');
    }
    expect(app).toContain("cadence context, not a forecast");
    expect(app).toContain("只作节奏参照，不预测下次重置");
  });

  it("derives a stable historical median hard-reset gap", () => {
    const outcomes = history.events
      .filter((event) => event.kind === "hard_reset")
      .map((event) => Date.parse(event.outcome_at))
      .sort((left, right) => left - right);
    const gaps = outcomes.slice(1).map((timestamp, index) => timestamp - outcomes[index]!).sort((left, right) => left - right);
    const middle = gaps.length / 2;
    const medianHours = (gaps[middle - 1]! + gaps[middle]!) / 2 / 3_600_000;
    expect(medianHours).toBeCloseTo(61.77, 1);
  });
});
