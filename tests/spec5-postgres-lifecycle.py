"""SPEC5-TC07..16/19: disposable real PostgreSQL transaction/race tests.

Uses the locally installed PostgreSQL binaries, never configured application DBs.
When pgvector isn't installed, a test-only array-backed vector domain exercises
lifecycle SQL. This is not pgvector/RLS storage integration acceptance evidence.
"""
from pathlib import Path
import os
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
BIN = Path(os.environ.get('SPEC5_POSTGRES_BIN', 'C:/Program Files/PostgreSQL/18/bin'))
PORT = os.environ.get('SPEC5_POSTGRES_PORT', '55435')
ACTOR = '00000000-0000-4000-8000-000000000001'
FLAGS = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0


def run(arguments, **kwargs):
    return subprocess.run([str(value) for value in arguments], capture_output=True, text=True, creationflags=FLAGS, **kwargs)


def sql(statement, check=True):
    result = run([BIN / 'psql', '-X', '-w', '-h', '127.0.0.1', '-p', PORT, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], input=statement)
    if check and result.returncode:
        raise AssertionError(result.stderr)
    return result


def main(acceptance=None):
    with tempfile.TemporaryDirectory(prefix='deskatlas-spec5-postgres-') as directory:
        workspace = Path(directory).resolve()
        if workspace.parent != Path(tempfile.gettempdir()).resolve() or not workspace.name.startswith('deskatlas-spec5-postgres-'):
            raise RuntimeError('INVALID_TEST_WORKSPACE')
        data = workspace / 'data'
        initialized = run([BIN / 'initdb', '-D', data, '-U', 'postgres', '-A', 'trust', '--encoding=UTF8', '--locale=C'])
        if initialized.returncode:
            raise RuntimeError(initialized.stderr)
        # Background PostgreSQL children inherit Windows pipe handles. A file
        # prevents communicate() waiting forever after pg_ctl itself exits.
        with (workspace / 'startup.log').open('w') as output:
            started = subprocess.run([str(BIN / 'pg_ctl'), '-D', str(data), '-l', str(workspace / 'server.log'), '-o', f'-p {PORT} -h 127.0.0.1', '-w', 'start'], stdout=output, stderr=subprocess.STDOUT, creationflags=FLAGS, timeout=60)
        if started.returncode:
            raise RuntimeError('TEMPORARY_POSTGRES_START_FAILED')
        try:
            sql('''
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA extensions; CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
CREATE DOMAIN extensions.vector AS double precision[];
CREATE FUNCTION extensions.vector_norm(extensions.vector) RETURNS double precision LANGUAGE sql IMMUTABLE AS $$ SELECT sqrt(sum(x*x)) FROM unnest($1) x $$;
CREATE FUNCTION extensions.cosine_test(extensions.vector,extensions.vector) RETURNS double precision LANGUAGE sql IMMUTABLE AS $$ SELECT 0::double precision $$;
CREATE OPERATOR extensions.<=> (LEFTARG=extensions.vector,RIGHTARG=extensions.vector,FUNCTION=extensions.cosine_test);
CREATE TYPE public.staff_role AS ENUM('ADMIN','STAFF');
CREATE TYPE public.audit_actor_role AS ENUM('ADMIN','STAFF','SYSTEM');
CREATE TABLE public.staff_profiles(user_id uuid PRIMARY KEY,role staff_role,is_active boolean);
CREATE TABLE public.audit_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_user_id uuid,actor_role audit_actor_role,action text,entity_type text,entity_id uuid,metadata jsonb,created_at timestamptz DEFAULT now());
CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean);
CREATE TABLE storage.objects(bucket_id text,name text);
INSERT INTO public.staff_profiles VALUES('00000000-0000-4000-8000-000000000001','ADMIN',true),('00000000-0000-4000-8000-000000000002','STAFF',true);
''')
            for name in ('015_assistant_published_knowledge.sql', '016_knowledge_base_lifecycle.sql'):
                migration = (ROOT / 'supabase/migrations' / name).read_text(encoding='utf-8')
                migration = migration.replace('CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;', '-- Test-only vector domain already installed.')
                migration = migration.replace('extensions.vector(1024)', 'extensions.vector')
                migration = migration.replace("(c->'embedding')::text::extensions.vector", "translate((c->'embedding')::text,'[]','{}')::extensions.vector")
                sql(migration)
            sql('''
CREATE FUNCTION test_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST_FAILED: %',label; END IF; END $$;
CREATE FUNCTION test_raises(statement text,expected text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN IF position(expected in SQLERRM)>0 THEN RETURN; END IF; RAISE; END; RAISE EXCEPTION 'EXPECTED_ERROR: %',expected; END $$;
SELECT kb_initialize_catalog('test',repeat('a',64));
CREATE TABLE test_uploads(name text PRIMARY KEY,payload jsonb);
CREATE FUNCTION test_upload(label text,target uuid DEFAULT NULL,rev bigint DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE r jsonb; request uuid:=gen_random_uuid(); v uuid; j jsonb; checkpoint jsonb; chunks jsonb;
BEGIN
 r:=kb_admin_command('test','00000000-0000-4000-8000-000000000001','upload',NULL,jsonb_build_object('title',label,'filename','synthetic.md','declared_type','MD','audience','ADMIN_ONLY','request_id',request,'replace_document_id',target,'expected_revision',rev));
 v:=(r->>'id')::uuid;
 INSERT INTO test_uploads VALUES(label,r);
 PERFORM test_assert(r=kb_admin_command('test','00000000-0000-4000-8000-000000000001','upload',NULL,jsonb_build_object('request_id',request)),'duplicate upload returns same receipt');
 r:=kb_admin_command('test','00000000-0000-4000-8000-000000000001','finalize',v,jsonb_build_object('request_id',request,'source_bytes',14,'source_sha256',repeat('b',64)));
 PERFORM test_assert(r=kb_admin_command('test','00000000-0000-4000-8000-000000000001','finalize',v,jsonb_build_object('request_id',request)),'duplicate finalize');
 j:=kb_worker_command('test','claim');
 PERFORM test_assert(j->'job'->>'version_id'=v::text,'expected claimed version');
 checkpoint:=jsonb_build_object('lease_token',j->'job'->>'lease_token','generation',1,'stage','EMBEDDING','chunks',jsonb_build_array(jsonb_build_object('ordinal',0,'heading_path','SOP','page_start',NULL,'page_end',NULL,'content','synthetic text','content_sha256',encode(extensions.digest('synthetic text','sha256'),'hex'),'token_count',3,'extraction_method','TEXT','embedding',to_jsonb(ARRAY[1::double precision]||array_fill(0::double precision,ARRAY[1023])))));
 PERFORM kb_worker_command('test','checkpoint',(j->'job'->>'id')::uuid,checkpoint);
 PERFORM test_raises(format('SELECT kb_worker_command(%L,%L,%L,%L::jsonb)','test','complete',j->'job'->>'id',jsonb_build_object('lease_token',j->'job'->>'lease_token','generation',1,'expected_chunk_count',2,'embedding_fingerprint',repeat('a',64))),'MANIFEST_INVALID');
 PERFORM kb_worker_command('test','complete',(j->'job'->>'id')::uuid,jsonb_build_object('lease_token',j->'job'->>'lease_token','generation',1,'expected_chunk_count',1,'embedding_fingerprint',repeat('a',64),'content_sha256',repeat('c',64),'parser_fingerprint','synthetic-parser','manifest_sha256',encode(extensions.digest(encode(extensions.digest('synthetic text','sha256'),'hex'),'sha256'),'hex'),'warning_codes','[]'::jsonb,'extraction_manifest','[]'::jsonb));
 PERFORM test_assert((SELECT status='READY' FROM kb_document_versions WHERE id=v),'complete only reaches READY');
 PERFORM test_assert((SELECT active_version_id IS NULL OR active_version_id<>v FROM kb_documents WHERE id=(SELECT document_id FROM kb_document_versions WHERE id=v)),'READY invisible');
 RETURN v;
END $$;
SELECT test_upload('first');
SELECT kb_admin_command('test','00000000-0000-4000-8000-000000000001','publish',(SELECT (payload->>'id')::uuid FROM test_uploads WHERE name='first'),jsonb_build_object('expected_revision',1,'audience','ADMIN_AND_STAFF','acknowledge_warnings',true,'request_id',gen_random_uuid()));
SELECT test_upload('replacement-a',(SELECT (payload->>'document_id')::uuid FROM test_uploads WHERE name='first'),2);
SELECT test_upload('replacement-b',(SELECT (payload->>'document_id')::uuid FROM test_uploads WHERE name='first'),2);
SELECT test_assert((SELECT count(*)=1 FROM kb_document_versions WHERE status='PUBLISHED'),'one published while replacements READY');
SELECT test_assert((SELECT count(*)=3 FROM kb_notifications),'one notification per completed ingestion');
SET ROLE anon;
''')
            denied = sql("SET ROLE anon; SELECT * FROM public.kb_chunks;", check=False)
            assert denied.returncode and 'permission denied' in denied.stderr
            denied = sql("SET ROLE authenticated; SELECT public.kb_worker_command('test','claim');", check=False)
            assert denied.returncode and 'permission denied' in denied.stderr
            def publish(name):
                return f"SELECT kb_admin_command('test','{ACTOR}','publish',(SELECT (payload->>'id')::uuid FROM test_uploads WHERE name='{name}'),jsonb_build_object('expected_revision',2,'audience','ADMIN_ONLY','acknowledge_warnings',true,'request_id',gen_random_uuid()));"
            args = [str(BIN / 'psql'), '-X', '-w', '-h', '127.0.0.1', '-p', PORT, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At']
            processes = [subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, creationflags=FLAGS) for _ in range(2)]
            for process, name in zip(processes, ('replacement-a', 'replacement-b')):
                process.stdin.write(publish(name)); process.stdin.close()
            for process in processes:
                process.wait(timeout=20)
            assert sorted(process.returncode for process in processes) == [0, 3]
            assert any('VERSION_CONFLICT' in process.stderr.read() for process in processes)
            sql('''
SELECT test_assert((SELECT count(*)=1 FROM kb_document_versions WHERE status='PUBLISHED'),'one concurrent publication winner');
SELECT test_assert((SELECT revision=3 FROM kb_documents LIMIT 1),'one revision advance');
SELECT kb_admin_command('test','00000000-0000-4000-8000-000000000001','audience',(SELECT id FROM kb_documents LIMIT 1),jsonb_build_object('expected_revision',3,'request_id',gen_random_uuid(),'audience','ADMIN_ONLY'));
SELECT test_assert((SELECT epoch>0 FROM kb_catalog LIMIT 1),'revocation epoch updated');
SELECT kb_admin_command('test','00000000-0000-4000-8000-000000000001','remove_document',(SELECT id FROM kb_documents LIMIT 1),jsonb_build_object('expected_revision',4,'request_id',gen_random_uuid()));
SELECT test_assert((SELECT active_version_id IS NULL AND deleted_at IS NOT NULL FROM kb_documents LIMIT 1),'removal tombstone wins');
SELECT test_assert((SELECT count(*)=3 FROM kb_jobs WHERE kind='PURGE'),'all removed versions queued for purge');
SELECT test_assert((SELECT count(*)=0 FROM kb_document_versions WHERE status='PUBLISHED'),'no publication after removal');
-- Claim and complete queued purges so the next scenario selects ingestion.
DO $$ DECLARE j jsonb; BEGIN LOOP j:=kb_worker_command('test','claim'); EXIT WHEN j IS NULL; PERFORM kb_worker_command('test','complete',(j->'job'->>'id')::uuid,jsonb_build_object('lease_token',j->'job'->>'lease_token','generation',j->'job'->>'generation')); END LOOP; END $$;
CREATE TABLE test_leases(name text PRIMARY KEY,payload jsonb);
DO $$ DECLARE v jsonb; request uuid:=gen_random_uuid(); BEGIN
 v:=kb_admin_command('test','00000000-0000-4000-8000-000000000001','upload',NULL,jsonb_build_object('title','lease race','filename','synthetic.md','declared_type','MD','audience','ADMIN_ONLY','request_id',request));
 PERFORM kb_admin_command('test','00000000-0000-4000-8000-000000000001','finalize',(v->>'id')::uuid,jsonb_build_object('request_id',request,'source_bytes',14,'source_sha256',repeat('b',64)));
 INSERT INTO test_leases VALUES('old',kb_worker_command('test','claim'));
END $$;
UPDATE kb_jobs SET lease_until=now()-interval '1 second' WHERE id=(SELECT (payload->'job'->>'id')::uuid FROM test_leases WHERE name='old');
INSERT INTO test_leases VALUES('new',kb_worker_command('test','claim'));
SELECT test_assert((SELECT a.payload->'job'->>'lease_token'<>b.payload->'job'->>'lease_token' FROM test_leases a,test_leases b WHERE a.name='old' AND b.name='new'),'expired lease replaced with fresh fence');
SELECT test_raises(format('SELECT kb_worker_command(%L,%L,%L,%L::jsonb)','test','heartbeat',payload->'job'->>'id',jsonb_build_object('lease_token',payload->'job'->>'lease_token','generation',1)),'LEASE_LOST') FROM test_leases WHERE name='old';
SELECT kb_admin_command('test','00000000-0000-4000-8000-000000000001','remove_document',(SELECT (payload->'job'->>'document_id')::uuid FROM test_leases WHERE name='new'),jsonb_build_object('expected_revision',1,'request_id',gen_random_uuid()));
SELECT test_raises(format('SELECT kb_worker_command(%L,%L,%L,%L::jsonb)','test','complete',payload->'job'->>'id',jsonb_build_object('lease_token',payload->'job'->>'lease_token','generation',1,'error_code','PARSER_FAILED')),'LEASE_LOST') FROM test_leases WHERE name='new';
SELECT test_assert((SELECT count(*)=0 FROM kb_jobs WHERE kind='INGEST' AND status='RUNNING'),'removal cancels active worker');
''')
            if acceptance is not None:
                acceptance()
            sql((ROOT / 'supabase/migrations/016_knowledge_base_lifecycle_down.sql').read_text().replace('extensions.vector(1024)', 'extensions.vector'))
            sql("SELECT test_assert(to_regclass('public.kb_documents') IS NOT NULL,'down preserves SPEC4 foundations');")
            print('SPEC-5 PostgreSQL lifecycle, concurrency, permission, and rollback checks passed (test vector domain).')
        finally:
            stopped = run([BIN / 'pg_ctl', '-D', data, '-m', 'fast', '-w', 'stop'])
            if stopped.returncode:
                raise RuntimeError('TEMPORARY_POSTGRES_STOP_FAILED')


if __name__ == '__main__':
    main()
