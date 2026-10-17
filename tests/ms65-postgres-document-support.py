"""MS65: real disposable PostgreSQL, production extraction and lifecycle SQL.
The vector-domain adapter is not pgvector/hosted-storage acceptance.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import uuid
os.environ.setdefault('SPEC5_POSTGRES_PORT', '55465')
spec = importlib.util.spec_from_file_location('lifecycle', Path(__file__).with_name('spec5-postgres-lifecycle.py'))
lifecycle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lifecycle)
ROOT = lifecycle.ROOT
sys.path[:0] = [str(ROOT / 'services/rag'), str(ROOT / 'services/rag/tests')]
from knowledge.extract import extract
from knowledge.chunk import chunk_sections
from knowledge.structure import manifest_hash
from knowledge.preparation import verify_support_preparation
from test_knowledge_ingestion import CharacterTokenizer

def lit(value):
    return "'" + str(value).replace("'", "''") + "'"

def acceptance():
    sql = lifecycle.sql
    for name in ['017_assistant_knowledge_availability.sql', '018_knowledge_correctness_and_cleanup.sql',
                 '019_section_context.sql', '020_reviewed_section_scope.sql', '021_knowledge_purge_scheduling.sql',
                 '022_ordinary_document_review.sql', '024_assistant_evidence_projection.sql', '025_automatic_knowledge_publication.sql',
                 '026_knowledge_upload_repair.sql', '027_rag_evidence_contract_repair.sql', '028_ms65_document_support.sql']:
        source = (ROOT / 'supabase/migrations' / name).read_text(encoding='utf-8')
        source = source.replace('extensions.vector(1024)', 'extensions.vector').replace("(c->'embedding')::text::extensions.vector", "translate((c->'embedding')::text,'[]','{}')::extensions.vector")
        sql(source)
    sql("UPDATE kb_jobs SET status='CANCELLED' WHERE status IN ('QUEUED','RUNNING','RETRY');")
    actor = lifecycle.ACTOR
    staff = '00000000-0000-4000-8000-000000000002'
    request = str(uuid.uuid4())
    data = {'title':'Unseen guide', 'filename':'unseen.md', 'declared_type':'MD', 'audience':'ADMIN_AND_STAFF', 'request_id':request}
    receipt = json.loads(sql(f"SELECT kb_admin_command('test','{actor}','upload_auto',NULL,{lit(json.dumps(data))}::jsonb);").stdout)
    vid, doc = receipt['id'], receipt['document_id']
    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder) / 'guide.md'
        path.write_text('\n\n'.join(f'# Topic {i}\nVerify badge {i} before allowing access.' for i in range(40)), encoding='utf-8')
        extraction = extract(path, 'MD', Path(folder))
        size = path.stat().st_size
        chunks = chunk_sections(extraction['sections'], CharacterTokenizer())
    assert len(chunks) == 40
    assert all(not c['section_context']['ancestors'] for c in chunks)
    assert verify_support_preparation(extraction, chunks) == 'ms65-v1'
    sql(f"SELECT kb_admin_command('test','{actor}','finalize','{vid}',{lit(json.dumps({'request_id':request,'source_bytes':size,'source_sha256':extraction['source_sha256']}))}::jsonb);")
    claim = json.loads(sql("SELECT kb_worker_command('test','claim',NULL,'{\"kind\":\"INGEST\"}');").stdout)
    job = claim['job']['id']
    lease = {'lease_token':claim['job']['lease_token'], 'generation':claim['job']['generation']}
    for c in chunks:
        c['embedding'] = [1.0] + [0.0]*1023
    for offset in range(0,len(chunks),4):
        sql(f"SELECT kb_worker_command('test','checkpoint','{job}',{lit(json.dumps({**lease,'stage':'EMBEDDING','chunks':chunks[offset:offset+4]}))}::jsonb);")
    payload = {**lease, 'preparation_policy':'kb-auto-v1', 'support_contract':'ms65-v1',
               'expected_chunk_count':len(chunks), 'content_sha256':extraction['content_sha256'],
               'manifest_sha256':hashlib.sha256(''.join(c['content_sha256'] for c in chunks).encode()).hexdigest(),
               'structure_manifest_sha256':manifest_hash(chunks), 'parser_fingerprint':extraction['parser_fingerprint'],
               'embedding_fingerprint':'a'*64, 'warning_codes':[], 'extraction_manifest':extraction['sections']}
    completion = f"SELECT kb_worker_command('test','complete','{job}',{lit(json.dumps(payload))}::jsonb);"
    sql(completion)
    sql(completion)
    sql(f"SELECT test_assert((SELECT support_contract='ms65-v1' AND NOT structure_reviewed FROM kb_document_versions WHERE id='{vid}'),'truthful negotiated publication');")
    sql(f"SELECT test_assert((SELECT bool_and(jsonb_array_length(section_context->'dependencies')=0 AND section_context->>'scope'='DOCUMENT') FROM kb_chunks WHERE version_id='{vid}'),'sibling headings are not global graph edges');")
    seed = sql(f"SELECT id FROM kb_chunks WHERE version_id='{vid}' ORDER BY ordinal LIMIT 1;").stdout.strip()
    args = f"'{staff}','test',repeat('a',64),ARRAY['{seed}']::uuid[]"
    result = json.loads(sql(f"SELECT assistant_document_evidence({args});").stdout)
    assert len(result['sources']) == 40
    assert result['contract'] == 'ms65-v1'
    old = json.loads(sql(f"SELECT assistant_expand_evidence_v3({args});").stdout)
    assert old['reason'] == 'REPROCESS_REQUIRED'
    sql(f"SELECT test_assert((SELECT count(*)=1 FROM kb_notifications WHERE job_id='{job}' AND kind='AVAILABLE'),'one terminal notice');")
    blocked_rollback = sql((ROOT/'supabase/migrations/028_ms65_document_support_down.sql').read_text(),check=False)
    assert 'ACTIVE_SUPPORT_CONTRACT' in blocked_rollback.stderr
    # Restriction and removal revoke both direct and whole-document inspection.
    sql(f"SELECT kb_admin_command('test','{actor}','audience','{doc}',jsonb_build_object('expected_revision',2,'audience','ADMIN_ONLY','request_id',gen_random_uuid()));")
    assert sql(f"SELECT assistant_document_evidence({args});",check=False).returncode != 0
    # Emulate a legacy artifact only in this disposable database to test durable
    # repair discovery and revision/audience fencing, never a live mutation.
    sql(f"UPDATE kb_document_versions SET support_contract=NULL WHERE id='{vid}';")
    inventory = json.loads(sql(f"SELECT kb_evidence_repairs('test','{actor}');").stdout)
    assert any(row['id'] == doc for row in inventory)
    req = str(uuid.uuid4())
    begin = f"SELECT kb_begin_evidence_repair('test','{actor}','{doc}',3,'{req}');"
    repair = json.loads(sql(begin).stdout)
    assert json.loads(sql(begin).stdout)['id'] == repair['id']
    assert repair['source_sha256'] == extraction['source_sha256']
    assert repair['target_object_key'] != repair['source_object_key']
    rid = repair['id']
    bad = f"SELECT kb_finalize_evidence_repair('test','{actor}','{rid}',repeat('f',64),{size});"
    assert 'MANIFEST_INVALID' in sql(bad,check=False).stderr
    sql(f"SELECT kb_finalize_evidence_repair('test','{actor}','{rid}','{extraction['source_sha256']}',{size});")
    sql(f"SELECT test_assert((SELECT active_version_id='{vid}' FROM kb_documents WHERE id='{doc}'),'repair leaves predecessor active');")
    repair_claim = json.loads(sql("SELECT kb_worker_command('test','claim',NULL,'{\"kind\":\"INGEST\"}');").stdout)
    repair_job = repair_claim['job']['id']
    repair_lease = {'lease_token':repair_claim['job']['lease_token'],'generation':repair_claim['job']['generation']}
    for offset in range(0,len(chunks),4):
        sql(f"SELECT kb_worker_command('test','checkpoint','{repair_job}',{lit(json.dumps({**repair_lease,'stage':'EMBEDDING','chunks':chunks[offset:offset+4]}))}::jsonb);")
    repaired = f"SELECT kb_worker_command('test','complete','{repair_job}',{lit(json.dumps({**payload,**repair_lease}))}::jsonb);"
    sql(repaired)
    sql(repaired)
    sql(f"SELECT test_assert((SELECT active_version_id='{rid}' AND audience='ADMIN_ONLY' AND revision=4 FROM kb_documents WHERE id='{doc}'),'source-equivalent repair activates atomically without widening audience');")
    sql(f"SELECT test_assert((SELECT repair_of='{vid}' AND support_contract='ms65-v1' AND NOT review_acknowledged FROM kb_document_versions WHERE id='{rid}'),'repair provenance stays automated');")
    sql(f"SELECT test_assert((SELECT status='SUPERSEDED' AND source_sha256='{extraction['source_sha256']}' FROM kb_document_versions WHERE id='{vid}'),'predecessor original identity retained');")
    sql(f"SELECT test_assert((SELECT count(*)=1 FROM kb_notifications WHERE job_id='{repair_job}' AND kind='AVAILABLE'),'repair has one terminal notice');")
    # Another legacy publication supports a separate stale-repair race.
    sql(f"UPDATE kb_document_versions SET support_contract=NULL WHERE id='{rid}';")
    next_req = str(uuid.uuid4())
    stale = json.loads(sql(f"SELECT kb_begin_evidence_repair('test','{actor}','{doc}',4,'{next_req}');").stdout)
    rid = stale['id']
    sql(f"SELECT kb_finalize_evidence_repair('test','{actor}','{rid}','{extraction['source_sha256']}',{size});")
    sql(f"SELECT kb_admin_command('test','{actor}','audience','{doc}',jsonb_build_object('expected_revision',4,'audience','ADMIN_ONLY','request_id',gen_random_uuid()));")
    sql("SELECT kb_worker_command('test','claim',NULL,'{\"kind\":\"INGEST\"}');")
    sql(f"SELECT test_assert((SELECT status IN ('CANCELLED','FAILED') FROM kb_jobs WHERE version_id='{rid}' AND kind='INGEST'),'audience revision fences stale repair');")
    sql(f"SELECT kb_admin_command('test','{actor}','remove_document','{doc}',jsonb_build_object('expected_revision',5,'request_id',gen_random_uuid()));")
    sql((ROOT/'supabase/migrations/028_ms65_document_support_down.sql').read_text())
    sql((ROOT/'supabase/migrations/027_rag_evidence_contract_repair_down.sql').read_text())
    print('MS65 PostgreSQL publication, 40-source admission, permissions, repair fencing and rollback passed.')

if __name__ == '__main__':
    lifecycle.main(acceptance)
