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

describe('reset event boundaries', () => {
  const group = new Function(app.slice(app.indexOf('function groupResetSignals('), app.indexOf('const eventOpenState')) + '; return groupResetSignals;')();
  const signal = (post_id: string, created_at: string, extra: Record<string, unknown> = {}) => ({post_id,created_at,event_type:'scheduled_reset',reset_mode:'hard_reset',source_tier:'A1', ...extra});
  it('separates two reset announcements and attaches a referenced report', () => {
    const a=signal('a','2026-09-07T10:00:00Z',{effective_time:'2026-09-07T12:00:00Z'});
    const b=signal('b','2026-09-08T10:00:00Z',{effective_time:'2026-09-08T12:00:00Z'});
    const report=signal('c','2026-09-08T12:20:00Z',{source_tier:'D',event_type:'community_observation',referenced_post_ids:'["b"]'});
    const groups=group([report,b,a]);
    expect(groups).toHaveLength(2);
    expect(groups[0].signals.map((s: {post_id:string})=>s.post_id)).toContain('c');
    expect(groups[0].signals.map((s: {post_id:string})=>s.post_id)).not.toContain('a');
  });
  it('does not merge banked resets with hard resets',()=>{
    expect(group([signal('a','2026-09-08T10:00:00Z'),signal('b','2026-09-08T10:10:00Z',{reset_mode:'banked_reset'})])).toHaveLength(2);
  });
  it('leaves ambiguous reports unassigned',()=>{
    const groups=group([signal('a','2026-09-08T02:00:00Z'),signal('b','2026-09-08T10:00:00Z'),signal('c','2026-09-08T06:00:00Z',{source_tier:'D',event_type:'community_observation'})]);
    expect(groups.some((g:{id:string,signals:Array<{post_id:string}>})=>g.id.startsWith('unassigned:')&&g.signals.some(s=>s.post_id==='c'))).toBe(true);
  });
});

it('keeps an official event anchor visible during a flood of delivery reports',()=>{
  const select=new Function('monitorRelevant',app.slice(app.indexOf('function monitorSignals('),app.indexOf('function signalLevel('))+'; return monitorSignals;')(()=>true);
  const signals=Array.from({length:80},(_,i)=>({post_id:String(i),created_at:'2026-09-08T02:00:00Z',source_tier:'D'}));
  signals.push({post_id:'official',created_at:'2026-09-07T19:24:57Z',source_tier:'A1'});
  expect(select({live:{signals}}).some((s:{post_id:string})=>s.post_id==='official')).toBe(true);
});
