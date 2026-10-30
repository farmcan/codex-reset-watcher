# Codex 还有余量？看重置信号，挑一件值得做的事

![拿皮鞭的小猫](https://codex-reset-watcher.weican16hit.workers.dev/brand-zh.png)

不想一直刷重置消息，也不想让剩余额度闲着？我做的 **Codex Reset Watcher（重置雷达）**，把公开重置信号、钉钉群提醒和有用的任务入口放到了一起。

**[打开雷达](https://codex-reset-watcher.weican16hit.workers.dev/) · [直接挑任务](https://codex-reset-watcher.weican16hit.workers.dev/#pedal) · [GitHub 源码](https://github.com/farmcan/codex-reset-watcher)**

## 看信号，不必自己追消息

网页把重置预告、已确认重置、可储存重置权益和个人到账分开，每条保留原帖与时间。“有人到账”不会直接写成“全员重置”。

最新核验已补入 **10 月的 6 次完成确认**。例如 10 月 28 日，10:42 的“今天重置”是预告，14:29 的“And it's done”才是完成确认；这仍是公告时间，不能证明每个账号的精确到账时刻。[近期证据](https://github.com/farmcan/codex-reset-watcher/blob/main/docs/recent-reset-audit.md)

早期 12 次回测单独保留，不拿这个固定样本宣称预测准确率，也不表示现在即将重置。

想持续跟进，可以加入跨组织钉钉群。通知由 Cloudflare 持续处理，无需电脑在线；现已在双人测试群实测 **Cloudflare 发出的应用内 DING 与群内 @所有人**；新增可见信号进入持久通知队列，发送去重并记录异常。DING 接收者需要是发送者的好友或同事；只入群还不一定能收到 DING，未送达会显示实际覆盖情况。

添加钉钉号 **`d4r_yr1im7hv6`**，我拉你进群。认准网页上拿皮鞭的小猫。

![真实首页：看动态、收提醒、找任务](https://codex-reset-watcher.weican16hit.workers.dev/showcase/home-desktop.jpg)

## Token maxxing：有余量，就留下一份成果

“怎么蹬”现在整理了 **15 个外部工具与任务入口**，中英文都有具体产物、用法和边界。可以先选一条路：

- **改好自己的项目**：补一类 bug、清技术债、优化一个真实慢路径，或把已有资料整理成知识卡。
- **贡献开源**：从自己用过的依赖、维护者欢迎的小任务开始，交付最小复现、测试和小补丁。
- **领取或发布任务**：找公益任务，也可以看现金悬赏；先核对验收条件和报酬规则。

不知道从哪里开始，可以看这些更贴题的项目：

| 入口 | 能帮你做什么 |
| --- | --- |
| [token-maxxing-prompts](https://github.com/ravsau/token-maxxing-prompts) | 从项目、笔记和半成品里找值得做的任务，附 10 类任务模板 |
| [OSS Supporter](https://github.com/omribz156/oss-supporter)、[burn-usage-skill](https://github.com/Nitjsefnie/burn-usage-skill) | 筛选开源任务，准备小修复并独立验证 |
| [Spare Tokens](https://github.com/LuizPiccini/spare-tokens)、[TokenHunt](https://github.com/Jia-wei-cui/TokenHunt) | 公益任务包与任务板方案，不等于现金赏金 |
| [Opire](https://opire.dev/) | 找带赏金的 issue，或按规则发布悬赏 |
| [TokenCode](https://github.com/yzfly/TokenCode)、[timework-skill](https://github.com/Eunho-J/timework-skill) | 用独立尝试或反馈循环，提高一个难题的解答质量 |

这些是外部方案，未全部安装实测；TokenHunt 的公共服务本轮未验证。**TokenCode 使用另计费的模型 API，不是 Codex 订阅余量入口。** 作者报告的 PR 成绩不代表你的成功率。完整适用条件见首页卡片。

开源贡献先读项目的贡献与 AI 使用规则，只提交自己能解释、能验证的改动；领取悬赏不保证付款，开始前确认验收和支付安排。

## 现在就能交给 Codex 的一个任务

```text
根据当前项目，选一个值得做、60 分钟内可验收的任务。
先给出问题依据、预期产物和验收命令，再完成最小改动。
保留修改前后证据；不要为了用量增加范围。
达到验收条件就停止，交付补丁、测试结果与剩余问题。
```

想省心：加入钉钉通知群。想现在动手：**[挑一个能验收的任务](https://codex-reset-watcher.weican16hit.workers.dev/#pedal)**。

## 简单的实现，明确的边界

Cloudflare 定时获取公开动态，规则与 AI 复核原文及回复链；D1 保存证据、通知队列与回执，再供网页、RSS 和钉钉使用。访问量与点赞也可在页面查看。

当前自动任务触发尚未启用；过去完成的一次 Dot → Codex 概念验证，不代表已经提供多用户自动开工。

[查看架构、截图与短片](https://codex-reset-watcher.weican16hit.workers.dev/showcase/) · [MIT 开源仓库](https://github.com/farmcan/codex-reset-watcher)

本站非 OpenAI 官方产品，不读取你的私人额度。个人用量与重置时间仍以 [Codex Usage](https://chatgpt.com/codex/settings/usage) 为准。
