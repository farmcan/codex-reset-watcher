# 自托管与运维

面向部署维护者。产品介绍和使用入口见 [项目主页](../README.md)。

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
  -> personal app DING (configured recipients, per-person receipts)
  -> Resend email (optional, idempotent)
  -> Web dashboard + JSON API + RSS
```

实时 Worker 首页每 60 秒重新读取最新状态；标签页在后台停留超过一分钟后，切回时会立即补刷。GitHub Pages 备用站仍按工作流约每 10 分钟生成一次公开快照。

详细设计见 [`docs/architecture.md`](architecture.md)。采用和拒绝了哪些 GitHub 经验见 [`docs/research-open-source.md`](research-open-source.md)。

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

`ALERT_EMAIL_FROM` 必须来自 Resend 已验证域名。默认只有 `medium` 或 `high` 信号发邮件；单账号低置信传闻只出现在网页/RSS。配置、测试与失败语义见 [`docs/email-alerts.md`](email-alerts.md)。

### 云端钉钉通知

当前生产通道为 **Cloudflare → 个人应用内 DING → 群内留档**。每次发送先分页获取通知群当前成员，逐批发送应用内 DING；必要时尝试关联群消息的 DING，并查询群消息 `SUCCESS` 和 `openMessageId`。普通群消息不会代替 DING 被算作成功；不使用短信、电话。

2026-10-25 已在隔离双人测试群完成真实云端模拟发送，DING 业务回执覆盖 2 位接收者，群消息也已查得成功状态。本机 CLI 只用于配置和只读核验，不算云端发送验收。

**通知范围：实时轮询新增、网页可见的每条信息均通知，不按 high/medium/low 过滤。** `posts.notification_eligible` 在增量抓取时持久化；模型把原规则未识别的短帖提升为网页信号后，也能获得通知资格。历史导入及首次基线默认为 0，不回放历史。复核后及每轮 Cron 都按目标补齐缺失发送任务，持久化唯一键防止重复；与网页相同的可见性条件排除无关内容。

生产设置 `DINGTALK_MODE=personal_ding`，目标群 ID 保存在 `DINGTALK_GROUP_ID` Secret。独立 DWS OAuth 登录的令牌经 AES-256-GCM 加密，保存在 D1 `app_state.dws_oauth_v1`；32 字节密钥仅保存在 `DWS_TOKEN_KEY` Worker Secret。云端自行刷新并持久化轮换后的令牌，使用跨实例锁，不依赖本机在线。初始化使用独立登录，避免本机和云端争用同一刷新令牌。

发送前原子认领，逐人 DING 回执、成员快照与群消息任务持久化。钉钉明确要求 DING 接收者为发送者的好友或同事；明确拒绝的整批会安全拆分，可达成员先正常通知，不让受限成员阻断整组。已成功成员不会在重试时收到重复 DING；剩余受限成员保留待处理并显示实际覆盖人数。明确的发送前临时失败继续重试；发送结果未知会隔离，不能盲目重发。队列缺口、积压、失败、未知状态或登录故障会使公开状态降级，`/healthz` 返回 503，不再仅凭 X 抓取正常显示整体健康。授权撤销或刷新结果未知仍需重新核验登录。

`POST /api/admin/test-dingtalk` 要求稳定 `Idempotency-Key`，个人 DING 测试必须另配隔离的 `DINGTALK_TEST_GROUP_ID`，不会回退到生产群。可临时使用 `DINGTALK_TEST_TOKEN`，验收后删除。同一成功或未知测试不会重复发送；仅明确 pending 的测试可继续查询已接受的任务。测试不写入公开重置信号。

`POST /api/admin/refresh-dws` 验证云端刷新；`POST /api/admin/reconcile-notifications` 在锁内补齐和处理待发送通知。均需管理员凭据。

企业机器人 DING 是另一通道：2026-10-22 云端 OpenAPI 返回 403，缺少 `Premium.Ding.Write`；随后开通申请返回 `40023 / 无效请求scope值`。当前个人 DING 的成功不代表该企业应用权限已经开通，也不能据此断言个人 DING 必须付费。

协议与字段参考官方 [DWS CLI](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli)（Apache-2.0，2026-10-25 核验，commit `52f38a4a6997da07fd9159fa643d313ca9b83409`）的 `internal/helpers/ding.go`、`internal/helpers/chat.go`、`internal/auth/oauth_helpers.go` 和 `internal/syncdata/endpoints.go`；本项目保留自身 MIT 许可。

公开交付事件同步 Seed 的 `/tasks/`。该页目前为审查后发布的状态快照；Worker 的逐轮心跳尚未自动回写，实时状态以本服务 API 为准。

## API

- `GET /api/status`：历史结论、实时信号、数据源/轮询/通知健康度
- `GET /api/events`：最近实时信号
- `GET /api/history`：完整的已审计历史记录
- `GET /api/sources`：信源 scorecard
- `GET /healthz`：健康检查；未初始化、stale、通知失败或未知时返回 `503`
- `GET /feed.xml`：RSS
- `POST /api/admin/poll`：带 `ADMIN_TOKEN` 手动轮询
- `POST /api/admin/test-email`：带 `ADMIN_TOKEN` 发送测试邮件


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


### 访问量与点赞

主页中英文共用 D1 累计数，自 2026-10-25 上线起记录，不回填历史访问。
`GET /api/engagement` 只读总数；`POST /api/engagement/visit` 和 `/like`
接受随机浏览器 UUID `visitor_id`。同一浏览器按上海自然日计一次访问，点赞一次；
唯一键和 SQLite trigger 原子去重并累加，刷新、重试与部署不清零。
页面只在浏览器存储可用时登记；仅保存随机标识，不保存 IP、账号或浏览历史。
这是轻量浏览器计数，不是实名人数统计；清除存储或换浏览器会被视为新浏览器。
常见爬虫与跨站写入被排除。存储失败显示不可用，不显示伪造的 0。
GitHub Pages 备用快照引导到实时站查看与点赞，不写入离线快照。

实现复用自有 MiaoTI 项目 `3603fa3` 的设计思路
（`functions/api/site-counter.js`、`migrations/0001_counters.sql`），
沿用已有 D1，无新增外部服务；这里按上海自然日去重，与 MiaoTI 的 24 小时 cookie 口径不同。
上线前应用 `0005_site_engagement.sql`。



## 指定 DING 接收者

默认按群成员发送。可在 `DINGTALK_RECIPIENT_IDS` Worker Secret 中保存非空 JSON ID 数组，明确指定必须送达的人；仅作用于生产通知群，隔离测试群不受影响。接收者必须在群成员快照中，配置为空或目标缺失时拒绝发送，不退回全员。

公开实例按维护者最新选择只向两位指定接收者发送DING；群内留档保留。其他成员原有关系限制的历史记录不删除，但不再作为这两位目标的失败。已有成功回执被复用，调整目标不会重复DING。API返回 `recipient_scope` 和目标人数，不公开个人ID。

```sh
npx wrangler secret put DINGTALK_RECIPIENT_IDS
```

运行时健康以 `/api/status` 和 `/healthz` 为准。失败、未知、缺失出站任务与真正积压仍显示异常，不能仅通过修改页面文案消除。

## 其他接口

- `GET /api/engagement`：只读累计访问、点赞和当前浏览器点赞状态。
- `POST /api/engagement/visit`、`POST /api/engagement/like`：浏览器随机ID去重后累计。
- 管理员复核、通知测试和队列对账接口均需授权；测试令牌使用后删除。
