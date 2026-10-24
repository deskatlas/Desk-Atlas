"""MS-35: execute the read-only profiler on disposable real PostgreSQL.

Uses pg_stat_statements with no application credentials or production access.
"""
import importlib.util
import json
import os
from pathlib import Path
import tempfile

os.environ.setdefault('SPEC5_POSTGRES_PORT', '55439')
spec = importlib.util.spec_from_file_location('lifecycle', Path(__file__).with_name('spec5-postgres-lifecycle.py'))
lifecycle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lifecycle)


def main():
    with tempfile.TemporaryDirectory(prefix='deskatlas-io-profiler-') as folder:
        root = Path(folder).resolve()
        if root.parent != Path(tempfile.gettempdir()).resolve():
            raise RuntimeError('INVALID_TEST_WORKSPACE')
        data = root / 'data'
        result = lifecycle.run([lifecycle.BIN / 'initdb', '-D', data, '-U', 'postgres',
                                '-A', 'trust', '--encoding=UTF8', '--locale=C'])
        if result.returncode:
            raise AssertionError(result.stderr)
        with (root / 'startup.log').open('w') as log:
            started = lifecycle.subprocess.run([str(lifecycle.BIN / 'pg_ctl'), '-D', str(data),
                '-l', str(root / 'server.log'), '-o',
                f'-p {lifecycle.PORT} -h 127.0.0.1 -c shared_preload_libraries=pg_stat_statements', '-w', 'start'],
                stdout=log, stderr=lifecycle.subprocess.STDOUT, creationflags=lifecycle.FLAGS, timeout=60)
        if started.returncode:
            raise AssertionError('DISPOSABLE_POSTGRES_START_FAILED')
        try:
            lifecycle.sql('CREATE SCHEMA extensions; CREATE EXTENSION pg_stat_statements WITH SCHEMA extensions; '
                          'CREATE TABLE io_fixture(id integer PRIMARY KEY); '
                          'INSERT INTO io_fixture SELECT n FROM generate_series(1,100) n; SELECT count(*) FROM io_fixture;')
            source = (lifecycle.ROOT / 'supabase/verification/disk_io_workload_snapshot.sql').read_text(encoding='utf-8')
            for _ in range(2):
                output = lifecycle.sql(source).stdout
                snapshot = json.loads(next(line for line in output.splitlines() if line.startswith('{')))
                assert {'settings', 'database_counters', 'top_shared_reads', 'top_temp_writes',
                        'top_calls', 'top_wal', 'tables', 'indexes', 'connections', 'blocked_sessions'} <= snapshot.keys()
                assert any(table['relname'] == 'io_fixture' for table in snapshot['tables'])
                assert any(index['indisprimary'] for index in snapshot['indexes'])
                assert all('query' not in query for query in snapshot['top_calls'])
                assert snapshot['statement_stats']['stats_reset']
            assert lifecycle.sql('SELECT count(*) FROM io_fixture').stdout.strip() == '100'
            print('Disk I/O profiler: real pg_stat_statements, two read-only snapshots, index/table metadata and omitted query text passed.')
        finally:
            stopped = lifecycle.run([lifecycle.BIN / 'pg_ctl', '-D', data, '-m', 'fast', '-w', 'stop'])
            if stopped.returncode:
                raise AssertionError('DISPOSABLE_POSTGRES_STOP_FAILED')


if __name__ == '__main__':
    main()
