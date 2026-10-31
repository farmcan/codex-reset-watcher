# 自托管与运维

面向部署维护者。产品介绍和使用入口见 [项目主页](../README.md)。

## 数据通道

| 通道 | 对象 | 默认频率 | 行为 |
| --- | --- | ---: | --- |
| A1 一手 | `@thsottiaux` 帖子与回复 | 20 分钟 | 预告、确认、banked、弱暗示分开 |
| B 侦察 | `@hqmank`、`@UsageReset` | 已停用 | 仅保留历史记录 |
| C 传闻 | `@rezoundous` 等已知账号 | 已停用 | 仅保留历史记录 |
| D 发现池 | X 全网相关英文帖子 | 已停用 | 仅保留历史记录 |

自 2026-09-15 起，`QUERY_SPECS` 只启用 Tibo。数据库里的旧通道游标与抓取记录保留，调度器只运行配置中启用的通道；API 的 `sources[].enabled` 标记当前是否启用。Tibo 每 20 分钟增量抓取，Qwen 每 10 分钟检查未复核内容，已完成的帖子不再调用模型。失败重试不会短于正常抓取间隔。

个人账户反馈不是新的来源等级，而是单条内容的弱证据类型：网页会显示并可单独筛选，但它不能独自证明全局 reset。

X Bearer Token 只存在 Cloudflare Secret 中，不会进入网页、D1 原始响应之外的公开配置或 Git。

## 架构

```text
Cloudflare Cron (every 10 minutes)
  -> 20-minute Tibo-only X query + since_id
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

### 通知通道与验收范围

截至 2026-10-31。API 受理、客户端收件、自然新增信号投递是三项独立验收，不能相互替代。这里记录维护者已有配置，不表示任意访客已获得这些账号的通知权限。

| 通道 | 已有验证 | 当前生产范围与待验项 |
| --- | --- | --- |
| 钉钉 | Worker 实发 DING、回执与隔离群读回；群内真实 @所有人 | 沿用已配置的指定接收者 DING 与群消息；受好友/同事关系限制，不承诺全员 DING |
| 飞书 | 独立测试群 Worker 实发与读回；@所有人为平台富提及；签名校验已保存核对 | 独立正式群已配置，仅本人；正式群自然新增信号待验收，不向正式群发 mock |
| 微信 ClawBot / iLink | Worker 无上下文发送被 API 受理，本人确认收到 | 本人专用持久队列已启用；未收取云端入站、未自动刷新；自然新增信号、跨天可用性与凭据寿命待验 |
| QQ | 官方主动 C2C 路径的 Worker 测试获回执，创建者本人客户端读回确认 | 本人持久队列已部署并启用，线上健康检查通过；无需 Gateway。自然新增信号、主动配额与长期送达待验；名称/小猫头像仍待设置 |
| 企业微信 | 尚无本项目实发验收 | 用户已明确暂缓；保持未配置，不为完成矩阵另建应用或群 |
| 邮件 | 有实现和配置说明 | 当前部署未配置，不宣传邮件已在运行 |

飞书与企微共用 `src/webhook-client.ts`、`src/webhook-notifications.ts`；微信复用同一持久投递队列与 `src/weixin-client.ts`。QQ 也复用该队列，使用 `src/qq-client.ts` 与 `src/qq-test.ts`；主动发送契约核对[腾讯官方 SDK 固定版本](https://github.com/tencent-connect/qqbot-nodejs/tree/429a0f1b798f3b0fcef3679e207dbc0469a1df2d)，不沿用旧版被动回复限制。先复用这些适配器，不另起通知包、重复队列或网关。微信实验与协议边界见[专项核验](research-weixin-ilink.md)。

飞书的测试与正式 Webhook 必须独立。已获授权的私有配置文件使用 `0600`，可由下列脚本经 stdin 原子写入 Cloudflare Secrets；不要在命令行参数、聊天、截图或公开日志中放 Webhook 值、签名、Bearer token、AppSecret 或本人目标 ID。

```sh
node scripts/configure-notification-webhook.mjs feishu /absolute/private-test.json test
node scripts/configure-notification-webhook.mjs feishu /absolute/private-production.json production
```

私有 JSON 字段为 `webhook_url`、`signing_secret`。对应 Secrets 为 `FEISHU_TEST_WEBHOOK_URL` / `FEISHU_TEST_WEBHOOK_SECRET` 与 `FEISHU_WEBHOOK_URL` / `FEISHU_WEBHOOK_SECRET`。微信生产使用 `WEIXIN_BOT_TOKEN`、`WEIXIN_OWNER_ID`，并显式设置 `WEIXIN_NOTIFICATIONS_ENABLED=true`；本人专用测试使用独立的 `WEIXIN_TEST_*` 配置。QQ 本人测试使用 `QQ_TEST_APP_ID`、`QQ_TEST_APP_SECRET`、`QQ_TEST_OWNER_OPENID`；生产使用 `QQ_APP_ID`、`QQ_APP_SECRET`、`QQ_OWNER_OPENID` 并显式设置 `QQ_NOTIFICATIONS_ENABLED=true`。获取 token 前的网络、限流及服务端临时故障按队列最多尝试三次；消息提交后的未知结果不重发。

新目的地启用时建立激活时间，只接收之后实时新增且有通知资格的网页信号，旧历史不重放。管理员测试需固定 `Idempotency-Key`；发送结果未知会隔离，不自动重发。队列正常或一次测试成功不等于自然信号与长期凭据均已验收；以通道实际回执和状态为准。

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
每 10 分钟处理一次复核队列，X 信源按每 20 分钟抓取。
每轮最多复核 20 条，逐帖调用、最多两条并发，按时间从新到旧处理。
失败保留规则结果、记录状态并退避重试，首页显示已完成、待处理和重试数量。
复核存储模型、提示版本、标题、摘要及原文证据。补审不重发历史邮件。

前端将消息按已审计事件、官方公告和引用关系分为独立的可折叠事件；
模糊归属保留在“尚未归属的消息”中。中文和英文标题、摘要来自模型复核，
未完成复核时使用原有标签。社区到账报告始终与一手完成确认分开，
已经过时的预告不会自动升级为“已完成”。

接口与地域说明：[百炼 OpenAI 兼容接口](https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope)、
[Base URL 总览](https://help.aliyun.com/zh/model-studio/base-url)。

受保护的 `POST /api/admin/review?limit=1` 可直接验证线上复核流程（上限 4 条，适配 Free D1 单次查询限制），使用 `ADMIN_TOKEN` 或专用于复核的 `REVIEW_ADMIN_TOKEN`。失败原因区分模型调用与数据库写入，敏感凭据经过脱敏；首页分别显示排队和失败待重试数量。


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

公开实例按维护者最新选择只向两位指定接收者发送DING；群消息会通过 `atAll: true` 和 `<@all>` 占位符真正 @所有人；群内留档保留。其他成员原有关系限制的历史记录不删除，但不再作为这两位目标的失败。已有成功回执被复用，调整目标不会重复DING。API返回 `recipient_scope` 和目标人数，不公开个人ID。

```sh
npx wrangler secret put DINGTALK_RECIPIENT_IDS
```

运行时健康以 `/api/status` 和 `/healthz` 为准。失败、未知、缺失出站任务与真正积压仍显示异常，不能仅通过修改页面文案消除。

## 其他接口

- `GET /api/engagement`：只读累计访问、点赞和当前浏览器点赞状态。
- `POST /api/engagement/visit`、`POST /api/engagement/like`：浏览器随机ID去重后累计。
- 管理员复核、通知测试和队列对账接口均需授权；测试令牌使用后删除。

## 重置时间与确认提醒（2026-10-28）

`/api/status` 与 `/api/events` 的每条信号新增 `reset_timing`：`published_at` 为原帖发布时间，`confirmed_at` 为一手确认公告时间，`reset_at` 仅在原文明确给出执行时刻时填写；`scheduled_for` 仅用于预告。公告时间不是每个账号到账时间，模型把发布时间复制到 `effective_time` 也不能作为精确执行证据。旧原始记录保留，公共接口按此证据规则解释。

X API 仍每20分钟轮询 Tibo，新预告和随后的一手重置确认各自入队并通知，按信号去重；预告时间过去不会自行生成完成提醒。群消息使用“标题、北京时间、原文、来源、网站”短格式，DING只发指定两人，群内真实@所有人。

所有测试模式必须配置不同于正式群的 `DINGTALK_TEST_GROUP_ID`，缺失或相同即拒绝发送。测试仅向隔离群发送。Dot不是现行查询依赖；旧本人试验中继已停止、订阅停用，恢复前页面明确显示未启用。OpenAI API Key可以提供模型访问，不会自动连接Dot，也不提供各个ChatGPT账号的实际到账时间。

### D1日额度与读取保护

2026-10-28的Cloudflare实发验收返回D1免费日读取额度耗尽，发送账本读取失败，未取得DING回执；不能把本地测试通过等同云端验收成功。免费额度按UTC日恢复，北京时间次日08:00。可选择等待或由账号持有人升级付费计划，未自动开启费用。

公开成功查询通过Cloudflare Cache API按路径共享60秒缓存，忽略无关query，避免重复页面刷新放大数据库扫描；管理员POST和失败健康检查不缓存。浏览器仍每分钟更新，数据生成时间保留。公共读取不再反复写入源配置；Cron初始化/同步源配置。D1限额返回明确503及`coverage=unknown`，前端显示监控与通知中断，不解释为“没有重置”。这项优化减少本项目读取，不保证账号内其他项目不耗尽共享额度。
