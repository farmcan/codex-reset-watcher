# 腾讯微信 ClawBot / iLink 接入核验

核验日期：2026-10-31（北京时间）。仅本人私聊。下文保留本机实验记录，并补充主线程完成的 Cloudflare 实发与生产配置；两阶段的发送证据分开记录。

## 当前结论与真实结果

**Cloudflare 已通过无上下文路径向本人发送，API 受理且本人确认收到；本人专用的持久通知队列已启用。** 无需本机常驻，但跨天可用性、凭据有效期及自动续期仍未证明，不能承诺永久送达。各通道范围见[通知验收矩阵](self-hosting.md#通知通道与验收范围)。

| 验收项 | 本轮状态 | 证据与边界 |
| --- | --- | --- |
| 官方来源、许可证 | 已核验 | `Tencent/openclaw-weixin`，MIT；固定 main commit `874637a0dbc24050f72d1385add4fc6170a2d726`，包版本 2.4.10 |
| 请求腾讯扫码二维码 | 真实成功 | 15:31:37 本机直连官方 `get_bot_qrcode?bot_type=3` 得到二维码；未携带已有账号 token |
| 本人手机扫码绑定 | 真实成功 | 首张未扫码二维码 `expired` 后刷新一次；15:35:10 腾讯返回 `confirmed`；之后经授权将发送所需凭据配置到 Worker Secrets |
| 不带上下文主动发送 | 一次真实送达 | 15:35:56 向扫码本人发送无 `context_token` 的测试；响应有 `message_id`，本人在本聊天明确确认收到。仅证明新绑定场景这一次可发；15:42:49 第二条不同的本人回复提示亦被API受理（距绑定约7分39秒），该条实际收件待验 |
| 带新上下文发送 | 真实成功并获Bot内确认 | 15:43:06 从扫码本人入站取得上下文；15:43:42 使用约36.7秒龄上下文发送第3次测试，API受理，随后收到本人Bot私聊确认 |
| 手机实际收到 | 无上下文、即时与延迟上下文测试已确认 | 第1次由本人在本聊天确认；第3次由本人Bot私聊回复确认；第4次由本人针对该条测试的确认卡明确确认 |
| 同一上下文延迟发送 | API受理且本人明确确认实收 | 15:47:04 冻结token龄238.206秒、距最后观察到的本人入站184.721秒；总发送4次封顶 |
| Bot 登录 token 有效期 | 未知 | 当前协议没有 TTL 或刷新 token 接口承诺 |
| 会话 `context_token` 有效期 / 主动条数 | TTL上界和条数仍未知 | 约36.7秒龄发送实收；同一冻结样本238.206秒龄、最后观察到的本人入站静置184.721秒后的发送也获本人确认。这不是有效期上界，未做耗尽配额测试 |
| Cloudflare 无上下文发送 | API 受理、本人确认收到 | 主线程完成本人专用 Worker 实发；不是本机转发，不把本机实验当云端证据 |
| 持久通知队列 | 已启用、自然新增信号待验收 | 复用现有 D1 投递队列，仅向扫码本人投递；17:10:04.623 北京时间的自然 Cron 已建立激活记录，当时无失败/未知/积压；这不是自然新信号已送达的证据。未启用云端入站轮询或自动刷新 |

本机原始证据、扫码状态及凭据副本保存在私有目录，权限目录 `0700`、文件 `0600`；云端发送所需值另存 Worker Secrets。文档不收录二维码链接、账号 ID、token、私人聊天正文或原始响应。

## 本机阶段四次发送的证据

| 次序 | 北京时间 | 路径 / 条件 | API结果 | 实际收件 |
| --- | --- | --- | --- | --- |
| 1 | 15:35:56 | 不带context，绑定后约46秒 | 受理，返回message_id | 本人在本聊天明确确认 |
| 2 | 15:42:49 | 不带context，向本人发回复提示 | 受理，返回message_id | 未单独确认；随后收到本人入站并取得context |
| 3 | 15:43:42 | context龄约36.7秒 | 受理，返回message_id | 本人Bot私聊确认，晚于发送 |
| 4 | 15:47:04 | 同一冻结context龄238.206秒；距最后观察到的本人入站184.721秒 | 受理，返回message_id | 本人针对第4次测试明确确认收到；没有再次补发 |

两次上下文发送使用同一冻结样本，后续入站没有覆盖实验token。结果仅描述本次条件，不能外推所有账号或跨天TTL；未做配额耗尽测试。

## 官方实现能证明什么

- [官方仓库](https://github.com/Tencent/openclaw-weixin/tree/874637a0dbc24050f72d1385add4fc6170a2d726)、[许可证](https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/LICENSE)：直接复用其协议，保留来源，不把上游能力写成本项目已验证能力。
- [官方协议](https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/docs/protocol_zh_CN.md)：JSON over HTTPS，二维码绑定取得 `bot_token`、`ilink_bot_id`、`baseurl`、`ilink_user_id`；`getupdates` 长轮询取得会话上下文；`sendmessage` 发送文本。协议明确客户端类型和示例不等于完整服务端契约。
- [扫码实现](https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/src/auth/login-qr.ts)：固定腾讯入口发起；支持手机验证码和腾讯域重定向。客户端二维码状态缓存的 5 分钟 TTL **不是**登录 token 或聊天上下文 TTL。
- [当前上下文存储](https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/src/messaging/inbound.ts)：按账号和用户隔离，已持久化到磁盘。保存 token 不会延长服务端有效期；不能沿用旧 issue 的“只在内存”作为当前事实。
- [失效保护](https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/src/api/session-guard.ts)：`-14` 被客户端标为 stale/expired Bot token，暂停请求一小时。这是冷却机制，不是成功刷新或凭据有效一小时的证据。

官方插件依赖 Node.js、文件系统和 OpenClaw 宿主，不能将整个插件直接当 Cloudflare Worker 安装包。本项目复用官方文本协议，用 Worker `fetch` 适配；云端出站已实测通过。这不解决凭据有效期，也不证明任意账号、群聊或跨天均可发送。

## 主动推送限制：报告与事实分开

以下为官方仓库中用户报告，尚非本账号实测，也不是腾讯服务端承诺：

- [#202](https://github.com/Tencent/openclaw-weixin/issues/202)：报告 24 小时上下文失效、10 条主动消息限制。
- [#225](https://github.com/Tencent/openclaw-weixin/issues/225)：报告约 48 小时无交互后 `ret=-2`；评论中社区发行版维护者仍称需要收件人新入站消息。该社区发行版与腾讯官方包不同，本轮未安装替换。
- [#286](https://github.com/Tencent/openclaw-weixin/issues/286)：报告约 1.5–2 分钟窗口、无上下文也被拒绝。其“只在内存”的描述已不适用于当前源码，时效结论也不能外推本账号。

本机首条无上下文发送由本人确认收到，后续云端同类路径也已实收，不能用旧报告断言所有场景都禁止无上下文发送。这三份报告不能合并成一个确定 TTL。`ret=-2` 只能先记服务端拒绝，不能无证据认定为上下文过期或额度耗尽。`getconfig` 返回 typing ticket，不是已经验证的 context-token 刷新接口；打字状态、空游标重取、重新读磁盘均不能当作续期成功。

## 适配接口与复用边界

```ts
sendWeixin(text, stableDeliveryKey, accountAndRecipientContext)
  -> { state: 'sent' | 'pending' | 'failed' | 'unknown',
       providerReceipt?, acceptanceOnly: true }
```

`sent` 只指 API 受理；官方 2.4.10 的 `sendMessage` 不要求成功响应必须含 `ret`，本轮 `message_id` 存在且无非零错误、并得到本人实际收件确认。适配器需接受这种省略成功码的格式，不能为凑字段重发；空白或不明响应仍记未知。实际手机收件单独存验收证据，不能借用这个字段表示已读。`stableDeliveryKey` 用于现有持久队列的本地去重；不能假定腾讯 `client_id` 提供跨请求幂等保证。发送前落账，网络超时/5xx/不明响应记 `unknown`，不盲目补发。缺本人绑定时保持未就绪；采用带上下文路径时，缺上下文也保持未就绪，不能据此否定已实测的新绑定无上下文路径；`-14` 需重新核验绑定，不通过无限重试冒充恢复。

| 所需字段 | 来源 / 用途 | 存储与当前值 |
| --- | --- | --- |
| `bot_token` | 手机确认后取得，Bot API Bearer credential | 私密；本人绑定凭据经授权配置到 Worker Secrets |
| `baseurl` / `base_url` | 手机确认返回的 API 地址 | 已取得；仅允许本次绑定返回且经校验的腾讯微信 HTTPS 主机 |
| `ilink_bot_id` / `bot_id` | 绑定的 Bot 标识，账号隔离 | 私密；已取得，仅存本机 |
| `ilink_user_id` / `owner_id` / `to_user_id` | 扫码本人作为唯一允许收件人 | 私密；本人目标配置到 Worker Secrets，禁止猜测或群 ID 替代 |
| `context_token` | 只从扫码本人私聊入站提取 | 私密；已取得并冻结测试样本，仅存本机，不跨账号复制 |
| `context_observed_at` | 接收该上下文的本机时间 | 已记录15:43:06；不能等同于服务端签发时间 |
| `context_expires_at` | 仅服务端提供或可验证实验才可填写 | `null`，不能按社区说法伪造 |
| `get_updates_buf` | 该 Bot 账号独立的增量游标 | 私密、持久化；已取得，仅本轮独立Bot游标 |
| `channel_version` / app headers | 本轮固定 2.4.10；App ID `bot`；ClientVersion 132106 | 非凭据，后续需随选定官方版本核验 |
| `stableDeliveryKey`, `client_id`, receipt | 现有 outbox 去重、每次尝试关联与受理证据 | 日志脱敏，结果未知不重放 |

`getupdates` 请求未见服务端按收件人过滤字段，因此只能收取该独立 Bot 的消息批次后立刻过滤；它不是读取本人微信所有联系人或聊天记录的接口。入站过滤先核对 `from_user_id === 扫码本人ID`、`message_type === 1` 且无 `group_id`，然后才查看本轮测试标记；忽略其他消息和附件，不建聊天历史缓存。

## 本机测试与继续条件

隔离脚本：`scripts/probe-weixin-personal.mjs`，Node.js 22，无生产依赖或配置变动。私有配置位于 `~/.config/codex-reset-watcher/weixin-personal-test/`，不在仓库内；二维码渲染依赖仅在被忽略的 `.wrangler/` 中。

1. `node scripts/probe-weixin-personal.mjs qr` 请求二维码；已绑定时拒绝覆盖已有会话。二维码需本机渲染后由本人微信扫描。
2. `node scripts/probe-weixin-personal.mjs poll` 单次轮询（最多 40 秒）；5 分钟后本地停止使用旧二维码。腾讯要求验证码时需本人提供手机显示数字，不尝试绕过。
3. 绑定后先 `send no-context` 做一次无上下文主动发送实验，目标固定为扫码本人；若真实送达也不能证明持续可发。
4. 已按官方生命周期补发一次 `start`（`notifystart` 返回 `ret:0`），仅声明本机测试接收端上线，不表示刷新凭据。本人在新 Bot 私聊发送 `重置通知绑定测试`；`receive` 单次增量收取并只保留本人上下文及标记匹配结果。随后 `send context` 发明确标注“不是重置信号”的本人测试。
5. 本人回复 `收到重置测试`，由 `receive` 验证本人确认消息晚于本轮 API 受理尝试，才认定手机收件；也可由本人在本聊天对指定文案明确确认。API 0、脚本退出成功不能代替此项。
6. 标记消息的上下文另存为冻结实验样本，后续确认消息不会覆盖它；同一上下文做少量延迟实验前保留其时间；延迟实验同时核对距最后本人入站的间隔，分别记录不同延迟的 API 受理与本人收件；最多四次发送尝试，结果未知不自动重放。不做连发耗尽配额测试。跨天、自然无交互后的有效性仍待独立验收。

本机阶段已结束限时接收并执行 `stop`，四次发送封顶，无常驻本机接收进程。即时上下文测试已获本人确认；第 4 次延迟测试此前仅记录API受理，现由本人针对该条本机测试的确认卡明确确认实收，已追加收件证据。此确认独立于云端测试，不修改原有“待确认”历史事件；无需再发送或轮询。公开状态留痕沿用 Seed 已审查事件机制，生产可见性由主线程统一验收。

## 已授权的云端方案与剩余限制

本人已授权云端持续通知。Worker Secrets 保存 Bot token 和固定本人目标；D1 复用现有投递队列，发送前落账、按信号与目标去重，失败与未知分别保留。生产发送不依赖本机在线，也不需要另搭 OpenClaw 网关。

当前采用已实测的无上下文发送路径，未启用云端 `getupdates` 长轮询，不把本机上下文、游标或私聊正文迁入云端。Bot token 的平台能力可能包含收发及媒体 API，不能称为 send-only credential；本人限制由应用执行，不等于腾讯颁发了更窄权限。

复用时直接使用现有 `src/weixin-client.ts`、`src/weixin-test.ts` 与 `src/webhook-notifications.ts`，不要再建第二套队列、常驻中继或绑定流程。`scripts/probe-weixin-personal.mjs` 只用于隔离诊断；不要与生产并行反复 `start` / `stop`、重新扫码或重放未知发送。未来若要收取入站、扩大接收人或迁移到独立仓库，应作为单独变更核验；当前不拆包或新建集成项目。

持久队列已启用不等于长期送达已验收。自然新增信号、跨天无交互发送与失效后的恢复仍须分别验证；没有已证明的 TTL 或自动续期机制。明确拒绝应降级并处理，网络结果未知不得盲目重发，其他已验证通知通道继续保留。
