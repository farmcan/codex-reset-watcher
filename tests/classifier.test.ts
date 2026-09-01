import { describe, expect, it } from "vitest";
import { classifyPost, isRelevant } from "../src/classifier";
import type { RawPost } from "../src/types";

function post(overrides: Partial<RawPost> = {}): RawPost {
  return {
    postId: "1",
    author: "thsottiaux",
    text: "We will reset Codex usage limits tomorrow",
    createdAt: "2026-08-30T00:00:00Z",
    url: "https://x.com/thsottiaux/status/1",
    lane: "official",
    sourceTier: "A1",
    sourceWeight: 1,
    referencedPostIds: [],
    referencedAuthors: [],
    linkedUrls: [],
    raw: {},
    ...overrides
  };
}

describe("classifyPost", () => {
  it("marks a clear first-party future hard reset as high severity", () => {
    const signal = classifyPost(post());
    expect(signal.eventType).toBe("scheduled_reset");
    expect(signal.resetMode).toBe("hard_reset");
    expect(signal.severity).toBe("high");
    expect(signal.shouldNotify).toBe(true);
    expect(signal.evidenceBasis).toBe("first_party");
  });

  it("separates a confirmed reset from an upcoming reset", () => {
    const signal = classifyPost(post({ text: "Codex usage limits have been reset for all paid users" }));
    expect(signal.eventType).toBe("explicit_reset");
    expect(signal.resetMode).toBe("hard_reset");
  });

  it("separates banked reset from hard reset", () => {
    const signal = classifyPost(post({ text: "A banked reset for Codex will land later today" }));
    expect(signal.eventType).toBe("scheduled_reset");
    expect(signal.resetMode).toBe("banked_reset");
    expect(signal.severity).toBe("medium");
  });

  it("keeps historical euphemisms low confidence", () => {
    const signal = classifyPost(post({ text: "Codex milestone reached. You know what's coming: reset button." }));
    expect(signal.eventType).toBe("weak_hint");
    expect(signal.severity).toBe("low");
  });

  it("filters explicit negations", () => {
    const signal = classifyPost(post({ text: "No reset planned for Codex usage limits tomorrow" }));
    expect(isRelevant(signal)).toBe(false);
    expect(signal.shouldNotify).toBe(false);
  });

  it("does not treat an ordinary account observation as a global event", () => {
    const signal = classifyPost(post({
      author: "someone",
      lane: "discovery",
      sourceTier: "D",
      sourceWeight: 0.15,
      text: "My account just hit 100%, I got the Codex reset"
    }));
    expect(signal.eventType).toBe("community_observation");
    expect(signal.shouldNotify).toBe(false);
  });

  it("inhibits a community relay of the same first-party post", () => {
    const signal = classifyPost(post({
      author: "UsageReset",
      lane: "scout",
      sourceTier: "B",
      sourceWeight: 0.62,
      text: "Codex usage limits will reset tomorrow",
      referencedAuthors: ["thsottiaux"],
      referencedPostIds: ["official-1"]
    }));
    expect(signal.eventType).toBe("community_rumor");
    expect(signal.evidenceBasis).toBe("derivative");
    expect(signal.severity).toBe("none");
    expect(signal.shouldNotify).toBe(false);
  });

  it("keeps an independent scout rumor low until corroborated", () => {
    const signal = classifyPost(post({
      author: "hqmank",
      lane: "scout",
      sourceTier: "B",
      sourceWeight: 0.72,
      text: "I estimate the next Codex reset will take place tomorrow"
    }));
    expect(signal.eventType).toBe("community_rumor");
    expect(signal.evidenceBasis).toBe("independent_rumor");
    expect(signal.severity).toBe("low");
  });

  it("does not directly notify from the broad discovery pool", () => {
    const signal = classifyPost(post({
      author: "random",
      lane: "discovery",
      sourceTier: "D",
      sourceWeight: 0.15,
      text: "Codex usage limits will reset tomorrow"
    }));
    expect(signal.eventType).toBe("community_rumor");
    expect(signal.shouldNotify).toBe(false);
  });

  it("treats a community recap as an observation, not an upcoming rumor", () => {
    const signal = classifyPost(post({
      author: "someone",
      lane: "discovery",
      sourceTier: "D",
      sourceWeight: 0.15,
      text: "Codex hit a milestone, so they reset usage for every paid subscription"
    }));
    expect(signal.eventType).toBe("community_observation");
    expect(signal.severity).toBe("none");
    expect(signal.shouldNotify).toBe(false);
  });

  it("requires future intent before calling community text a rumor", () => {
    const signal = classifyPost(post({
      author: "rezoundous",
      lane: "rumor",
      sourceTier: "C",
      sourceWeight: 0.42,
      text: "Codex usage limits reset yesterday"
    }));
    expect(signal.eventType).not.toBe("community_rumor");
    expect(signal.shouldNotify).toBe(false);
  });

  it("does not turn a hoped-for limit change into a future reset rumor", () => {
    const signal = classifyPost(post({
      author: "TokenGremlin",
      lane: "rumor",
      sourceTier: "C",
      sourceWeight: 0.38,
      text: "An OpenAI usage reset does not feel like a gift while the weekly Codex limits stay low. I really hope this changes soon."
    }));
    expect(signal.eventType).not.toBe("community_rumor");
    expect(signal.shouldNotify).toBe(false);
  });
});
