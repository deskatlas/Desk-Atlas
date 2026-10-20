"""QAD-TC45: isolated real PostgreSQL cutover, race guards and rollback.

Uses the existing array-backed vector test domain, not pgvector acceptance.
"""
import importlib.util
import json
import os
from pathlib import Path

os.environ.setdefault('SPEC5_POSTGRES_PORT', '55469')
spec = importlib.util.spec_from_file_location('lifecycle', Path(__file__).with_name('spec5-postgres-lifecycle.py'))
lifecycle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lifecycle)


def acceptance():
    sql = lifecycle.sql
    sql('ALTER TABLE kb_document_versions ADD COLUMN system_verification jsonb;')
    source = (lifecycle.ROOT / 'supabase/migrations/029_hosted_embedding_cutover.sql').read_text()
    source = source.replace('extensions.vector(1024)', 'extensions.vector')
    source = source.replace("(item->'vector')::text::extensions.vector", "translate((item->'vector')::text,'[]','{}')::extensions.vector")
    sql(source)
    sql((lifecycle.ROOT / 'supabase/migrations/030_embedding_cleanup_independence.sql').read_text())
    sql("UPDATE kb_jobs SET status='CANCELLED' WHERE status IN ('QUEUED','RUNNING','RETRY'); UPDATE kb_document_versions SET status='FAILED' WHERE status IN ('UPLOADING','QUEUED','PROCESSING','READY');")
    # Create an isolated corpus using already-exercised lifecycle APIs.
    sql("INSERT INTO kb_catalog(scope_id,active_embedding_fingerprint,epoch) VALUES('embedding-test',repeat('a',64),1);")
    actor = lifecycle.ACTOR
    sql(f"""INSERT INTO kb_documents(id,scope_id,title,audience,created_by,updated_by) VALUES
     ('10000000-0000-4000-8000-000000000001','embedding-test','Synthetic','ADMIN_ONLY','{actor}','{actor}');
     INSERT INTO kb_document_versions(id,document_id,version_number,status,request_id,expected_revision,original_filename,detected_type,uploaded_by,embedding_fingerprint,
       review_acknowledged,reviewed_by,reviewed_at,published_by,published_at,chunk_count,expected_chunk_count,manifest_sha256)
     VALUES('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',1,'PUBLISHED',gen_random_uuid(),1,'synthetic.md','MD','{actor}',repeat('a',64),
       true,'{actor}',now(),'{actor}',now(),1,1,repeat('c',64));
     UPDATE kb_documents SET active_version_id='20000000-0000-4000-8000-000000000001' WHERE scope_id='embedding-test';
     INSERT INTO kb_chunks(id,version_id,generation,ordinal,heading_path,content,content_sha256,token_count,extraction_method,embedding,embedding_fingerprint)
     VALUES('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',1,0,'','Synthetic text',repeat('c',64),3,'TEXT','{{1,0}}'::extensions.vector,repeat('a',64));""")
    sql("UPDATE kb_document_versions SET system_verification=jsonb_build_object('policy','kb-auto-v1','embedding_fingerprint',repeat('a',64)) WHERE id='20000000-0000-4000-8000-000000000001';")
    sql("""INSERT INTO kb_jobs(version_id,document_id,kind,idempotency_key,generation,status,stage,next_attempt_at)
     VALUES('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
      'PURGE','synthetic-independent-cleanup',1,'QUEUED','WAITING_UPLOAD',now()+interval '1 day');""")
    run = json.loads(sql("SELECT kb_embedding_maintenance('begin','embedding-test',NULL,jsonb_build_object('fingerprint',repeat('b',64)));").stdout.strip())['run_id']
    def rpc(op, data=None, check=True):
        body = json.dumps(data or {}).replace("'", "''")
        return sql(f"SELECT kb_embedding_maintenance('{op}','embedding-test','{run}','{body}'::jsonb);", check)
    assert rpc('commit', check=False).returncode != 0
    assert len(json.loads(rpc('read').stdout)['chunks']) == 1
    rpc('stage', {'vectors': [{'chunk_id': '30000000-0000-4000-8000-000000000001', 'vector': [0, 1]}]})
    sql("""INSERT INTO kb_jobs(version_id,document_id,kind,idempotency_key,generation,status)
     VALUES('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
      'INGEST','synthetic-ingestion-blocker',1,'QUEUED');""")
    assert rpc('commit', check=False).returncode != 0
    assert sql("SELECT kb_embedding_maintenance('begin','embedding-test',NULL,jsonb_build_object('fingerprint',repeat('d',64)));", False).returncode != 0
    sql("UPDATE kb_jobs SET status='CANCELLED' WHERE idempotency_key='synthetic-ingestion-blocker';")
    sql("UPDATE kb_documents SET revision=revision+1 WHERE scope_id='embedding-test';")
    assert rpc('commit', check=False).returncode != 0
    sql("UPDATE kb_documents SET revision=revision-1 WHERE scope_id='embedding-test';")
    rpc('commit')
    sql("SELECT test_assert((SELECT system_verification->>'embedding_fingerprint'=repeat('b',64) FROM kb_document_versions WHERE id='20000000-0000-4000-8000-000000000001'),'verification binding migrated');")
    sql("SELECT test_assert((SELECT active_embedding_fingerprint=repeat('b',64) AND epoch>1 FROM kb_catalog WHERE scope_id='embedding-test'),'atomic fingerprint');")
    assert rpc('commit', check=False).returncode != 0
    # No leaked public mutation API.
    sql("SELECT test_assert(NOT has_function_privilege('authenticated','kb_embedding_maintenance(text,text,uuid,jsonb)','EXECUTE'),'maintenance private');")
    rpc('rollback')
    sql("SELECT test_assert((SELECT system_verification->>'embedding_fingerprint'=repeat('a',64) FROM kb_document_versions WHERE id='20000000-0000-4000-8000-000000000001'),'verification binding restored');")
    sql("SELECT test_assert((SELECT embedding_fingerprint=repeat('a',64) AND embedding='{1,0}'::extensions.vector FROM kb_chunks WHERE id='30000000-0000-4000-8000-000000000001'),'prior vectors restored');")
    sql((lifecycle.ROOT / 'supabase/migrations/030_embedding_cleanup_independence_down.sql').read_text())
    assert sql("SELECT kb_embedding_maintenance('begin','embedding-test',NULL,jsonb_build_object('fingerprint',repeat('d',64)));", False).returncode != 0
    sql((lifecycle.ROOT / 'supabase/migrations/029_hosted_embedding_cutover_down.sql').read_text())
    print('Hosted embedding atomic cutover and rollback passed (test vector domain).')


if __name__ == '__main__':
    lifecycle.main(acceptance)
