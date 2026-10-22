# 猛蹬：怎么蹬 / Put Codex to work

核验日期：2026-10-22。6 个外部项目，3 类工作流，每类 2 个。核验上游文档及部分源码，不是本机实测或质量担保。这里的猛蹬是完成已有、有价值的任务，不是破解或增加额度。

## Superpowers · 规划与质量

- 项目：https://github.com/obra/superpowers
- 许可：MIT
- 适用：把需求讨论、实施计划、任务执行、TDD 和代码复核串起来，适合把一个功能做完整，而不是反复催“继续”。
- 开始：按上游 Codex 安装说明启用，先确认需求、设计和验收条件。
- 限制：这是工作方法和技能，不会增加额度；小任务和明确验收比空转更有用。
- 上游说明与核验依据：https://github.com/obra/superpowers#codex-cli

Connects design, implementation plans, execution, TDD and code review. Complete a feature instead of repeatedly prompting “continue.”

Start: Follow the upstream Codex guide; agree on requirements, design and acceptance checks first.

Caveat: Workflow discipline, not extra quota. Small tasks and explicit checks beat empty loops.

## Spec Kit · 规划与质量

- 项目：https://github.com/github/spec-kit
- 许可：MIT
- 适用：用规格、计划和任务清单组织开发，支持 Codex 集成。适合模糊需求、多模块功能和需要留存的决策。
- 开始：按 Codex 集成文档初始化，依次完成需求、计划、任务和实施，每阶段审查后继续。
- 限制：不是无人值守循环；别把文档数量当成果，最终仍需测试和行为验收。
- 上游说明与核验依据：https://github.com/github/spec-kit/blob/main/docs/integrations/codex.md

Organizes development around specifications, plans and tasks, with Codex support. Useful for unclear requirements and multi-module features.

Start: Follow the Codex integration guide, then review specification, planning, tasks and implementation in order.

Caveat: Not an unattended loop. Verify behavior and tests, not the volume of generated documents.

## Claude Squad · 并行任务

- 项目：https://github.com/smtg-ai/claude-squad
- 许可：AGPL-3.0
- 适用：虽然名字带 Claude，也支持 Codex。通过 tmux 会话、独立 Git worktree 和分支管理多个任务，集中查看状态和差异。
- 开始：准备 Codex、tmux 和 gh，按上游用法开始两个互不依赖的小任务。
- 限制：worktree 不是安全沙箱，也不会消除合并冲突。先复核差异，再合并。
- 上游说明与核验依据：https://github.com/smtg-ai/claude-squad#usage

Also supports Codex despite its name. Manages tasks using tmux sessions, separate Git worktrees and branches, with progress and diff views.

Start: Prepare Codex, tmux and gh; follow upstream instructions and start with two independent tasks.

Caveat: A worktree is not a sandbox and does not eliminate merge conflicts. Review diffs before merging.

## Superset · 并行任务

- 项目：https://github.com/superset-sh/superset
- 许可：Elastic License 2.0
- 适用：把 Codex 会话、独立 worktree、差异查看和浏览器预览放在一个桌面工作台，适合并行推进功能、测试和文档。
- 开始：加入已有仓库，每个任务建一个工作区，选择 Codex，再检查 Changes 并运行测试。
- 限制：macOS 是主要平台，Linux 为实验性，Windows 暂无。worktree 不是沙箱；许可为 ELv2，不是 MIT。
- 上游说明与核验依据：https://github.com/superset-sh/superset#start-with-one-task

A desktop workspace for Codex sessions, worktrees, diffs and browser previews. Run feature, testing and documentation tasks in parallel.

Start: Add a repository, create a workspace per task, choose Codex, then inspect Changes and run tests.

Caveat: macOS is primary; Linux is experimental and Windows is not yet supported. Worktrees are not sandboxes; the license is ELv2, not MIT.

## Ralph Orchestrator · 持续执行 · 进阶

- 项目：https://github.com/mikeyobrien/ralph-orchestrator
- 许可：MIT
- 适用：用事件和不同角色组织循环，支持 Codex 后端、任务记录和验证门槛，适合能自动验收的长任务。
- 开始：先写目标和验证命令，配置迭代数、时长与停止条件，检查启动参数再运行。
- 限制：核验的 Codex 后端默认带 --yolo。不要在日常机器上盲目运行；先审查权限并提供外部隔离，提示词不等于沙箱。
- 上游说明与核验依据：https://github.com/mikeyobrien/ralph-orchestrator/blob/b5789dfbb25bd4aa65ce565c756d95acc8c42f76/crates/ralph-adapters/src/cli_backend.rs#L357-L367

Coordinates iterative work with events, specialized roles, Codex support, task tracking and validation gates.

Start: Define the task, validation commands, iteration/runtime limits and stop conditions; inspect launch arguments first.

Caveat: The reviewed Codex backend defaults to --yolo. Do not run it blindly on your everyday machine. Review permissions and provide external isolation; prompts are not sandboxes.

## ralphex · 持续执行 · 进阶

- 项目：https://github.com/umputun/ralphex
- 许可：MIT
- 适用：读取带任务勾选项和验证命令的计划，逐项执行、提交，再进行多轮复核；支持 Codex 原生执行和 worktree。
- 开始：先准备小计划，在隔离环境核对 CLI 版本、权限和迭代上限，再试一轮完整执行。
- 限制：要求 Codex CLI ≥ 0.130.0；Codex 模式默认 danger-full-access，并自动提交。同模型自审不是独立验证，不能默认允许推送或部署。
- 上游说明与核验依据：https://github.com/umputun/ralphex#codex-executor-mode

Reads a plan with task checkboxes and validation commands, executes tasks, creates commits and runs review phases. Supports native Codex execution and worktrees.

Start: Prepare a small plan; verify the CLI version, permissions and iteration limit in an isolated environment before one complete run.

Caveat: Requires Codex CLI ≥ 0.130.0. Codex mode defaults to danger-full-access and creates commits. Self-review is not independent validation or permission to push/deploy.

## 采用边界

先明确任务、测试、权限、运行时长和迭代上限。worktree 分离工作文件，不隔离系统权限。并行和循环可能更快消耗额度；登录方式决定使用和计费。不要自动推送或部署，不为空耗额度运行。本站不安装或调用这些工具，不修改重置信号标准。

Spec Kit 当前 Codex 入口采用 `specify init my-project --integration codex` 和 `$speckit-specify` 等技能；以链接上游为准，不照搬旧版教程。页面不提供一键安装命令。

## 未收录

[Crystal](https://github.com/stravu/crystal) 上游已标注 2026 年 2 月弃用并转向 Nimbalyst，因此未作为仍维护的首选收录。Superset 使用 Elastic License 2.0；不能将六项统称 MIT 或 OSI 开源。星数随时变化且不证明安全、质量或吞吐量，因此不作为排序依据。
