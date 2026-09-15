import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { dashboardData, getDueSourceStates, markSourceFailure } from "../src/db";

const databases = [];
afterEach(() => databases.splice(0).forEach((sqlite) => sqlite.close()));

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  databases.push(sqlite);
  for (const name of ["0001_initial.sql", "0002_model_reviews.sql"]) {
    sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  }
  const prepare = (sql, params = []) => ({
    bind: (...values) => prepare(sql, values),
    run: async () => ({ meta: sqlite.prepare(sql).run(...params) }),
    all: async () => ({ results: sqlite.prepare(sql).all(...params) })
  });
  const db = {
    prepare,
    batch: async (statements) => Promise.all(statements.map((statement) => statement.all()))
  };
  const insert = sqlite.prepare("INSERT INTO source_state (name,lane,query,poll_seconds,since_id) VALUES (?,?,?,3600,?)");
  for (const [name, lane] of [["official-first-party", "official"], ["community-scouts", "scout"], ["known-rumor-accounts", "rumor"], ["discovery-pool", "discovery"]]) {
    insert.run(name, lane, "old query", "2098685367058612394");
  }
  return { sqlite, db };
}

describe("Tibo-only polling with existing production state", () => {
  it("never schedules retired sources and preserves their history and cursors", async () => {
    const { sqlite, db } = fixture();
    const states = await getDueSourceStates(db, "2026-09-15T14:00:00.000Z");
    expect(states.map((state) => state.name)).toEqual(["official-first-party"]);
    expect(states[0]?.since_id).toBe("2098685367058612394");
    expect(sqlite.prepare("SELECT count(*) AS n FROM source_state").get()?.n).toBe(4);
    const data = await dashboardData(db);
    const sources = data.sources;
    expect(sources.filter((source) => source.enabled).map((source) => source.name)).toEqual(["official-first-party"]);
  });

  it("does not poll sooner after failure and respects the next scheduled time", async () => {
    const { db } = fixture();
    const now = "2026-09-15T14:00:00.000Z";
    const state = (await getDueSourceStates(db, now))[0];
    await markSourceFailure(db, state, now, "X API 402");
    expect(await getDueSourceStates(db, "2026-09-15T14:30:00.000Z")).toEqual([]);
    const next = await getDueSourceStates(db, "2026-09-15T15:00:00.000Z");
    expect(next).toHaveLength(1);
    expect(next[0]?.since_id).toBe(state.since_id);
    expect(next[0]?.consecutive_failures).toBe(1);
  });
});
