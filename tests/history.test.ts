import { describe, expect, it } from "vitest";
import history from "../data/reset-events.json";
import scorecard from "../data/source-scorecard.json";

describe("historical audit", () => {
  it("contains twelve individually linked reset records", () => {
    expect(history.events).toHaveLength(12);
    expect(new Set(history.events.map((event) => event.id)).size).toBe(12);
    for (const event of history.events) {
      expect(event.confirmation.url).toMatch(/^https:\/\/x\.com\/thsottiaux\/status\/\d+$/);
      expect(event.confirmation.post_id).toMatch(/^\d+$/);
    }
  });

  it("reproduces the published 12/12, 11/12, 8/12, 3/12, 1/12 conclusions", () => {
    const events = history.events;
    expect(events.filter((event) => event.confirmation).length).toBe(12);
    expect(events.filter((event) => event.earliest_first_party_signal).length).toBe(11);
    expect(events.filter((event) => event.advance_quality === "clear").length).toBe(8);
    expect(events.filter((event) => event.advance_quality === "weak").length).toBe(3);
    expect(events.filter((event) => event.advance_quality === "none").length).toBe(1);
  });

  it("does not upgrade the single community-only recall to first-party evidence", () => {
    const communityOnly = history.events.find((event) => event.advance_quality === "none");
    expect(communityOnly?.earliest_first_party_signal).toBeNull();
    expect(communityOnly?.community_signal?.quality).toBe("single-account-low-confidence");
    expect(communityOnly?.community_signal?.post_id).toBe("2081705220174930026");
  });

  it("keeps banked reset distinct", () => {
    expect(history.events.filter((event) => event.kind === "banked_reset")).toHaveLength(3);
    expect(history.events.slice(0, 2).every((event) => event.kind === "banked_reset")).toBe(true);
    expect(history.events[0]?.timeline.at(-1)?.post_id).toBe("2096045774505136257");
    expect(history.events[1]?.timeline.at(-1)?.post_id).toBe("2095730340065317303");
  });

  it("keeps every event timeline chronological and tied to an outcome", () => {
    for (const event of history.events) {
      expect(event.timeline.length).toBeGreaterThanOrEqual(2);
      const timestamps = event.timeline.map((node) => Date.parse(node.published_at));
      expect(timestamps.every(Number.isFinite)).toBe(true);
      expect(timestamps).toEqual([...timestamps].sort((left, right) => left - right));
      expect(event.timeline.some((node) => node.timing === "outcome")).toBe(true);
      expect(Date.parse(event.outcome_at)).toBeGreaterThan(0);
    }
  });

  it("keeps personal account observations weak and separate from global confirmation", () => {
    const personalNodes = history.events
      .flatMap((event) => event.timeline.map((node) => ({
        role: node.role,
        stage: node.stage,
        evidenceRelation: node.evidence_relation,
        signalQuality: node.signal_quality
      })))
      .filter((node) => node.role === "personal_observation");
    expect(personalNodes.length).toBeGreaterThan(0);
    expect(personalNodes.every((node) => node.evidenceRelation === "observation")).toBe(true);
    expect(personalNodes.every((node) => node.signalQuality === "weak_observation")).toBe(true);
    expect(personalNodes.some((node) => node.stage === "official_confirmation")).toBe(false);
  });

  it("publishes event coverage and lead-time samples without claiming prediction accuracy", () => {
    expect(scorecard.sample_scope.unit).toContain("confirmed reset event");
    expect(scorecard.warning.toLowerCase()).toContain("no prediction precision");
    expect(JSON.stringify(scorecard).toLowerCase()).not.toContain('"accuracy"');
    const firstParty = scorecard.sources.find((source) => source.handle === "thsottiaux");
    expect(firstParty?.metrics?.confirmed_events).toBe(12);
    expect(firstParty?.metrics?.median_advance_lead_minutes).toBe(1115);
    const relay = scorecard.sources.find((source) => source.handle === "UsageReset");
    expect(relay?.metrics?.stale_events).toBe(1);
  });
});
