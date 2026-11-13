# 小猫重置雷达插件

维护入口：本文件。首版 `0.1.0` 是只读状态面板，不包含 Skill、LLM 问答、后台任务执行或个人额度读取。上游信号内容与复核沿用既有 Watcher；本插件不新增模型请求。

- 在线面板：<https://codex-reset-radar.weican16hit.workers.dev/>
- 安装说明：<https://codex-reset-radar.weican16hit.workers.dev/install>
- 远程 MCP：<https://codex-reset-radar.weican16hit.workers.dev/mcp>
- 固定版本：Git tag `plugin-v0.1.0`，从仓库 marketplace 分发。

## 在另一台电脑安装

同一 ChatGPT 账号优先使用[个人测试插件](https://chatgpt.com/plugins/plugin_asdk_app_6af6d57b5bb08191b18f8f4d0b303070/app/open_reset_radar)。已在真实 ChatGPT Web 宿主直接渲染与刷新，不发送聊天消息。该个人入口不等于公共目录发布，也不授予其他账号访问权限。个人插件外壳的默认版本显示为1.0.0；面板及仓库发行版本为0.1.0。


需要支持 `codex plugin` 的新版 Codex CLI，以及支持 MCP App 静态入口的图形客户端。

```sh
codex plugin marketplace add farmcan/codex-reset-watcher --ref plugin-v0.1.0
codex plugin add reset-radar@reset-radar
```

安装后重新打开客户端或新建会话；从应用入口打开「小猫重置雷达」。CLI 只负责安装，不渲染图形面板。若客户端未显示入口，可使用在线面板；这不等于已经验收该客户端的插件 UI。

支持自定义远程 MCP 的客户端也可直接添加上述 `/mcp` URL，选择无需认证。不要填写 OpenAI、X 或 Cloudflare 凭据。

## 产品行为

直接打开面板看信号、来源检查与最近动态。每分钟刷新，切回可见时刷新；隐藏时不轮询，关闭后停止。首次查看不把历史事件当新通知；已读时间、外观和提示音偏好仅保存在当前设备，存储不可用时退回当前面板内存。

提示音需主动点击开启并由用户动作解锁音频。面板内提示不等于系统后台推送；跨重启是否自动解锁音频由宿主策略决定。离开面板后的提醒通过现有网站通知渠道，用户自行入群/订阅；安装插件不自动订阅，也不开通个人私信。没有测试或发送任何新通知给群成员。

源健康与通知通道健康分开。本面板只用 `source_status` 与一手来源最近成功时间判断新鲜度；时间超出原监控三个周期加60秒时显示覆盖未知。请求失败保留旧记录但不显示健康。Banked reset、自动全量重置、预告和确认明确区分；无原文执行时间时不生成倒计时。

## 架构与许可

`apps/reset-radar/` 是独立 Cloudflare Worker，经 `RADAR` Service Binding 只读原 Worker 的 `/api/status`。只投影8条已公开信号和必要状态，缓存60秒；不对外暴露上游原始诊断、投递日志或个人观察。没有新建 Cron、D1数据库、付费模型或数据采集任务。原站源码、监控频率与通知队列不变。托管请求使用既有 Cloudflare 账户，实际增量账单未核实，不能称为账单硬上限。

复用 MIT 的 `@modelcontextprotocol/sdk@1.32.2`（服务器/HTTP transport）和 `@modelcontextprotocol/ext-apps@1.2.2`（面板桥接），没有自行重写 MCP。`package-lock.json` 固定依赖；`THIRD_PARTY.md` 记录来源。SVG 小猫和 CSS 为本版本代码原生素材；未发布之前仍待确认的设计样机。

`plugins/reset-radar/` 是便携 Agent Plugins 包，`.agents/plugins/marketplace.json` 是仓库目录。唯一 MCP 工具 `open_reset_radar` 标记为只读、仅应用可见，声明 `global` 与 `thread` 静态入口；不向聊天发送消息。UI 用 App bridge 调用只读工具更新，独立网页直接请求 `/api/panel`。

## 开发与发布

```sh
npm ci
npm ci --prefix apps/reset-radar
npm run build --prefix apps/reset-radar
npm run typecheck --prefix apps/reset-radar
npm test --prefix apps/reset-radar
npm run check
npx wrangler whoami
npx wrangler deploy --config apps/reset-radar/wrangler.jsonc
```

正式发布前检查 Cloudflare 100% Active版本、真实 `/api/panel`、MCP initialize/list/call/resource、浏览器加载及响应式交互。仓库发行版ZIP仅包含插件manifest、MCP配置、图标、说明和许可证，不包含源码依赖、私有数据或凭据。完整源码由固定Git tag提供。

官方公共目录与仓库测试分发分开：公共目录要求组织发布权限、开发者个人或企业身份验证、域名challenge、自动检查与人工审核。当前账号的官方上传入口提示先完成开发者身份验证；未完成公共目录上架。认证可能涉及本人资料，不能用仓库分发成功冒称已通过。

## 验收记录

实际结果、生产版本、浏览器截图及宿主能力缺口见 `acceptance.json`；任务开始与结束经 Seed 既有 `/tasks/` 审查事件链留痕。历史快照不代表实时监控健康。
