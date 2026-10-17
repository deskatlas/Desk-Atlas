"""MS64-TC03..14: disposable PostgreSQL with real extraction and guarded lifecycle.
Array vector adapter does not certify pgvector or hosted private storage.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import uuid

os.environ.setdefault('SPEC5_POSTGRES_PORT', '55464')
spec = importlib.util.spec_from_file_location('lifecycle', Path(__file__).with_name('spec5-postgres-lifecycle.py'))
lifecycle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lifecycle)
ROOT = lifecycle.ROOT
sys.path[:0] = [str(ROOT / 'services/rag'), str(ROOT / 'services/rag/tests')]
from knowledge.extract import extract
from knowledge.chunk import chunk_sections
from knowledge.structure import manifest_hash
from knowledge.preparation import verify_preparation
from test_knowledge_ingestion import CharacterTokenizer


def literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def acceptance():
    sql = lifecycle.sql
    for name in ['017_assistant_knowledge_availability.sql', '018_knowledge_correctness_and_cleanup.sql',
                 '019_section_context.sql', '020_reviewed_section_scope.sql', '021_knowledge_purge_scheduling.sql',
                 '022_ordinary_document_review.sql', '024_assistant_evidence_projection.sql', '025_automatic_knowledge_publication.sql',
                 '026_knowledge_upload_repair.sql']:
        source = (ROOT / 'supabase/migrations' / name).read_text()
        source = source.replace('extensions.vector(1024)', 'extensions.vector').replace("(c->'embedding')::text::extensions.vector", "translate((c->'embedding')::text,'[]','{}')::extensions.vector")
        sql(source)
    sql("UPDATE kb_jobs SET status='CANCELLED' WHERE status IN ('QUEUED','RUNNING','RETRY');")
    actor = lifecycle.ACTOR

    def command(op, vid=None, data=None, who=actor):
        return f"SELECT kb_admin_command('test','{who}',{literal(op)},{literal(vid) if vid else 'NULL'}::uuid,{literal(json.dumps(data or {}))}::jsonb);"

    def pending(audience='ADMIN_ONLY', replacement=None, rev=1, op='upload_auto', text=None, source=None, tokenizer=None, title='Ordinary'):
        text = text or '# Checkout\n1. Verify the reference.\n\n# Restrictions\nNever add an unauthorized fee.'
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'ordinary.md'
            path.write_text(text, encoding='utf-8', newline='')
            if source is not None:
                path = source
            extraction = extract(path, 'MD', Path(folder))
            source_bytes = path.stat().st_size
            chunks = chunk_sections(extraction['sections'], tokenizer or CharacterTokenizer())
        data = {'title': title, 'filename': path.name, 'declared_type': 'MD', 'audience': audience, 'request_id': str(uuid.uuid4())}
        if replacement:
            data.update(replace_document_id=replacement, expected_revision=rev)
        receipt = json.loads(sql(command(op, data=data)).stdout)
        assert json.loads(sql(command(op, data=data)).stdout)['id'] == receipt['id']
        vid = receipt['id']
        finalize = command('finalize', vid, {'request_id': data['request_id'], 'source_bytes': source_bytes, 'source_sha256': extraction['source_sha256']})
        sql(finalize)
        sql(finalize)
        claim = json.loads(sql("SELECT kb_worker_command('test','claim',NULL,jsonb_build_object('kind','INGEST'));").stdout)
        assert claim['job']['version_id'] == vid
        lease = {'lease_token': claim['job']['lease_token'], 'generation': claim['job']['generation']}
        job = claim['job']['id']
        for chunk in chunks:
            chunk['embedding'] = [1.0] + [0.0] * 1023
        sql(f"SELECT kb_worker_command('test','checkpoint','{job}',{literal(json.dumps({**lease, 'stage': 'EMBEDDING', 'chunks': chunks}))}::jsonb);")
        payload = {**lease, 'preparation_policy': verify_preparation(extraction, chunks), 'expected_chunk_count': len(chunks),
                   'content_sha256': extraction['content_sha256'], 'manifest_sha256': hashlib.sha256(''.join(c['content_sha256'] for c in chunks).encode()).hexdigest(),
                   'structure_manifest_sha256': manifest_hash(chunks), 'parser_fingerprint': extraction['parser_fingerprint'],
                   'embedding_fingerprint': 'a' * 64, 'warning_codes': [],
                   'extraction_manifest': [{k: s[k] for k in ['heading','page','method','section_id','normalized_start','normalized_end']} for s in extraction['sections']]}
        return receipt, job, payload

    def complete(job, payload):
        return f"SELECT kb_worker_command('test','complete','{job}',{literal(json.dumps(payload))}::jsonb);"

    # QAD-TC45: a document is not limited to one answer's six-chunk budget.
    large, large_job, large_payload = pending(text='\n\n'.join(
        f'# Procedure {index}\nVerify reference {index} before checkout.' for index in range(12)))
    assert large_payload['expected_chunk_count'] > 6
    sql(complete(large_job, large_payload))
    sql(f"SELECT test_assert((SELECT status='PUBLISHED' FROM kb_document_versions WHERE id='{large['id']}'),'complete multi-section guide publishes');")
    sql(command('remove_document', large['document_id'], {'expected_revision': 2, 'request_id': str(uuid.uuid4())}))

    # Optional private local fixtures stay outside the repository and source logs.
    if os.environ.get('KB_UPLOAD_FIXTURE_DIR'):
        from transformers import AutoTokenizer
        model = json.loads((ROOT / 'services/rag/models.json').read_text())['embedding']
        tokenizer = AutoTokenizer.from_pretrained(model['id'], revision=model['tokenizer_revision'],
            cache_dir=str(ROOT / 'services/rag/.cache/models'), local_files_only=True)
        names = ['WORKSPACE MAP TAB', 'RESERVATION MANAGEMENT', 'QR SCANNER TAB', 'RESERVATIONS TAB',
                 'EXTEND RESERVATION', 'KIOSK PAYMENT CONFIRMATION', 'KIOSK QUEUE TAB', 'RELOCATE',
                 'DASHBOARD TAB', 'MY ACTIVITY TAB']
        for name in names:
            source = Path(os.environ['KB_UPLOAD_FIXTURE_DIR']) / f'STAFF - {name}.md'
            receipt, fixture_job, fixture_payload = pending(source=source, tokenizer=tokenizer)
            sql(complete(fixture_job, fixture_payload))
            sql(f"SELECT test_assert((SELECT status='PUBLISHED' AND chunk_count={fixture_payload['expected_chunk_count']} FROM kb_document_versions WHERE id='{receipt['id']}'),'complete supplied guide publishes');")
            sql(command('remove_document', receipt['document_id'], {'expected_revision': 2, 'request_id': str(uuid.uuid4())}))
            print(f"Supplied guide {source.name}: published {fixture_payload['expected_chunk_count']} complete chunks.", flush=True)

    r, job, payload = pending()
    vid, doc = r['id'], r['document_id']
    assert 'NOT_FOUND' in sql(complete(job, payload).replace("'test'", "'other-scope'", 1), check=False).stderr
    sql(complete(job, payload))
    sql(complete(job, payload))
    sql(f"SELECT test_assert((SELECT status='PUBLISHED' AND NOT structure_reviewed AND NOT review_acknowledged AND reviewed_at IS NULL AND document_review_identity IS NULL AND evidence_roles IS NULL AND system_verification->>'policy'='kb-auto-v1' FROM kb_document_versions WHERE id='{vid}'),'truthful auto provenance');")
    sql(f"SELECT test_assert((SELECT count(*)=1 FROM kb_notifications WHERE job_id='{job}' AND kind='AVAILABLE'),'one durable outcome');")
    sql(f"SELECT test_assert((SELECT bool_and(section_context->>'scope'='DOCUMENT' AND jsonb_array_length(section_context->'dependencies')=1) FROM kb_chunks WHERE version_id='{vid}'),'all qualifications retained');")
    sql(f"SELECT test_assert((assistant_knowledge_availability('{actor}','test',repeat('a',64))->>'enabled')::boolean,'auto publication enables admin retrieval');")
    sql("SELECT test_assert(NOT (assistant_knowledge_availability('00000000-0000-4000-8000-000000000002','test',repeat('a',64))->>'enabled')::boolean,'staff denied admin only');")
    sql(f"SELECT test_assert((assistant_project_evidence('{actor}','test',repeat('a',64),ARRAY[(SELECT id FROM kb_chunks WHERE version_id='{vid}' ORDER BY ordinal LIMIT 1)])->>'complete')::boolean,'compatible conservative projection');")
    sql(f"SELECT test_assert((SELECT jsonb_array_length(assistant_project_evidence('{actor}','test',repeat('a',64),ARRAY[(SELECT id FROM kb_chunks WHERE version_id='{vid}' ORDER BY ordinal LIMIT 1)])->'sources')=2),'qualification remains required');")
    # Replacement does not change the live audience or predecessor until commit.
    successor, job, payload = pending('ADMIN_AND_STAFF', doc, 2, title='Updated staff guide')
    sql(f"SELECT test_assert((SELECT active_version_id='{vid}' AND audience='ADMIN_ONLY' FROM kb_documents WHERE id='{doc}'),'predecessor remains active');")
    sql(f"SELECT test_assert((SELECT title='Ordinary' FROM kb_documents WHERE id='{doc}'),'name stays until publication');")
    sql(complete(job, payload))
    sql(f"SELECT test_assert((SELECT active_version_id='{successor['id']}' AND audience='ADMIN_AND_STAFF' FROM kb_documents WHERE id='{doc}'),'atomic successor audience');")
    sql(f"SELECT test_assert((SELECT title='Updated staff guide' FROM kb_documents WHERE id='{doc}'),'entered replacement name persists');")
    sql("SELECT test_assert((assistant_knowledge_availability('00000000-0000-4000-8000-000000000002','test',repeat('a',64))->>'enabled')::boolean,'staff shared availability');")
    # Failed replacement preserves usable knowledge.
    failed, job, payload = pending('ADMIN_ONLY', doc, 3)
    payload.pop('preparation_policy')
    sql(complete(job, payload))
    sql(f"SELECT test_assert((SELECT status='FAILED' FROM kb_document_versions WHERE id='{failed['id']}'),'missing verification fails closed');")
    sql(f"SELECT test_assert((SELECT active_version_id='{successor['id']}' AND audience='ADMIN_AND_STAFF' FROM kb_documents WHERE id='{doc}'),'failed replacement preserves publication');")
    # Explicit retry creates a new fenced generation, retaining the exact intent.
    sql(command('retry', failed['id'], {'expected_revision': 3, 'request_id': str(uuid.uuid4())}))
    sql(f"SELECT test_assert((SELECT generation=2 AND upload_intent->>'generation'='2' AND upload_intent->>'audience'='ADMIN_ONLY' FROM kb_document_versions WHERE id='{failed['id']}'),'retry preserves intent');")
    sql(command('remove_version', failed['id'], {'expected_revision': 3, 'request_id': str(uuid.uuid4())}))
    # Removal wins over a correctly leased delayed completion.
    removed, removed_job, removed_payload = pending()
    sql(command('remove_document', removed['document_id'], {'expected_revision': 1, 'request_id': str(uuid.uuid4())}))
    assert 'LEASE_LOST' in sql(complete(removed_job, removed_payload), check=False).stderr
    sql(f"SELECT test_assert((SELECT status='REMOVED' FROM kb_document_versions WHERE id='{removed['id']}'),'no resurrection');")
    # Concurrent audience restriction fences a late worker.
    stale, job, payload = pending('ADMIN_AND_STAFF', doc, 3)
    sql(command('audience', doc, {'expected_revision': 3, 'audience': 'ADMIN_ONLY', 'request_id': str(uuid.uuid4())}))
    assert 'LEASE_LOST' in sql(complete(job, payload), check=False).stderr
    # Deactivation blocks publication even after accepted transfer.
    r, job, payload = pending()
    sql(f"UPDATE staff_profiles SET is_active=false WHERE user_id='{actor}';")
    sql(complete(job, payload))
    sql(f"SELECT test_assert((SELECT status='FAILED' FROM kb_document_versions WHERE id='{r['id']}'),'deactivation blocks publication');")
    sql(f"UPDATE staff_profiles SET is_active=true WHERE user_id='{actor}';")
    # Old READY backlog has no upload intent and stays unpublished.
    r, job, payload = pending(op='upload')
    sql(complete(job, payload))
    sql(f"SELECT test_assert((SELECT status='READY' AND upload_intent IS NULL FROM kb_document_versions WHERE id='{r['id']}'),'no backlog publication');")
    # Private worker entrypoints cannot be invoked by browser roles.
    assert 'permission denied' in sql("SET ROLE authenticated; SELECT kb_worker_command('test','claim',NULL,jsonb_build_object('kind','INGEST'));", check=False).stderr
    assert 'permission denied' in sql("SET ROLE service_role; SELECT kb_worker_command_ms63('test','claim');", check=False).stderr
    assert 'FORBIDDEN' in sql(command('upload_auto', data={}, who='00000000-0000-4000-8000-000000000002'), check=False).stderr
    assert 'MS64_PROVENANCE_IN_USE' in sql((ROOT/'supabase/migrations/025_automatic_knowledge_publication_down.sql').read_text(), check=False).stderr
    # Once all automated work is retired, rollback archives truthful provenance.
    auto_docs = json.loads(sql("SELECT jsonb_agg(jsonb_build_object('id',d.id,'revision',d.revision)) FROM kb_documents d WHERE d.deleted_at IS NULL AND EXISTS(SELECT 1 FROM kb_document_versions v WHERE v.document_id=d.id AND v.upload_intent IS NOT NULL);").stdout)
    for row in auto_docs:
        sql(command('remove_document', row['id'], {'expected_revision': row['revision'], 'request_id': str(uuid.uuid4())}))
    sql((ROOT/'supabase/migrations/026_knowledge_upload_repair_down.sql').read_text())
    sql((ROOT/'supabase/migrations/025_automatic_knowledge_publication_down.sql').read_text())
    sql("SELECT test_assert(EXISTS(SELECT 1 FROM audit_logs WHERE action='KB_AUTO_PROVENANCE_ARCHIVED' AND metadata->'system_verification'->>'policy'='kb-auto-v1'),'rollback archives retired provenance');")
    print('MS64 disposable SQL: upload intent, finalize idempotency, verification, atomic replacement, audience isolation, stale workers, deactivation, legacy and rollback guard passed.')


if __name__ == '__main__':
    lifecycle.main(acceptance)

