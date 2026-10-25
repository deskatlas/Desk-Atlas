"""MS82-TC01/05/06/08: incident attribution stays separate and content-free."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('summary', Path(__file__).resolve().parents[1] / 'scripts/ms82-incident-summary.py')
summary = importlib.util.module_from_spec(spec)
spec.loader.exec_module(summary)


class IncidentSummaryTests(unittest.TestCase):
    def test_unknowns_and_distinct_cancellation(self):
        result = summary.summarize([
            {'date': '2026-10-22T14:23:29Z', 'event_message': 'canceling statement due to statement timeout'},
            {'date': '2026-10-22T14:32:26Z', 'event_message': 'canceling statement due to user request'},
            {'date': '2026-10-22T16:57:38Z', 'event_message': 'received fast shutdown request'},
        ])
        self.assertEqual(result['classes']['statement_timeout']['count'], 1)
        self.assertEqual(result['classes']['user_cancellation']['count'], 1)
        self.assertEqual(result['classes']['readiness']['count'], 0)
        self.assertEqual(result['recovery_interval'], 'unknown')
        self.assertEqual(result['shutdown_initiator'], 'unknown')

    def test_payloads_levels_and_timestamps_cannot_leak(self):
        secret = 'private fixture payload'
        result = summary.summarize([
            {'date': secret, 'level': 'error', 'event_message': secret},
            {'date': '2026-10-22T19:00:00Z', 'level': 'success', 'event_message': 'unexpected EOF on standby connection', 'auth_user': secret},
        ])
        self.assertEqual(result['unclassified_records'], 1)
        self.assertEqual(result['classes']['standby_eof']['count'], 1)
        self.assertNotIn(secret, str(result))
        self.assertEqual(result['standby_health'], 'unknown')

    def test_malformed_matching_timestamp_is_rejected(self):
        with self.assertRaises(ValueError):
            summary.summarize([{'date': 'private invalid timestamp', 'event_message': 'received fast shutdown request'}])


if __name__ == '__main__':
    unittest.main()
