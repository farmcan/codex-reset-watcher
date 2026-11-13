小猫重置雷达的首个可安装预览版：直接展示 Cloudflare 上的公开重置信号，不需要 API Key，不发起 AI 对话。

- [在线面板](https://codex-reset-radar.weican16hit.workers.dev/)
- [安装与通知说明](https://codex-reset-radar.weican16hit.workers.dev/install)
- [同一账号的个人测试插件](https://chatgpt.com/plugins/plugin_asdk_app_6af6d57b5bb08191b18f8f4d0b303070/app/open_reset_radar)：已在本次账号创建、连接并在真实 ChatGPT Web 宿主中直接打开和刷新；其他账号不自动获得访问权限。

在另一台装有新版 Codex CLI 的电脑安装仓库版本：

```sh
codex plugin marketplace add farmcan/codex-reset-watcher --ref plugin-v0.1.0
codex plugin add reset-radar@reset-radar
```

安装后重开图形客户端或开始新会话。图形面板依赖宿主支持 MCP App 静态入口；CLI 只负责安装。Codex 原生窗口因本次工具访问限制尚未单独验收，不能把 CLI 安装成功当作原生 UI 已验收。

本版包含浅色/深色主题、响应式小猫面板、8条动态的精简云端投影（面板展示最近5条）、手动与可见时定时刷新、已读标记、主动开启的面板提示音、来源过期与断网状态，以及现有通知渠道入口。离开面板后的提醒通过用户自行加入的现有渠道；没有插件后台系统推送、个人额度读取或自动开工。

发布验证：原项目147项加新增7项，共154项测试通过；插件类型检查、生产MCP初始化/工具/资源、真实Cloudflare数据、真实ChatGPT Web面板与刷新、浅/深色、窄面板无横向溢出、断网覆盖未知与恢复通过。依赖生产审计未发现已知漏洞。自然新事件送达和长期提示音未由本次短测证明。

这不是官方公共目录上架版本。官方上传入口当前要求完成开发者个人或企业身份验证；后续还有域名验证与审核。仓库测试分发可以先使用。ZIP只包含manifest、远程MCP配置、图标、说明与许可证；无需把任何密钥放进安装包。

完整源码、许可与当前验收边界见本版本Git tag中的 `docs/plugin/README.md` 与 `docs/plugin/acceptance.json`。
