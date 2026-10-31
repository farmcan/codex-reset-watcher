#!/usr/bin/env python3
"""Read-only personal quota probe. Private state stays outside public assets."""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import selectors
import shutil
import subprocess
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / '.wrangler/personal-usage-watch/state.json'
URL = 'https://codex-reset-watcher.weican16hit.workers.dev/api/status'


def rpc_usage():
    binary = shutil.which('codex') or '/Applications/Codex.app/Contents/Resources/codex'
    process = subprocess.Popen([binary, 'app-server'], stdin=subprocess.PIPE,
                               stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ)
    buffer = b''

    def call(number, method, params=None):
        nonlocal buffer
        request = {'id': number, 'method': method}
        if params is not None:
            request['params'] = params
        process.stdin.write((json.dumps(request) + '\n').encode())
        process.stdin.flush()
        end = time.monotonic() + 25
        while time.monotonic() < end:
            if b'\n' not in buffer:
                if not selector.select(max(0, end - time.monotonic())):
                    break
                chunk = os.read(process.stdout.fileno(), 65536)
                if not chunk:
                    break
                buffer += chunk
                continue
            line, buffer = buffer.split(b'\n', 1)
            reply = json.loads(line)
            if reply.get('id') == number:
                if 'error' in reply:
                    raise RuntimeError('rpc_error_' + str(reply['error'].get('code')))
                return reply['result']
        raise TimeoutError('rpc_timeout')

    try:
        call(1, 'initialize', {'clientInfo': {'name': 'personal_reset_watch', 'version': '0.1.0'}})
        process.stdin.write(b'{"method":"initialized"}\n')
        process.stdin.flush()
        return call(2, 'account/rateLimits/read')
    finally:
        selector.close()
        process.terminate()
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()


def snapshot(raw, now):
    # Never persist tokens, account IDs, email addresses, or paid-credit balances.
    account = raw.get('accountId')
    if not isinstance(account, str) or not account:
        raise ValueError('account_identity_unavailable')
    buckets = raw.get('rateLimitsByLimitId') or {'codex': raw.get('rateLimits', {})}
    windows = {}
    for bucket, limits in buckets.items():
        for slot in ('primary', 'secondary'):
            w = limits.get(slot) or {}
            if w.get('windowDurationMins') != 10080:
                continue
            used, reset = w.get('usedPercent'), w.get('resetsAt')
            if not isinstance(used, (int, float)) or not 0 <= used <= 100:
                continue
            if not isinstance(reset, (int, float)) or reset <= now:
                continue
            windows[f'{bucket}:{slot}'] = {'used': used, 'reset': reset}
    if not windows:
        raise ValueError('weekly_window_unavailable')
    credits = raw.get('rateLimitResetCredits') or {}
    return {'at': now, 'account': hashlib.sha256(account.encode()).hexdigest(),
            'windows': windows, 'available_resets': credits.get('availableCount')}


def compare(previous, current):
    if not previous or previous['account'] != current['account']:
        return []  # First observation / account switch creates a baseline only.
    events = []
    for key, new in current['windows'].items():
        old = previous['windows'].get(key)
        if not old or old['used'] - new['used'] < 2:
            continue
        natural = previous['at'] < old['reset'] <= current['at']
        events.append({'kind': 'weekly_refill' if natural else 'quota_recovered',
                       'window': key, 'observed_between': [previous['at'], current['at']],
                       'used_before': old['used'], 'used_after': new['used'],
                       'next_reset': new['reset'],
                       'cause': 'scheduled_window' if natural else 'unknown_or_manual_reset'})
    before, after = previous.get('available_resets'), current.get('available_resets')
    if isinstance(before, int) and isinstance(after, int) and after > before:
        events.append({'kind': 'reset_card_granted', 'observed_between': [previous['at'], current['at']]})
    return events


def delayed_checks(state, live, now, recovered):
    if live.get('source_status') != 'healthy':
        raise ValueError('public_source_unhealthy')
    pending = state.setdefault('signals', {})
    # On installation, also watch the latest still-open, typed announcement.
    # It may predate our baseline, but must not replay elapsed reminders.
    bootstrap = None
    if not state.get('current_round_bootstrapped'):
        completed = {s.get('cluster_key') for s in live.get('signals', []) if s.get('event_type') == 'explicit_reset'}
        candidates = [s for s in live.get('signals', []) if s.get('source_tier') in ('A1', 'A2')
                      and s.get('event_type') == 'scheduled_reset' and s.get('reset_mode') in ('hard_reset', 'banked_reset')
                      and not s.get('superseded_by_post_id') and s.get('cluster_key') not in completed
                      and 0 <= now - dt.datetime.fromisoformat(s['created_at'].replace('Z', '+00:00')).timestamp() <= 86400]
        if candidates:
            bootstrap = max(candidates, key=lambda s: s['created_at']).get('post_id')
        state['current_round_bootstrapped'] = True
    for signal in sorted(live.get('signals', []), key=lambda s: s['created_at']):
        key = str(signal.get('cluster_key') or signal.get('post_id') or signal['id'])
        try:
            references = json.loads(signal.get('referenced_post_ids') or '[]')
        except (ValueError, TypeError):
            references = []
        linked = [k for k, s in pending.items() if any(ref in s.get('post_ids', []) for ref in references)]
        if len(linked) == 1:
            key = linked[0]
        if signal.get('superseded_by_post_id'):
            continue
        if signal.get('reset_mode') not in ('hard_reset', 'banked_reset', 'unknown'):
            continue
        if signal.get('source_tier') not in ('A1', 'A2'):
            continue
        if signal.get('event_type') not in ('scheduled_reset', 'explicit_reset'):
            continue
        published = dt.datetime.fromisoformat(signal['created_at'].replace('Z', '+00:00')).timestamp()
        if published < state['started_at'] and signal.get('post_id') != bootstrap:
            continue  # Never replay historical announcements on installation.
        timing = signal.get('reset_timing') or {}
        when = timing.get('scheduled_for')
        due = max(published, dt.datetime.fromisoformat(when.replace('Z', '+00:00')).timestamp()) if when else published
        entry = pending.setdefault(key, {'due': due, 'checks': [], 'resolved': False, 'post_ids': []})
        if signal.get('post_id') == bootstrap and published < state['started_at']:
            entry['checks'] = [d for d in (3600, 10800) if now >= due + d]
        if signal.get('reset_mode') != 'unknown' or 'mode' not in entry:
            entry['mode'] = signal.get('reset_mode')
        if signal.get('post_id') and signal['post_id'] not in entry.setdefault('post_ids', []):
            entry['post_ids'].append(signal['post_id'])
    visible = {s.get('post_id'): s for s in live.get('signals', [])}
    for entry in pending.values():
        posts = entry.get('post_ids', [])
        entry['superseded'] = bool(posts) and all(visible.get(p, {}).get('superseded_by_post_id') for p in posts)
    # An observed recovery cannot close multiple overlapping announcements.
    # Time proximity yields a tentative association, never proof of global rollout.
    recoveries = recovered if isinstance(recovered, list) else [{'kind': 'quota_recovered'}] if recovered else []
    for event in recoveries:
        banked = event['kind'] == 'reset_card_granted'
        eligible = [(key, s) for key, s in pending.items()
                    if not s['resolved'] and not s.get('superseded') and s['due'] <= now <= s['due'] + 36 * 3600
                    and ((s.get('mode') == 'banked_reset') if banked else s.get('mode') != 'banked_reset')]
        if len(eligible) == 1:
            key, signal = eligible[0]
            signal['resolved'] = True
            event['related_signal'] = key
            event['association'] = 'single_active_round_time_match'
            signal.setdefault('arrival_observations', []).append(event)
    notices = []
    for key, signal in pending.items():
        if signal['resolved'] or signal.get('superseded'):
            continue
        for delay in (3600, 10800):
            if now >= signal['due'] + delay and delay not in signal['checks']:
                signal['checks'].append(delay)
                # If the machine slept through both deadlines, send one current check.
                notices = [n for n in notices if n.get('signal') != key]
                notices.append({'kind': 'arrival_unconfirmed', 'signal': key, 'reset_mode': signal.get('mode'),
                                'hours_after_signal': delay // 3600})
    return notices


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_suffix('.tmp')
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write('\n')
    os.replace(temporary, path)


def notify_dingtalk(state):
    owner = json.loads((STATE.parent / 'dingtalk-owner.json').read_text())['user_id']
    auth = json.loads(subprocess.run(['dws', 'auth', 'status', '--format', 'json'],
                                   capture_output=True, text=True, check=True, timeout=30).stdout)
    if auth.get('user_id') != owner or not auth.get('authenticated'):
        raise ValueError('dingtalk_owner_identity_mismatch')
    labels = {'quota_recovered': '个人额度恢复观察', 'weekly_refill': '周窗口到期后额度恢复观察',
              'reset_card_granted': '重置卡新增', 'arrival_unconfirmed': '延迟复查：尚未确认到账',
              'monitor_error': '个人额度监测异常', 'monitor_recovered': '个人额度监测读取恢复'}
    for event in state['outbox']:
        if event.get('acknowledged_at') or event.get('delivery'):
            continue  # A previous sending/unknown/failed outcome is never blindly replayed.
        title = labels.get(event['kind'], '个人额度复查')
        text = f'【{title}】\n'
        if event['kind'] in ('quota_recovered', 'weekly_refill'):
            zone = dt.timezone(dt.timedelta(hours=8))
            interval = [dt.datetime.fromtimestamp(t, zone).strftime('%m-%d %H:%M') for t in event['observed_between']]
            text += f'采样区间（北京时间）：{interval[0]}—{interval[1]}。已观察到weekly用量下降；具体执行时刻及原因未获服务端证明，可能包括正常周补充或手动用卡，不能据此认定全局自动重置。'
        elif event['kind'] == 'arrival_unconfirmed':
            target = '重置卡新增' if event.get('reset_mode') == 'banked_reset' else '额度恢复'
            text += f'距对应公开信号或明确执行时间已约{event["hours_after_signal"]}小时，本机复查尚未观察到{target}。该结果不代表确定未到账；继续保留后续采样。'
        elif event['kind'] == 'reset_card_granted':
            text += '可用重置卡数量增加；这是卡发放观察，不是已经使用或自动恢复额度。'
        else:
            text += '本机只读复查的读取状态发生变化。来源不可读时到账情况未知；异常与恢复按各自来源独立记录。'
        text += '\n仅本人私聊通知；公开预告、个人观察、手动使用卡分别记录。'
        event['delivery'] = {'status': 'sending', 'channel': 'dingtalk_owner_dm'}
        save(STATE, state)
        try:
            result = subprocess.run(['dws', 'chat', '+messages-send', '--as', 'user', '--user', owner,
                    '--text', '-', '--body-stdin', '--idempotency-key', 'personal-usage-' + event['id'],
                    '--wait-delivery', '--yes', '--format', 'json'], input=text, capture_output=True,
                    text=True, timeout=50)
            receipt = json.loads(result.stdout)
            delivered = receipt.get('deliveryStatus') == 'delivered' and bool(receipt.get('openMessageId'))
            event['delivery'] = {'status': 'delivered' if delivered else 'unknown',
                                 'channel': 'dingtalk_owner_dm', 'message_id': receipt.get('openMessageId')}
            if delivered:
                event['acknowledged_at'] = time.time()
        except Exception:
            event['delivery'] = {'status': 'unknown', 'channel': 'dingtalk_owner_dm'}
        save(STATE, state)


def publish_observations(state):
    config_path = STATE.parent / 'observation-ingest.json'
    if not config_path.exists():
        return  # Publication remains disabled until the scoped endpoint is configured.
    config = json.loads(config_path.read_text())
    for event in state['outbox']:
        if event['kind'] not in ('quota_recovered', 'weekly_refill', 'reset_card_granted') or event.get('public_observation') == 'accepted':
            continue
        start, end = event.get('observed_between', [event['observed_at'], event['observed_at']])
        stamp = lambda t: dt.datetime.fromtimestamp(t, dt.timezone.utc).isoformat()
        round_state = state.get('signals', {}).get(event.get('related_signal'), {})
        posts = round_state.get('post_ids', [])
        row = {'id': 'probe-' + hashlib.sha256(event['id'].encode()).hexdigest()[:24],
               'kind': event['kind'], 'source': 'account_probe', 'assurance': 'direct',
               'interval_start': stamp(start), 'interval_end': stamp(end), 'observed_at': stamp(event['observed_at']),
               'signal_post_id': posts[-1] if posts and event['kind'] != 'weekly_refill' else None}
        request = urllib.request.Request(URL.replace('/api/status', '/api/admin/arrival-observations'),
            data=json.dumps([row]).encode(), method='POST',
            headers={'Authorization': 'Bearer ' + config['token'], 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(request, timeout=20) as response:
            result = json.load(response)
        if result.get('accepted') != 1:
            raise ValueError('observation_not_accepted')
        event['public_observation'] = 'accepted'
        save(STATE, state)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--ack', help='Acknowledge one delivered notice; do not acknowledge unknown delivery.')
    parser.add_argument('--notify-dingtalk', action='store_true', help='Deliver pending observations to the verified owner DM.')
    args = parser.parse_args()
    import fcntl
    STATE.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (STATE.parent / 'lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        now = time.time()
        state = json.loads(STATE.read_text()) if STATE.exists() else {'started_at': now, 'outbox': []}
        if args.ack:
            for event in state['outbox']:
                if event['id'] == args.ack:
                    event['acknowledged_at'] = now
            save(STATE, state)
            return
        events, errors = [], []
        try:
            current = snapshot(rpc_usage(), now)
            previous = state.get('previous')
            events = compare(previous, current)
            if previous and previous['account'] != current['account']:
                state['signals'] = {}  # No cross-account delayed checks.
                state['started_at'] = now
            state['previous'] = current
            request = urllib.request.Request(URL, headers={'User-Agent': 'Mozilla/5.0'})
            try:
                with urllib.request.urlopen(request, timeout=20) as response:
                    live = json.load(response)['live']
                events += delayed_checks(state, live, now, [e for e in events if e['kind'] in ('quota_recovered', 'reset_card_granted')])
            except Exception:
                errors.append('public_signal_check_failed')
        except Exception:
            errors.append('personal_usage_unavailable')
            if 'public_signal_check_failed' in state.get('errors', []):
                errors.append('public_signal_check_failed')
        for error in errors:
            if error not in state.get('errors', []):
                events.append({'kind': 'monitor_error', 'code': error})
        for error in state.get('errors', []):
            if error not in errors:
                events.append({'kind': 'monitor_recovered', 'code': error})
        state['errors'] = errors
        for index, event in enumerate(events):
            event.update(id=f'{int(now * 1000)}-{index}', observed_at=now)
            state['outbox'].append(event)
        state['checked_at'] = now
        # Keep private evidence, including acknowledged notices; no raw API response.
        save(STATE, state)
        if args.notify_dingtalk:
            try:
                notify_dingtalk(state)
                if any(e.get('delivery', {}).get('status') != 'delivered' for e in state['outbox'] if e.get('delivery')):
                    errors.append('dingtalk_delivery_requires_reconciliation')
            except Exception:
                errors.append('dingtalk_notification_unavailable')
            state['notification_errors'] = [e for e in errors if e.startswith('dingtalk_')]
            save(STATE, state)
        try:
            publish_observations(state)
            state['publication_errors'] = []
        except Exception:
            state['publication_errors'] = ['observation_publication_pending']
            errors.append('observation_publication_pending')
        save(STATE, state)
        print(json.dumps({'status': 'partial' if errors else 'ok', 'baseline': bool(state.get('previous')),
                          'pending': [e for e in state['outbox'] if not e.get('acknowledged_at')],
                          'errors': errors}, ensure_ascii=False))


if __name__ == '__main__':
    main()
