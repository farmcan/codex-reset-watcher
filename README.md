<p align="center"><img src="public/brand-zh.png" width="220" alt="Codex 重置雷达的小猫形象"></p>

<h1 align="center">Codex 重置雷达</h1>

<p align="center">有重置信号时收到提醒，把剩余额度花在有产物的任务上。</p>

<p align="center">
  <a href="https://codex-reset-watcher.weican16hit.workers.dev/">打开雷达</a> ·
  <a href="https://codex-reset-watcher.weican16hit.workers.dev/en/">English</a> ·
  <a href="https://codex-reset-watcher.weican16hit.workers.dev/showcase/">作品介绍与素材</a> ·
  <a href="https://farmcan.github.io/codex-reset-watcher/">备用站</a> ·
  <a href="https://codex-reset-watcher.weican16hit.workers.dev/feed.xml">RSS</a>
</p>

<p align="center">
  <a href="https://github.com/farmcan/codex-reset-watcher/actions/workflows/ci.yml"><img src="https://github.com/farmcan/codex-reset-watcher/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  · <a href="LICENSE">MIT 开源</a> · 非官方项目
</p>

追踪 Codex 的公开额度重置信号：**什么时候说的、谁说的、是预告还是已完成，点开都有原帖。**
有新消息接收钉钉提醒；不知道做什么时，从任务 Ideas 中选一件能留下成果的事。

<details>
<summary>查看主页截图</summary>

![首页：看重置、收提醒、找任务](public/showcase/home-desktop.jpg)

</details>

## 直接使用

1. **看信号**：[打开雷达](https://codex-reset-watcher.weican16hit.workers.dev/)，查看当前判断和每轮事件的证据。
2. **收通知**：钉钉添加 `d4r_yr1im7hv6`，联系维护者加入跨组织通知群。应用内 DING 需要接收者与发送账号为好友或同事；接收范围以页面实际状态为准。
3. **安排任务**：[不知道怎么蹬？看一些 Ideas](https://codex-reset-watcher.weican16hit.workers.dev/#pedal)，从维护、调研、开源贡献和悬赏中选一个能验收的任务。
4. **核对额度**：[个人 Codex Usage](https://chatgpt.com/codex/settings/usage) 才能确认你的实际剩余额度和到账情况。

## 现在能做什么

| 能力 | 实际行为 |
| --- | --- |
| 分清消息 | 未来全量重置、已经重置、可储存重置卡、弱暗示分别标注 |
| 看清依据 | 保留原帖、时间、内容分类和事件时间轴；中英文页面 |
| 云端 DING | 新增网页可见信号进入持久队列，向配置的接收者发送真正应用内 DING；逐人回执去重，群消息 @所有人，登录自动刷新 |
| 看重置时间 | 预告、精确执行时刻、确认公告分开显示；原文没给具体时刻就明确标为未公布 |
| 看周期过程 | [横向时间轴](https://codex-reset-watcher.weican16hit.workers.dev/#cycles)支持拖动、缩放、展开节点与按月汇总；公开预告、报出、官方完成和账号恢复观察独立留证 |
| 发现异常 | 抓取、复核和通知分别显示状态；失败或未知不当作“没有新消息” |
| 用好剩余额度 | 15 个 Token maxxing 入口，附任务模板、产物、时间上限和来源 |
| 甩鞭求重置 | 点小猫立即 +1，中英文猫咪播放约0.75秒甩鞭与短音效，可静音；连点不重启动画。共用累计数，原木鱼/支持数保留 |

首页每分钟刷新。备用站约每 10 分钟同步公开快照，页面会标出快照状态；甩鞭计数与访问量请使用实时站。

## 下一步：重置前自动开工

目标是：**可信的重置前信号 → 自己的 Dot → Codex 执行预先准备的任务目录。**

此前用个人账号完成过一次 Cloudflare → Dot → Codex 文件产出的概念验证。临时网关与订阅已清理，**当前没有启用自动开工**。
自然 Reset 自动执行和多用户接入尚未开放；长期订阅管理仍需完善。
多用户方案将让每个人授权自己的 Dot，各自配置任务、预算与停止条件，使用各自的 Codex 额度。

[接入调研、现成方案与验收条件 →](docs/research-reset-task-triggers.md)

## 先分清三件事

- **预告不等于到账**；只有明确的一手未来全量重置，才提示提前安排已有任务。
- **Banked reset 不等于自动清空额度**，它是可储存或手动使用的权益。
- **公开信号不等于个人额度**；本站不读取你的 Codex 登录，也不预测私人 5 小时或周窗口。

[10 月新增核验](docs/recent-reset-audit.md)已补入 6 次完成确认，精确执行时刻未公布；它是核验子集，不代表全月清单。
[早期 12 轮历史审计](docs/historical-audit.md)用于回看证据，不能当作未来预测准确率。[信源判断方法](docs/credibility-methodology.md) · [怎么蹬的筛选依据](docs/research-pedaling-workflows.md)

## 个人额度

打开 [个人额度看板](https://resetcat.pages.dev/quota/)，可加载演示、下载示例或复制 Agent 指令。导入一次即显示最后观测的余额和已知期限。导入更多快照会在当前浏览器合并历史。看板可切换燃尽图、泳道图、时间范围和采样粒度。通过页面底部的「清除本机记录」删除导入的快照。不同域名和浏览器各自保存记录。

### Agent 指令

> 根据我手动提供或授权读取的额度信息，按下方 v1 示例生成 quota-snapshot.json。保留来源、池和周期的稳定本地 ID、单位、实际观测时间及当时剩余量。来源明确给出周期或期限时才填写，未知填 null。只有日期时保留 YYYY-MM-DD。观测时间须带时区。省略凭据、账户标识、原始日志和未经观测的历史。

### 快照格式 v1

```json
{
  "schemaVersion": 1,
  "timezone": "Asia/Shanghai",
  "pools": [
    {
      "sourceId": "codex",
      "sourceLabel": "Codex",
      "poolId": "weekly",
      "poolLabel": "周额度",
      "cycleId": "demo-week-01",
      "unit": "percent",
      "total": 100,
      "cycleStart": "2026-11-24T06:00:00+08:00",
      "resetsAt": "2026-11-24T09:00:00+08:00",
      "expiresAt": null,
      "deadlineAt": null,
      "observations": [
        {"observedAt": "2026-11-24T07:00:00+08:00", "remaining": 60},
        {"observedAt": "2026-11-24T07:30:00+08:00", "remaining": 55},
        {"observedAt": "2026-11-24T08:00:00+08:00", "remaining": 50}
      ]
    }
  ]
}
```

| 字段 | 约定 |
| --- | --- |
| `timezone` | IANA 时区。省略时使用 UTC。用于显示时间、按天采样和解释仅日期的期限。 |
| `sourceId` / `sourceLabel` | 稳定来源 ID 与显示名称。多个账户可用不同的本地别名。 |
| `poolId` / `poolLabel` | 来源内稳定的额度池 ID 与显示名称。 |
| `cycleId` | 建议提供稳定周期 ID。缺省时根据开始和期限字段识别周期。 |
| `unit` / `total` | `percent` 表示 0–100 的剩余百分比。也可用 `credits` 等原单位，未知总量填 null。 |
| `cycleStart` / `resetsAt` / `expiresAt` / `deadlineAt` | 周期开始、刷新、失效、自定计划期限。接受带时区的 ISO 8601 时间、YYYY-MM-DD 或 null。仅日期的期限按当地日期起点标记，界面保留日精度。 |
| `observations[]` | 至少一个观测点。用带时区的 `observedAt` 和非负数或 null 的 `remaining`。0 表示耗尽。 |

合并键为来源、池、单位、周期和观测时刻。同一键重复导入只保留一个点，后导入的值可更正该点。相同池和单位的其他周期可在跨周期视图中查看。小时或天采样取相应桶内的末点。

燃尽图在余额回升、周期切换、未知余额或间隔超过 6 小时处断开。近 24 小时内至少有 3 个连续点，跨度至少 1 小时，且最新观测距查看时刻不超过 6 小时时，才用首末余额之差估计平均速率。预测画到理论归零或已知期限中更早的时刻，点线表示均匀使用参考。余额只取导入的观测，过期时提示待更新。

### 本地打开看板

在仓库根目录运行以下命令，然后打开 [本地个人额度](http://127.0.0.1:8793/quota/)。

```bash
npm ci
npm run dev -- --ip 127.0.0.1 --port 8793
```

可在另一个终端运行 `node scripts/check-personal-quota.mjs`，使用本机 Chrome 验证导入、合并、刷新、图表和网络行为。额度看板本身可直接用演示数据或本地 JSON，无需配置抓取凭据。

### macOS 菜单栏应用

ResetCat Quota Bar 支持 macOS 14 及以上版本。安装需要 Node.js 和 Xcode 命令行工具。在仓库根目录运行：

```bash
npm ci
apps/quota-bar/install.sh
```

安装完成后，在系统菜单栏点单色小猫。齿轮菜单可加载演示、导入 JSON，或选定 AI Agent 会继续更新的本机快照。「完整图表」打开独立窗口，燃尽图和泳道图都读取同一份本机记录。菜单栏拥挤时，从 Spotlight 或 Finder 打开 `ResetCat Quota Bar` 调出面板。App 安装到 `~/Applications`，离线运行无需终端或 Node.js。

更新前从齿轮菜单退出应用，再运行安装脚本。另可使用第三方 CodexBar 查看其直接接入的额度来源。

```bash
brew install --cask codexbar
open -a CodexBar
```

在 CodexBar 的 Settings → Providers 中启用 Codex。个人额度网页通过 JSON 快照更新。[CodexBar 官方安装说明](https://github.com/steipete/CodexBar#install)

## 本地运行与自托管

```sh
npm install
npm run db:migrate:local
cp .dev.vars.example .dev.vars
npm run dev
```

当前使用 Cloudflare Workers + D1，约每 20 分钟检查 Tibo 的新帖与回复；规则结合 AI 复核，并用持久投递记录去重。
需要 Node.js 22+；真实抓取需要自己的 X API 凭据。完整检查运行 `npm run check`。

部署、Cloudflare Secrets、通知接收者、邮件及 API 说明统一放在 [自托管与运维](docs/self-hosting.md)。
[通知通道与验收范围](docs/self-hosting.md#通知通道与验收范围) · [同类产品核查](docs/research-competitors.md) · [分享文案](docs/launch/sharing-plan.md)
[架构图与截图](https://codex-reset-watcher.weican16hit.workers.dev/showcase/) · [技术文档](docs/architecture.md) · [贡献](CONTRIBUTING.md) · [安全反馈](SECURITY.md) · [许可证](LICENSE)

中文网页与钉钉使用中文小猫图，英文网页使用英文小猫图。项目与 OpenAI、X 或被追踪账号无官方隶属关系。
