"""MS82-TC02/05: real interruption on a disposable loopback PostgreSQL cluster.

No application database configuration or hosted database is used. The separate
HTTP tests cover application transport; this is not a PostgREST outage test.
"""
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import time

spec = importlib.util.spec_from_file_location('fixture', Path(__file__).with_name('spec5-postgres-lifecycle.py'))
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
PORT = '55482'


def command(statement):
    return [str(value) for value in [fixture.BIN / 'psql', '-X', '-w', '-h', '127.0.0.1',
            '-p', PORT, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1',
            '-v', 'VERBOSITY=verbose', '-At', '-c', statement]]


def sql(statement):
    result = fixture.run(command(statement), timeout=10)
    if result.returncode:
        raise AssertionError('DISPOSABLE_SQL_FAILED')
    return result.stdout.strip()


def interrupt(function, code):
    child = subprocess.Popen(command("SET application_name='ms82_synthetic_wait'; SELECT pg_sleep(30)"),
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                             creationflags=fixture.FLAGS)
    try:
        deadline = time.monotonic() + 10
        while True:
            pid = sql("SELECT pid FROM pg_stat_activity WHERE application_name='ms82_synthetic_wait' AND wait_event='PgSleep'")
            if pid:
                break
            if time.monotonic() >= deadline:
                raise AssertionError('SYNTHETIC_QUERY_NOT_READY')
            time.sleep(0.05)
        assert pid.isdigit()
        assert sql(f'SELECT {function}({pid})') == 't'
        _, stderr = child.communicate(timeout=10)
        assert child.returncode != 0 and code in stderr, 'EXPECTED_SQLSTATE_MISSING'
        assert sql('SELECT 1') == '1'
    finally:
        if child.poll() is None:
            child.kill()
            child.communicate(timeout=10)


def main():
    with tempfile.TemporaryDirectory(prefix='deskatlas-ms82-postgres-') as directory:
        workspace = Path(directory).resolve()
        assert workspace.parent == Path(tempfile.gettempdir()).resolve()
        assert workspace.name.startswith('deskatlas-ms82-postgres-')
        data = workspace / 'data'
        initialized = fixture.run([fixture.BIN / 'initdb', '-D', data, '-U', 'postgres', '-A', 'trust',
                                   '--encoding=UTF8', '--locale=C'], timeout=60)
        assert initialized.returncode == 0, 'TEMPORARY_INIT_FAILED'

        def control(action):
            with (workspace / 'control.log').open('a') as output:
                args = [fixture.BIN / 'pg_ctl', '-D', data, '-l', workspace / 'server.log',
                        '-o', f'-p {PORT} -h 127.0.0.1', '-w', '-t', '15']
                if action == 'stop':
                    args += ['-m', 'fast']
                result = subprocess.run([str(value) for value in args + [action]],
                                        stdout=output, stderr=subprocess.STDOUT,
                                        creationflags=fixture.FLAGS, timeout=20)
                assert result.returncode == 0, 'TEMPORARY_CONTROL_FAILED'

        control('start')
        try:
            timed_out = fixture.run(command("SET statement_timeout='100ms'; SELECT pg_sleep(10)"), timeout=10)
            assert timed_out.returncode != 0 and '57014' in timed_out.stderr
            assert 'statement timeout' in timed_out.stderr
            interrupt('pg_cancel_backend', '57014')
            interrupt('pg_terminate_backend', '57P01')
            control('stop')
            unavailable = fixture.run(command('SELECT 1'), timeout=10)
            assert unavailable.returncode != 0, 'STOPPED_CLUSTER_ACCEPTED_QUERY'
            control('start')
            assert sql('SELECT 1') == '1'
            print('MS82: statement timeout, explicit cancellation, session termination, unavailable read and restart readiness passed.')
            print('Disposable PostgreSQL only; hosted initiator, PostgREST recovery and staging traffic remain pending.')
        finally:
            control('stop')


if __name__ == '__main__':
    main()
