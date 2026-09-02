import type { QuerySpec, SourceProfile, SourceTier } from "./types";

export const QUERY_SPECS: QuerySpec[] = [
  {
    name: "official-first-party",
    lane: "official",
    pollSeconds: 3600,
    maxResults: 50,
    allowedAuthors: ["thsottiaux"],
    query:
      'from:thsottiaux (Codex OR "ChatGPT Work" OR tokens OR milestone OR banked OR "rate limits" OR "usage limits" OR "reset button" OR reset OR "you know what\'s coming") -is:retweet'
  },
  {
    name: "community-scouts",
    lane: "scout",
    pollSeconds: 3600,
    maxResults: 50,
    allowedAuthors: ["UsageReset", "hqmank"],
    query:
      '(from:UsageReset OR from:hqmank) (Codex OR "ChatGPT Work" OR reset OR tokens OR limits OR quota) -is:retweet'
  },
  {
    name: "known-rumor-accounts",
    lane: "rumor",
    pollSeconds: 3600,
    maxResults: 50,
    allowedAuthors: ["kimmonismus", "rezoundous", "TokenGremlin", "argofowl"],
    query:
      '(from:kimmonismus OR from:rezoundous OR from:TokenGremlin OR from:argofowl) (Codex OR "ChatGPT Work" OR reset OR tokens OR limits OR quota) -is:retweet'
  },
  {
    name: "discovery-pool",
    lane: "discovery",
    pollSeconds: 3600,
    maxResults: 100,
    query:
      '(Codex OR "ChatGPT Work") (reset OR "usage limits" OR "rate limits" OR quota OR tokens OR allowance) -is:retweet -is:reply lang:en'
  }
];

const PROFILES: Record<string, SourceProfile> = {
  thsottiaux: { tier: "A1", weight: 1, role: "first_party" },
  openai: { tier: "A2", weight: 0.9, role: "official" },
  openaidevs: { tier: "A2", weight: 0.9, role: "official" },
  hqmank: { tier: "B", weight: 0.72, role: "scout" },
  usagereset: { tier: "B", weight: 0.62, role: "relay" },
  rezoundous: { tier: "C", weight: 0.42, role: "rumor" },
  kimmonismus: { tier: "C", weight: 0.4, role: "rumor" },
  tokengremlin: { tier: "C", weight: 0.38, role: "rumor" },
  argofowl: { tier: "C", weight: 0.38, role: "rumor" }
};

export const DEFAULT_PROFILE: SourceProfile = { tier: "D", weight: 0.15, role: "discovery" };

export function sourceProfile(author: string): SourceProfile {
  return PROFILES[author.toLowerCase().replace(/^@/, "")] ?? DEFAULT_PROFILE;
}

export function sourceTierRank(tier: SourceTier): number {
  return { A1: 5, A2: 4, B: 3, C: 2, D: 1 }[tier];
}

export const SEVERITY_RANK = { none: 0, low: 1, medium: 2, high: 3 } as const;
