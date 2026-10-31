# 竞品核查：个人用量与公开重置信号

核查日期：2026-10-31（北京时间）。结论基于官网、公开源码、GitHub 提交/发布记录及只读生产检查；未安装竞品客户端，未接入个人账号，未实操倒计时保存 / 日历导出，也未实测竞品通知送达。页面提供入口、源码存在实现、实际收件成功是三种不同证据。

## 简短对比

| 产品 | 核实的功能与数据源 | 源码 / 许可证 | 维护与边界 |
| --- | --- | --- | --- |
| [CodexBar](https://github.com/steipete/CodexBar) | 个人用量、窗口倒计时、多服务商菜单栏与 CLI；Codex 使用已授权的 PAT / OAuth / CLI RPC，可选网页会话补充数据。不是公开重置公告雷达。 | Swift；[MIT](https://github.com/steipete/CodexBar/blob/348e2fa8d36ae8e452739ca07a79e83ab9d25e98/LICENSE)。 | [10-31 有提交](https://github.com/steipete/CodexBar/commit/348e2fa8d36ae8e452739ca07a79e83ab9d25e98)，最新稳定版 [v0.82.0，10-27 北京时间](https://github.com/steipete/CodexBar/releases/tag/v0.82.0)。源码与发布仍活跃；本轮未验证本人账号读取。 |
| [Reset Watch](https://resetwatch.app/) | Codex / Claude Code / Grok Build 公开公告、历史、原帖、时区、24 小时非官方概率，以及 RSS / 日历；页面列 X、官方状态页、AIHOT 与 codex-reset.com。 | 未定位到经官网关联确认的公开仓库或开源许可证；后端采集与概率算法未核实。 | 页面快照日期为 10-31；RSS 与日历端点本轮均 HTTP 200、格式正确。Chrome 插件页面注明待商店审核；微信提醒仅见隐私政策描述，未验证送达。 |
| [LimitTracker](https://limittracker.com/) | 公开公告档案 + 手填 / 粘贴 `/status` 的个人倒计时、banked 到期记录；个人值按官网说明保存在浏览器。页脚列 codex-resets.com，另有 OpenAI Status 来源标签。 | 未定位到经官网关联确认的公开仓库或开源许可证；[服务条款](https://limittracker.com/terms-of-service)保留原创内容及功能的权利。 | 可见 10-31 公告和档案评估日期；说明文章仍标 09-18。浏览器 / 邮件提醒有入口，但本轮浏览器观察仍为检查可用性、控件禁用，未验证收件。 |
| [CodeReset](https://codereset.dev/) | 粘贴解析、手填、浏览器本地保存、倒计时、用量节奏、`.ics` 导出有对应代码；公开卡片请求 codexreset.dev API，失败保留带日期的旧快照。 | 找到内容对应的 [diegobona/codereset](https://github.com/diegobona/codereset)；仓库树无 LICENSE，package.json 无 license 字段，不能按已获开源许可复用。 | 最新提交 [09-16](https://github.com/diegobona/codereset/commit/833630b1192be9e220ad1d6ce7db2516b6a53ee8)，未归档；现场公开卡仍为 09-15 检查、09-12 事件、UNKNOWN / PARTIAL COVERAGE。不能称为当前实时覆盖。 |

## 可复查依据与限制

- **CodexBar**：固定核查版本 `348e2fa8d36ae8e452739ca07a79e83ab9d25e98`。[Codex 数据源说明](https://github.com/steipete/CodexBar/blob/348e2fa8d36ae8e452739ca07a79e83ab9d25e98/docs/codex.md)与 [OAuth fetcher](https://github.com/steipete/CodexBar/blob/348e2fa8d36ae8e452739ca07a79e83ab9d25e98/Sources/CodexBarCore/Providers/Codex/CodexOAuth/CodexOAuthUsageFetcher.swift)对应，代码确有 Bearer 请求及窗口字段解析；该路径使用 ChatGPT 后端接口，不能写成官方承诺稳定的第三方公共额度 API。README 的免额外登录依赖已有授权会话，不代表不需要凭据。macOS 应用要求 14+，源码构建要求 Swift 6.2+；另有 Linux 桌面与 CLI，不能笼统说仅支持 Mac。[安装与运行要求](https://github.com/steipete/CodexBar/blob/348e2fa8d36ae8e452739ca07a79e83ab9d25e98/README.md)
- **Reset Watch**：本轮直接读取 [RSS](https://api.resetwatch.app/v1/tools/codex/feed.xml) 与 [日历](https://api.resetwatch.app/v1/tools/codex/calendar.ics)，确认内容可获取；未验证阅读器 / 日历客户端推送。[隐私政策](https://resetwatch.app/privacy/)描述 API、插件、微信一次授权一次提醒，不能据此认定插件已上架或微信生产闭环已通过。官网概率带低可信度提示，本轮没有校准或准确率证据；多处来源标签也不能证明它直接独立查询 X API。
- **LimitTracker**：[首页](https://limittracker.com/)明说不自动访问本地会话，Claude / ChatGPT / Cursor 是指南入口，不是已接入的实时用量。首页不同区域分别写 OpenAI Status 与 Codex Resets，后端如何取数、合并和去重未公开核实；不把历史条数或等待均值当预测成绩。GitHub 同名的 [keirbowden/LimitTracker](https://github.com/keirbowden/LimitTracker)实际是 Salesforce Governor Limits 工具，已排除。
- **CodeReset**：固定版本 `833630b1192be9e220ad1d6ce7db2516b6a53ee8` 的 [reset-desk](https://github.com/diegobona/codereset/blob/833630b1192be9e220ad1d6ce7db2516b6a53ee8/components/reset-desk.tsx)、[解析与日历实现](https://github.com/diegobona/codereset/blob/833630b1192be9e220ad1d6ce7db2516b6a53ee8/lib/reset.ts)、[公开数据与回退值](https://github.com/diegobona/codereset/blob/833630b1192be9e220ad1d6ce7db2516b6a53ee8/lib/global-reset.ts)相互对应。[卡片代码](https://github.com/diegobona/codereset/blob/833630b1192be9e220ad1d6ce7db2516b6a53ee8/components/global-reset-card.tsx)每秒更新的是已过时间，API 在组件挂载时请求，不能把“每秒更新”写成每秒抓取新公告。仓库 README 仍有 preview 描述，以代码与现场旧快照为准；未证明当前部署等于该 commit。[隐私页](https://codereset.dev/privacy)说明个人值本地保存，另有可选匿名事件统计，不应概括为完全没有网络请求。排除重置 VS Code 数据的同名 [d41bf92/CodeReset](https://github.com/d41bf92/CodeReset)。

Reset Watch、LimitTracker 的仓库结论只覆盖本轮官网 / 政策页链接检查及 GitHub 名称、域名搜索；未找到不等于不存在。三家数据源域名 `codex-reset.com`、`codex-resets.com`、`codexreset.dev` 拼写不同，本轮未核实它们的运营关系，也不视为三份独立的一手证据。

## 本项目如何定位

已有产品覆盖了个人用量、倒计时、公告历史与订阅，不能宣称独家或全网首个。个人自动用量优先评估直接使用 CodexBar；公开公告与日历可直接试用 Reset Watch；手工倒计时已有 LimitTracker / CodeReset。现阶段值得验证的差异，是**公开证据链、已验收的钉钉提醒与能留下产物的任务 Ideas 组合**，而不是再造个人用量仪表盘。

本项目可对外使用的事实边界：

- **本轮生产读回**：[首页](https://codex-reset-watcher.weican16hit.workers.dev/)、[RSS](https://codex-reset-watcher.weican16hit.workers.dev/feed.xml)、[状态 API](https://codex-reset-watcher.weican16hit.workers.dev/api/status)、[健康端点](https://codex-reset-watcher.weican16hit.workers.dev/healthz)可读；10-31 15:31 的 API 快照为 healthy，一手抓取最后成功为 15:30:04，周期约 20 分钟。健康结论只适用于启用的一手来源；社区、传闻和发现查询处于停用状态，不能宣传全网实时监听。
- **通知按通道分开验收**：钉钉云端 DING、群 @所有人、回执与相同请求去重见[发布评审](launch/review-decisions.md)。本轮飞书独立测试群实发与富提及读回通过，独立正式群已配置；微信本人云端实发已获收件确认并启用本人队列；QQ 本人云端测试获回执且客户端读回确认，持续队列已部署启用，线上健康检查通过。自然新增信号与凭据长期有效性不能由一次测试代替，详见[通知验收矩阵](self-hosting.md#通知通道与验收范围)。接收范围受现有配置、授权及平台关系限制，不代表任意访客已可订阅或全员均能收到 DING；邮件当前未配置，企微已暂缓。
- **仓库与页面可核实**：预告 / 完成 / banked / 弱暗示分类，原帖、引用关系和时间线，抓取 / 复核 / 投递分开显示状态，任务 Ideas 与模板；代码 [MIT](../LICENSE)、可自托管。Ideas 是用户选题入口，不是自动执行记录。
- **没有上线**：个人额度自动接入、私人窗口预测、精准预测下一次公开重置、自然 Reset → Dot 自动开工、多用户自动任务接入。旧单账号合成事件的文件产出仅为概念验证，临时网关与订阅已清理；[证据和限制](evidence/reset-dot-probe-20261025.json)不能被改写为持续服务已上线。

可直接使用的技术帖、朋友圈与独立拉票草稿见 [分享文案](launch/sharing-plan.md)。
