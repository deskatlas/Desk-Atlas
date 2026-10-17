"""MS46-TC02/08..10/14/21: disposable PostgreSQL, real gateway and worker.

Reuses the test vector domain. Storage is a synthetic adapter, not Supabase
provider/RLS acceptance. Never reads an application database configuration.
"""
import importlib.util
import json
import os
from pathlib import Path
import secrets
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

spec = importlib.util.spec_from_file_location('lifecycle', Path(__file__).with_name('spec5-postgres-lifecycle.py'))
lifecycle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lifecycle)
ROOT = lifecycle.ROOT


def literal(value):
    return 'NULL' if value is None else "'" + str(value).replace("'", "''") + "'"


def gateway_boundary():
    authority = secrets.token_hex(32)
    class Bridge(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_POST(self):
            if self.headers.get('authorization') != 'Bearer ' + authority:
                self.send_response(403)
                self.end_headers()
                return
            payload = json.loads(self.rfile.read(int(self.headers['content-length'])))
            name, args = payload['name'], payload['args']
            if name == 'kb_reconcile_uploads':
                statement = f"SELECT kb_reconcile_uploads({literal(args['p_scope'])},{int(args['p_expiry_seconds'])});"
            elif name == 'kb_worker_command':
                statement = f"SELECT kb_worker_command({literal(args['p_scope'])},{literal(args['p_operation'])},{literal(args['p_id'])}::uuid,{literal(json.dumps(args['p_data']))}::jsonb);"
            elif name == 'fixture_job_kind':
                statement = f"SELECT jsonb_build_object('kind',kind) FROM kb_jobs WHERE id={literal(args['id'])}::uuid;"
            else:
                raise ValueError('FIXTURE_RPC_NOT_ALLOWED')
            result = lifecycle.sql(statement, check=False)
            response = {'data': json.loads(result.stdout.strip() or 'null'), 'error': None} if result.returncode == 0 else {'data': None, 'error': {'message': 'DATABASE_UNAVAILABLE'}}
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(response).encode())
    server = ThreadingHTTPServer(('127.0.0.1', 0), Bridge)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        environment = {**os.environ, 'MS46_SQL_BRIDGE': f'http://127.0.0.1:{server.server_port}',
                       'MS46_SQL_AUTHORITY': authority, 'MS46_PYTHON': str(ROOT / 'services/rag/.venv/Scripts/python.exe')}
        node = Path('C:/Program Files/nodejs/node.exe') if os.name == 'nt' else Path('node')
        vitest = ROOT / 'node_modules/vitest/vitest.mjs'
        result = subprocess.run([str(node), str(vitest), 'run', 'tests/ms46-postgres-boundary.test.ts'], cwd=ROOT,
                                env=environment, capture_output=True, text=True, timeout=90)
        if result.returncode:
            # Fixtures contain no real credentials or source text; keep diagnostics
            # bounded and never include the generated bridge authority.
            raise AssertionError((result.stdout + result.stderr).replace(authority, '[redacted]')[-6000:])
        print('MS46 SQL -> TypeScript gateway -> Python worker boundary passed.')
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def acceptance():
    sql = lifecycle.sql
    # Drain old-fixture purge jobs before installing the new attestation contract.
    sql("""DO $$ DECLARE j jsonb; BEGIN LOOP j:=kb_worker_command('test','claim'); EXIT WHEN j IS NULL;
      PERFORM kb_worker_command('test','complete',(j->'job'->>'id')::uuid,jsonb_build_object('lease_token',j->'job'->>'lease_token','generation',j->'job'->>'generation'));
    END LOOP; END $$;
    SELECT test_upload('ms46-source');""")
    migration = (ROOT / 'supabase/migrations/018_knowledge_correctness_and_cleanup.sql').read_text()
    migration = migration.replace('extensions.vector(1024)', 'extensions.vector').replace("(c->'embedding')::text::extensions.vector", "translate((c->'embedding')::text,'[]','{}')::extensions.vector")
    sql(migration)
    sql("""
SELECT test_assert(EXISTS(SELECT 1 FROM kb_jobs j JOIN kb_document_versions v ON v.id=j.version_id WHERE v.status='REMOVED' AND j.status='QUEUED' AND v.source_object_key IS NOT NULL),'recent legacy purge paths reconstructed');
-- Legacy fixtures have no storage bytes. Advance their time and attest absence
-- only in this disposable SQL fixture, then isolate the gateway/worker scenario.
UPDATE kb_document_versions SET upload_authorized_until=now()-interval '1 second' WHERE status='REMOVED';
DO $$ DECLARE j jsonb; BEGIN LOOP j:=kb_worker_command('test','claim'); EXIT WHEN j IS NULL;
 PERFORM kb_worker_command('test','complete',(j->'job'->>'id')::uuid,jsonb_build_object('lease_token',j->'job'->>'lease_token','generation',j->'job'->>'generation','storage_verified',true));
END LOOP; END $$;
""")
    sql("""
SELECT kb_admin_command('test','00000000-0000-4000-8000-000000000001','publish',(SELECT (payload->>'id')::uuid FROM test_uploads WHERE name='ms46-source'),jsonb_build_object('expected_revision',1,'audience','ADMIN_ONLY','acknowledge_warnings',true,'request_id',gen_random_uuid()));
SELECT test_assert((assistant_expand_evidence('00000000-0000-4000-8000-000000000001','test',repeat('a',64),ARRAY[(SELECT id FROM kb_chunks LIMIT 1)])->>'complete')::boolean,'complete procedure assembly');
SELECT test_raises(format('SELECT assistant_expand_evidence(%L,%L,%L,ARRAY[%L::uuid])','00000000-0000-4000-8000-000000000002','test',repeat('a',64),(SELECT id FROM kb_chunks LIMIT 1)),'KNOWLEDGE_CHANGED');
UPDATE kb_chunks SET content='corrupt fixture';
SELECT test_raises(format('SELECT assistant_expand_evidence(%L,%L,%L,ARRAY[%L::uuid])','00000000-0000-4000-8000-000000000001','test',repeat('a',64),(SELECT id FROM kb_chunks LIMIT 1)),'MANIFEST_INVALID');
UPDATE kb_chunks SET content='synthetic text';
CREATE TABLE ms46_upload(payload jsonb,permit jsonb);
DO $$ DECLARE v jsonb; request uuid:=gen_random_uuid(); BEGIN
 v:=kb_admin_command('test','00000000-0000-4000-8000-000000000001','upload',NULL,jsonb_build_object('title','exhausted','filename','synthetic.md','declared_type','MD','audience','ADMIN_ONLY','request_id',request));
 PERFORM kb_admin_command('test','00000000-0000-4000-8000-000000000001','finalize',(v->>'id')::uuid,jsonb_build_object('request_id',request,'source_bytes',14,'source_sha256',repeat('b',64)));
 UPDATE kb_jobs SET attempts=5 WHERE version_id=(v->>'id')::uuid;
END $$;
DO $$ DECLARE v jsonb; permit jsonb; BEGIN
 v:=kb_admin_command('test','00000000-0000-4000-8000-000000000001','upload',NULL,jsonb_build_object('title','fenced','filename','synthetic.md','declared_type','MD','audience','ADMIN_ONLY','request_id',gen_random_uuid()));
 permit:=kb_upload_permit('test','00000000-0000-4000-8000-000000000001',(v->>'id')::uuid,86400);
 INSERT INTO ms46_upload VALUES(v,permit);
 PERFORM kb_upload_permit('test','00000000-0000-4000-8000-000000000001',(v->>'id')::uuid,86400,(permit->>'permit_id')::uuid);
 PERFORM kb_admin_command('test','00000000-0000-4000-8000-000000000001','remove_document',(v->>'document_id')::uuid,jsonb_build_object('expected_revision',1,'request_id',gen_random_uuid()));
END $$;
SELECT test_raises(format('SELECT kb_upload_permit(%L,%L,%L,86400)','test','00000000-0000-4000-8000-000000000001',payload->>'id'),'NOT_FOUND') FROM ms46_upload;
SELECT test_raises(format('UPDATE kb_document_versions SET source_object_key=NULL WHERE id=%L',payload->>'id'),'UPLOAD_AUTHORIZATION_ACTIVE') FROM ms46_upload;
SELECT test_assert((SELECT upload_authorized_until>now()+interval '2 hours' FROM kb_document_versions WHERE id=(SELECT (payload->>'id')::uuid FROM ms46_upload)),'last authorization bound retained');
""")
    down = (ROOT / 'supabase/migrations/018_knowledge_correctness_and_cleanup_down.sql').read_text().replace('extensions.vector(1024)', 'extensions.vector').replace("(c->'embedding')::text::extensions.vector", "translate((c->'embedding')::text,'[]','{}')::extensions.vector")
    assert sql(down, check=False).returncode != 0, 'rollback must retain outstanding authorization and cleanup fences'
    gateway_boundary()
    sql("""
SELECT test_assert((SELECT count(*)=1 FROM kb_notifications WHERE kind='PROCESSING_FAILED' AND error_code='RESOURCE_LIMIT'),'exhausted claim notice once');
SELECT test_assert((SELECT j.status='RETRY' AND v.source_object_key IS NOT NULL AND j.next_attempt_at=v.upload_authorized_until FROM kb_jobs j JOIN kb_document_versions v ON v.id=j.version_id WHERE v.id=(SELECT (payload->>'id')::uuid FROM ms46_upload)),'initial purge retains paths and schedule');
-- Advance only disposable fixture time; production timestamps are never altered.
UPDATE kb_document_versions SET upload_authorized_until=now()-interval '1 second';
UPDATE kb_jobs SET next_attempt_at=now()-interval '1 second' WHERE kind='PURGE' AND status='RETRY';
""")
    # The second boundary run expects a final purge rather than a terminal claim.
    os.environ['MS46_FINAL_PURGE'] = 'true'
    try:
        gateway_boundary()
    finally:
        os.environ.pop('MS46_FINAL_PURGE', None)
    sql("SELECT test_assert((SELECT source_object_key IS NULL FROM kb_document_versions WHERE id=(SELECT (payload->>'id')::uuid FROM ms46_upload)),'final verified purge clears paths');")
    sql(down)
    print('MS46 disposable SQL integrity, cleanup fencing, terminalization and rollback passed (test vector domain).')


if __name__ == '__main__':
    lifecycle.main(acceptance)
