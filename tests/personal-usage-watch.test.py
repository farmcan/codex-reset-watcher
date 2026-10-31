import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('watch', Path(__file__).parents[1] / 'scripts/personal-usage-watch.py')
watch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(watch)


def sample(at=100, used=80, reset=1000, account='same', cards=1):
    return {'at': at, 'account': account, 'available_resets': cards,
            'windows': {'codex:primary': {'used': used, 'reset': reset}}}


class PersonalUsageTest(unittest.TestCase):
    def test_first_snapshot_and_account_change_are_not_resets(self):
        self.assertEqual(watch.compare(None, sample()), [])
        self.assertEqual(watch.compare(sample(), sample(used=0, account='other')), [])

    def test_observed_refill_has_interval_not_manufactured_timestamp(self):
        event = watch.compare(sample(), sample(at=200, used=5, reset=1100))[0]
        self.assertEqual(event['kind'], 'quota_recovered')
        self.assertEqual(event['observed_between'], [100, 200])
        self.assertEqual(event['cause'], 'unknown_or_manual_reset')

    def test_natural_weekly_refill_is_distinct(self):
        self.assertEqual(watch.compare(sample(), sample(at=1001, used=0, reset=2000))[0]['kind'], 'weekly_refill')

    def test_reset_timestamp_alone_does_not_prove_refill(self):
        self.assertEqual(watch.compare(sample(), sample(at=200, reset=1100)), [])
        self.assertEqual(watch.compare(sample(), sample(at=200, used=79)), [])

    def test_card_grant_is_not_automatic_refill(self):
        self.assertEqual(watch.compare(sample(), sample(at=200, cards=2))[0]['kind'], 'reset_card_granted')

    def test_weekly_can_be_primary_and_private_fields_are_excluded(self):
        s = watch.snapshot({'accountId': 'private', 'rateLimits': {'primary': {
            'windowDurationMins': 10080, 'usedPercent': 50, 'resetsAt': 2000},
            'credits': {'balance': 'secret'}}}, 100)
        self.assertEqual(s['windows']['codex:primary']['used'], 50)
        self.assertNotIn('private', str(s))
        self.assertNotIn('secret', str(s))

    def test_delay_is_durable_and_does_not_replay_historical_signals(self):
        state = {'started_at': 100}
        def signal(key, at):
            return {'id': key, 'created_at': watch.dt.datetime.fromtimestamp(at, watch.dt.timezone.utc).isoformat(),
                    'reset_mode': 'hard_reset', 'source_tier': 'A1', 'event_type': 'explicit_reset'}
        live = {'source_status': 'healthy', 'signals': [signal('old', 50), signal('new', 200)]}
        self.assertEqual(watch.delayed_checks(state, live, 201, False), [])
        self.assertEqual(len(watch.delayed_checks(state, live, 3801, False)), 1)
        self.assertEqual(watch.delayed_checks(state, live, 3802, False), [])
        self.assertEqual(watch.delayed_checks(state, live, 11001, True), [])
        self.assertNotIn('old', state['signals'])

    def test_recovery_is_attached_to_one_round_only(self):
        state = {'started_at': 0, 'signals': {'one': {'due': 100, 'checks': [], 'resolved': False}}}
        events = [{'kind': 'quota_recovered', 'observed_between': [110, 200]}]
        watch.delayed_checks(state, {'source_status': 'healthy'}, 200, events)
        self.assertEqual(events[0]['related_signal'], 'one')
        self.assertTrue(state['signals']['one']['resolved'])

    def test_overlapping_announcements_remain_unassigned(self):
        state = {'started_at': 0, 'signals': {k: {'due': 100, 'checks': [], 'resolved': False} for k in ['one', 'two']}}
        events = [{'kind': 'quota_recovered'}]
        watch.delayed_checks(state, {'source_status': 'healthy'}, 200, events)
        self.assertNotIn('related_signal', events[0])
        self.assertFalse(any(s['resolved'] for s in state['signals'].values()))

    def test_card_grant_and_quota_recovery_close_different_rounds(self):
        state = {'started_at': 0, 'signals': {'banked': {'due': 100, 'checks': [], 'resolved': False, 'mode': 'banked_reset'}}}
        watch.delayed_checks(state, {'source_status': 'healthy'}, 200, [{'kind': 'quota_recovered'}])
        self.assertFalse(state['signals']['banked']['resolved'])
        watch.delayed_checks(state, {'source_status': 'healthy'}, 200, [{'kind': 'reset_card_granted'}])
        self.assertTrue(state['signals']['banked']['resolved'])

    def test_current_open_round_is_watched_without_old_reminder_replay(self):
        state = {'started_at': 20000}
        signal = {'post_id': '1234567890123', 'cluster_key': 'current', 'created_at': watch.dt.datetime.fromtimestamp(10000, watch.dt.timezone.utc).isoformat(),
                  'source_tier': 'A1', 'event_type': 'scheduled_reset', 'reset_mode': 'banked_reset'}
        live = {'source_status': 'healthy', 'signals': [signal]}
        self.assertEqual(watch.delayed_checks(state, live, 22000, []), [])
        self.assertIn('current', state['signals'])
        self.assertEqual(state['signals']['current']['checks'], [3600, 10800])
        events = [{'kind': 'reset_card_granted'}]
        watch.delayed_checks(state, live, 23000, events)
        self.assertEqual(events[0]['related_signal'], 'current')


if __name__ == '__main__':
    unittest.main()
