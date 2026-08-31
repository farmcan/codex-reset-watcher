export type Lane = "official" | "scout" | "rumor" | "discovery";
export type SourceTier = "A1" | "A2" | "B" | "C" | "D";
export type Severity = "none" | "low" | "medium" | "high";
export type EventType =
  | "explicit_reset"
  | "scheduled_reset"
  | "weak_hint"
  | "rate_limit_change"
  | "community_rumor"
  | "community_observation"
  | "unrelated";
export type ResetMode = "hard_reset" | "banked_reset" | "unknown" | "not_applicable";
export type EvidenceBasis =
  | "first_party"
  | "derivative"
  | "independent_rumor"
  | "account_observation"
  | "unknown";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ENVIRONMENT: string;
  PUBLIC_TIMEZONE: string;
  EMAIL_PROVIDER: string;
  EMAIL_MIN_SEVERITY: Severity;
  X_BEARER_TOKEN?: string;
  ADMIN_TOKEN?: string;
  RESEND_API_KEY?: string;
  ALERT_EMAIL_FROM?: string;
  ALERT_EMAIL_TO?: string;
}

export interface QuerySpec {
  name: string;
  lane: Lane;
  pollSeconds: number;
  maxResults: number;
  query: string;
  allowedAuthors?: string[];
}

export interface SourceProfile {
  tier: SourceTier;
  weight: number;
  role: "first_party" | "official" | "scout" | "relay" | "rumor" | "discovery";
}

export interface RawPost {
  postId: string;
  author: string;
  text: string;
  createdAt: string;
  url: string;
  lane: Lane;
  sourceTier: SourceTier;
  sourceWeight: number;
  referencedPostIds: string[];
  referencedAuthors: string[];
  linkedUrls: string[];
  raw: unknown;
}

export interface Signal {
  signalId: string;
  postId: string;
  eventType: EventType;
  resetMode: ResetMode;
  severity: Severity;
  confidence: number;
  contentConfidence: number;
  evidenceBasis: EvidenceBasis;
  effectiveTime: string | null;
  approximateTime: boolean;
  clusterKey: string;
  supersededByPostId: string | null;
  shouldNotify: boolean;
  reason: string;
  evidence: string[];
  createdAt: string;
}

export interface XFetchResult {
  posts: RawPost[];
  newestId: string | null;
  resultCount: number;
}

export interface SourceStateRow {
  name: string;
  lane: Lane;
  query: string;
  poll_seconds: number;
  since_id: string | null;
  primed_at: string | null;
  last_attempt_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  consecutive_failures: number;
  next_poll_at: string | null;
}

export interface PollSummary {
  status: "success" | "partial" | "failed" | "skipped";
  startedAt: string;
  finishedAt: string;
  queryNames: string[];
  fetchedCount: number;
  insertedCount: number;
  relevantCount: number;
  notifiedCount: number;
  errors: string[];
}
