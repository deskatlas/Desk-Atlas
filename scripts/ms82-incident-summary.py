"""MS82-TC01/05/06/08: read-only, allowlisted summary; never export raw logs."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path

# Labels are fixed and content-free. SQLSTATE is a message-based classification,
# not a claim that the export contains structured server diagnostic fields.
CLASSES = {
    'closure_column': ('42703', 'column reservations.closure_reason does not exist'),
    'workspace_column': ('42703', 'column workspace_instances_1.name does not exist'),
    'staff_ambiguity': ('42702', 'column reference "is_super_admin" is ambiguous'),
    'shutdown_rejection': ('57P03', 'the database system is shutting down'),
    'admin_termination': ('57P01', 'terminating connection due to administrator command'),
    'client_reset': ('08006', 'could not receive data from client: Connection reset by peer'),
    'standby_eof': ('08P01', 'unexpected EOF on standby connection'),
    'statement_timeout': ('57014', 'canceling statement due to statement timeout'),
    'user_cancellation': ('57014', 'canceling statement due to user request'),
    'shutdown_request': ('00000', 'received fast shutdown request'),
    'readiness': ('00000', 'database system is ready to accept connections'),
}


def summarize(rows):
    groups = {name: [] for name in CLASSES}
    unclassified = 0
    for row in rows:
        message = row.get('event_message', '')
        matched = False
        for name, (_, pattern) in CLASSES.items():
            if isinstance(message, str) and message == pattern:
                # Parse and format timestamps; arbitrary input cannot reach output.
                stamp = datetime.fromisoformat(row['date'].replace('Z', '+00:00'))
                if stamp.tzinfo is None:
                    raise ValueError('UTC timestamp required')
                groups[name].append(stamp.astimezone(timezone.utc).isoformat())
                matched = True
                break
        unclassified += not matched
    return {
        'records': len(rows), 'unclassified_records': unclassified,
        'classes': {name: {'inferred_sqlstate': CLASSES[name][0], 'count': len(times),
                           'first_utc': min(times) if times else None,
                           'last_utc': max(times) if times else None}
                    for name, times in groups.items()},
        'shutdown_initiator': 'unknown', 'deployed_revision': 'unknown',
        'applied_migrations': 'unknown', 'recovery_interval': 'unknown',
        'timeout_query_attribution': 'unknown', 'cancellation_origin': 'unknown',
        'standby_health': 'unknown',
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    arguments = parser.parse_args()
    try:
        print(json.dumps(summarize(json.loads(arguments.source.read_text(encoding='utf-8'))), indent=2))
    except (OSError, ValueError, TypeError, KeyError, AttributeError):
        raise SystemExit('Invalid or unavailable incident export; no source content printed') from None
