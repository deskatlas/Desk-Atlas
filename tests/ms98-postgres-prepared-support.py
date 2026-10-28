"""QAD-TC44-TC46: real disposable PostgreSQL prepared-artifact lifecycle."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import uuid

os.environ.setdefault('SPEC5_POSTGRES_PORT', '55498')
spec = importlib.util.spec_from_file_location('lifecycle', Path(__file__).with_name('spec5-postgres-lifecycle.py'))
lifecycle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lifecycle)
ROOT = lifecycle.ROOT
sys.path[:0] = [str(ROOT / 'services/rag'), str(ROOT / 'services/rag/tests')]
from knowledge.extract import extract
from knowledge.chunk import chunk_sections
from knowledge.structure import manifest_hash
from knowledge.preparation import verify_support_preparation
from rag.document_support import canonical_units, wire
from rag.prepared_support import PreparedArtifact, source_binding
from test_knowledge_ingestion import CharacterTokenizer


def lit(value):
    return "'" + str(value).replace("'", "''") + "'"


def acceptance():
    sql = lifecycle.sql
    for name in ['017_assistant_knowledge_availability.sql', '018_knowledge_correctness_and_cleanup.sql',
                 '019_section_context.sql', '020_reviewed_section_scope.sql', '021_knowledge_purge_scheduling.sql',
                 '022_ordinary_document_review.sql', '024_assistant_evidence_projection.sql', '025_automatic_knowledge_publication.sql',
                 '026_knowledge_upload_repair.sql', '027_rag_evidence_contract_repair.sql', '028_ms65_document_support.sql',
                 '202610280001_prepared_internal_support.sql', '202610280002_prepared_internal_audience.sql',
                 '202610280003_prepared_internal_retry.sql', '202610280004_prepared_heartbeat_recovery.sql', '202610280005_prepared_original_units.sql']:
        migration = (ROOT / 'supabase/migrations' / name).read_text(encoding='utf-8')
        migration = migration.replace('extensions.vector(1024)', 'extensions.vector').replace(
            "(c->'embedding')::text::extensions.vector", "translate((c->'embedding')::text,'[]','{}')::extensions.vector")
        sql(migration)
    sql("UPDATE kb_jobs SET status='CANCELLED' WHERE status IN ('QUEUED','RUNNING','RETRY');")
    actor, staff = lifecycle.ACTOR, '00000000-0000-4000-8000-000000000002'
    request = str(uuid.uuid4())
    receipt = json.loads(sql(f"SELECT kb_admin_command('test','{actor}','upload_auto',NULL,{lit(json.dumps({'title':'Workflow guide','filename':'guide.md','declared_type':'MD','audience':'ADMIN_AND_STAFF','request_id':request}))}::jsonb);").stdout)
    vid, doc = receipt['id'], receipt['document_id']
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / 'guide.md'
        path.write_text('# Main\nReview the payment proof.\n\n# Opening\nUnlock the doors.\n\n# Restriction\nNever approve unmatched amounts.', encoding='utf-8')
        extraction = extract(path, 'MD', Path(directory))
        size = path.stat().st_size
        chunks = chunk_sections(extraction['sections'], CharacterTokenizer())
    assert verify_support_preparation(extraction, chunks) == 'ms65-v1'
    sql(f"SELECT kb_admin_command('test','{actor}','finalize','{vid}',{lit(json.dumps({'request_id':request,'source_bytes':size,'source_sha256':extraction['source_sha256']}))}::jsonb);")
    claim = json.loads(sql("SELECT kb_worker_command('test','claim',NULL,'{\"kind\":\"INGEST\"}');").stdout)
    job = claim['job']['id']
    lease = {'lease_token':claim['job']['lease_token'], 'generation':claim['job']['generation']}
    for chunk in chunks:
        chunk['embedding'] = [1.0] + [0.0]*1023
    sql(f"SELECT kb_worker_command('test','checkpoint','{job}',{lit(json.dumps({**lease,'stage':'EMBEDDING','chunks':chunks}))}::jsonb);")
    payload = {**lease, 'preparation_policy':'kb-auto-v1', 'support_contract':'ms65-v1',
        'expected_chunk_count':len(chunks), 'content_sha256':extraction['content_sha256'],
        'manifest_sha256':hashlib.sha256(''.join(c['content_sha256'] for c in chunks).encode()).hexdigest(),
        'structure_manifest_sha256':manifest_hash(chunks), 'parser_fingerprint':extraction['parser_fingerprint'],
        'embedding_fingerprint':'a'*64, 'warning_codes':[], 'extraction_manifest':extraction['sections']}
    sql(f"SELECT kb_worker_command('test','complete','{job}',{lit(json.dumps(payload))}::jsonb);")
    args = f"'{staff}','test',repeat('a',64)"
    assert not json.loads(sql(f"SELECT assistant_prepared_catalog({args});").stdout)['complete']
    claim_sql = "SELECT kb_support_command('test','claim',NULL,jsonb_build_object('compiler_fingerprint',repeat('c',64)));"
    prepared = json.loads(sql(claim_sql).stdout)
    pjob = prepared['job']['id']
    please = {key:prepared['job'][key] for key in ('lease_token','generation')}
    assert not sql(claim_sql).stdout.strip()
    units = canonical_units(prepared['sources'])
    groups = []
    for index, heading in enumerate(['Main','Opening','Restriction']):
        addresses = [unit['i'] for unit in units if unit['heading'] == heading]
        groups.append({'id':index,'label':heading,'applies_to':heading,
            'ranges':[[min(addresses),max(addresses)]],'requires':[2] if index==0 else [],'scope':'WORKFLOW'})
    artifact = PreparedArtifact(source_binding=source_binding(prepared['sources']), units=units, groups=groups)
    completion = {**please,'artifact_text':wire(artifact.model_dump()).decode(), 'model':'Qwen/Qwen3-32B',
                  'calls':4,'bytes':2000,'input_tokens':500,'output_tokens':200,'compiler_fingerprint':'c'*64}
    malformed = {**completion,'artifact_text':json.dumps({'contract':'ragfix-prepared-v1','source_binding':'a'*64})}
    assert sql(f"SELECT kb_support_command('test','complete','{pjob}',{lit(json.dumps(malformed))}::jsonb);",check=False).returncode != 0
    sql(f"SELECT kb_support_command('test','fail','{pjob}',{lit(json.dumps({**please,'error_code':'PREPARATION_UNVERIFIED'}))}::jsonb);")
    assert not sql(claim_sql).stdout.strip(), 'unchanged failed compiler must not repeat paid work'
    retry = f"SELECT kb_support_command('test','retry','{pjob}',jsonb_build_object('compiler_fingerprint',repeat('c',64)));"
    sql(retry)
    assert sql(retry,check=False).returncode != 0, 'retry requires a failed job, never queues twice'
    retried = json.loads(sql(claim_sql).stdout)
    assert retried['job']['id'] == pjob
    sql(f"SELECT kb_support_command('test','fail','{pjob}',{lit(json.dumps({**{key:retried['job'][key] for key in ('lease_token','generation')},'error_code':'PREPARATION_UNVERIFIED'}))}::jsonb);")
    changed_claim = json.loads(sql("SELECT kb_support_command('test','claim',NULL,jsonb_build_object('compiler_fingerprint',repeat('d',64)));").stdout)
    assert changed_claim['job']['id'] == pjob
    assert changed_claim['job']['lease_token'] != please['lease_token']
    # A killed worker cannot heartbeat; reclaim before the conservative lease expires.
    sql(f"UPDATE kb_support_jobs SET updated_at=now()-interval '2 minutes' WHERE id='{pjob}';")
    recovered = json.loads(sql("SELECT kb_support_command('test','claim',NULL,jsonb_build_object('compiler_fingerprint',repeat('d',64)));").stdout)
    assert recovered['job']['id'] == pjob and recovered['job']['lease_token'] != changed_claim['job']['lease_token']
    changed_claim = recovered
    please = {key:changed_claim['job'][key] for key in ('lease_token','generation')}
    completion.update({**please,'compiler_fingerprint':'d'*64})
    sql(f"SELECT kb_support_command('test','complete','{pjob}',{lit(json.dumps({**completion,'lease_token':str(uuid.uuid4())}))}::jsonb);", check=False)
    assert not json.loads(sql(f"SELECT assistant_prepared_catalog({args});").stdout)['complete']
    complete = f"SELECT kb_support_command('test','complete','{pjob}',{lit(json.dumps(completion))}::jsonb);"
    sql(complete)
    sql(complete)
    catalog = json.loads(sql(f"SELECT assistant_prepared_catalog({args});").stdout)
    assert catalog['complete'] and len(catalog['documents']) == 1
    assert json.loads(sql(f"SELECT assistant_prepared_catalog({args},repeat('d',64));").stdout)['complete']
    assert not json.loads(sql(f"SELECT assistant_prepared_catalog({args},repeat('e',64));").stdout)['complete']
    assert 'units' not in catalog['documents'][0]
    sql("SELECT test_assert((SELECT count(*)=1 FROM audit_logs WHERE action='KB_SUPPORT_INDEX_PREPARED'),'idempotent completion');")
    selection = [{'version_id':vid,'artifact_sha256':catalog['documents'][0]['artifact_sha256'],'groups':[0]}]
    evidence = json.loads(sql(f"SELECT assistant_prepared_evidence({args},{lit(json.dumps(selection))}::jsonb);").stdout)
    assert sql(f"SELECT assistant_prepared_evidence({args},{lit(json.dumps(selection))}::jsonb,repeat('e',64));",check=False).returncode != 0
    assert {source['heading_path'] for source in evidence['sources']} == {'Main','Restriction'}
    assert set(evidence['indexes'][0]['selected_groups']) == {0,2}
    assert {unit['heading'] for unit in evidence['units']} == {'Main','Restriction'}
    assert sql('SET ROLE authenticated; SELECT * FROM kb_support_artifacts;',check=False).returncode != 0
    sql(f"SELECT kb_admin_command('test','{actor}','audience','{doc}',jsonb_build_object('expected_revision',2,'audience','ADMIN_ONLY','request_id',gen_random_uuid()));")
    assert json.loads(sql(f"SELECT assistant_prepared_catalog({args});").stdout)['documents'] == []
    assert sql(f"SELECT assistant_prepared_evidence({args},{lit(json.dumps(selection))}::jsonb);",check=False).returncode != 0
    admin_args = f"'{actor}','test',repeat('a',64)"
    assert json.loads(sql(f"SELECT assistant_prepared_catalog({admin_args});").stdout)['complete']
    # This fixture predates customer migration 032; permit its later audience.
    sql("ALTER TABLE kb_documents DROP CONSTRAINT kb_documents_audience_check;")
    sql(f"UPDATE kb_documents SET audience='CUSTOMER' WHERE id='{doc}';")
    assert json.loads(sql(f"SELECT assistant_prepared_catalog({admin_args});").stdout)['documents'] == [], 'internal discovery must not expose customer-only policy'
    sql(f"UPDATE kb_support_jobs SET status='CANCELLED' WHERE id='{pjob}';")
    sql(f"UPDATE kb_documents SET audience='ADMIN_ONLY' WHERE id='{doc}';")
    sql(f"SELECT test_assert((SELECT status='QUEUED' FROM kb_support_jobs WHERE id='{pjob}'),'restored internal audience requeues cancelled preparation');")
    sql(f"UPDATE staff_profiles SET is_active=false WHERE user_id='{actor}';")
    assert sql(f"SELECT assistant_prepared_catalog({admin_args});",check=False).returncode != 0
    sql(f"UPDATE staff_profiles SET is_active=true WHERE user_id='{actor}';")
    sql(f"UPDATE kb_support_artifacts SET source_manifest=repeat('f',64) WHERE version_id='{vid}';")
    assert not json.loads(sql(f"SELECT assistant_prepared_catalog({admin_args});").stdout)['complete']
    sql((ROOT/'supabase/migrations/202610280005_prepared_original_units_down.sql').read_text())
    sql((ROOT/'supabase/migrations/202610280004_prepared_heartbeat_recovery_down.sql').read_text())
    sql((ROOT/'supabase/migrations/202610280003_prepared_internal_retry_down.sql').read_text())
    sql((ROOT/'supabase/migrations/202610280002_prepared_internal_audience_down.sql').read_text())
    sql((ROOT/'supabase/migrations/202610280001_prepared_internal_support_down.sql').read_text())
    sql(f"SELECT test_assert((SELECT status='PUBLISHED' FROM kb_document_versions WHERE id='{vid}'),'rollback preserves canonical publication');")
    print('Prepared-support PostgreSQL lifecycle, dependency closure, authorization, freshness and rollback passed.')


if __name__ == '__main__':
    lifecycle.main(acceptance)
