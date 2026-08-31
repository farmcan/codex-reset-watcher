# 最近 10 次 Codex 重置信号审计

截止 2026-08-31 11:20（Asia/Shanghai）。数据来自官方 X API Full-archive / Recent Search。Ground truth 是 `@thsottiaux` 对已经重置、正在传播或 banked reset 的一手帖子；目标是评估“能否提前提醒”，不是证明承诺必然执行。

| # | 北京时间与类型 | 一手确认 | 最早可用信号 | 提前量 | 结论 |
| ---: | --- | --- | --- | ---: | --- |
| 1 | 08-31 10:29 hard | [25M 开始传播](https://x.com/thsottiaux/status/2094251180121854309) | [里程碑暗示](https://x.com/thsottiaux/status/2093573991965557198)；[明确 6pm PST](https://x.com/thsottiaux/status/2094144275957350900) | 模糊 44h51m；明确 7h05m | 清楚；明确转发只慢 61 秒 |
| 2 | 08-30 04:43 hard | [修复并重置](https://x.com/thsottiaux/status/2093801758665715784) | [soon, but not today](https://x.com/thsottiaux/status/2093551005711679557) | 16h36m | 弱；可能指向下一事件 |
| 3 | 08-28 00:35 hard | [brand new usage](https://x.com/thsottiaux/status/2093014447833116908) | [reset button 暗示](https://x.com/thsottiaux/status/2092862554632826968) | 10h04m | 清楚；`UsageReset` 后续 incoming 属 stale |
| 4 | 08-24 08:46 hard | [传播并重置](https://x.com/thsottiaux/status/2091688655828246890) | [次日 full reset](https://x.com/thsottiaux/status/2091407991736332689) | 18h35m | 清楚；一手比聚合账号早约 4.5 小时 |
| 5 | 08-21 19:43 banked | [20M banked reset](https://x.com/thsottiaux/status/2090766694897619318) | 同帖说明当天发放 | 到观察到账 13h33m | 清楚，但不是自动 hard reset |
| 6 | 08-13 09:01 hard | [15M，下一小时](https://x.com/thsottiaux/status/2087706104814023111) | [明天有惊喜](https://x.com/thsottiaux/status/2087423996115681767) | 18h41m | 清楚但属于语境型提示 |
| 7 | 08-11 08:28 hard | [所有付费用户](https://x.com/thsottiaux/status/2086972933566857393) | [回复称周一再重置](https://x.com/thsottiaux/status/2086189414292865249) | 51h53m | 清楚；隐藏回复是侦察员最有价值的场景 |
| 8 | 08-09 04:29 hard | [Sol 庆祝重置](https://x.com/thsottiaux/status/2086188036493344823) | [Theo needs a reset](https://x.com/thsottiaux/status/2085845171363791135) | 22h42m | 弱；双关不能写成排期 |
| 9 | 08-01 11:32 hard | [效率周末重置](https://x.com/thsottiaux/status/2083395449814229287) | [把 resets 列为迹象](https://x.com/thsottiaux/status/2083053369351090257) | 22h39m | 弱；社区账号判断前后矛盾 |
| 10 | 07-29 12:09 hard | [Sol 修复并重置](https://x.com/thsottiaux/status/2082317452755751098) | 无可用一手预告；[社区单账号估计 7 月 29 日](https://x.com/rezoundous/status/2081705220174930026) | 社区 40h33m | 单次猜中，不能计算准确率 |

## 结论

- 一手确认 `10/10`。
- 任意一手提前信号 `9/10`，其中清楚可操作 `6/10`、弱或歧义 `3/10`。
- 加社区层后，事件条件下的表面召回可到 `10/10`，但新增的第十次只是单账号低置信猜测。
- `@hqmank` 至少 `7/10` 提供有用转述，适合发现隐藏回复，不适合替代一手判断。
- `@UsageReset` 上线后可评估的 5 次中，3 次有用、1 次漏掉、1 次 stale，适合分发兜底。
- 不能报告社区账号的数值预测准确率：没有完整的非事件日误报分母。

机器可读的完整字段、时间戳和原帖 ID 见 [`../data/reset-events.json`](../data/reset-events.json)。
