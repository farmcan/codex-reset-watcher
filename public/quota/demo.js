export const demo = {
  "schemaVersion": 1,
  "timezone": "Asia/Shanghai",
  "pools": [
    {
      "sourceId": "codex", "sourceLabel": "Codex", "poolId": "weekly", "poolLabel": "周额度",
      "cycleId": "demo-week-01", "unit": "percent", "total": 100,
      "cycleStart": "2026-11-24T06:00:00+08:00", "resetsAt": "2026-11-24T09:00:00+08:00",
      "observations": [
        {"observedAt": "2026-11-24T07:00:00+08:00", "remaining": 60},
        {"observedAt": "2026-11-24T07:30:00+08:00", "remaining": 55},
        {"observedAt": "2026-11-24T08:00:00+08:00", "remaining": 50}
      ]
    },
    {
      "sourceId": "codex", "sourceLabel": "Codex", "poolId": "five-hour", "poolLabel": "短时额度",
      "cycleId": "demo-short-01", "unit": "percent", "total": 100,
      "cycleStart": "2026-11-24T05:00:00+08:00", "resetsAt": "2026-11-24T10:00:00+08:00",
      "observations": [
        {"observedAt": "2026-11-24T06:00:00+08:00", "remaining": 98},
        {"observedAt": "2026-11-24T07:00:00+08:00", "remaining": 88},
        {"observedAt": "2026-11-24T08:00:00+08:00", "remaining": 76}
      ]
    },
    {
      "sourceId": "demo-b", "sourceLabel": "来源 B", "poolId": "grant", "poolLabel": "赠送额度",
      "cycleId": "demo-grant-01", "unit": "credits", "total": 100, "expiresAt": "2026-11-24T10:00:00+08:00",
      "observations": [
        {"observedAt": "2026-11-24T06:00:00+08:00", "remaining": 60},
        {"observedAt": "2026-11-24T07:00:00+08:00", "remaining": 40},
        {"observedAt": "2026-11-24T08:00:00+08:00", "remaining": 20}
      ]
    },
    {
      "sourceId": "demo-c", "sourceLabel": "来源 C", "poolId": "plan", "poolLabel": "订阅额度",
      "cycleId": "demo-plan-01", "unit": "percent", "total": 100, "resetsAt": "2026-11-25T18:00:00+08:00",
      "observations": [
        {"observedAt": "2026-11-24T06:00:00+08:00", "remaining": 84},
        {"observedAt": "2026-11-24T07:00:00+08:00", "remaining": 78},
        {"observedAt": "2026-11-24T08:00:00+08:00", "remaining": 72}
      ]
    },
    {
      "sourceId": "demo-d", "sourceLabel": "来源 D", "poolId": "bundle", "poolLabel": "资源包",
      "cycleId": "demo-bundle-01", "unit": "credits", "total": 500,
      "cycleStart": "2026-11-23T15:00:00+08:00", "deadlineAt": "2026-11-25",
      "expiresAt": "2026-11-24T11:00:00+08:00",
      "observations": [
        {"observedAt": "2026-11-24T05:00:00+08:00", "remaining": 260},
        {"observedAt": "2026-11-24T06:00:00+08:00", "remaining": 240},
        {"observedAt": "2026-11-24T07:00:00+08:00", "remaining": 210},
        {"observedAt": "2026-11-24T08:00:00+08:00", "remaining": 180}
      ]
    }
  ]
}
;
export const demoNow = Date.parse("2026-11-24T08:05:00+08:00");
