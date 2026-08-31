import { sourceProfile } from "./config";
import type { QuerySpec, RawPost, XFetchResult } from "./types";

interface XUser { id: string; username?: string; }
interface XTweet {
  id: string;
  text: string;
  created_at: string;
  author_id?: string;
  note_tweet?: { text?: string };
  referenced_tweets?: Array<{ id: string; type: string }>;
  entities?: { urls?: Array<{ expanded_url?: string; unwound_url?: string }> };
}
interface XPayload {
  data?: XTweet[];
  includes?: { users?: XUser[]; tweets?: XTweet[] };
  meta?: { newest_id?: string; result_count?: number };
  errors?: Array<{ title?: string; detail?: string }>;
}

export class XApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly retryAfter: string | null = null) {
    super(message);
  }
}

export async function fetchXQuery(spec: QuerySpec, bearerToken: string, sinceId?: string | null): Promise<XFetchResult> {
  const url = new URL("https://api.x.com/2/tweets/search/recent");
  url.searchParams.set("query", spec.query);
  url.searchParams.set("max_results", String(spec.maxResults));
  url.searchParams.set("tweet.fields", "created_at,author_id,conversation_id,note_tweet,entities,referenced_tweets,public_metrics");
  url.searchParams.set("expansions", "author_id,referenced_tweets.id,referenced_tweets.id.author_id");
  url.searchParams.set("user.fields", "username,name,verified,verified_type");
  if (sinceId) url.searchParams.set("since_id", sinceId);

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${bearerToken}` },
    signal: AbortSignal.timeout(25_000)
  });
  const payload = await response.json<XPayload>().catch(() => ({} as XPayload));
  if (!response.ok) {
    const detail = payload.errors?.map((error) => error.detail || error.title).filter(Boolean).join("; ");
    throw new XApiError(`X API ${response.status}${detail ? `: ${detail}` : ""}`, response.status, response.headers.get("retry-after"));
  }

  const users = new Map((payload.includes?.users ?? []).map((user) => [String(user.id), user]));
  const referenced = new Map((payload.includes?.tweets ?? []).map((tweet) => [String(tweet.id), tweet]));
  const allowed = spec.allowedAuthors?.map((author) => author.toLowerCase()) ?? null;
  const posts: RawPost[] = [];

  for (const row of payload.data ?? []) {
    const author = users.get(String(row.author_id ?? ""))?.username ?? String(row.author_id ?? "unknown");
    if (allowed && !allowed.includes(author.toLowerCase())) continue;
    const references = row.referenced_tweets ?? [];
    const referencedAuthors = references
      .map((reference) => referenced.get(reference.id)?.author_id)
      .map((authorId) => users.get(String(authorId ?? ""))?.username)
      .filter((value): value is string => Boolean(value));
    const linkedUrls = (row.entities?.urls ?? [])
      .map((entry) => entry.unwound_url || entry.expanded_url)
      .filter((value): value is string => Boolean(value));
    const profile = sourceProfile(author);
    posts.push({
      postId: String(row.id),
      author,
      text: row.note_tweet?.text || row.text,
      createdAt: row.created_at,
      url: `https://x.com/${author}/status/${row.id}`,
      lane: spec.lane,
      sourceTier: profile.tier,
      sourceWeight: profile.weight,
      referencedPostIds: references.map((reference) => String(reference.id)),
      referencedAuthors,
      linkedUrls,
      raw: row
    });
  }

  return {
    posts,
    newestId: payload.meta?.newest_id ?? (posts.length ? posts.map((post) => post.postId).sort().at(-1) ?? null : null),
    resultCount: payload.meta?.result_count ?? posts.length
  };
}
