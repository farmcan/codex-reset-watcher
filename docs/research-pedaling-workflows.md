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

## 领取悬赏、发布任务与开源贡献

- Opire：https://opire.dev/ ，官方说明 https://docs.opire.dev/overview/introduction ，支付条件 https://docs.opire.dev/rewards/pricing 。本轮核验官方文档，未注册、认领、发赏或验证收款。平台追踪 issue 悬赏与认领；认领不是自动付款，出赏人审核后自行安排支付。首页与支付文档对谁能创建悬赏表述不一致，应在实际发赏前核对资格、金额、收款与验收规则。
- 发布任务：先形成 GitHub issue 草稿，明确复现、范围、验收测试与报酬规则，再按平台条件设置悬赏。不自动承诺付款。
- Up For Grabs：https://up-for-grabs.net/ ，目录源码 https://github.com/up-for-grabs/up-for-grabs.net ；Good First Issue 贡献指南 https://www.goodfirstissue.org/guide 。只作为发现入口，须继续核对原 issue、维护者近期活动、竞争 PR、贡献和 AI 政策。
- 优先为自己实际使用的依赖提交真实修复。GitHub 官方指南：https://docs.github.com/en/get-started/exploring-projects-on-github/contributing-to-open-source 。产物是最小复现、回归测试与可审阅 PR；普通贡献不保证报酬或合入。
- 任务目录是网站服务；按链接使用，不为浏览任务引入部署依赖，也未复制上游实现。具体目标项目的许可证、CLA/DCO和AI政策须另核对。

### 不直接当成当前普通悬赏平台推荐的旧名单

- Algora：https://algora.io/ 当前首页重点是开源工程师招聘；https://github.com/algora-io/algora 的源码仍描述 jobs/contracts/bounties，但老 /bounties 地址404，不能据旧文章保证当前可接悬赏。
- OnlyDust：https://www.onlydust.com/ 当前主页宣布结束，不能按旧文档推荐为仍运行的贡献奖励平台。
- IssueHunt：https://issuehunt.io/ 当前是安全漏洞悬赏，不当作普通代码任务池；需要具体项目的测试授权和范围，未做任何扫描。
- Gitcoin：https://gitcoin.co/ 当前以公共物品资助为主，不等同按 issue 验收付酬的任务板。

## 用户提供的7个直接相关仓库（2026-10-22复核）

本轮仅查阅文档、元数据与部分源码，没有安装或执行这些工具；不把上游指令当作本轮执行授权。

### Token maxxing prompts

- 仓库：https://github.com/ravsau/token-maxxing-prompts
- 用途：从项目、笔记、日志和半成品生成 10–15 个有持久产物的任务；附审计、补测试、ADR、代码考古等 10 类模板。
- 产物：任务清单、排序依据、每项产物与验收方式。
- 边界：提示词可交给现有 Codex；不需要另建 Agent 框架。不自动扫描私人资料。
- 许可：MIT
- 源码依据：https://github.com/ravsau/token-maxxing-prompts/blob/master/README.md

### OSS Supporter

- 仓库：https://github.com/omribz156/oss-supporter
- 用途：面向任意 Agent 的开源维护手册：筛选小任务、验证、提交并跟进，优先减少维护者负担。
- 产物：最小复现、补丁、验证证据与 PR 草稿。
- 边界：作者公布的 token/合入成绩属于作者报告，不代表本站实测或成功率。
- 许可：MIT
- 源码依据：https://github.com/omribz156/oss-supporter/blob/main/docs/validation-gates.md

### burn-usage-skill

- 仓库：https://github.com/Nitjsefnie/burn-usage-skill
- 用途：将开源贡献拆为主控、实现与独立验证角色，并提供 GitHub 筛选和跟进脚本。
- 产物：窄范围修复、独立反证与验收报告。
- 边界：需配置 GitHub 身份与执行环境；默认示例偏 Claude harness，采用前适配。PR 成绩为作者自述。
- 许可：MIT
- 源码依据：https://github.com/Nitjsefnie/burn-usage-skill/blob/main/SKILL.md

### Spare Tokens

- 仓库：https://github.com/LuizPiccini/spare-tokens
- 用途：从科研、公民科技、健康等项目整理任务包，支持面向 Codex 导出提示词与 PR 草稿流程。
- 产物：任务产物与便于人快速验收的证据包。
- 边界：CLI 不调用模型，也不代管订阅。官方入口 npx spare-tokens@latest start --target codex；本轮未安装实跑。
- 许可：MIT
- 源码依据：https://github.com/LuizPiccini/spare-tokens/blob/main/skills/spare-tokens/SKILL.md

### TokenHunt · g0v

- 仓库：https://github.com/Jia-wei-cui/TokenHunt
- 用途：公民科技任务板：发布、认领、提交成果和验收。仓库提供 Pages + Worker + D1 实现。
- 产物：任务说明、认领记录、交付物与验收。
- 边界：已核对源码流程，未验证可用公共服务；“token 赏金”不等于现金结算。README 声明 CC-BY 4.0，未见独立许可证文件。
- 许可：README: CC-BY 4.0
- 源码依据：https://github.com/Jia-wei-cui/TokenHunt/blob/main/workers/src/issues.js

### TokenCode · /race

- 仓库：https://github.com/yzfly/TokenCode
- 用途：同一道难题在隔离 worktree 中独立尝试，再用检查和裁判比较结果。
- 产物：候选补丁、测试结果与择优依据。
- 边界：工具走模型 API 凭据，不是 Codex 订阅余量入口；并行会增加账单，本页不启动竞赛。
- 许可：CC-BY-NC 4.0
- 源码依据：https://github.com/yzfly/TokenCode/blob/main/internal/race/race.go

### timework-skill

- 仓库：https://github.com/Eunho-J/timework-skill
- 用途：在时间或轮数约束中反复提出、验证并记录，把证据和结论存入工作日志与知识库。
- 产物：实验记录、反证、知识笔记与剩余问题。
- 边界：上游强调用满最低预算；这里仅借鉴反馈方法，并保留提前停止条件。未发现明确许可证，复制前核对。
- 许可：许可待核对 / license unverified
- 源码依据：https://github.com/Eunho-J/timework-skill/blob/main/SKILL.md

OSS Supporter README中52个已合入PR、约15亿token，以及burn-usage-skill约40+PR/30仓库等均为作者报告，本轮未逐项独立审计，页面不以这些数字承诺效果。TokenCode仅解释方法和工具边界；本轮未运行收费API、未转让任何账号或订阅访问。
