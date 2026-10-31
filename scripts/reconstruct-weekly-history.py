#!/usr/bin/env python3
"""Extract quota telemetry only, without retaining conversation contents."""
import datetime as dt
import json
import os
from pathlib import Path
import statistics
import subprocess

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / '.wrangler/personal-usage-watch'


def save(name, value):
    OUTPUT.mkdir(parents=True, exist_ok=True, mode=0o700)
    path = OUTPUT / name
    fd = os.open(path, os.O_CREAT | os.O_TRUNC | os.O_WRONLY, 0o600)
    with os.fdopen(fd, 'w') as stream:
        stream.write(value)


def main():
    sessions = [p for p in (Path.home() / '.codex/sessions', Path.home() / '.codex/archived_sessions') if p.exists()]
    process = subprocess.Popen(['rg', '--json', '"rate_limits"', *map(str, sessions), '--glob', '*.jsonl'],
                               stdout=subprocess.PIPE, text=True)
    rows = []
    for line in process.stdout:
        try:
            hit = json.loads(line)
            if hit.get('type') != 'match':
                continue
            row = json.loads(hit['data']['lines']['text'])
            payload = row.get('payload', {})
            if row.get('type') != 'event_msg' or payload.get('type') != 'token_count':
                continue
            limits = payload.get('rate_limits') or {}
            for slot in ('primary', 'secondary'):
                window = limits.get(slot) or {}
                if window.get('window_minutes') == 10080 and isinstance(window.get('resets_at'), (int, float)):
                    rows.append({'observed_at': row['timestamp'], 'slot': slot, 'limit_id': limits.get('limit_id'),
                                 'used_percent': window.get('used_percent'), 'resets_at': window['resets_at']})
        except (ValueError, KeyError, TypeError):
            continue
    if process.wait() not in (0, 1):
        raise RuntimeError('history_scan_incomplete')
    # Forked/archived rollouts may repeat the same telemetry; retain one copy.
    rows = list({(r['observed_at'], r['slot'], r['limit_id'], r['used_percent'], r['resets_at']): r for r in rows}.values())
    rows.sort(key=lambda r: r['observed_at'])
    save('local-weekly-observations.json', json.dumps({'scope': 'quota telemetry only; historical account identity unavailable; not a complete reset ledger', 'observations': rows}) + '\n')
    clusters = []
    for value in sorted({r['resets_at'] for r in rows if r['limit_id'] == 'codex'}):
        if not clusters or value - clusters[-1][-1] > 300:
            clusters.append([value])
        else:
            clusters[-1].append(value)
    anchors = {value: int(statistics.median(cluster)) for cluster in clusters for value in cluster}
    windows = {}
    for row in rows:
        if row['limit_id'] != 'codex':
            continue
        anchor = anchors[row['resets_at']]
        window = windows.setdefault(anchor, {'next_reset_epoch': anchor, 'first_observed': row['observed_at'],
                                            'last_observed': row['observed_at'], 'observations': 0})
        window['last_observed'] = row['observed_at']
        window['observations'] += 1
    ordered = sorted(windows.values(), key=lambda w: w['first_observed'])
    save('historical-weekly-windows.json', json.dumps({'basis': 'codex expiry clusters with <=5min adjacent jitter; identities unknown; not confirmed resets', 'windows': ordered}, indent=2) + '\n')
    text = '# 私有历史补查\n\n这是一份窗口观察索引，不是已确认重置清单。历史账号归属未知；不能把窗口起点推断写成全局到账事实。\n\n'
    text += 'Usage过去30天历史于2026-10-31再次读回：10月8日07:38获得重置卡，10月29日22:19使用重置卡（北京时间）。没有更早分页入口；不宣称所有历史已找全。\n\n'
    text += f'本机额度观察 {len(rows)} 条，codex桶约 {len(ordered)} 组窗口；其他桶不混算。\n\n'
    text += '| 首次观察（北京时间） | 最后观察 | 下次到期 | 到期减7天（仅推断） | 观察条数 |\n|---|---|---|---|---:|\n'
    zone = dt.timezone(dt.timedelta(hours=8))
    def format_time(value):
        return dt.datetime.fromtimestamp(value, zone).strftime('%Y-%m-%d %H:%M')
    for window in ordered:
        first = dt.datetime.fromisoformat(window['first_observed'].replace('Z', '+00:00')).timestamp()
        last = dt.datetime.fromisoformat(window['last_observed'].replace('Z', '+00:00')).timestamp()
        text += f'| {format_time(first)} | {format_time(last)} | {format_time(window["next_reset_epoch"])} | {format_time(window["next_reset_epoch"] - 604800)} | {window["observations"]} |\n'
    save('history-review.md', text)
    print(json.dumps({'observations': len(rows), 'window_clusters': len(ordered), 'confirmed_global_resets_from_this_scan': 0}))


if __name__ == '__main__':
    main()
