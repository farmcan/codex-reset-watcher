# Codex 重置雷达：看动态、收提醒、找任务

不想反复刷重置消息，也不想让 Codex 的剩余额度闲着？我把公开动态、钉钉提醒和任务 Ideas 放到一起：**看懂消息，再选一件值得做的事。**

[打开雷达](https://codex-reset-watcher.weican16hit.workers.dev/) · [挑一个任务](https://codex-reset-watcher.weican16hit.workers.dev/#pedal) · [GitHub 源码](https://github.com/farmcan/codex-reset-watcher)

## 看懂消息，不把预告当到账

首页先给最新动态，展开可看原帖、时间和后续回复。手机有快捷目录，证据与任务模板按需展开，不必翻完一长页。

**预告、完成公告、个人到账是三件事。** 原文没给精确执行时刻，就标“未公布”；公开确认也不能证明每个账号同时到账。个人额度以 [Codex Usage](https://chatgpt.com/codex/settings/usage) 为准。

![桌面首页：重置动态、提醒与任务入口](https://codex-reset-watcher.weican16hit.workers.dev/showcase/home-desktop.jpg?v=20261031-desktop)

## 判断有没有依据？看历史与原帖

[早期固定审计](https://github.com/farmcan/codex-reset-watcher/blob/main/docs/historical-audit.md)回看截至 9 月 6 日的 12 轮事件：12 轮有一手公告或确认，11 轮有提前线索，其中 8 轮预告清楚。**这是事后样本审计，不是在线预测准确率。**

再看当前账本复核后的 **10 月 28 日（北京时间）**：

- [10:42：今天重置](https://x.com/thsottiaux/status/2115273064481218829) → 预告。
- [10:43：午夜 PST 前](https://x.com/thsottiaux/status/2115273253711409208) → 补充时间范围。
- [14:29：And it’s done](https://x.com/thsottiaux/status/2115330127886463244) → 完成确认。

三帖沿真实回复关系串联，可逐条核对；14:29 是公告发布时间，精确执行和个人到账时刻仍未公布。另有[10 月近期确认记录](https://github.com/farmcan/codex-reset-watcher/blob/main/docs/recent-reset-audit.md)，与早期样本分开呈现。

## 有新消息，钉钉提醒

实时收录的新动态会在群里 **@所有人**，应用内 **DING 面向已配置的指定接收者**。通知由 Cloudflare 持续处理，无需维护者电脑在线；两种提醒均已在独立测试群实发核验。历史补录不会重放通知。

想加入通知群，添加钉钉号 **`d4r_yr1im7hv6`** 联系我。DING 需要好友或同事关系，入群不会自动开通；也可[订阅 RSS](https://codex-reset-watcher.weican16hit.workers.dev/feed.xml)。

## Token maxxing：留下能验收的成果

“怎么蹬”整理了 **15 个外部工具与任务入口**，覆盖修 bug、补测试、整理资料、开源贡献和任务悬赏。每项都说明产物、用法和使用条件。

不必开启大工程：修一个已复现的问题，留回归测试；或把零散资料整理成有出处的知识卡。**先定义结果与时间预算，达到验收条件就停止。**

可以直接交给 Codex：

> 从当前项目选一个值得做的任务。先说明问题依据、交付物和验收命令，再完成最小改动；交付结果、证据和剩余问题。

外部工具未全部安装实测，部分使用另计费 API；开源贡献与悬赏也有各自规则，使用前请看卡片说明。

## 实现方案，保持简单

公开信息进入 Cloudflare Worker，规则与 AI 核验原文及回复关系；D1 保存证据、通知队列与回执，再供网页、RSS 和钉钉使用。通知去重，异常和未知状态明确保留。

![当前已部署架构，点击查看大图](https://codex-reset-watcher.weican16hit.workers.dev/showcase/architecture.jpg?v=20261031-pink)

手机点图查看大图；[交互架构图](https://codex-reset-watcher.weican16hit.workers.dev/showcase/architecture)可在图框内左右滑动。

项目 MIT 开源，不读取你的个人 Codex 登录。**Dot 自动开工目前未启用**，当前聚焦看动态、收提醒、找任务。

[体验产品](https://codex-reset-watcher.weican16hit.workers.dev/) · [截图、架构与短片](https://codex-reset-watcher.weican16hit.workers.dev/showcase/)
