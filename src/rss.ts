import type { Env } from "./types";

function xmlEscape(value: unknown): string {
  return String(value ?? "").replace(/[<>&"']/g, (character) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    '"': "&quot;",
    "'": "&apos;"
  })[character] ?? character);
}

export async function buildRss(env: Env, origin: string): Promise<Response> {
  const { results } = await env.DB.prepare(`
    SELECT s.signal_id, s.event_type, s.reset_mode, s.severity, s.confidence,
      s.reason, s.created_at, p.author, p.text, p.url
    FROM signals s JOIN posts p ON p.post_id = s.post_id
    WHERE s.event_type NOT IN ('unrelated', 'community_observation')
      AND s.severity != 'none'
      AND s.superseded_by_post_id IS NULL
      AND p.source_tier != 'D'
    ORDER BY s.created_at DESC LIMIT 50
  `).all<Record<string, unknown>>();
  const items = results.map((row) => `
    <item>
      <guid isPermaLink="false">${xmlEscape(row.signal_id)}</guid>
      <title>${xmlEscape(`${row.severity === "high" ? "高" : row.severity === "medium" ? "中" : "低"} · ${row.event_type} · @${row.author}`)}</title>
      <link>${xmlEscape(row.url)}</link>
      <pubDate>${new Date(String(row.created_at)).toUTCString()}</pubDate>
      <description>${xmlEscape(`${row.reason}\n\n${row.text}`)}</description>
    </item>`).join("");
  const body = `<?xml version="1.0" encoding="UTF-8" ?>
  <rss version="2.0"><channel>
    <title>Codex Reset Watcher</title>
    <link>${xmlEscape(origin)}</link>
    <description>Unofficial, evidence-first public Codex reset signals from X.</description>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>${items}
  </channel></rss>`;
  return new Response(body, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=60"
    }
  });
}
