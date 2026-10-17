"""MS48-TC01..13: disposable PostgreSQL with real extraction and RPCs.

Uses the established test vector domain. This proves PostgreSQL function and
manifest behavior, not real pgvector search quality or production acceptance.
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
from test_ms48 import large_sop


def literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def acceptance():
    sql = lifecycle.sql
    for name in ['018_knowledge_correctness_and_cleanup.sql', '019_section_context.sql', '020_reviewed_section_scope.sql']:
        source = (ROOT / 'supabase/migrations' / name).read_text()
        source = source.replace('extensions.vector(1024)', 'extensions.vector')
        source = source.replace("(c->'embedding')::text::extensions.vector", "translate((c->'embedding')::text,'[]','{}')::extensions.vector")
        sql(source)
    # Isolate this scenario from the earlier lifecycle fixtures in this same
    # disposable database. No application credentials or live DB are consulted.
    sql("UPDATE kb_jobs SET status='CANCELLED' WHERE status IN ('QUEUED','RETRY','RUNNING');")
    with tempfile.TemporaryDirectory(prefix='ms48-source-') as directory:
        path = Path(directory) / 'synthetic.md'
        path.write_text(large_sop().replace('Only the Topic 0 supervisor approves Topic 0 changes.',
                                          'Only the Topic 0 supervisor approves changes according to policy.'))
        extraction = extract(path, 'MD', Path(directory))
        chunks = chunk_sections(extraction['sections'], CharacterTokenizer())
    for chunk in chunks:
        chunk['embedding'] = [1.0] + [0.0] * 1023
    actor = '00000000-0000-4000-8000-000000000001'
    version = json.loads(sql(f"SELECT kb_admin_command('test','{actor}','upload',NULL,jsonb_build_object('title','MS48 synthetic SOP','filename','synthetic.md','declared_type','MD','audience','ADMIN_ONLY','request_id',gen_random_uuid()));").stdout)
    vid = version['id']
    sql(f"SELECT kb_admin_command('test','{actor}','finalize','{vid}',jsonb_build_object('request_id',(SELECT request_id FROM kb_document_versions WHERE id='{vid}'),'source_bytes',100,'source_sha256',repeat('b',64)));")
    claim = json.loads(sql("SELECT kb_worker_command('test','claim');").stdout)
    lease = {'lease_token': claim['job']['lease_token'], 'generation': claim['job']['generation']}
    job = claim['job']['id']
    for offset in range(0, len(chunks), 16):
        sql(f"SELECT kb_worker_command('test','checkpoint','{job}',{literal(json.dumps({**lease, 'stage': 'EMBEDDING', 'chunks': chunks[offset:offset+16]}))}::jsonb);")
    complete = {**lease, 'expected_chunk_count': len(chunks), 'content_sha256': extraction['content_sha256'],
                'manifest_sha256': hashlib.sha256(''.join(c['content_sha256'] for c in chunks).encode()).hexdigest(),
                'structure_manifest_sha256': manifest_hash(chunks), 'parser_fingerprint': extraction['parser_fingerprint'],
                'embedding_fingerprint': 'a' * 64, 'warning_codes': ['SECTION_SCOPE_REVIEW'], 'extraction_manifest': []}
    sql(f"SELECT kb_worker_command('test','complete','{job}',{literal(json.dumps(complete))}::jsonb);")
    review = [{'section_id': c['section_context']['section_id'], 'scope': 'DOCUMENT' if c['section_context']['section_id'] == 's119' else 'LOCAL', 'dependencies': [], 'acknowledge_references': True} for c in chunks]
    # The synthetic reviewer explicitly resolves the generic policy reference.
    # Private policy scope is never automatically approved by this fixture.
    review[0]['dependencies'] = ['s2']
    publish = f"SELECT kb_admin_command('test','{actor}','publish','{vid}',jsonb_build_object('expected_revision',1,'audience','ADMIN_ONLY','acknowledge_warnings',true,'acknowledge_structure',true,'structure_review',{literal(json.dumps(review))}::jsonb,'request_id',gen_random_uuid()));"
    missing_review = publish.replace(literal(json.dumps(review)), "'[]'")
    assert 'REVIEW_REQUIRED' in sql(missing_review, check=False).stderr
    invalid_review = json.loads(json.dumps(review))
    invalid_review[0]['dependencies'] = ['s99999']
    assert 'REVIEW_REQUIRED' in sql(publish.replace(literal(json.dumps(review)), literal(json.dumps(invalid_review))), check=False).stderr
    assert 'permission denied' in sql(f"SET ROLE service_role; SELECT kb_apply_structure_review('{vid}','[]');", check=False).stderr
    unverified = json.loads(json.dumps(review))
    unverified[0]['acknowledge_references'] = False
    assert 'REVIEW_REQUIRED' in sql(publish.replace(literal(json.dumps(review)), literal(json.dumps(unverified))), check=False).stderr
    unresolved_review = json.loads(json.dumps(review))
    unresolved_review[0]['scope'] = 'UNRESOLVED'
    unavailable_publish = publish.replace(literal(json.dumps(review)), literal(json.dumps(unresolved_review)))
    # Explicitly unresolved publication must remain unavailable; never bypass it.
    sql(f"""BEGIN;
{unavailable_publish}
SELECT test_assert((assistant_expand_evidence('{actor}','test',repeat('a',64),ARRAY[(SELECT id FROM kb_chunks WHERE version_id='{vid}' AND ordinal=117)])->>'reason')='UNRESOLVED_CONTEXT','unresolved global context blocks unrelated suggestions');
ROLLBACK;""")
    sql(publish)
    reviewed_manifest = sql(f"SELECT structure_manifest_sha256 FROM kb_document_versions WHERE id='{vid}';").stdout.strip()
    seed = sql(f"SELECT id FROM kb_chunks WHERE version_id='{vid}' AND ordinal=117;").stdout.strip()
    statement = f"SELECT assistant_expand_evidence('{actor}','test',repeat('a',64),ARRAY['{seed}'::uuid]);"
    result = json.loads(sql(statement).stdout)
    assert result['complete'] and len(result['sources']) == 2
    assert len(result['groups']) == 2
    assert json.loads(sql(f"SELECT section_context->'dependencies' FROM kb_chunks WHERE id='{seed}';").stdout) == ['s119']
    assert 'Employees may suggest' in result['sources'][0]['content']
    assert 'Only management may approve' in result['sources'][1]['content']
    assert all('Topic 0 supervisor' not in s['content'] for s in result['sources'])
    # Reproduce the stored v3 defect: one unresolved rule was promoted globally.
    # The transaction rolls back to the reviewed v4 graph without touching content.
    sql(f"""BEGIN;
UPDATE kb_chunks SET section_context=jsonb_build_object('version',1,'section_id',section_context->>'section_id','dependencies',CASE WHEN ordinal=0 THEN '[]'::jsonb ELSE '["s1"]'::jsonb END,'unresolved',ordinal=0) WHERE version_id='{vid}';
UPDATE kb_chunks SET structure_sha256=kb_structure_hash(section_context) WHERE version_id='{vid}';
UPDATE kb_document_versions SET structure_manifest_sha256=(SELECT encode(extensions.digest(convert_to(string_agg(content_sha256||structure_sha256,'' ORDER BY ordinal),'UTF8'),'sha256'),'hex') FROM kb_chunks WHERE version_id='{vid}') WHERE id='{vid}';
SELECT test_assert((SELECT bool_and((assistant_expand_evidence('{actor}','test',repeat('a',64),ARRAY[id])->>'reason')='UNRESOLVED_CONTEXT') FROM kb_chunks WHERE version_id='{vid}'),'one unresolved v3 rule blocks all 119 seeds');
ROLLBACK;""")
    assert json.loads(sql(statement).stdout)['complete']
    print('MS48: reproduced 119/119 blocked legacy seeds; reviewed scope restores the two-source answer.')
    print('MS48: 119 stored chunks -> 2 authorized evidence chunks; serialized bytes:', len(json.dumps(result).encode()))
    # Nonselected content corruption still invalidates the entire generation.
    sql(f"UPDATE kb_chunks SET content=content||'corrupt' WHERE version_id='{vid}' AND ordinal=0;")
    assert 'MANIFEST_INVALID' in sql(statement, check=False).stderr
    sql(f"UPDATE kb_chunks SET content={literal(chunks[0]['content'])} WHERE version_id='{vid}' AND ordinal=0;")
    sql(f"UPDATE kb_chunks SET structure_sha256=repeat('0',64) WHERE version_id='{vid}' AND ordinal=0;")
    assert 'MANIFEST_INVALID' in sql(statement, check=False).stderr
    sql(f"UPDATE kb_chunks SET structure_sha256=kb_structure_hash(section_context) WHERE version_id='{vid}' AND ordinal=0;")
    sql(f"BEGIN; DELETE FROM kb_chunks WHERE version_id='{vid}' AND ordinal=0; SELECT test_raises({literal(statement)},'MANIFEST_INVALID'); ROLLBACK;")
    sql(f"UPDATE kb_document_versions SET structure_manifest_sha256=NULL WHERE id='{vid}';")
    assert json.loads(sql(statement).stdout)['reason'] == 'REPROCESS_REQUIRED'
    sql(f"UPDATE kb_document_versions SET structure_manifest_sha256='{reviewed_manifest}' WHERE id='{vid}';")
    # A different actor cannot resolve admin-only seeds or reference content.
    assert 'KNOWLEDGE_CHANGED' in sql(statement.replace(actor, '00000000-0000-4000-8000-000000000002'), check=False).stderr
    assert 'KNOWLEDGE_CHANGED' in sql(statement.replace("'test'", "'other'"), check=False).stderr
    # Add a large required closure and attest it in this synthetic fixture.
    sql(f"""UPDATE kb_chunks SET section_context=jsonb_set(section_context,'{{dependencies}}','["s1","s2","s3","s4","s5","s6","s119"]') WHERE id='{seed}';
UPDATE kb_chunks SET structure_sha256=kb_structure_hash(section_context) WHERE version_id='{vid}';
UPDATE kb_document_versions SET structure_manifest_sha256=(SELECT encode(extensions.digest(convert_to(string_agg(content_sha256||structure_sha256,'' ORDER BY ordinal),'UTF8'),'sha256'),'hex') FROM kb_chunks WHERE version_id='{vid}') WHERE id='{vid}';""")
    assert json.loads(sql(statement).stdout)['reason'] == 'CONTEXT_BUDGET'
    sql(f"UPDATE kb_chunks SET section_context=jsonb_set(section_context,'{{unresolved}}','true') WHERE id='{seed}';")
    sql(f"""UPDATE kb_chunks SET structure_sha256=kb_structure_hash(section_context) WHERE version_id='{vid}';
UPDATE kb_document_versions SET structure_manifest_sha256=(SELECT encode(extensions.digest(convert_to(string_agg(content_sha256||structure_sha256,'' ORDER BY ordinal),'UTF8'),'sha256'),'hex') FROM kb_chunks WHERE version_id='{vid}') WHERE id='{vid}';""")
    assert json.loads(sql(statement).stdout)['reason'] == 'UNRESOLVED_CONTEXT'
    sql((ROOT / 'supabase/migrations/020_reviewed_section_scope_down.sql').read_text())
    assert json.loads(sql(statement).stdout)['reason'] == 'UNRESOLVED_CONTEXT'
    sql((ROOT / 'supabase/migrations/019_section_context_down.sql').read_text().replace('extensions.vector(1024)', 'extensions.vector').replace("(c->'embedding')::text::extensions.vector", "translate((c->'embedding')::text,'[]','{}')::extensions.vector"))
    assert json.loads(sql(statement).stdout) == {'complete': False, 'sources': []}
    sql("UPDATE kb_document_versions SET upload_authorized_until=now()-interval '1 second'; UPDATE kb_document_versions SET source_object_key=NULL WHERE status='REMOVED';")
    sql((ROOT / 'supabase/migrations/018_knowledge_correctness_and_cleanup_down.sql').read_text().replace("(c->'embedding')::text::extensions.vector", "translate((c->'embedding')::text,'[]','{}')::extensions.vector"))
    print('MS48 PostgreSQL context, integrity, authorization, limits, and rollback passed.')


if __name__ == '__main__':
    lifecycle.main(acceptance)
