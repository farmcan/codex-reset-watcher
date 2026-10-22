# Token maxxing：把剩余额度换成实际产物

核验日期：2026-10-22。以下为上游文档及部分源码核验，未安装、未进行本机实测。选择标准是有明确产物、可验收且能停止；不按 token 消耗量排名。

## Desloppify

- 项目：https://github.com/peteromallet/desloppify
- 产物：小补丁、回归测试、修改前后差异。
- 建议任务：扫描当前项目的 src/，只修复 3 个高价值问题。保留现有行为，运行回归测试；40 分钟停止，交付补丁与验证结果。
- 边界：支持 Codex；评分是辅助，不是任务终点。自定义 OSNL 许可，商业再分发先读 LICENSE。
- 许可：OSNL 0.2
- 核验依据：https://github.com/peteromallet/desloppify/blob/main/desloppify/data/global/CODEX.md

## Codex Autoresearch

- 项目：https://github.com/TheGreenCedar/codex-autoresearch
- 产物：基线、实验日志、测量结果、保留或回滚的补丁。
- 建议任务：选当前项目一个真实慢路径，固定基准与正确性检查。最多 5 轮或 30 分钟；重复测量，只保留稳定改善，交付前后数据。
- 边界：原生面向 Codex；没有可靠指标时先做普通调查，不为循环而循环。
- 许可：Apache-2.0
- 核验依据：https://github.com/TheGreenCedar/codex-autoresearch/blob/main/plugins/codex-autoresearch/skills/codex-autoresearch/SKILL.md

## Autoresearch

- 项目：https://github.com/uditgoenka/autoresearch
- 产物：可复现问题、失败用例、修复及剩余风险。
- 建议任务：检查本仓库输入校验与错误恢复路径，最多确认 3 个真实 bug。每个先做失败用例再修复，30 分钟停止，不扫描外部系统。
- 边界：Codex 使用技能入口；上游的 Claude Code hooks 不等于 Codex 也有相同防护。
- 许可：MIT
- 核验依据：https://github.com/uditgoenka/autoresearch/blob/master/.agents/skills/autoresearch/SKILL.md

## Fabric · extract_wisdom

- 项目：https://github.com/danielmiessler/Fabric
- 产物：观点—原文位置—反例—可执行清单。
- 建议任务：只处理我提供的 3 份资料，提炼知识卡：每条附原文位置与适用边界。分开作者观点与推断，找不到依据标未知，不凑条数。
- 边界：可把模板交给 Codex，不必运行 Fabric CLI；完整 CLI 的模型配置与费用另算。
- 许可：MIT
- 核验依据：https://github.com/danielmiessler/Fabric/blob/main/data/patterns/extract_wisdom/system.md

## 排除与进阶

- dtnewman/burn-baby-burn：README把刷用量、排行榜和OKR作为用途，未提供与本需求相符的有效产物，不收录。
- anaclumos/tokenmaxxing：重点是订阅账号池切换及额度调度，不解决余量应该投入什么任务，不收录。
- weellio/gander：管理与观察会话，不直接提供产物任务，保留为辅助工具而非主推荐。
- karpathy/autoresearch：真实的自动ML实验方案；README要求单张 NVIDIA GPU，除模型额度外还需本地算力和训练数据。本轮不作为普通电脑的默认余量任务。未从本轮仓库元数据取得明确许可证，采用前须核对。
- 旧版 Superpowers、Spec Kit、Claude Squad、Superset 等侧重规划和会话管理，未直接回答本栏的问题，已移出主推荐。

每次先写下输入、交付物、验收命令和时间或迭代上限。订阅额度与API账单分别核对；不把多消耗当多产出，也不自动安装、执行这些项目。
