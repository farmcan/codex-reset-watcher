# Codex Reset Watcher

一个开源、非官方的 Codex 全局额度重置信号追踪器。它在 Cloudflare Workers 上定时查询官方 X API，把一手预告、已经落地、banked reset、社区转述和社区传闻分开，保存审计记录，并可通过邮件提醒。

> 它不读取你的 Codex 登录、个人 5 小时窗口或周额度。个人剩余额度与重置时间仍应以 Codex Usage 为准。

在线查看：

- 实时入口：[`codex-reset-watcher.weican16hit.workers.dev`](https://codex-reset-watcher.weican16hit.workers.dev/)，X 一手源约每 2 分钟检查；
- English：[`codex-reset-watcher.weican16hit.workers.dev/en/`](https://codex-reset-watcher.weican16hit.workers.dev/en/)；
- 网络受限备用入口：[`farmcan.github.io/codex-reset-watcher`](https://farmcan.github.io/codex-reset-watcher/)，约每 10 分钟从实时入口同步公开快照。

两个入口使用同一份 D1 证据账本。备用入口不保存凭据，也不会从浏览器跨域读取 `workers.dev`，因此在该域名被本地网络污染时仍可显示最近快照。

## 先看历史结论

仓库内置截至 2026-08-31 的最近 10 次逐条审计：

- `10/10`：`@thsottiaux` 最终提供一手确认；
- `9/10`：确认前出现过某种一手信号，但包含暗语和模糊表达；
- `6/10`：信号足够清楚、可操作；
- `3/10`：只有弱暗示或事件归属有歧义；
- `1/10`：未找到可用一手预告；社区单账号约提前 40 小时猜中，但不能与官方排期等价。

完整的 10 条记录在 [`data/reset-events.json`](data/reset-events.json)，人读版本在 [`docs/historical-audit.md`](docs/historical-audit.md)，可复跑校验为：

```bash
npm run backtest
```

每一条历史现在都带“最早线索 → 社区放大 → 官方确认 → 到账或异常 → 最终结果”的证据时间轴，以及该节点距离最终结果的提前 / 滞后量。信源评估口径见 [`docs/credibility-methodology.md`](docs/credibility-methodology.md)。

## 它解决什么

1. **现在是否有值得行动的消息**：首页先给自然语言判断，不先铺日志。
2. **消息属于哪一种**：future hard reset、confirmed hard reset、banked reset、弱暗示、社区风声、个人到账或异常严格分开。
3. **为什么可信**：每条信号保留作者等级、原帖、时间、分类理由和是否被更强证据覆盖。
4. **提醒是否可靠**：首次启动静默建基线；同一事件去重；官方确认抑制旧传闻；邮件使用 outbox、退避重试和 idempotency key。
5. **监控是否真的在工作**：网页公开最近成功轮询、错误、stale/down 和邮件配置状态。

首页计时卡会显示“上次全量重置后已经运行多久”，并以最近审计样本的中位间隔标注冷却、升温、常见窗口或超出常见节奏。进度条只用于描述历史节奏，不是概率，也不会预测下一次重置时间。

## 数据通道

| 通道 | 对象 | 默认频率 | 行为 |
| --- | --- | ---: | --- |
| A1 一手 | `@thsottiaux` 帖子与回复 | 2 分钟 | 预告、确认、banked、弱暗示分开 |
| B 侦察 | `@hqmank`、`@UsageReset` | 5 分钟 | 发现隐藏回复；同一原帖转述不算独立证据 |
| C 传闻 | `@rezoundous` 等已知账号 | 10 分钟 | 单账号保持低置信；两名独立作者才可升级 |
| D 发现池 | X 全网相关英文帖子 | 30 分钟 | 只入候选池，不直接推送 |

个人账户反馈不是新的来源等级，而是单条内容的弱证据类型：网页会显示并可单独筛选，但它不能独自证明全局 reset。

X Bearer Token 只存在 Cloudflare Secret 中，不会进入网页、D1 原始响应之外的公开配置或 Git。

## 架构

```text
Cloudflare Cron (2 min)
  -> X source adapters + per-query since_id
  -> deterministic classifier
  -> event grouping / derivative dedupe / official inhibition
  -> D1 posts + signals + poll health + notification outbox
  -> Resend email (optional, idempotent)
  -> Web dashboard + JSON API + RSS
```

详细设计见 [`docs/architecture.md`](docs/architecture.md)。采用和拒绝了哪些 GitHub 经验见 [`docs/research-open-source.md`](docs/research-open-source.md)。

## 本地运行

要求 Node.js 22+，并已有 Cloudflare 账号。

```bash
npm install
npm run db:migrate:local
cp .dev.vars.example .dev.vars
npm run dev
```

`X_BEARER_TOKEN` 不配置时，网页会明确显示初始化/异常，历史 10 次仍可查看。

完整校验：

```bash
npm run check
```

## 部署到 Cloudflare

```bash
npx wrangler login
npx wrangler d1 create codex-reset-watcher-db
# 把返回的 database_id 写入 wrangler.jsonc
npm run db:migrate:remote
npx wrangler secret put X_BEARER_TOKEN
npx wrangler secret put ADMIN_TOKEN
npm run deploy
```

Cron 使用 UTC、至少一次执行语义；应用用 D1 锁、帖子 ID、signal ID 和邮件 idempotency key 去重。

### 邮件提醒

邮件是可选 provider，当前实现使用 Resend：

```bash
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put ALERT_EMAIL_FROM
npx wrangler secret put ALERT_EMAIL_TO
```

`ALERT_EMAIL_FROM` 必须来自 Resend 已验证域名。默认只有 `medium` 或 `high` 信号发邮件；单账号低置信传闻只出现在网页/RSS。配置、测试与失败语义见 [`docs/email-alerts.md`](docs/email-alerts.md)。

## API

- `GET /api/status`：历史结论、实时信号、数据源/轮询/邮件健康度
- `GET /api/events`：最近实时信号
- `GET /api/history`：完整 10 次历史记录
- `GET /api/sources`：信源 scorecard
- `GET /healthz`：健康检查；未初始化或 stale 时返回 `503`
- `GET /feed.xml`：RSS
- `POST /api/admin/poll`：带 `ADMIN_TOKEN` 手动轮询
- `POST /api/admin/test-email`：带 `ADMIN_TOKEN` 发送测试邮件

## 重要边界

- 只有一手、明确、未来的 hard reset 才能提示“如果本来有任务，可以考虑提前安排”。
- 已经确认的重置只提示检查个人 Usage；不会说“赶紧用”。
- banked reset 不等同自动 hard reset。
- 社区重复转发同一原帖不是交叉印证。
- 个人到账或异常只能说明一个账户；默认停留在弱观察泳道。
- 没有完整非事件日误报分母，因此不输出“社区预测准确率”或精确概率。
- 本项目不隶属于或代表 OpenAI、X、Thibault Sottiaux 或任何社区账号。

## 开源

代码与本项目原创 Logo 使用 MIT License；设计参考见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。安全问题请看 [`SECURITY.md`](SECURITY.md)，贡献流程见 [`CONTRIBUTING.md`](CONTRIBUTING.md)。
