# Codex Reset Watcher

一个开源、非官方的 Codex 额度重置信号追踪器。它在 Cloudflare Workers 上定时查询官方 X API，把一手预告、全量重置、可储存重置卡、社区转述和社区传闻分开，保存审计记录，并可通过邮件提醒。

> 它不读取你的 Codex 登录、个人 5 小时窗口或周额度。个人剩余额度与重置时间仍应以 Codex Usage 为准。

在线查看：

- 实时入口：[`codex-reset-watcher.weican16hit.workers.dev`](https://codex-reset-watcher.weican16hit.workers.dev/)，仅 Tibo 约每小时检查；
- English：[`codex-reset-watcher.weican16hit.workers.dev/en/`](https://codex-reset-watcher.weican16hit.workers.dev/en/)；
- 网络受限备用入口：[`farmcan.github.io/codex-reset-watcher`](https://farmcan.github.io/codex-reset-watcher/)，约每 10 分钟从实时入口同步公开快照。

两个入口使用同一份 D1 证据账本。备用入口不保存凭据，也不会从浏览器跨域读取 `workers.dev`，因此在该域名被本地网络污染时仍可显示最近快照。

## 先看历史结论

仓库内置截至 2026-09-05 的最近 12 次逐条审计，其中 9 次全量重置、3 次可储存重置卡：

- `12/12`：最终找到一手公告或确认；
- `11/12`：确认前出现过某种一手信号，但包含暗语和模糊表达；
- `8/12`：信号足够清楚、可操作；
- `3/12`：只有弱暗示或事件归属有歧义；
- `1/12`：未找到可用一手预告；社区单账号约提前 40 小时猜中，但不能与官方排期等价。

完整记录在 [`data/reset-events.json`](data/reset-events.json)，人读版本在 [`docs/historical-audit.md`](docs/historical-audit.md)，可复跑校验为：

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

首页主计时卡从“最近一次确认获得重置权益”开始计时，因此全量重置和确认到账的可储存重置卡都算；卡片会明确显示类型，并另列“距上次全量重置”。节奏进度采用全部重置权益的历史中位间隔，只作参照，不是概率，也不会预测下一次重置时间。

## 数据通道

| 通道 | 对象 | 默认频率 | 行为 |
| --- | --- | ---: | --- |
| A1 一手 | `@thsottiaux` 帖子与回复 | 1 小时 | 预告、确认、banked、弱暗示分开 |
| B 侦察 | `@hqmank`、`@UsageReset` | 已停用 | 仅保留历史记录 |
| C 传闻 | `@rezoundous` 等已知账号 | 已停用 | 仅保留历史记录 |
| D 发现池 | X 全网相关英文帖子 | 已停用 | 仅保留历史记录 |

自 2026-09-15 起，`QUERY_SPECS` 只启用 Tibo。数据库里的旧通道游标与抓取记录保留，调度器只运行配置中启用的通道；API 的 `sources[].enabled` 标记当前是否启用。Tibo 每小时增量抓取，Qwen 每 10 分钟检查未复核内容，已完成的帖子不再调用模型。失败重试不会短于正常抓取间隔。

个人账户反馈不是新的来源等级，而是单条内容的弱证据类型：网页会显示并可单独筛选，但它不能独自证明全局 reset。

X Bearer Token 只存在 Cloudflare Secret 中，不会进入网页、D1 原始响应之外的公开配置或 Git。

## 架构

```text
Cloudflare Cron (every 10 minutes)
  -> hourly Tibo-only X query + since_id
  -> deterministic classifier
  -> event grouping / derivative dedupe / official inhibition
  -> D1 posts + signals + poll health + notification outbox
  -> Resend email (optional, idempotent)
  -> Web dashboard + JSON API + RSS
```

实时 Worker 首页每 60 秒重新读取最新状态；标签页在后台停留超过一分钟后，切回时会立即补刷。GitHub Pages 备用站仍按工作流约每 10 分钟生成一次公开快照。

详细设计见 [`docs/architecture.md`](docs/architecture.md)。采用和拒绝了哪些 GitHub 经验见 [`docs/research-open-source.md`](docs/research-open-source.md)。

## 本地运行

要求 Node.js 22+，并已有 Cloudflare 账号。

```bash
npm install
npm run db:migrate:local
cp .dev.vars.example .dev.vars
npm run dev
```

`X_BEARER_TOKEN` 不配置时，网页会明确显示初始化/异常，已审计历史仍可查看。

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
- `GET /api/history`：完整的已审计历史记录
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

## Qwen 内容复核与事件视图

配置 `DASHSCOPE_API_KEY` 为 Cloudflare Secret 后，只有 Tibo（`@thsottiaux`）的帖子进入
`model_reviews` 队列，包括被规则判为无关的 Tibo 内容。其他账号使用规则筛选。默认使用北京地域的
`qwen3.7-plus`，可通过 `QWEN_BASE_URL` / `QWEN_MODEL` 调整。
每 10 分钟处理一次复核队列，X 信源仍按每小时抓取。
每轮最多复核 20 条，逐帖调用、最多两条并发，按时间从新到旧处理。
失败保留规则结果、记录状态并退避重试，首页显示已完成、待处理和重试数量。
复核存储模型、提示版本、标题、摘要及原文证据。补审不重发历史邮件。

前端将消息按已审计事件、官方公告和引用关系分为独立的可折叠事件；
模糊归属保留在“尚未归属的消息”中。中文和英文标题、摘要来自模型复核，
未完成复核时使用原有标签。社区到账报告始终与一手完成确认分开，
已经过时的预告不会自动升级为“已完成”。

接口与地域说明：[百炼 OpenAI 兼容接口](https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope)、
[Base URL 总览](https://help.aliyun.com/zh/model-studio/base-url)。

受保护的 `POST /api/admin/review?limit=1` 可直接验证线上复核流程（上限 20 条），使用 `ADMIN_TOKEN` 或专用于复核的 `REVIEW_ADMIN_TOKEN`。失败原因区分模型调用与数据库写入，敏感凭据经过脱敏；首页分别显示排队和失败待重试数量。
