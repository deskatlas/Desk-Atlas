"""MS78-TC05/06/07/17: disposable PostgreSQL ownership, permissions and replica races.
Never reads configured application database credentials.
"""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import json
import os
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
BIN = Path(os.environ.get('MS78_POSTGRES_BIN', 'C:/Program Files/PostgreSQL/18/bin'))
PORT = os.environ.get('MS78_POSTGRES_PORT', '55478')
FLAGS = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0

def run(args, **kwargs):
    return subprocess.run([str(a) for a in args], capture_output=True, text=True, creationflags=FLAGS, **kwargs)

def sql(statement, check=True):
    result = run([BIN/'psql', '-X', '-w', '-h', '127.0.0.1', '-p', PORT, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], input=statement)
    if check and result.returncode: raise AssertionError(result.stderr)
    return result

def main():
    with tempfile.TemporaryDirectory(prefix='deskatlas-ms78-postgres-') as directory:
        workspace = Path(directory).resolve()
        data = workspace/'data'
        initialized = run([BIN/'initdb', '-D', data, '-U', 'postgres', '-A', 'trust', '--encoding=UTF8', '--locale=C'])
        if initialized.returncode: raise RuntimeError(initialized.stderr)
        with (workspace/'startup.log').open('w') as output:
            started = subprocess.run([str(BIN/'pg_ctl'), '-D', str(data), '-l', str(workspace/'server.log'), '-o', f'-p {PORT} -h 127.0.0.1', '-w', 'start'], stdout=output, stderr=output, creationflags=FLAGS)
        if started.returncode: raise RuntimeError((workspace/'startup.log').read_text())
        try:
            sql("""
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE customers(id uuid PRIMARY KEY, email text);
CREATE TABLE reservations(id uuid PRIMARY KEY, reference_code text, status text, source text,
 customer_id uuid, customer_email text, checked_in_at timestamptz, checked_out_at timestamptz,
 reschedule_count int DEFAULT 0, is_closure_impacted bool DEFAULT false, closure_impact_status text,
 created_at timestamptz DEFAULT now());
CREATE TABLE reservation_candidates(reservation_id uuid, rank int, workspace_instance_id uuid,
 start_at timestamptz, end_at timestamptz, is_assigned bool);
CREATE TABLE workspace_instances(id uuid PRIMARY KEY,display_name text);
CREATE TABLE payment_attempts(id uuid, reservation_id uuid,status text,created_at timestamptz);
CREATE TABLE business_settings(id int PRIMARY KEY,timezone text,customer_reschedule_cutoff_hours int,
 customer_cancellation_cutoff_value int,customer_cancellation_cutoff_unit text);
CREATE TABLE rate_limit_events(id uuid DEFAULT gen_random_uuid(),scope text CONSTRAINT rate_limit_events_scope_check CHECK(scope IN ('CUSTOMER_TOKEN')),subject_hash text,created_at timestamptz DEFAULT now());
ALTER TABLE rate_limit_events ENABLE ROW LEVEL SECURITY;
INSERT INTO customers VALUES ('00000000-0000-4000-8000-000000000001','owner@example.test'),('00000000-0000-4000-8000-000000000002','other@example.test');
INSERT INTO business_settings VALUES(1,'Asia/Manila',24,12,'HOURS');
-- Linked foreign row has the same email as the verified customer: still forbidden.
INSERT INTO reservations(id,reference_code,status,source,customer_id,customer_email) VALUES
 ('10000000-0000-4000-8000-000000000001','owned','CONFIRMED','WEB','00000000-0000-4000-8000-000000000001','old@example.test'),
 ('10000000-0000-4000-8000-000000000002','legacy','CONFIRMED','WEB',NULL,' OWNER@example.test '),
 ('10000000-0000-4000-8000-000000000003','foreign','CONFIRMED','WEB','00000000-0000-4000-8000-000000000002','owner@example.test');
INSERT INTO reservation_candidates SELECT id,0,NULL,now()+interval '1 day',now()+interval '2 days',true FROM reservations;
""")
            for name in ['034_ms78_owned_customer_assistance.sql','035_ms78_atomic_verification_limits.sql']:
                sql((ROOT/'supabase/migrations'/name).read_text())
            owner = '00000000-0000-4000-8000-000000000001'
            rows = sql(f"SELECT snapshot->>'reference' FROM customer_assistance_owned_bookings('{owner}',NULL,true);").stdout.splitlines()
            assert set(rows)=={'owned','legacy'}, rows
            sql("UPDATE reservations SET status='CANCELLED' WHERE reference_code='legacy';")
            assert sql(f"SELECT count(*) FROM customer_assistance_owned_bookings('{owner}',NULL,false);").stdout.strip()=='1'
            for target in ['10000000-0000-4000-8000-000000000003','99999999-0000-4000-8000-000000000000']:
                assert sql(f"SELECT count(*) FROM customer_assistance_owned_bookings('{owner}','{target}');").stdout.strip()=='0'
            assert sql(f"SET ROLE anon; SELECT * FROM customer_assistance_owned_bookings('{owner}');",False).returncode
            assert sql("SET ROLE authenticated; SELECT * FROM rate_limit_events;",False).returncode
            # Equal starts paginate by UUID, bounded to eleven including the look-ahead row.
            sql(f"INSERT INTO reservations(id,reference_code,status,source,customer_id) SELECT ('20000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'page-'||n,'CONFIRMED','WEB','{owner}' FROM generate_series(1,25) n;")
            assert sql(f"SELECT count(*) FROM customer_assistance_owned_bookings('{owner}',NULL,true);").stdout.strip()=='11'
            seen=[]
            cursor='NULL,NULL'
            while True:
                page=[json.loads(line) for line in sql(f"SELECT row_to_json(x) FROM customer_assistance_owned_bookings('{owner}',NULL,true,{cursor}) x;").stdout.splitlines()]
                visible=page[:10]
                seen.extend(row['snapshot']['id'] for row in visible)
                if len(page)<=10: break
                last=visible[-1]
                cursor=f"'{last['sort_start']}'::timestamptz,'{last['snapshot']['id']}'::uuid"
            assert len(seen)==27 and len(set(seen))==27, seen
            entries=json.dumps([dict(scope='ASSISTANT_TOKEN',subjectHash='a'*64,limit=10,windowSeconds=600),dict(scope='CUSTOMER_TOKEN',subjectHash='a'*64,limit=60,windowSeconds=60)])
            def consume(_): return json.loads(sql(f"SELECT consume_customer_access_limits('{entries}'::jsonb);").stdout)['allowed']
            with ThreadPoolExecutor(max_workers=8) as executor:
                results=list(executor.map(consume,range(25)))
            assert sum(results)==10, results
            assert sql("SELECT count(*) FROM rate_limit_events WHERE scope='CUSTOMER_TOKEN';").stdout.strip()=='10'
            entries=json.dumps([dict(scope='VERIFY_IP',subjectHash='b'*64,limit=5,windowSeconds=900),dict(scope='VERIFY_EMAIL',subjectHash='c'*64,limit=5,windowSeconds=900)])
            with ThreadPoolExecutor(max_workers=8) as executor:
                results=list(executor.map(consume,range(20)))
            assert sum(results)==5, results
            assert sql("SET ROLE anon; SELECT consume_customer_access_limits('[]');",False).returncode
            sql("INSERT INTO rate_limit_events(scope,subject_hash) VALUES('PUBLIC_ASSISTANT_IP',repeat('d',64));")
            sql((ROOT/'supabase/migrations/035_ms78_atomic_verification_limits_down.sql').read_text())
            assert sql("SELECT count(*) FROM rate_limit_events WHERE scope='PUBLIC_ASSISTANT_IP';").stdout.strip()=='1'
            sql((ROOT/'supabase/migrations/034_ms78_owned_customer_assistance_down.sql').read_text())
            print('MS78 PostgreSQL ownership, RLS permissions, bounded pagination, atomic cross-connection quota and rollback passed.')
        finally:
            stopped=run([BIN/'pg_ctl','-D',data,'-m','fast','-w','stop'])
            if stopped.returncode: raise RuntimeError('TEMPORARY_POSTGRES_STOP_FAILED')

if __name__=='__main__': main()
