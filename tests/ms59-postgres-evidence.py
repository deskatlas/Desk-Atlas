"""MS59-TC08/09/14/15/16: disposable DB, real parser and publication APIs."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile

os.environ.setdefault('SPEC5_POSTGRES_PORT', '55459')
spec = importlib.util.spec_from_file_location('lifecycle', Path(__file__).with_name('spec5-postgres-lifecycle.py'))
lifecycle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lifecycle)
ROOT = lifecycle.ROOT
sys.path[:0] = [str(ROOT / 'services/rag'), str(ROOT / 'services/rag/tests')]
from knowledge.extract import extract
from knowledge.chunk import chunk_sections
from knowledge.structure import manifest_hash
from test_knowledge_ingestion import CharacterTokenizer


def literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def acceptance():
    sql = lifecycle.sql
    for name in ['018_knowledge_correctness_and_cleanup.sql', '019_section_context.sql', '020_reviewed_section_scope.sql', '022_ordinary_document_review.sql', '024_assistant_evidence_projection.sql']:
        text = (ROOT / 'supabase/migrations' / name).read_text()
        text = text.replace('extensions.vector(1024)', 'extensions.vector').replace("(c->'embedding')::text::extensions.vector", "translate((c->'embedding')::text,'[]','{}')::extensions.vector")
        sql(text)
    sql("UPDATE kb_jobs SET status='CANCELLED' WHERE status IN ('QUEUED','RUNNING','RETRY');")
    actor = lifecycle.ACTOR
    with tempfile.TemporaryDirectory(prefix='ms59-parser-') as directory:
        path = Path(directory) / 'sop.md'
        path.write_text('# Office Guide\n\n## Lost property\n\n1. Store the item securely.\n\n2. Verify ownership before release.', encoding='utf-8')
        extraction = extract(path, 'MD', Path(directory))
        chunks = chunk_sections(extraction['sections'], CharacterTokenizer())
    for chunk in chunks:
        chunk['embedding'] = [1.0] + [0.0] * 1023
    receipt = json.loads(sql(f"SELECT kb_admin_command('test','{actor}','upload',NULL,jsonb_build_object('title','Synthetic Guide','filename','sop.md','declared_type','MD','audience','ADMIN_ONLY','request_id',gen_random_uuid()));").stdout)
    vid = receipt['id']
    sql(f"SELECT kb_admin_command('test','{actor}','finalize','{vid}',jsonb_build_object('request_id',(SELECT request_id FROM kb_document_versions WHERE id='{vid}'),'source_bytes',100,'source_sha256',{literal(extraction['source_sha256'])}));")
    claim = json.loads(sql("SELECT kb_worker_command('test','claim');").stdout)
    lease = {'lease_token': claim['job']['lease_token'], 'generation': claim['job']['generation']}
    job = claim['job']['id']
    sql(f"SELECT kb_worker_command('test','checkpoint','{job}',{literal(json.dumps({**lease, 'stage': 'EMBEDDING', 'chunks': chunks}))}::jsonb);")
    completed = {**lease, 'expected_chunk_count': len(chunks), 'content_sha256': extraction['content_sha256'], 'manifest_sha256': hashlib.sha256(''.join(c['content_sha256'] for c in chunks).encode()).hexdigest(), 'structure_manifest_sha256': manifest_hash(chunks), 'parser_fingerprint': extraction['parser_fingerprint'], 'embedding_fingerprint': 'a' * 64, 'warning_codes': [], 'extraction_manifest': []}
    sql(f"SELECT kb_worker_command('test','complete','{job}',{literal(json.dumps(completed))}::jsonb);")
    review = [{'section_id': c['section_context']['section_id'], 'scope': 'LOCAL', 'dependencies': [], 'acknowledge_references': True} for c in chunks]
    roles = {c['section_context']['section_id']: 'DIRECT' if 'Verify ownership' in c['content'] else 'CONTEXT' for c in chunks}
    binding = {'source_sha256': extraction['source_sha256'], 'content_sha256': extraction['content_sha256'], 'structure_manifest_sha256': manifest_hash(chunks), 'generation': lease['generation'], 'audience': 'ADMIN_ONLY'}
    data = {'expected_revision': 1, 'audience': 'ADMIN_ONLY', 'acknowledge_warnings': True, 'acknowledge_structure': True, 'structure_review': review, 'document_review': binding, 'evidence_review': roles, 'acknowledge_evidence': True}
    def publish(value):
        return f"SELECT kb_admin_command('test','{actor}','publish','{vid}',{literal(json.dumps(value))}::jsonb||jsonb_build_object('request_id',gen_random_uuid()));"
    assert 'REVIEW_REQUIRED' in sql(publish({**data, 'acknowledge_evidence': False}), check=False).stderr
    assert 'REVIEW_REQUIRED' in sql(publish({**data, 'evidence_review': {k: 'CONTEXT' for k in roles}}), check=False).stderr
    sql(publish(data))
    seed = sql(f"SELECT id FROM kb_chunks WHERE version_id='{vid}' ORDER BY ordinal DESC LIMIT 1;").stdout.strip()
    args = f"'{actor}','test',repeat('a',64),ARRAY['{seed}'::uuid]"
    legacy = json.loads(sql(f'SELECT assistant_expand_evidence({args});').stdout)
    current = json.loads(sql(f'SELECT assistant_expand_evidence_v3({args});').stdout)
    assert legacy['complete'] and len(legacy['sources']) == len(chunks)
    assert current['complete'] and len(current['sources']) == 1
    assert len(current['context_sources']) == len(chunks) - 1
    assert 'Verify ownership' in current['sources'][0]['content']
    costs = json.loads(sql(f'SELECT assistant_evidence_costs({args});').stdout)
    assert costs['version'] == 3 and costs['roots'][0]['complete']
    assert 'permission denied' in sql(f'SET ROLE authenticated; SELECT assistant_evidence_costs({args});', check=False).stderr
    assert 'permission denied' in sql(f'SET ROLE service_role; SELECT assistant_evidence_graph_ms59({args});', check=False).stderr
    assert 'FORBIDDEN' in sql(f"SELECT assistant_expand_evidence_v3('00000000-0000-4000-8000-000000000099','test',repeat('a',64),ARRAY['{seed}'::uuid]);", check=False).stderr
    down = (ROOT / 'supabase/migrations/024_assistant_evidence_projection_down.sql').read_text()
    assert 'ACTIVE_EVIDENCE_CONTRACT' in sql(down, check=False).stderr
    # A rejected down migration aborts atomically. Continue with a clean transaction.
    sql(f"UPDATE kb_document_versions SET evidence_binding=repeat('0',64) WHERE id='{vid}';")
    assert 'MANIFEST_INVALID' in sql(f'SELECT assistant_expand_evidence_v3({args});', check=False).stderr
    sql(f"UPDATE kb_documents SET active_version_id=NULL WHERE id='{receipt['document_id']}';")
    sql(down)
    assert sql("SELECT to_regprocedure('public.assistant_expand_evidence_v3(uuid,text,text,uuid[])') IS NULL;").stdout.strip() == 't'
    assert sql("SELECT has_function_privilege('service_role','public.kb_admin_command(text,uuid,text,uuid,jsonb)','EXECUTE');").stdout.strip() == 't'
    print('MS59 disposable parser/publication, reviewed context, legacy compatibility, cost projection, denial, manifest and guarded rollback passed.')


if __name__ == '__main__':
    lifecycle.main(acceptance)
