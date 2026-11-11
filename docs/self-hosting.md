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

截至 2026-11-11。API 受理、客户端收件、自然新增信号投递是三项独立验收，不能相互替代。这里记录维护者已有配置，不表示任意访客已获得这些账号的通知权限。

| 通道 | 已有验证 | 当前生产范围与待验项 |
| --- | --- | --- |
| 钉钉 | Worker 实发 DING、回执与隔离群读回；群内真实 @所有人；已导出正式群邀请并核对预览 | 官网直接提供邀请链接和同源二维码；没有取得公开数字群号，不以内部会话 ID 代替。个人 DING 仍受好友/同事关系限制，不承诺全员 DING |
| 飞书 | 独立测试群 Worker 实发与读回；正式群可见 2026-11-11 15:10 自然通知；机器人和正式群小猫头像、群描述网站链接已在客户端核验 | 正式群已提供永久分享入口，浏览器显示打开飞书；需要飞书客户端。已开启企业内群搜索，新成员可读公开信号历史；跨组织外部加入尚未验证 |
| 微信 ClawBot / iLink | 本人新入站上下文刷新后，2026-11-11 21:13 云端测试获受理，且本人明确确认收到 | 已按授权恢复本人通知，激活时间为 2026-11-11 21:29:18（北京时间），不补发停用期间旧信号；历史失败保留。官方插件仅 direct，尚无普通微信群自动投递；官网已增加维护者提供的微信交流群二维码及解码得到的微信官方群入口，二维码注明 2026-11-19 前有效，过期后前端自动隐藏旧入口；自然新增、自动刷新、跨天与凭据寿命仍待验 |
| QQ | 本人 C2C 与项目QQ群主动通知分别完成 Worker 实发及本人收件确认；项目群小猫头像与机器人名称已保存，群主更新权限后 2026-11-12 00:20 云端测试成功 | 群持续通知已于北京时间 2026-11-12 00:24:52 新激活，未回放历史，健康接口群通道 healthy、无积压/未知/失败。官网提供官方邀请、QQ 生成的群二维码和群号；邀请预览显示“申请加群”，外部成员实际入群及首条自然新增信号尚待验证 |
| 小红书 | 官方文档存在群聊加入组件；已登录网页端可读取消息，但当前界面没有建群或邀请导出操作 | 手机镜像提示 iPhone 使用中，尚未建群，没有公开群入口；未核验普通群自动发送 API，不宣传自动通知已接通 |
| 企业微信 | 尚无本项目实发验收 | 用户已明确暂缓；保持未配置，不为完成矩阵另建应用或群 |
| 邮件 | 有实现和配置说明 | 当前部署未配置，不宣传邮件已在运行 |

飞书群永久分享入口：[加入飞书通知群](https://applink.feishu.cn/client/chat/chatter/add_by_link?link_token=f33nb646-9c77-4ffb-a6b8-aec383d83876)。这是客户端入群入口，不是 Webhook；跨组织加入仍待验证。

飞书与企微共用 `src/webhook-client.ts`、`src/webhook-notifications.ts`；微信复用同一持久投递队列与 `src/weixin-client.ts`。QQ 也复用该队列，使用 `src/qq-client.ts` 与 `src/qq-test.ts`；主动发送契约核对[腾讯官方 SDK 固定版本](https://github.com/tencent-connect/qqbot-nodejs/tree/429a0f1b798f3b0fcef3679e207dbc0469a1df2d)，不沿用旧版被动回复限制。先复用这些适配器，不另起通知包、重复队列或网关。微信实验与协议边界见[专项核验](research-weixin-ilink.md)。

飞书的测试与正式 Webhook 必须独立。已获授权的私有配置文件使用 `0600`，可由下列脚本经 stdin 原子写入 Cloudflare Secrets；不要在命令行参数、聊天、截图或公开日志中放 Webhook 值、签名、Bearer token、AppSecret 或本人目标 ID。

```sh
node scripts/configure-notification-webhook.mjs feishu /absolute/private-test.json test
node scripts/configure-notification-webhook.mjs feishu /absolute/private-production.json production
```

私有 JSON 字段为 `webhook_url`、`signing_secret`。对应 Secrets 为 `FEISHU_TEST_WEBHOOK_URL` / `FEISHU_TEST_WEBHOOK_SECRET` 与 `FEISHU_WEBHOOK_URL` / `FEISHU_WEBHOOK_SECRET`。微信个人对话如需恢复，使用 `WEIXIN_BOT_TOKEN`、`WEIXIN_OWNER_ID` 并显式设置 `WEIXIN_NOTIFICATIONS_ENABLED=true`；本人通道已于上述激活时间恢复，不能由测试成功推断群聊能力。本人专用测试使用独立的 `WEIXIN_TEST_*` 配置。QQ 本人测试使用 `QQ_TEST_APP_ID`、`QQ_TEST_APP_SECRET`、`QQ_TEST_OWNER_OPENID`；生产使用 `QQ_APP_ID`、`QQ_APP_SECRET`、`QQ_OWNER_OPENID` 并显式设置 `QQ_NOTIFICATIONS_ENABLED=true`。获取 token 前的网络、限流及服务端临时故障按队列最多尝试三次；消息提交后的未知结果不重发。

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
接受随机浏览器 UUID `visitor_id`。自 2026-11-09 起，同一浏览器不活跃 30 分钟后重新访问计一次；支持按上海自然日每浏览器一次。旧累计数保留，今日访客按浏览器和上海自然日去重；
唯一键和 SQLite trigger 原子去重并累加，刷新、重试与部署不清零。
页面只在浏览器存储可用时登记；仅保存随机标识，不保存 IP、账号或浏览历史。
这是轻量浏览器计数，不是实名人数统计；清除存储或换浏览器会被视为新浏览器。
常见爬虫与跨站写入被排除。存储失败显示不可用，不显示伪造的 0。
GitHub Pages 备用快照引导到实时站查看与点赞，不写入离线快照。

实现复用自有 MiaoTI 项目 `3603fa3` 的设计思路
（`functions/api/site-counter.js`、`migrations/0001_counters.sql`），
沿用已有 D1，无新增外部服务；这里按上海自然日去重，与 MiaoTI 的 24 小时 cookie 口径不同。
上线前应用 `0005_site_engagement.sql` 和 `0010_engagement_sessions.sql`。



## 指定 DING 接收者

默认按群成员发送。可在 `DINGTALK_RECIPIENT_IDS` Worker Secret 中保存非空 JSON ID 数组，明确指定必须送达的人；仅作用于生产通知群，隔离测试群不受影响。接收者必须在群成员快照中，配置为空或目标缺失时拒绝发送，不退回全员。

公开实例按维护者最新选择只向两位指定接收者发送DING；群消息会通过 `atAll: true` 和 `<@all>` 占位符真正 @所有人；群内留档保留。其他成员原有关系限制的历史记录不删除，但不再作为这两位目标的失败。已有成功回执被复用，调整目标不会重复DING。API返回 `recipient_scope` 和目标人数，不公开个人ID。

```sh
npx wrangler secret put DINGTALK_RECIPIENT_IDS
```

运行时健康以 `/api/status` 和 `/healthz` 为准。失败、未知、缺失出站任务与真正积压仍显示异常，不能仅通过修改页面文案消除。

## 其他接口

- `GET /api/engagement`：只读累计访问、点赞和当前浏览器点赞状态。
- `POST /api/engagement/visit`、`POST /api/engagement/like`：浏览器随机 ID 按会话或自然日去重后累计。
- 管理员复核、通知测试和队列对账接口均需授权；测试令牌使用后删除。

## 重置时间与确认提醒（2026-10-28）

`/api/status` 与 `/api/events` 的每条信号新增 `reset_timing`：`published_at` 为原帖发布时间，`confirmed_at` 为一手确认公告时间，`reset_at` 仅在原文明确给出执行时刻时填写；`scheduled_for` 仅用于预告。公告时间不是每个账号到账时间，模型把发布时间复制到 `effective_time` 也不能作为精确执行证据。旧原始记录保留，公共接口按此证据规则解释。

X API 仍每20分钟轮询 Tibo，新预告和随后的一手重置确认各自入队并通知，按信号去重；预告时间过去不会自行生成完成提醒。群消息使用“标题、北京时间、原文、来源、网站”短格式，DING只发指定两人，群内真实@所有人。

所有测试模式必须配置不同于正式群的 `DINGTALK_TEST_GROUP_ID`，缺失或相同即拒绝发送。测试仅向隔离群发送。Dot不是现行查询依赖；旧本人试验中继已停止、订阅停用，恢复前页面明确显示未启用。OpenAI API Key可以提供模型访问，不会自动连接Dot，也不提供各个ChatGPT账号的实际到账时间。

### D1日额度与读取保护

2026-10-28的Cloudflare实发验收返回D1免费日读取额度耗尽，发送账本读取失败，未取得DING回执；不能把本地测试通过等同云端验收成功。免费额度按UTC日恢复，北京时间次日08:00。可选择等待或由账号持有人升级付费计划，未自动开启费用。

公开成功查询通过Cloudflare Cache API按路径共享60秒缓存，忽略无关query，避免重复页面刷新放大数据库扫描；管理员POST和失败健康检查不缓存。浏览器仍每分钟更新，数据生成时间保留。公共读取不再反复写入源配置；Cron初始化/同步源配置。D1限额返回明确503及`coverage=unknown`，前端显示监控与通知中断，不解释为“没有重置”。这项优化减少本项目读取，不保证账号内其他项目不耗尽共享额度。

QQ群使用独立 `qq_group` 投递目标：需配置 `QQ_GROUP_OPENID`，复用 `QQ_APP_ID` / `QQ_APP_SECRET`，并显式设置 `QQ_GROUP_NOTIFICATIONS_ENABLED=true`。当前未认证机器人允许加入管理员自己担任群主的群；已建立仅本人和机器人的项目群，群绑定与主动实发已核验，本人确认收件后现已开启；此前 40034105 拒绝与后续权限恢复分别保留记录。群与本人 C2C 分开激活和去重，新群不回放历史，失败不回退到本人私聊。

2026-11-11 续验：QQ 控制台已保存 Codex-Watcher 名称、小猫头像与雷达网址简介；新建项目群与群头像已在客户端核验。平台说明未认证主体仅管理员可用，但可添加至管理员当群主的群；个人认证后才可配置公开机器人服务。未将添加机器人的二维码宣传成群入群二维码。微信已取得本人新上下文、云端测试获受理并由本人确认收件；本人持续通知已按新的激活时间恢复，未来自然信号另验。

小红书能力参考：[官方群聊组件](https://miniapp.xiaohongshu.com/doc/DC532545)、[群口令转换接口](https://miniapp.xiaohongshu.com/doc/DC217062)。这些只证明已有群加入能力，不证明当前账号建群资格或普通群自动发送能力。

2026-11-12 QQ 续验：群主更新机器人权限后，唯一云端主动测试于 00:20:13（北京时间）取得回执，随后本人明确确认实收。00:24:52 建立新目标激活边界，启用后群通道健康；commissioning 测试不计自然队列成功，首次自然信号仍待验。官网采用本人提供的官方原始二维码，不修改码图；公开群号 1132211341。官方邀请预览已核对群名、群号和申请入口，不承诺无需审核直接加入。

2026-11-12 微信群入口：维护者提供原始二维码图片，离线解码成功，目的地址为 HTTPS weixin.qq.com；不改变码图像素，通过 CSS 显示码区，并保留完整原图入口。中英文显示“交流群”及“11月19日前有效”，按北京时间2026-11-19零点保守收起旧入口，页面重新可见及每分钟复查。发布二维码不表示已核验外部成员入群，也不改变当前仅私聊自动通知的边界。
