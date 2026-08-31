import { SEVERITY_RANK } from "./config";
import { shortHash } from "./db";
import type { Env, Severity } from "./types";

interface DeliveryRow {
  id: number;
  signal_id: string;
  destination_hash: string;
  attempts: number;
  event_type: string;
  reset_mode: string;
  severity: Severity;
  confidence: number;
  evidence_basis: string;
  effective_time: string | null;
  reason: string;
  author: string;
  text: string;
  url: string;
  source_tier: string;
  created_at: string;
}

export interface DeliverySummary {
  attempted: number;
  sent: number;
  failed: number;
}

export function emailConfigured(env: Env): boolean {
  return Boolean(env.RESEND_API_KEY && env.ALERT_EMAIL_FROM && env.ALERT_EMAIL_TO && env.EMAIL_PROVIDER === "resend");
}

export function severityAtLeast(value: Severity, minimum: Severity): boolean {
  return SEVERITY_RANK[value] >= SEVERITY_RANK[minimum];
}

function alertTitle(row: DeliveryRow): string {
  if (row.event_type === "explicit_reset" && row.reset_mode === "hard_reset") return "Codex 重置已确认";
  if (row.event_type === "scheduled_reset" && row.reset_mode === "hard_reset") return "Codex 官方重置预告";
  if (row.reset_mode === "banked_reset") return "Codex banked reset 消息";
  if (row.event_type === "community_rumor" && row.severity === "medium") return "Codex 社区交叉风声";
  return "Codex reset 新信号";
}

function actionCopy(row: DeliveryRow): string {
  if (row.event_type === "scheduled_reset" && row.reset_mode === "hard_reset" && row.source_tier.startsWith("A")) {
    return "这是较明确的一手未来 hard reset 信号。如果本来就有任务，可以考虑提前安排；它仍不是执行保证。";
  }
  if (row.event_type === "explicit_reset" && row.reset_mode === "hard_reset") {
    return "重置已经被一手来源确认。请在 Codex Usage 中检查自己的账号是否实际到账。";
  }
  if (row.reset_mode === "banked_reset") {
    return "这是可保存或手动使用的 banked reset，不等同于自动 hard reset。请查看 Codex Usage 中的可用数量和有效期。";
  }
  return "这是社区风声，只值得留意，不建议仅据此强行消耗额度。请先打开原帖确认。";
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character] ?? character);
}

function excerpt(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 500 ? `${compact.slice(0, 497)}…` : compact;
}

async function sendResend(env: Env, row: DeliveryRow): Promise<void> {
  if (!env.RESEND_API_KEY || !env.ALERT_EMAIL_FROM || !env.ALERT_EMAIL_TO) throw new Error("Email secrets are incomplete.");
  const title = alertTitle(row);
  const action = actionCopy(row);
  const sourceText = excerpt(row.text);
  const confidence = `${Math.round(Number(row.confidence) * 100)}%`;
  const effective = row.effective_time ? `\n预计时间（${row.evidence_basis === "first_party" ? "原帖解析" : "近似"}）：${row.effective_time}` : "";
  const plain = `${title}\n\n${action}\n\n来源：@${row.author} · ${row.source_tier}\n信号：${row.event_type} / ${row.reset_mode} / ${row.severity}\n加权置信：${confidence}${effective}\n\n原文摘录：\n${sourceText}\n\n原帖：${row.url}\n\n本提醒是非官方信息整理，不是投资或额度使用指令。`;
  const html = `
    <div style="font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:680px;margin:auto;color:#17201b;line-height:1.65">
      <p style="font-size:12px;letter-spacing:.08em;color:#657269">CODEX RESET WATCHER</p>
      <h1 style="font-size:25px;margin:0 0 12px">${escapeHtml(title)}</h1>
      <p style="font-size:16px;background:#f1f6f2;padding:16px;border-radius:12px">${escapeHtml(action)}</p>
      <p><strong>来源</strong> @${escapeHtml(row.author)} · ${escapeHtml(row.source_tier)}<br>
      <strong>信号</strong> ${escapeHtml(row.event_type)} / ${escapeHtml(row.reset_mode)} / ${escapeHtml(row.severity)}<br>
      <strong>加权置信</strong> ${confidence}</p>
      <blockquote style="border-left:3px solid #4f7a61;margin:18px 0;padding:4px 16px;color:#3d4941">${escapeHtml(sourceText)}</blockquote>
      <p><a href="${escapeHtml(row.url)}" style="color:#176b42">打开 X 原帖 →</a></p>
      <p style="font-size:12px;color:#748078">非官方信息整理。社区风声不等于官方排期；实际到账以你的 Codex Usage 为准。</p>
    </div>`;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `codex-reset/${row.signal_id}/${row.destination_hash}`
    },
    body: JSON.stringify({
      from: env.ALERT_EMAIL_FROM,
      to: env.ALERT_EMAIL_TO.split(",").map((address) => address.trim()).filter(Boolean),
      subject: `[Codex Reset] ${title}`,
      text: plain,
      html
    }),
    signal: AbortSignal.timeout(20_000)
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Resend ${response.status}: ${detail.slice(0, 1000)}`);
  }
}

export async function processPendingDeliveries(env: Env, now = new Date().toISOString()): Promise<DeliverySummary> {
  const summary: DeliverySummary = { attempted: 0, sent: 0, failed: 0 };
  if (!emailConfigured(env) || !env.ALERT_EMAIL_TO) return summary;
  const destinationHash = await shortHash(env.ALERT_EMAIL_TO.trim().toLowerCase());
  const { results } = await env.DB.prepare(`
    SELECT d.id, d.signal_id, d.destination_hash, d.attempts,
      s.event_type, s.reset_mode, s.severity, s.confidence, s.evidence_basis,
      s.effective_time, s.reason, s.created_at,
      p.author, p.text, p.url, p.source_tier
    FROM deliveries d
    JOIN signals s ON s.signal_id = d.signal_id
    JOIN posts p ON p.post_id = s.post_id
    WHERE d.channel = 'email'
      AND d.destination_hash = ?
      AND d.status = 'pending'
      AND d.next_attempt_at <= ?
      AND s.should_notify = 1
      AND s.superseded_by_post_id IS NULL
    ORDER BY d.created_at ASC LIMIT 10
  `).bind(destinationHash, now).all<DeliveryRow>();

  for (const row of results) {
    summary.attempted += 1;
    try {
      await sendResend(env, row);
      await env.DB.prepare(`
        UPDATE deliveries SET status = 'sent', attempts = attempts + 1, sent_at = ?, last_error = NULL WHERE id = ?
      `).bind(now, row.id).run();
      summary.sent += 1;
    } catch (error) {
      const attempts = row.attempts + 1;
      const terminal = attempts >= 5;
      const delayMinutes = Math.min(15, 2 ** Math.max(0, attempts - 1));
      const retryAt = new Date(Date.parse(now) + delayMinutes * 60_000).toISOString();
      await env.DB.prepare(`
        UPDATE deliveries
        SET status = ?, attempts = ?, next_attempt_at = ?, last_error = ?
        WHERE id = ?
      `).bind(
        terminal ? "failed" : "pending",
        attempts,
        retryAt,
        String(error instanceof Error ? error.message : error).slice(0, 2000),
        row.id
      ).run();
      summary.failed += 1;
    }
  }
  return summary;
}

export async function sendTestEmail(env: Env): Promise<void> {
  if (!env.RESEND_API_KEY || !env.ALERT_EMAIL_FROM || !env.ALERT_EMAIL_TO) throw new Error("Email secrets are incomplete.");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `codex-reset/test/${crypto.randomUUID()}`
    },
    body: JSON.stringify({
      from: env.ALERT_EMAIL_FROM,
      to: env.ALERT_EMAIL_TO.split(",").map((address) => address.trim()).filter(Boolean),
      subject: "[Codex Reset] 邮件提醒测试",
      text: "Codex Reset Watcher 邮件通道已配置成功。以后只有达到通知阈值且未被更强证据抑制的新信号才会发送。",
      html: "<h2>Codex Reset Watcher 邮件通道已配置成功</h2><p>以后只有达到通知阈值且未被更强证据抑制的新信号才会发送。</p>"
    }),
    signal: AbortSignal.timeout(20_000)
  });
  if (!response.ok) throw new Error(`Resend ${response.status}: ${(await response.text()).slice(0, 1000)}`);
}
