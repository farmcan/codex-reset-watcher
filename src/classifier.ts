import type { EvidenceBasis, EventType, RawPost, ResetMode, Severity, Signal } from "./types";

const CONTEXT = ["codex", "chatgpt work", "usage limit", "usage limits", "rate limit", "quota", "allowance", "tokens"];
const EXPLICIT = [
  "will reset",
  "going to reset",
  "about to reset",
  "resetting usage",
  "reset usage",
  "full reset",
  "brand new usage",
  "reset will land",
  "reset has been propagated"
];
const COMPLETE = [
  "have now reset",
  "has been reset",
  "have been reset",
  "we've reset",
  "we have reset",
  "limits are reset",
  "brand new usage",
  "reset has been propagated",
  "just reset"
];
const FUTURE = [
  "later today",
  "this evening",
  "tonight",
  "tomorrow",
  "next hour",
  "in the next hour",
  "in a few hours",
  "soon",
  "this week",
  "coming on",
  "will take place"
];
const WEAK_HINTS = [
  "reset button",
  "you know what's coming",
  "needs a reset",
  "need a reset",
  "tomorrow surprise",
  "surprise tomorrow",
  "milestone"
];
const NEGATIONS = [
  "no reset",
  "not a reset",
  "isn't a reset",
  "is not a reset",
  "won't reset",
  "will not reset",
  "not planned",
  "probably no reset",
  "no reset coming"
];
const EXCLUSIONS = ["git reset", "password reset", "reset config", "reset cache", "database reset", "workspace reset"];
const OBSERVATIONS = ["my account", "for me", "mine reset", "i got the reset", "just hit my account", "went from 99% to 100%"];
const WISHES = ["please give us a reset", "please drop a banked reset", "i'd take a banked reset", "i would take a banked reset"];

function normalize(value: string): string {
  return value.toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, " ").trim();
}

function matches(text: string, phrases: string[]): string[] {
  return phrases.filter((phrase) => text.includes(phrase));
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(3))));
}

function inferEffectiveTime(text: string, createdAt: string): { at: string | null; approximate: boolean } {
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created)) return { at: null, approximate: false };
  const addHours = (hours: number) => ({ at: new Date(created + hours * 3_600_000).toISOString(), approximate: true });
  if (text.includes("next hour") || text.includes("in the next hour")) return addHours(1);
  if (text.includes("later today") || text.includes("tonight") || text.includes("this evening")) return addHours(8);
  if (text.includes("tomorrow")) return addHours(24);
  if (text.includes("soon")) return addHours(6);
  if (text.includes("this week")) return addHours(72);
  return { at: null, approximate: false };
}

function evidenceBasis(post: RawPost, text: string): EvidenceBasis {
  if (post.sourceTier === "A1" || post.sourceTier === "A2") return "first_party";
  const referencesFirstParty = post.referencedAuthors.some((author) => author.toLowerCase() === "thsottiaux") ||
    post.linkedUrls.some((url) => /(?:x|twitter)\.com\/thsottiaux\/status\//i.test(url));
  if (referencesFirstParty) return "derivative";
  if (matches(text, OBSERVATIONS).length) return "account_observation";
  if (post.sourceTier === "B" || post.sourceTier === "C" || post.sourceTier === "D") return "independent_rumor";
  return "unknown";
}

function clusterKey(resetMode: ResetMode, effectiveTime: string | null, createdAt: string): string {
  const date = (effectiveTime ?? createdAt).slice(0, 10);
  return `codex-global:${resetMode}:${date}`;
}

export function classifyPost(post: RawPost): Signal {
  const text = normalize(post.text);
  const contextHits = matches(text, CONTEXT);
  const explicitHits = matches(text, EXPLICIT);
  const completeHits = matches(text, COMPLETE);
  const futureHits = matches(text, FUTURE);
  const weakHits = matches(text, WEAK_HINTS);
  const resetWord = text.includes("reset");
  const futureIntent = futureHits.length > 0 || /\b(?:will|going to|about to|expected to)\b.{0,40}\breset\b/.test(text) || /\breset\b.{0,20}\bincoming\b/.test(text);
  const banked = text.includes("banked reset") || text.includes("reset bank") || text.includes("banked");
  const basis = evidenceBasis(post, text);
  const timing = inferEffectiveTime(text, post.createdAt);
  const blocked = matches(text, NEGATIONS).length > 0 || matches(text, EXCLUSIONS).length > 0 || matches(text, WISHES).length > 0;

  let eventType: EventType = "unrelated";
  let resetMode: ResetMode = "unknown";
  let severity: Severity = "none";
  let shouldNotify = false;
  let score = 0;
  const evidence: string[] = [];

  if (contextHits.length) { score += 0.25; evidence.push(...contextHits.slice(0, 2)); }
  if (explicitHits.length) { score += 0.35; evidence.push(...explicitHits.slice(0, 2)); }
  if (completeHits.length) { score += 0.3; evidence.push(...completeHits.slice(0, 2)); }
  if (futureHits.length) { score += 0.25; evidence.push(...futureHits.slice(0, 2)); }
  if (weakHits.length) { score += 0.2; evidence.push(...weakHits.slice(0, 2)); }
  if (resetWord) { score += 0.15; evidence.push("reset"); }
  if (banked) { score += 0.2; evidence.push("banked reset"); }
  const contentConfidence = clamp(score);

  if (!blocked) {
    if (post.sourceTier === "A1" || post.sourceTier === "A2") {
      if (completeHits.length && (contextHits.length || resetWord)) {
        eventType = "explicit_reset";
        resetMode = banked ? "banked_reset" : "hard_reset";
        severity = "high";
        shouldNotify = true;
      } else if (banked && (futureHits.length || explicitHits.length || resetWord)) {
        eventType = "scheduled_reset";
        resetMode = "banked_reset";
        severity = "medium";
        shouldNotify = true;
      } else if (futureHits.length && resetWord && contextHits.length) {
        eventType = "scheduled_reset";
        resetMode = "hard_reset";
        severity = "high";
        shouldNotify = true;
      } else if (weakHits.length && (contextHits.length || resetWord)) {
        eventType = "weak_hint";
        resetMode = "unknown";
        severity = "low";
        shouldNotify = true;
      } else if (contextHits.length && (text.includes("increase") || text.includes("more usage") || text.includes("limit change"))) {
        eventType = "rate_limit_change";
        resetMode = "not_applicable";
        severity = "low";
        shouldNotify = true;
      }
    } else if (basis === "account_observation") {
      eventType = "community_observation";
      resetMode = banked ? "banked_reset" : "unknown";
    } else if (futureIntent && resetWord && contextHits.length) {
      eventType = "community_rumor";
      resetMode = banked ? "banked_reset" : "hard_reset";
      severity = basis === "derivative" ? "none" : "low";
      shouldNotify = basis === "independent_rumor" && post.lane !== "discovery" && contentConfidence >= 0.6;
    } else if (explicitHits.length && resetWord && contextHits.length) {
      eventType = "community_observation";
      resetMode = banked ? "banked_reset" : "hard_reset";
    }
  }

  const confidence = clamp(contentConfidence * post.sourceWeight);
  const reason = blocked
    ? "Negated, wished-for, or unrelated reset language."
    : basis === "derivative" && eventType !== "unrelated"
      ? "Derivative relay of first-party evidence; stored but inhibited as an independent alert."
      : eventType === "unrelated"
        ? "No global Codex reset signal crossed the deterministic rule threshold."
        : `Matched ${eventType} from source tier ${post.sourceTier}.`;

  return {
    signalId: `x:${post.postId}`,
    postId: post.postId,
    eventType,
    resetMode,
    severity,
    confidence,
    contentConfidence,
    evidenceBasis: basis,
    effectiveTime: timing.at,
    approximateTime: timing.approximate,
    clusterKey: clusterKey(resetMode, timing.at, post.createdAt),
    supersededByPostId: null,
    shouldNotify,
    reason,
    evidence: [...new Set(evidence)],
    createdAt: post.createdAt
  };
}

export function isRelevant(signal: Signal): boolean {
  return signal.eventType !== "unrelated";
}
