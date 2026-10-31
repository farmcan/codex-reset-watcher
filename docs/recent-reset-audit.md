# 最近重置核验（2026-10-30）

一手 X API 逐条核实的10月完成记录。以下是**确认公告时间**，精确执行/各账号到账时间均未知；不是完整月度普查。旧12轮回测样本及统计独立保留，不能从新增记录反推预测命中率。

| 北京时间 | 状态 | 确认原文 |
|---|---|---|
| 10-28 14:29 | 一手完成确认 | [原帖](https://x.com/thsottiaux/status/2115330127886463244) |
| 10-25 14:06 | 一手完成确认 | [原帖](https://x.com/thsottiaux/status/2114237083652882932) |
| 10-13 13:06 | 一手完成确认 | [原帖](https://x.com/thsottiaux/status/2109873287853707513) |
| 10-11 12:01 | 一手完成确认 | [原帖](https://x.com/thsottiaux/status/2109132167112782291) |
| 10-07 11:35 | 一手完成确认 | [原帖](https://x.com/thsottiaux/status/2107676072871600470) |
| 10-03 05:18 | 一手完成确认 | [原帖](https://x.com/thsottiaux/status/2106131810921136451) |

10月28日：上午10:42“today is a reset”是当日预告；10:43补充“Lands by midnight PST”；14:29才发布“And it's done”。后者回复中间的时间补充帖，需要核实两级引用关系，不能只搜索含 reset 的帖子。10月25日同样存在“By midnight PST”中间回复与后续完成确认。

数据文件：[recent-reset-events.json](../data/recent-reset-events.json)。获取路径为官方X API，竞品仅作为发现原帖的线索；没有把竞品摘要当作一手事实。历史导入保持静默，不向生产群补发过期或模拟通知。

排除的误判：特定受影响账号补偿credits不是全局/储存重置；tokens/sec是速度，不是额度上调。

## 旧分类修正与复核边界

10月30日，针对旧公告静默复核了“today/reset day”、仅写“Day N/Reset”、未来重置承诺及一般性28天计划。预告不再当作完成；性能提升不当作额度调整，补偿额度不当作可储存重置卡。原帖和既有投递记录保留，不重发历史通知。

其中一条“Loading a banked reset…”多次遇到模型接口520，按已核实原文与独立评审归为“正在发放的可储存重置权益”，没有完成时间。该条使用 `source-evidence-review` 明确标识，保留旧模型错误和尝试次数；公共健康统计分别列出模型复核与原文证据复核，不冒称模型成功。

## 2026-11-01补查：公开历史与个人记录分开

从 [7and1/codex-reset-history](https://github.com/7and1/codex-reset-history) 找到公开历史数据集（CC BY 4.0、10月12日快照），并对照其[持续维护的原站](https://codex-reset.com/timeline)查漏。它们是线索，未把第三方统计直接写成一手完成或本人到账。

本轮重新用X API读回：

- **10月20日14:33:48**：Tibo明确“and reset. Enjoy.”，补入一手完成记录。[原帖](https://x.com/thsottiaux/status/2112432076767289678)
- **10月15日14:28:13**：Tibo“Done and dusted”引用“Landing within the next 2 hours”，引用链明确，补入完成确认；原文没有说明形式和适用套餐，保留类型未注明。[完成帖](https://x.com/thsottiaux/status/2110618732666257557)、[时间补充](https://x.com/thsottiaux/status/2110595554036400151)
- **10月17日的独立“Done”**：X API未返回引用/回复关系，不能仅按邻近时间认定它是该轮reset完成。第三方链接指向的另一条实际是“Landing sometime today by EOD PST”，也不是完成确认。保留排除原因，不在公共完成列表中铺待验证占位。

当前扩展为8条经原帖核对的10月完成公告；这仍不是整月完整普查，旧12轮回测保持冻结。公共主页仅列已知确认发布时间和原帖，不列个人用卡、用量比例或未验证到账条。
