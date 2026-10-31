# 个人额度到账复查

2026-10-31：此前已有一次 Usage 页面人工核对，私有证据证明“下次 weekly 重置减去 7 天”与一次手动使用重置卡的历史记录吻合。它不是全局自动重置的到账时间，也不是持续监测已经上线的证据。

本次使用官方 `account/rateLimits/read`，由本机已登录 Codex App Server 读取；不读取、复制或上传登录文件。官方字段说明：<https://learn.chatgpt.com/docs/app-server#6-rate-limits-chatgpt>。

运行 `python3 scripts/personal-usage-watch.py`：

- 按窗口长度 10080 分钟识别 weekly，支持 primary / secondary 和多个 limit bucket。
- 首次成功仅建立基线。用量下降至少 2 个百分点时记录两次采样之间的“额度恢复观察”；已跨原定到期时间时单独标记正常周补充。不能仅凭此确定全局自动发放、手动用卡、套餐调整等原因。
- 重置时间变化本身不算到账；重置卡数量增加单独标记为卡发放。
- 对启用后新增的一手重置预告/确认，在信号或明确执行时间之后 1 小时、3 小时各复查一次；全量重置观察额度，banked观察卡新增。类型未知保持未知，引用关系可串起同一轮。未看到变化只说“尚未确认到账”；机器休眠错过两次时合并成一次当前提醒，不补发旧提醒。来源不健康或个人额度不可读时报告未知，不当作未到账。
- 事件持久化到私有 outbox。`--ack ID` 表示该通知已由调用方消费，不是手机实际收件回执。未知发送不自动重放。
- 账号切换重新建立基线，不把不同账号的用量比较成重置。保留私有历史，公开状态只记录执行情况。
- 同账号相邻记录超过60分钟（30分钟计划加30分钟宽限），单独记录覆盖间隔并通过本人私聊提醒；仅能确认间隔内覆盖未知，不把原因猜成Mac休眠、平台故障或没有重置。本次恢复读取不回填遗漏时段。

状态在被 Git 忽略的 `.wrangler/personal-usage-watch/`，新写文件权限 0600；不保存原始 API 响应、账号 ID、邮件、付费积分余额、登录凭据。已有人工证据仍在私有 `.wrangler/`，不加入仓库或公开页面。

用户最终选择钉钉：Codex heartbeat 每30分钟运行 `python3 scripts/personal-usage-watch.py --notify-dingtalk`，使用既有DWS登录给本人私聊。绑定来自`auth status`和`contact +me`交叉核对；每次发送再次核对本人身份。2026-10-31接入测试返回`deliveryStatus=delivered`与消息ID；这是普通钉钉私聊，不是真DING或手机已读回执。不广播给现有两人群。发送意图先持久化，unknown/中断不盲目重发，失败在聊天提示处理。

个人额度监测依赖这台Mac在线与既有登录状态。公开Worker的X监控与原通知渠道不变。调度配置成功、首次自然执行、真实额度变化、实际通知分别验收，不能互相替代。公共观察写入/API/横向周期图已接线，见 [cycle-timeline.md](cycle-timeline.md)；接口专用令牌仅在本机私有文件中，后续恢复/发卡事件只上传固定脱敏字段。

检查：`python3 tests/personal-usage-watch.test.py`。本次已用真实账号完成只读采样并建立基线；真实重置事件尚待发生，不用合成样例冒充到账验收。历史提取运行 `python3 scripts/reconstruct-weekly-history.py`，私有结果在`.wrangler/personal-usage-watch/history-review.md`；只读额度遥测，不保留聊天正文，不将历史账号不明的窗口变化当成全局到账证据。
