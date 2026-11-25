import { demo } from './demo.js';

export const agentTemplate = JSON.stringify({
  schemaVersion: 1,
  timezone: demo.timezone,
  pools: [{
    ...demo.pools[0], expiresAt: null, deadlineAt: null, observations: demo.pools[0].observations.slice(0, 1)
  }]
}, null, 2);

const guideZH = `请帮我将本机已登录、且我已授权读取的额度来源接到 ResetCat。先通过只读额度接口查询一次，验证真实读数并生成合法的 v1 quota-snapshot.json。再按本机支持的方式建立对话结束后仍运行的本机定时任务，默认每 5 分钟重新查询并原子更新同一个文件。

每次成功查询填写实际观测时间、单位和剩余量。使用稳定的来源、额度池和周期 ID，各个窗口分开。周期开始、重置、到期和计划期限只填写来源实际提供的值，未知填 null，只有日期时保留 YYYY-MM-DD。失败时保留上一次有效文件，不能补造观测或更新时间。仅使用用户授权的只读接口，省略凭据、账号标识及原始日志，不发送模型请求。

完成后告诉我在 ResetCat「监测本机快照」里唯一需要选定的完整文件路径、实际刷新周期和停止方式。验证至少一次自动更新后两处都显示新的观测时间。如果本机无法建立持续任务，请明确只有一次性快照，并说明原因。以下数字只是模板示例，请替换为实际观测。`;

const guideEN = `Connect ResetCat to local quota sources I have signed into and authorized you to read. Read the actual quota once through a read-only interface and create a valid v1 quota-snapshot.json. Set up a local scheduled job that continues after this conversation. By default, read again every five minutes and atomically replace the same file.

Record the actual observation time, unit, and remaining amount after every successful query. Use stable local IDs for sources, pools, and cycles. Keep windows separate. Copy source-provided cycle starts, resets, expiries, and deadlines. Use null for unknown values and keep date-only deadlines as YYYY-MM-DD. On failure, preserve the last valid file and its observation time. Use authorized read-only sources, omit credentials, account identifiers, and raw logs, and make no model requests.

Tell me the one absolute path to select in ResetCat, the actual refresh interval, and how to stop the job. Verify an automatic update changes the observation time in both views. If a persistent job cannot run on this machine, explain that you produced a one-time snapshot. Replace the example values below with actual observations.`;

export function formatAgentGuide(language = 'zh') {
  return (language === 'en' ? guideEN : guideZH) + '\n\n' + agentTemplate;
}
