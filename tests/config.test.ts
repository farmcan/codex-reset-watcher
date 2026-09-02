import { describe, expect, it } from "vitest";
import { QUERY_SPECS, sourceProfile } from "../src/config";
import { severityAtLeast } from "../src/notifications";

describe("monitor configuration", () => {
  it("polls first-party X faster than community discovery", () => {
    const official = QUERY_SPECS.find((spec) => spec.lane === "official");
    const discovery = QUERY_SPECS.find((spec) => spec.lane === "discovery");
    expect(official?.pollSeconds).toBe(3600);
    expect(discovery?.pollSeconds).toBe(3600);
    expect(new Set(QUERY_SPECS.map((spec) => spec.pollSeconds))).toEqual(new Set([3600]));
  });

  it("requires canonical first-party author on the primary query", () => {
    expect(QUERY_SPECS[0]?.allowedAuthors).toEqual(["thsottiaux"]);
    expect(sourceProfile("@thsottiaux").tier).toBe("A1");
  });

  it("supports a severity threshold for email routing", () => {
    expect(severityAtLeast("high", "medium")).toBe(true);
    expect(severityAtLeast("medium", "medium")).toBe(true);
    expect(severityAtLeast("low", "medium")).toBe(false);
  });
});
