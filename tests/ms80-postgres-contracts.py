"""MS80-TC01/06/08: disposable real PostgreSQL query/catalog verification.

No application database configuration is read. Uses repository SQL and the local
PostgreSQL binaries, following the existing disposable fixture convention.
Embedded projections are compiled to SQL here; hosted PostgREST/RLS acceptance
is separate and is not claimed by this test.
"""
from pathlib import Path
import importlib.util
import json
import re
import subprocess
import tempfile

spec = importlib.util.spec_from_file_location('fixture', Path(__file__).with_name('spec5-postgres-lifecycle.py'))
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
fixture.PORT = '55480'
ROOT = fixture.ROOT


def sql(statement, database='postgres', check=True):
    result = fixture.run([fixture.BIN / 'psql', '-X', '-w', '-h', '127.0.0.1', '-p', fixture.PORT,
                          '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-At'], input=statement)
    if check and result.returncode:
        raise AssertionError(result.stderr)
    return result


def projection(fields, table, alias='t'):
    # Only known relationship directions are supported; all column names are
    # checked by PostgreSQL against the actual schema, not a mock column list.
    relations = {
        ('reservations', 'reservation_candidates'): ('reservation_id', 'id', True),
        ('reservation_candidates', 'workspace_instances'): ('id', 'workspace_instance_id', False),
        ('workspace_instances', 'workspace_templates'): ('id', 'template_id', False),
    }
    parts = re.split(r',\s*(?![^()]*\))', fields) if '(' not in fields else split_fields(fields)
    pairs = []
    for part in parts:
        match = re.fullmatch(r'(\w+)\((.*)\)', part)
        if match:
            child, nested = match.groups()
            foreign, parent, many = relations[(table, child)]
            inner = projection(nested, child, alias + 'c')
            expression = f'(SELECT {"jsonb_agg(" + inner + ")" if many else inner} FROM {child} {alias}c WHERE {alias}c.{foreign}={alias}.{parent})'
            pairs.extend([f"'{child}'", expression])
        else:
            assert re.fullmatch(r'\w+', part), part
            pairs.extend([f"'{part}'", f'{alias}.{part}'])
    return 'jsonb_build_object(' + ','.join(pairs) + ')'


def split_fields(fields):
    result, depth, start = [], 0, 0
    for index, char in enumerate(fields):
        depth += (char == '(') - (char == ')')
        if char == ',' and depth == 0:
            result.append(fields[start:index])
            start = index + 1
    return result + [fields[start:]]


def acceptance(database, upgrade=False):
    sql('CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);', database)
    if upgrade:
        # A genuine pre-consolidation schema, upgraded by its original closure migration.
        sql((ROOT / 'supabase/archive/pre-consolidation/001_schema.sql').read_text(encoding='utf-8'), database)
        sql((ROOT / 'supabase/archive/pre-consolidation/016_add_closure_impact_to_reservations.sql').read_text(encoding='utf-8'), database)
    else:
        sql((ROOT / 'supabase/001_schema.sql').read_text(encoding='utf-8'), database)

    for broken in ['SELECT closure_reason,closure_date FROM reservations', 'SELECT name FROM workspace_instances']:
        result = sql('\\set VERBOSITY verbose\n' + broken, database, False)
        assert result.returncode and '42703' in result.stderr

    source = (ROOT / 'packages/domain/src/services/reservationSupabaseRepository.ts').read_text(encoding='utf-8')
    candidate_fields = re.search(r'&select=(rank,start_at,end_at,workspace_instance_id,workspace_instances\([^`]+)\&order=', source).group(1)
    alert_fields = re.search(r"/reservations\?select=(id,updated_at,reference_code[^']+)&is_closure_impacted=", source).group(1)
    sql('SELECT ' + projection(candidate_fields, 'reservation_candidates') + ' FROM reservation_candidates t', database)
    sql('SELECT ' + projection(alert_fields, 'reservations') + ' FROM reservations t', database)
    statuses = re.search(r'status=in\.\((PENDING_PAYMENT[^)]+)\)', source).group(1).split(',')
    sql('SELECT status FROM reservations WHERE status IN (' + ','.join("'" + value + "'" for value in statuses) + ')', database)
    catalog = json.loads(sql("""SELECT jsonb_agg(jsonb_build_array(table_name,column_name,data_type) ORDER BY table_name,column_name)
      FROM information_schema.columns WHERE table_schema='public' AND
      ((table_name='reservations' AND column_name IN ('closure_exception_id','is_closure_impacted','closure_impact_status','closure_notified_at','manual_resolution_notes'))
       OR (table_name='workspace_instances' AND column_name IN ('display_name','instance_code'))
       OR (table_name='schedule_blocks' AND column_name IN ('id','start_at','end_at','reason')))""", database).stdout)
    # Original FK permits missing/deleted metadata, while keeping impact state.
    sql("""INSERT INTO schedule_blocks(id,scope,block_type,start_at,end_at,reason)
      VALUES('00000000-0000-4000-8000-000000000001','BUSINESS','CLOSURE','2026-10-25T16:00Z','2026-10-26T00:00Z','Repairs');""", database)
    assert sql("SELECT to_char((end_at-interval '1 microsecond') AT TIME ZONE 'Asia/Manila','YYYY-MM-DD') FROM schedule_blocks", database).stdout.strip() == '2026-10-26'
    assert sql("SELECT count(*) FROM pg_constraint WHERE conrelid='reservations'::regclass AND confrelid='schedule_blocks'::regclass AND confdeltype='n'", database).stdout.strip() == '1'
    sql("""INSERT INTO reservations(id,reference_code,source,customer_first_name,customer_last_name,customer_email,
      status,rate_snapshot,amount_due,is_closure_impacted,closure_impact_status,closure_exception_id)
      VALUES('00000000-0000-4000-8000-000000000002','MS80-FIXTURE','WEB','Synthetic','Guest','fixture@example.invalid',
      'PENDING_PAYMENT',100,100,true,'AFFECTED_PENDING_ACTION','00000000-0000-4000-8000-000000000001');""", database)
    observed = sql('SELECT updated_at FROM reservations', database).stdout.strip()
    # Another connection changes the observed reservation before cleanup commits.
    sql("UPDATE reservations SET closure_impact_status='MANUAL_RESOLUTION_REQUIRED',updated_at=now()", database)
    stale = sql(f"UPDATE reservations SET is_closure_impacted=false WHERE is_closure_impacted=true AND updated_at='{observed}' RETURNING id", database).stdout
    assert '00000000-0000-4000-8000-000000000002' not in stale
    sql('DELETE FROM schedule_blocks', database)
    assert sql("SELECT is_closure_impacted AND closure_exception_id IS NULL FROM reservations", database).stdout.strip() == 't'
    current = sql('SELECT updated_at FROM reservations', database).stdout.strip()
    sql(f"UPDATE reservations SET is_closure_impacted=false,closure_impact_status=NULL,closure_exception_id=NULL,updated_at=now() WHERE is_closure_impacted=true AND updated_at='{current}'", database)
    assert sql('SELECT is_closure_impacted FROM reservations', database).stdout.strip() == 'f'
    return catalog


def main():
    with tempfile.TemporaryDirectory(prefix='deskatlas-ms80-postgres-') as directory:
        folder = Path(directory).resolve()
        assert folder.parent == Path(tempfile.gettempdir()).resolve() and folder.name.startswith('deskatlas-ms80-')
        result = fixture.run([fixture.BIN / 'initdb', '-D', folder / 'data', '-U', 'postgres', '-A', 'trust', '--encoding=UTF8', '--locale=C'])
        if result.returncode:
            raise RuntimeError(result.stderr)
        with (folder / 'startup.log').open('w') as output:
            result = subprocess.run([str(fixture.BIN / 'pg_ctl'), '-D', str(folder / 'data'), '-l', str(folder / 'server.log'),
                                     '-o', f'-p {fixture.PORT} -h 127.0.0.1', '-w', 'start'], stdout=output, stderr=output, creationflags=fixture.FLAGS)
        if result.returncode:
            raise RuntimeError('TEMPORARY_POSTGRES_START_FAILED')
        try:
            sql('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE DATABASE ms80_clean; CREATE DATABASE ms80_upgrade;')
            clean = acceptance('ms80_clean')
            upgraded = acceptance('ms80_upgrade', upgrade=True)
            assert clean == upgraded
            print('MS80: original 42703 reproduced; repaired embedded SQL projections, enum filters, closure FK and clean/upgrade contract parity passed.')
            print('Hosted PostgREST, deployed revision/migration inventory and staging traffic remain pending.')
        finally:
            result = fixture.run([fixture.BIN / 'pg_ctl', '-D', folder / 'data', '-m', 'fast', '-w', 'stop'])
            if result.returncode:
                raise RuntimeError('TEMPORARY_POSTGRES_STOP_FAILED')


if __name__ == '__main__':
    main()
