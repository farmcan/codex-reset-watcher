import { describe, expect, it } from "vitest";
import { QUERY_SPECS, sourceProfile } from "../src/config";
import { severityAtLeast } from "../src/notifications";

describe("monitor configuration", () => {
  it("only polls Tibo once per hour", () => {
    expect(QUERY_SPECS).toHaveLength(1);
    expect(QUERY_SPECS[0]?.name).toBe("official-first-party");
    expect(QUERY_SPECS[0]?.pollSeconds).toBe(3600);
    expect(QUERY_SPECS[0]?.query).toContain("from:thsottiaux ");
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
