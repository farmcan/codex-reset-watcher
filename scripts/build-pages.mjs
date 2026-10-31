#!/usr/bin/env node

import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const origin = (process.env.WATCHER_ORIGIN || "https://codex-reset-watcher.weican16hit.workers.dev").replace(/\/$/, "");
const output = ".pages-dist";
const snapshotDir = join(output, "snapshots");

async function fetchBody(path) {
  const response = await fetch(`${origin}${path}`, {
    headers: { "User-Agent": "codex-reset-watcher-pages-snapshot/1.0" },
    signal: AbortSignal.timeout(20_000)
  });
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return response.text();
}

await rm(output, { recursive: true, force: true });
await cp("public", output, { recursive: true });
await mkdir(snapshotDir, { recursive: true });

const snapshots = ["status", "history", "sources", "events"];
await Promise.all(snapshots.map(async (name) => {
  const body = await fetchBody(`/api/${name}`);
  JSON.parse(body);
  await writeFile(join(snapshotDir, `${name}.json`), `${body.trim()}\n`);
}));

await writeFile(join(output, "feed.xml"), await fetchBody("/feed.xml"));
await writeFile(join(output, ".nojekyll"), "");

console.log(`Built GitHub Pages snapshot from ${origin}`);
