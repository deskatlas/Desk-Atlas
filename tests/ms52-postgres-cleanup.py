"""MS52 / QAD-TC45/46: disposable PostgreSQL, never application databases.

Test vector domain, not pgvector or Supabase private-storage acceptance.
"""
import importlib.util
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location('lifecycle', Path(__file__).with_name('spec5-postgres-lifecycle.py'))
lifecycle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lifecycle)
ROOT = lifecycle.ROOT
ACTOR = lifecycle.ACTOR


def literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def acceptance():
    sql = lifecycle.sql
    def load(name):
        source = (ROOT / 'supabase/migrations' / name).read_text()
        source = source.replace('extensions.vector(1024)', 'extensions.vector')
        source = source.replace("(c->'embedding')::text::extensions.vector", "translate((c->'embedding')::text,'[]','{}')::extensions.vector")
        sql(source)
    for name in ['018_knowledge_correctness_and_cleanup.sql', '019_section_context.sql', '020_reviewed_section_scope.sql', '021_knowledge_purge_scheduling.sql']:
        load(name)
    sql("UPDATE kb_jobs SET status='CANCELLED' WHERE status IN ('QUEUED','RETRY','RUNNING');")
    def rpc(operation, identifier=None, data=None, scope='test'):
        raw = sql(f"SELECT kb_worker_command({literal(scope)},{literal(operation)},{literal(identifier) if identifier else 'NULL'}::uuid,{literal(json.dumps(data or {}))}::jsonb);").stdout
        return json.loads(raw.strip() or "null")
    def upload(title):
        return json.loads(sql(f"SELECT kb_admin_command('test','{ACTOR}','upload',NULL,jsonb_build_object('title',{literal(title)},'filename','synthetic.md','declared_type','MD','audience','ADMIN_ONLY','request_id',gen_random_uuid()));").stdout)
    def remove(v):
        sql(f"SELECT kb_admin_command('test','{ACTOR}','remove_document','{v['document_id']}',jsonb_build_object('expected_revision',1,'request_id',gen_random_uuid()));")
    v = upload('grace')
    vid = v['id']
    sql(f"SELECT kb_upload_permit('test','{ACTOR}','{vid}',86400);")
    remove(v)
    sql(f"SELECT test_assert((SELECT j.stage='WAITING_UPLOAD' AND j.next_attempt_at=v.upload_authorized_until FROM kb_jobs j JOIN kb_document_versions v ON v.id=j.version_id WHERE v.id='{vid}'),'durable eligibility at enqueue');")
    assert rpc('claim', data={'kind': 'PURGE'}) is None
    sql(f"UPDATE kb_document_versions SET upload_authorized_until=now()-interval '1 second' WHERE id='{vid}'; UPDATE kb_jobs SET next_attempt_at=now() WHERE version_id='{vid}';")
    claim = rpc('claim', data={'kind': 'PURGE'})
    job = claim['job']['id']
    lease = {key: claim['job'][key] for key in ['generation', 'lease_token']}
    assert rpc('claim', data={'kind': 'PURGE'}) is None, 'no duplicate lease'
    stale = dict(lease)
    sql(f"UPDATE kb_jobs SET lease_until=now()-interval '1 second' WHERE id='{job}';")
    claim = rpc('claim', data={'kind': 'PURGE'})
    lease = {key: claim['job'][key] for key in ['generation', 'lease_token']}
    assert lease['lease_token'] != stale['lease_token']
    rejected = sql(f"SELECT kb_worker_command('test','purge_targets','{job}',{literal(json.dumps(stale))}::jsonb);", check=False)
    assert 'LEASE_LOST' in rejected.stderr
    # Defense in depth: eligibility is revalidated immediately before side effects.
    sql(f"UPDATE kb_document_versions SET upload_authorized_until=now()+interval '10 seconds' WHERE id='{vid}';")
    assert rpc('purge_targets', job, lease)['status'] == 'WAITING_UPLOAD'
    sql(f"UPDATE kb_document_versions SET upload_authorized_until=now()-interval '1 second' WHERE id='{vid}'; UPDATE kb_jobs SET next_attempt_at=now() WHERE version_id='{vid}';")
    # All removed generations are drained in bounded batches before storage calls.
    sql(f"""INSERT INTO kb_chunks(version_id,generation,ordinal,heading_path,content,content_sha256,token_count,extraction_method,embedding,embedding_fingerprint)
      SELECT '{vid}',1+(i%2),i,'','synthetic',repeat('a',64),1,'TEXT',ARRAY[1.0]::extensions.vector,repeat('a',64) FROM generate_series(0,2500) i;""")
    for remaining in [1501, 501, 0]:
        sql(f"UPDATE kb_jobs SET next_attempt_at=now() WHERE id='{job}';")
        claim = rpc('claim', data={'kind': 'PURGE'})
        lease = {key: claim['job'][key] for key in ['generation', 'lease_token']}
        if remaining == 1501:
            sql(f"UPDATE kb_document_versions SET preview_object_key='{ACTOR}/{ACTOR}/preview' WHERE id='{vid}';")
            rejected = sql(f"SELECT kb_worker_command('test','purge_targets','{job}',{literal(json.dumps(lease))}::jsonb);", check=False)
            assert 'MANIFEST_INVALID' in rejected.stderr
            sql(f"SELECT test_assert((SELECT count(*)=2501 FROM kb_chunks WHERE version_id='{vid}'),'invalid target causes no chunk effects'); UPDATE kb_document_versions SET preview_object_key=NULL WHERE id='{vid}';")
        targets = rpc('purge_targets', job, lease)
        sql(f"SELECT test_assert((SELECT count(*)={remaining} FROM kb_chunks WHERE version_id='{vid}'),'bounded all-generation deletion');")
        if remaining:
            assert targets == {'deferred': True, 'status': 'CLEANING_CHUNKS'}
            assert rpc('claim', data={'kind': 'PURGE'}) is None, 'large cleanup yields between batches'
    # Wrong scope, stale lease and unverified storage cannot complete a job.
    for scope, data in [('other', lease), ('test', {**lease, 'lease_token': ACTOR}), ('test', lease)]:
        result = sql(f"SELECT kb_worker_command({literal(scope)},'complete','{job}',{literal(json.dumps(data))}::jsonb);", check=False)
        assert result.returncode
    rpc('complete', job, {**lease, 'error_code': 'STORAGE_FAILED', 'retryable': True})
    sql(f"SELECT test_assert((SELECT source_object_key IS NOT NULL FROM kb_document_versions WHERE id='{vid}'),'retry keeps paths'); UPDATE kb_jobs SET next_attempt_at=now() WHERE id='{job}';")
    claim = rpc('claim', data={'kind': 'PURGE'})
    lease = {key: claim['job'][key] for key in ['generation', 'lease_token']}
    rpc('purge_targets', job, lease)  # Idempotent crash/restart after deleted chunks.
    rpc('complete', job, {**lease, 'storage_verified': True})
    sql(f"SELECT test_assert((SELECT status='SUCCEEDED' FROM kb_jobs WHERE id='{job}'),'verified completion'); SELECT test_assert((SELECT source_object_key IS NULL FROM kb_document_versions WHERE id='{vid}'),'references cleared only after verification');")
    busy = upload('busy ingestion')
    sql(f"SELECT kb_admin_command('test','{ACTOR}','finalize','{busy['id']}',jsonb_build_object('request_id',(SELECT request_id FROM kb_document_versions WHERE id='{busy['id']}'),'source_bytes',14,'source_sha256',repeat('b',64)));")
    ingest = rpc('claim', data={'kind': 'INGEST'})
    assert ingest['job']['kind'] == 'INGEST'
    removed = upload('independent cleanup')
    remove(removed)
    purge = rpc('claim', data={'kind': 'PURGE'})
    assert purge['job']['version_id'] == removed['id']
    sql(f"SELECT test_assert((SELECT status='RUNNING' FROM kb_jobs WHERE id='{ingest['job']['id']}'),'ingestion stays leased');")
    # Newer scope-review function remains byte-for-byte unchanged by rollout.
    before = sql("SELECT md5(prosrc) FROM pg_proc WHERE proname='kb_admin_command';").stdout
    load('021_knowledge_purge_scheduling_down.sql')
    load('021_knowledge_purge_scheduling.sql')
    assert sql("SELECT md5(prosrc) FROM pg_proc WHERE proname='kb_admin_command';").stdout == before
    print('MS52 disposable PostgreSQL eligibility, bounded cleanup, lease, scope, retry, lane and rollback checks passed.')


if __name__ == '__main__':
    lifecycle.main(acceptance)
