"""MS77-TC06/08/11/15: disposable SQL quotas, permits, public catalog and RLS.
Never reads application credentials or connects to the configured database.
"""
import importlib.util
import json
import os
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

os.environ['MS78_POSTGRES_PORT'] = '55477'
spec = importlib.util.spec_from_file_location('fixture', Path(__file__).with_name('ms78-postgres-ownership.py'))
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
ROOT = fixture.ROOT


def acceptance():
    sql = fixture.sql
    sql("""CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE rate_limit_events(id uuid DEFAULT gen_random_uuid(),scope text CONSTRAINT rate_limit_events_scope_check CHECK(scope IN ('VERIFY_IP')),subject_hash text,request_id uuid,created_at timestamptz DEFAULT now());
ALTER TABLE rate_limit_events ENABLE ROW LEVEL SECURITY;
CREATE TABLE workspace_templates(id uuid PRIMARY KEY,is_active boolean,capacity int,rate_amount numeric);
CREATE TABLE floors(id uuid PRIMARY KEY,is_active boolean);
CREATE TABLE workspace_instances(id uuid PRIMARY KEY,template_id uuid,floor_id uuid,operational_status text,display_name text);
CREATE TABLE map_versions(id uuid PRIMARY KEY,floor_id uuid,status text);
CREATE TABLE map_elements(id uuid PRIMARY KEY,map_version_id uuid,workspace_instance_id uuid,element_role text);
""")
    foundation = (ROOT/'supabase/migrations/032_ms76_customer_rag_foundations.sql').read_text()
    sql('BEGIN;'+foundation[foundation.index('CREATE TABLE public.customer_assistant_controls'):])
    sql((ROOT/'supabase/migrations/033_ms77_public_assistant.sql').read_text())
    def quota(ip='a'*64, visitor='b'*64):
        return json.loads(sql(f"SELECT admit_public_assistant('{ip}','{visitor}','{uuid4()}');").stdout)
    with ThreadPoolExecutor(max_workers=16) as pool:
        attempts = list(pool.map(lambda _: quota(), range(16)))
    assert sum(a['allowed'] for a in attempts) == 10
    assert all(a.get('retry_after', 0) > 0 for a in attempts if not a['allowed'])
    assert int(sql("SELECT count(*) FROM rate_limit_events;").stdout) == 20
    # Changing visitor cookies cannot bypass IP admission.
    assert quota(visitor='c'*64)['allowed'] is False
    sql('TRUNCATE rate_limit_events;')
    # Changing trusted IPs cannot bypass the server-issued visitor hourly quota.
    for i in range(30):
        assert quota(ip=f'{i:064x}')['allowed']
    assert not quota(ip='f'*64)['allowed']
    assert int(sql("SELECT count(*) FROM rate_limit_events;").stdout) == 60
    # Both scopes commit atomically: rejected attempts add neither counter.
    assert sql("SET ROLE anon; SELECT admit_public_assistant(repeat('a',64),repeat('b',64),gen_random_uuid());", False).returncode
    assert sql('SET ROLE authenticated; SELECT * FROM customer_assistant_controls;', False).returncode
    def claim(subject, principal='PUBLIC_VISITOR', request=None):
        return sql(f"SELECT customer_assistant_control('claim','test','{principal}','{subject}','{request or uuid4()}','{uuid4()}','{uuid4()}',NULL);", False)
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda i: claim(f'{i:064x}', 'PUBLIC_VISITOR' if i % 2 else 'VERIFIED_CUSTOMER'), range(8)))
    assert sum(r.returncode == 0 for r in results) == 2
    assert all('RATE_LIMITED' in r.stderr for r in results if r.returncode)
    assert int(sql("SELECT count(*) FROM customer_assistant_controls WHERE stage<>'complete';").stdout) == 2
    sql("UPDATE customer_assistant_controls SET permit_until=now()-interval '1 second';")
    assert claim('f'*64).returncode == 0
    assert sql("SET ROLE service_role; SELECT customer_assistant_control_ms76('claim','test','PUBLIC_VISITOR',repeat('f',64),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),NULL);", False).returncode
    sql("""INSERT INTO floors VALUES('00000000-0000-4000-8000-000000000001',true);
INSERT INTO workspace_templates VALUES('00000000-0000-4000-8000-000000000002',true,2,50);
INSERT INTO map_versions VALUES('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','PUBLISHED');
INSERT INTO workspace_instances SELECT ('10000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','ACTIVE','Spot '||i FROM generate_series(1,15) i;
INSERT INTO map_elements SELECT gen_random_uuid(),'00000000-0000-4000-8000-000000000003',id,'WORKSPACE' FROM workspace_instances;
""")
    catalog = json.loads(sql('SELECT customer_spot_candidates();').stdout)
    assert catalog['has_more'] and len(catalog['spots']) == 13
    ids = [s['workspace_id'] for s in catalog['spots']]
    assert ids == sorted(ids)
    sql("UPDATE workspace_instances SET operational_status='MAINTENANCE' WHERE id='"+ids[0]+"';")
    assert json.loads(sql(f"SELECT customer_spot_candidates(ARRAY['{ids[0]}']::uuid[]);").stdout)['spots'] == []
    sql("UPDATE map_versions SET status='ARCHIVED';")
    assert json.loads(sql('SELECT customer_spot_candidates();').stdout)['spots'] == []
    down = (ROOT/'supabase/migrations/033_ms77_public_assistant_down.sql').read_text()
    assert 'MS77_ROLLBACK_INCOMPATIBLE' in sql(down, False).stderr
    sql("UPDATE rate_limit_events SET created_at=now()-interval '2 hours'; UPDATE customer_assistant_controls SET permit_until=now()-interval '1 second';")
    sql(down)
    print('MS77 PostgreSQL quota races, shared two-slot permits, recovery, catalog/RLS and guarded rollback passed.')


def main():
    import tempfile
    import subprocess
    with tempfile.TemporaryDirectory(prefix='deskatlas-ms77-postgres-') as directory:
        folder = Path(directory).resolve()
        result = fixture.run([fixture.BIN/'initdb', '-D', folder/'data', '-U', 'postgres', '-A', 'trust', '--encoding=UTF8', '--locale=C'])
        if result.returncode:
            raise RuntimeError(result.stderr)
        with (folder/'startup.log').open('w') as output:
            result = subprocess.run([str(fixture.BIN/'pg_ctl'), '-D', str(folder/'data'), '-l', str(folder/'server.log'), '-o', f'-p {fixture.PORT} -h 127.0.0.1', '-w', 'start'], stdout=output, stderr=output, creationflags=fixture.FLAGS)
        if result.returncode:
            raise RuntimeError((folder/'startup.log').read_text())
        try:
            acceptance()
        finally:
            result = fixture.run([fixture.BIN/'pg_ctl', '-D', folder/'data', '-m', 'fast', '-w', 'stop'])
            if result.returncode:
                raise RuntimeError('TEMPORARY_POSTGRES_STOP_FAILED')


if __name__ == '__main__':
    main()
