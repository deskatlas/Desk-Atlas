"""MS53-TC10/11/13: disposable PostgreSQL publication and rollback authority.

Uses the established array-backed test vector domain, not pgvector quality or
live Supabase acceptance. No application database configuration is consulted.
"""
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile

spec = importlib.util.spec_from_file_location('lifecycle', Path(__file__).with_name('spec5-postgres-lifecycle.py'))
lifecycle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lifecycle)
ROOT = lifecycle.ROOT
sys.path[:0] = [str(ROOT / 'services/rag'), str(ROOT / 'services/rag/tests')]
from knowledge.chunk import chunk_sections
from knowledge.extract import extract
from knowledge.structure import manifest_hash
from test_knowledge_ingestion import CharacterTokenizer


def literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def acceptance():
    sql = lifecycle.sql
    for name in ['018_knowledge_correctness_and_cleanup.sql', '019_section_context.sql',
                 '020_reviewed_section_scope.sql', '022_ordinary_document_review.sql']:
        source = (ROOT / 'supabase/migrations' / name).read_text()
        source = source.replace('extensions.vector(1024)', 'extensions.vector')
        source = source.replace("(c->'embedding')::text::extensions.vector", "translate((c->'embedding')::text,'[]','{}')::extensions.vector")
        sql(source)
    sql("UPDATE kb_jobs SET status='CANCELLED' WHERE status IN ('QUEUED','RETRY','RUNNING');")
    actor = '00000000-0000-4000-8000-000000000001'

    def ready(text):
        with tempfile.TemporaryDirectory(prefix='ms53-source-') as directory:
            path = Path(directory) / 'ordinary.md'
            path.write_text(text)
            extraction = extract(path, 'MD', Path(directory))
            chunks = chunk_sections(extraction['sections'], CharacterTokenizer())
        for chunk in chunks:
            chunk['embedding'] = [1.0] + [0.0] * 1023
        receipt = json.loads(sql(f"SELECT kb_admin_command('test','{actor}','upload',NULL,jsonb_build_object('title','MS53 ordinary document','filename','ordinary.md','declared_type','MD','audience','ADMIN_ONLY','request_id',gen_random_uuid()));").stdout)
        vid = receipt['id']
        sql(f"SELECT kb_admin_command('test','{actor}','finalize','{vid}',jsonb_build_object('request_id',(SELECT request_id FROM kb_document_versions WHERE id='{vid}'),'source_bytes',100,'source_sha256',{literal(extraction['source_sha256'])}));")
        claim = json.loads(sql("SELECT kb_worker_command('test','claim');").stdout)
        lease = {'lease_token': claim['job']['lease_token'], 'generation': claim['job']['generation']}
        job = claim['job']['id']
        sql(f"SELECT kb_worker_command('test','checkpoint','{job}',{literal(json.dumps({**lease, 'stage': 'EMBEDDING', 'chunks': chunks}))}::jsonb);")
        complete = {**lease, 'expected_chunk_count': len(chunks), 'content_sha256': extraction['content_sha256'],
                    'manifest_sha256': hashlib.sha256(''.join(c['content_sha256'] for c in chunks).encode()).hexdigest(),
                    'structure_manifest_sha256': manifest_hash(chunks), 'parser_fingerprint': extraction['parser_fingerprint'],
                    'embedding_fingerprint': 'a' * 64, 'warning_codes': [], 'extraction_manifest': []}
        sql(f"SELECT kb_worker_command('test','complete','{job}',{literal(json.dumps(complete))}::jsonb);")
        return vid, {'source_sha256': extraction['source_sha256'], 'content_sha256': extraction['content_sha256'],
                     'structure_manifest_sha256': manifest_hash(chunks), 'generation': lease['generation'], 'audience': 'ADMIN_ONLY'}

    def publish(vid, binding, review=None):
        data = {'expected_revision': 1, 'audience': 'ADMIN_ONLY', 'acknowledge_warnings': True,
                'acknowledge_structure': True, 'document_review': binding, 'structure_review': review or [],
                'request_id': '00000000-0000-4000-8000-000000000009'}
        # Each attempted document uses a fresh request id, preserving idempotency.
        data.pop('request_id')
        return f"SELECT kb_admin_command('test','{actor}','publish','{vid}',{literal(json.dumps(data))}::jsonb||jsonb_build_object('request_id',gen_random_uuid()));"

    vid, binding = ready('1. Verify the reference.\n\n2. Return the card.\n\nNever add an unauthorized fee.')
    assert 'REVIEW_REQUIRED' in sql(publish(vid, None), check=False).stderr
    for field in binding:
        changed = {**binding, field: 2 if field == 'generation' else 'ADMIN_AND_STAFF' if field == 'audience' else 'f' * 64}
        assert 'REVIEW_REQUIRED' in sql(publish(vid, changed), check=False).stderr, field
    assert 'REVIEW_REQUIRED' in sql(publish(vid, binding, [{'section_id': 's1', 'scope': 'UNRESOLVED', 'dependencies': [], 'acknowledge_references': False}]), check=False).stderr
    assert 'permission denied' in sql(f"SET ROLE service_role; SELECT kb_prepare_document_review('{vid}','{{}}','ADMIN_ONLY','[]');", check=False).stderr
    sql(publish(vid, binding))
    sql(f"SELECT test_assert((SELECT document_review_identity->>'source_sha256'={literal(binding['source_sha256'])} FROM kb_document_versions WHERE id='{vid}'),'acknowledgment identity persisted');")
    sql(f"SELECT test_assert((SELECT status='PUBLISHED' AND structure_reviewed FROM kb_document_versions WHERE id='{vid}'),'document review publishes explicitly');")
    sql(f"SELECT test_assert((SELECT bool_and(section_context->>'scope'='DOCUMENT') FROM kb_chunks WHERE version_id='{vid}'),'whole headingless procedure retained');")

    vid, binding = ready('# Checkout\nDo not add a fee.\n\n# Kitchen\nThe kitchen opens at eight.')
    # TS/SQL classifier parity: conditional/negative policy remains exceptional.
    assert 'REVIEW_REQUIRED' in sql(publish(vid, binding), check=False).stderr
    sql(publish(vid, binding, [{'section_id': 's1', 'scope': 'LOCAL', 'dependencies': [], 'acknowledge_references': False}]))
    sql(f"SELECT test_assert((SELECT bool_and(section_context->>'scope'='LOCAL') FROM kb_chunks WHERE version_id='{vid}'),'neutral topic defaults and explicit local exception');")

    vid, binding = ready('# Procedure\nRead the schedule.\n\n## Steps\nSee [Procedure](#procedure).')
    sql(publish(vid, binding))
    sql(f"SELECT test_assert((SELECT section_context->'dependencies' ? 's1' FROM kb_chunks WHERE version_id='{vid}' AND ordinal=1),'prepared defaults retain ancestor and reference');")

    vid, binding = ready('See section Missing.\n\nThen finish the visit.')
    assert 'REVIEW_REQUIRED' in sql(publish(vid, binding), check=False).stderr
    assert 'REVIEW_REQUIRED' in sql(publish(vid, binding, [{'section_id': 's1', 'scope': 'DOCUMENT', 'dependencies': [], 'acknowledge_references': True}]), check=False).stderr
    # Down preserves prepared/published evidence. Old callers remain explicit.
    sql((ROOT / 'supabase/migrations/022_ordinary_document_review_down.sql').read_text())
    sql("SELECT test_assert(to_regprocedure('public.kb_prepare_document_review(uuid,jsonb,text,jsonb)') IS NULL,'review helper rollback');")
    sql("SELECT test_assert((SELECT count(*)=3 FROM kb_document_versions WHERE parser_fingerprint LIKE 'kb-parser-v5:%' AND status='PUBLISHED'),'rollback retains published generations');")
    print('MS53 document review: identity mismatches, no implicit publication, scope exceptions, dependencies, unresolved blockers, permissions and rollback passed.')


if __name__ == '__main__':
    lifecycle.main(acceptance)
