#!/usr/bin/env python3
"""Publish allowlisted execution status only; never publish personal quota data."""
import base64
import datetime as dt
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
PRIVATE = ROOT / '.wrangler/personal-usage-watch'
sys.path.insert(0, str(ROOT / '.wrangler'))

JOB = 'codex-personal-usage-watch'
ENDPOINT = 'repos/farmcan/seed/contents/content/briefs/watch-activity/status.json'


def publish():
    state = json.loads((PRIVATE / 'state.json').read_text())
    at = dt.datetime.fromtimestamp(state['checked_at'], dt.timezone.utc)
    stamp = at.isoformat()
    partial = bool(state.get('errors') or state.get('notification_errors') or state.get('publication_errors'))
    pending = PRIVATE / 'status.pending-publication.json'
    history = json.loads(pending.read_text()) if pending.exists() else []
    event = {'id': f'{JOB}-{int(state["checked_at"] * 1000)}', 'job_id': JOB,
             'finished_at': stamp, 'result': '个人额度只读复查部分失败，变化未知；保留私有断点' if partial else
             '个人额度与公开信号复查完成；私有证据已保存，未向公开站点写入账号用量',
             'new_fulltexts': None, 'settled': None, 'posts': None,
             'sources_ok': None, 'sources_failed': None}
    if state.get('public_fetch', {}).get('attempts', 1) > 1:
        event['result'] += '；公开接口只读传输重试后' + ('仍有缺口' if 'public_signal_check_failed' in state.get('errors', []) else '读取成功')
    if event['id'] not in {e['id'] for e in history}:
        history.append(event)
    pending.write_text(json.dumps(history, ensure_ascii=False, indent=2) + '\n')
    from seed_status_pkg.site.watch_activity import validate
    for attempt in range(3):
        current = json.loads(subprocess.run(['gh', 'api', ENDPOINT], check=True, capture_output=True, text=True).stdout)
        data = json.loads(base64.b64decode(current['content']))
        job = next((j for j in data['jobs'] if j['id'] == JOB), None)
        if job is None:
            job = {'id': JOB, 'title': 'Codex 个人额度到账复查', 'schedule': '本机 Codex heartbeat 每30分钟；依赖Mac在线与已登录会话',
                   'stage': '真实只读采样与本人钉钉私聊测试通过；自然到账闭环待验',
                   'scope': '本机读取weekly窗口；额度恢复与重置卡分开；新增一手重置消息后1/3小时复查。本人钉钉私聊通知，不公开个人用量。',
                   'next_step': '验收首次自然调度；真实额度变化发生后再验收到账提醒。', 'url': '/tasks/', 'account_ids': []}
            data['jobs'].append(job)
        job['scope'] = '本机读取weekly窗口；额度恢复与重置卡分开；新增一手重置消息后1/3小时复查。本人钉钉私聊通知，不公开个人用量。'
        job['monitor'] = {'state': 'enabled', 'heartbeat_at': stamp,
                          'next_expected_at': (at + dt.timedelta(minutes=30)).isoformat(), 'grace_seconds': 1800}
        if partial:
            job['stage'] = '本轮读取部分失败，个人到账或来源变化未知；私有断点保留'
        else:
            job['stage'] = '额度只读、本人钉钉与可缩放周期图已接线；自然到账闭环待验'
        ids = {e['id'] for e in data['history']}
        data['history'].extend(e for e in history if e['id'] not in ids)
        started = f'{JOB}-started-20261031'
        if not any(e['id'] == started for e in data.get('incidents', [])):
            data.setdefault('incidents', []).append({'id': started, 'job_id': JOB,
                'opened_at': dt.datetime.fromtimestamp(state['started_at'], dt.timezone.utc).isoformat(),
                'updated_at': stamp, 'status': 'recorded',
                'summary': '新增个人额度到账复查；已实测官方App Server只读采样',
                'impact': '此前只有一次人工核对；新增前后采样与延迟复查，私人数据只在本机。公开X监测与原通知渠道保持原运行方式。',
                'next_step': '定时配置、首次自然执行、真实到账与通知分别验收；机器离线时覆盖未知。'})
        incident_ids = {e['id'] for e in data.get('incidents', [])}
        for event in state.get('outbox', []):
            if event['kind'] not in ('monitor_error', 'monitor_recovered', 'monitor_gap'):
                continue
            event_id = JOB + '-' + event['id']
            if event_id in incident_ids:
                continue
            event_time = dt.datetime.fromtimestamp(event['observed_at'], dt.timezone.utc).isoformat()
            recovered = event['kind'] == 'monitor_recovered'
            gap = event['kind'] == 'monitor_gap'
            gap_minutes = round((event['observed_between'][1]-event['observed_between'][0])/60) if gap else None
            data['incidents'].append({'id': event_id, 'job_id': JOB, 'opened_at': event_time, 'updated_at': event_time,
                'status': 'recorded', 'summary': '个人复查执行记录存在间隔' if gap else '个人复查来源读取恢复' if recovered else '个人复查来源读取一度失败',
                'impact': f'相邻记录间隔约{gap_minutes}分钟，超过计划及宽限；本次个人额度读取已完成，中间覆盖未知，原因未确认。' if gap else '该来源本轮读取已成功；不代表额度到账或其他来源恢复。' if recovered else '对应时段到账验证覆盖未知，未把读取失败解释为没有重置。',
                'next_step': '保留前后私有执行证据，继续按原频率复查；实际到账需另有采样变化。'})
        route_id = JOB + '-owner-dingtalk-20261031'
        if route_id not in incident_ids:
            data['incidents'].append({'id': route_id, 'job_id': JOB, 'opened_at': stamp, 'updated_at': stamp,
                'status': 'recorded', 'summary': '按用户最终选择改为本人钉钉私聊；测试已投递',
                'impact': '交叉核对本人身份后，官方CLI返回delivered及消息ID；未将私人用量发送到原两人群。普通私聊回执不等于手机已读。',
                'next_step': '首次自然触发及真实到账闭环仍待独立验收；前端展示方案已记录，公共观察接口尚未上线。'})
        data['checked_at'] = stamp
        validate(data)
        body = {'message': 'Record private Codex usage check without personal data', 'branch': 'main',
                'sha': current['sha'], 'content': base64.b64encode((json.dumps(data, ensure_ascii=False, indent=2) + '\n').encode()).decode()}
        result = subprocess.run(['gh', 'api', '--method', 'PUT', ENDPOINT, '--input', '-'],
                                input=json.dumps(body), capture_output=True, text=True)
        if result.returncode == 0:
            commit = json.loads(result.stdout)['commit']['sha']
            (PRIVATE / 'status-publication.json').write_text(json.dumps({'commit': commit, 'at': stamp,
                    'production_verified': False}) + '\n')
            pending.unlink()
            print(json.dumps({'status': 'committed_pending_production', 'commit': commit}))
            return
    raise RuntimeError('status_publish_failed_pending_retained')


if __name__ == '__main__':
    publish()
