import { describe, expect, it } from "vitest";
import history from "../data/reset-events.json";

describe("historical audit", () => {
  it("contains exactly ten individually linked reset records", () => {
    expect(history.events).toHaveLength(10);
    expect(new Set(history.events.map((event) => event.id)).size).toBe(10);
    for (const event of history.events) {
      expect(event.confirmation.url).toMatch(/^https:\/\/x\.com\/thsottiaux\/status\/\d+$/);
      expect(event.confirmation.post_id).toMatch(/^\d+$/);
    }
  });

  it("reproduces the published 10/10, 9/10, 6/10, 3/10, 1/10 conclusions", () => {
    const events = history.events;
    expect(events.filter((event) => event.confirmation).length).toBe(10);
    expect(events.filter((event) => event.earliest_first_party_signal).length).toBe(9);
    expect(events.filter((event) => event.advance_quality === "clear").length).toBe(6);
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
    expect(history.events.filter((event) => event.kind === "banked_reset")).toHaveLength(1);
  });
});
