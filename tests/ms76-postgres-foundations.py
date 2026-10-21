"""MS76: disposable PostgreSQL matrix, lifecycle, RLS and control races.
Array-backed vector fixture verifies SQL boundaries, not live pgvector quality.
"""
import importlib.util
import json
import os
from pathlib import Path
import uuid
import hashlib
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
os.environ.setdefault('SPEC5_POSTGRES_PORT', '55476')
spec = importlib.util.spec_from_file_location('lifecycle', Path(__file__).with_name('spec5-postgres-lifecycle.py'))
lifecycle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lifecycle)
ROOT = lifecycle.ROOT
sys.path[:0] = [str(ROOT/'services/rag'),str(ROOT/'services/rag/tests')]
from knowledge.extract import extract
from knowledge.chunk import chunk_sections
from knowledge.structure import manifest_hash
from test_knowledge_ingestion import CharacterTokenizer


def lit(value):
    return "'" + str(value).replace("'", "''") + "'"


def acceptance():
    sql = lifecycle.sql
    sql("CREATE TABLE customer_access_challenges(token_hash text, purpose text NOT NULL CHECK(purpose='REWARDS_ACCESS')); ALTER TABLE customer_access_challenges ENABLE ROW LEVEL SECURITY;")
    sql('CREATE FUNCTION extensions.vector_dims(extensions.vector) RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT cardinality($1) $$;')
    for name in ['017_assistant_knowledge_availability.sql','018_knowledge_correctness_and_cleanup.sql','019_section_context.sql',
                 '020_reviewed_section_scope.sql','021_knowledge_purge_scheduling.sql','022_ordinary_document_review.sql',
                 '023_assistant_hybrid_retrieval.sql','024_assistant_evidence_projection.sql','025_automatic_knowledge_publication.sql',
                 '026_knowledge_upload_repair.sql','027_rag_evidence_contract_repair.sql','028_ms65_document_support.sql',
                 '032_ms76_customer_rag_foundations.sql']:
        source=(ROOT/'supabase/migrations'/name).read_text(encoding='utf-8')
        source=source.replace('extensions.vector(1024)','extensions.vector').replace("(c->'embedding')::text::extensions.vector", "translate((c->'embedding')::text,'[]','{}')::extensions.vector")
        source=source.replace('value::text::extensions.vector',"translate(value::text,'[]','{}')::extensions.vector")
        source=source.replace("(p_vectors->(q.ordinality::integer-1))::text::extensions.vector", "translate((p_vectors->(q.ordinality::integer-1))::text,'[]','{}')::extensions.vector")
        sql(source)
    sql("UPDATE kb_jobs SET status='CANCELLED' WHERE status IN ('QUEUED','RUNNING','RETRY');")
    def prepare(audience):
        actor = lifecycle.ACTOR
        staff = '00000000-0000-4000-8000-000000000002'
        request = str(uuid.uuid4())
        data = {'title':'Unseen guide', 'filename':'unseen.md', 'declared_type':'MD', 'audience':audience, 'request_id':request}
        receipt = json.loads(sql(f"SELECT kb_admin_command('test','{actor}','upload_auto',NULL,{lit(json.dumps(data))}::jsonb);").stdout)
        vid, doc = receipt['id'], receipt['document_id']
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'guide.md'
            path.write_text('\n\n'.join(f'# Topic {i}\nVerify badge {i} before allowing access.' for i in range(2)), encoding='utf-8')
            extraction = extract(path, 'MD', Path(folder))
            size = path.stat().st_size
            chunks = chunk_sections(extraction['sections'], CharacterTokenizer())
        assert len(chunks) == 2
        assert all(not c['section_context']['ancestors'] for c in chunks)
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
        return doc,vid
    prepare('VERIFIED_CUSTOMER')
    doc,vid=prepare('PUBLIC_CUSTOMER')
    actor=lifecycle.ACTOR
    staff='00000000-0000-4000-8000-000000000002'
    visitor=str(uuid.uuid4())
    cid=sql(f"SELECT id FROM kb_chunks WHERE version_id='{vid}' ORDER BY ordinal LIMIT 1;").stdout.strip()
    vector=lit('{'+','.join(['1']+['0']*1023)+'}')+'::extensions.vector'
    # Real automatic publications retain canonical hashes and structure.
    matrix={'ADMIN_ONLY':[True,False,False,False],'ADMIN_AND_STAFF':[True,True,False,False],
            'PUBLIC_CUSTOMER':[False,False,True,True],'VERIFIED_CUSTOMER':[False,False,False,True]}
    principals=[(actor,None),(staff,None),(visitor,'PUBLIC_VISITOR'),(visitor,'VERIFIED_CUSTOMER')]
    for audience, expected in matrix.items():
        revision=sql(f"SELECT revision FROM kb_documents WHERE id='{doc}';").stdout.strip()
        sql(f"SELECT kb_admin_command('test','{actor}','audience','{doc}',jsonb_build_object('expected_revision',{revision},'audience','{audience}','request_id',gen_random_uuid()));")
        for (subject,principal),allowed in zip(principals,expected):
            prefix='customer' if principal else 'assistant'
            args=f"'{subject}',"+(lit(principal)+',' if principal else '')+"'test',repeat('a',64)"
            source=json.loads(sql(f"SELECT {prefix}_read_source({args},'{vid}','{cid}');").stdout.strip() or 'null')
            assert (source is not None)==allowed,(audience,principal,'source')
            found=json.loads(sql(f"SELECT {prefix}_search_knowledge({args},{vector},0.5);").stdout)
            assert any(c['chunk_id']==cid for c in found)==allowed,(audience,principal,'search')
            hybrid=json.loads(sql(f"SELECT {prefix}_search_hybrid({args},{lit(json.dumps([[1]+[0]*1023]))}::jsonb,ARRAY['badge'],0.5);").stdout)
            assert any(c['chunk_id']==cid for c in hybrid['lexical'][0])==allowed,(audience,principal,'lexical')
            if allowed:
                expanded=json.loads(sql(f"SELECT {prefix}_document_evidence({args},ARRAY['{cid}']::uuid[]);").stdout)
                assert len(expanded['sources'])==2
            else:
                refused=sql(f"SELECT {prefix}_document_evidence({args},ARRAY['{cid}']::uuid[]);",check=False)
                assert refused.returncode!=0,(audience,principal,'expansion')
    # Metadata and content tampering are rejected before releasing titles/text.
    for change in [f"UPDATE kb_chunks SET content='tampered' WHERE id='{cid}'", f"UPDATE kb_document_versions SET generation=generation+1 WHERE id='{vid}'", f"UPDATE kb_document_versions SET status='SUPERSEDED' WHERE id='{vid}'"]:
        result=sql(f"BEGIN; {change}; SELECT customer_read_source('{visitor}','VERIFIED_CUSTOMER','test',repeat('a',64),'{vid}','{cid}'); ROLLBACK;").stdout
        assert not any(line.startswith('{') for line in result.splitlines())
    epoch=int(sql("SELECT epoch FROM kb_catalog WHERE scope_id='test';").stdout)
    revision=sql(f"SELECT revision FROM kb_documents WHERE id='{doc}';").stdout.strip()
    replacement={'title':'replacement','filename':'replacement.md','declared_type':'MD','audience':'VERIFIED_CUSTOMER','replace_document_id':doc,'expected_revision':int(revision),'request_id':str(uuid.uuid4())}
    sql(f"SELECT kb_admin_command('test','{actor}','upload_auto',NULL,{lit(json.dumps(replacement))}::jsonb);")
    assert sql(f"SELECT active_version_id FROM kb_documents WHERE id='{doc}';").stdout.strip()==vid
    sql(f"SELECT kb_admin_command('test','{actor}','remove_document','{doc}',jsonb_build_object('expected_revision',{revision},'audience','VERIFIED_CUSTOMER','request_id',gen_random_uuid()));")
    assert int(sql("SELECT epoch FROM kb_catalog WHERE scope_id='test';").stdout)>epoch
    assert sql(f"SELECT customer_read_source('{visitor}','VERIFIED_CUSTOMER','test',repeat('a',64),'{vid}','{cid}');").stdout.strip() in ('', 'null')
    assert 'permission denied' in sql("SET ROLE authenticated; SELECT * FROM customer_assistant_controls;",check=False).stderr
    assert 'permission denied' in sql("SET ROLE authenticated; SELECT * FROM customer_access_challenges;",check=False).stderr
    assert 'permission denied' in sql(f"SET ROLE authenticated; SELECT customer_read_source('{visitor}','PUBLIC_VISITOR','test',repeat('a',64),'{vid}','{cid}');",check=False).stderr
    # Cross-connection admission, ownership/generation fencing and replay.
    request,session,generation=[str(uuid.uuid4()) for _ in range(3)]
    def control(operation,req=request,gen=generation,subject='b'*64):
        return f"SELECT customer_assistant_control('{operation}','test','PUBLIC_VISITOR','{subject}','{req}','{session}','{gen}',NULL);"
    with ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(lambda _: sql(control('claim'),check=False),range(2)))
    assert sum(r.returncode==0 for r in results)==1
    assert 'REQUEST_REPLAY' in ''.join(r.stderr for r in results)
    assert sql(control('cancel',gen=str(uuid.uuid4()))).stdout.strip() in ('', 'null')
    assert sql(control('cancel',subject='c'*64)).stdout.strip() in ('', 'null')
    assert json.loads(sql(control('progress')).stdout)['stage']=='checking'
    assert json.loads(sql(control('cancel')).stdout)['cancelled']
    assert json.loads(sql(control('check')).stdout)['cancelled']
    assert 'REQUEST_REPLAY' in sql(control('claim'),check=False).stderr
    # Lease recovery without clearing the request replay tombstone.
    next_request=str(uuid.uuid4())
    sql(control('claim',req=next_request))
    sql(f"UPDATE customer_assistant_controls SET permit_until=now()-interval '1 second' WHERE request_id='{next_request}';")
    sql(control('claim',req=str(uuid.uuid4())))
    # Maintainer amendment: merge both old audiences without losing publications.
    old_epoch=int(sql("SELECT epoch FROM kb_catalog WHERE scope_id='test';").stdout)
    retained=json.loads(sql("SELECT json_build_object('version',d.active_version_id,'chunk',c.id) FROM kb_documents d JOIN kb_chunks c ON c.version_id=d.active_version_id WHERE d.audience='VERIFIED_CUSTOMER' AND d.deleted_at IS NULL ORDER BY c.ordinal LIMIT 1;").stdout)
    sql((ROOT/'supabase/migrations/036_unified_customer_knowledge.sql').read_text())
    assert int(sql("SELECT epoch FROM kb_catalog WHERE scope_id='test';").stdout)>old_epoch
    assert sql("SELECT count(*) FROM kb_documents WHERE audience IN ('PUBLIC_CUSTOMER','VERIFIED_CUSTOMER');").stdout.strip()=='0'
    assert sql("SELECT count(*) FROM kb_document_versions WHERE upload_intent->>'audience' IN ('PUBLIC_CUSTOMER','VERIFIED_CUSTOMER') OR system_verification->>'audience' IN ('PUBLIC_CUSTOMER','VERIFIED_CUSTOMER');").stdout.strip()=='0'
    for principal in ['PUBLIC_VISITOR','VERIFIED_CUSTOMER']:
        result=json.loads(sql(f"SELECT customer_read_source('{visitor}','{principal}','test',repeat('a',64),'{retained['version']}','{retained['chunk']}');").stdout)
        assert result['chunk_id']==retained['chunk']
    merged_doc,merged_vid=prepare('CUSTOMER')
    merged_cid=sql(f"SELECT id FROM kb_chunks WHERE version_id='{merged_vid}' ORDER BY ordinal LIMIT 1;").stdout.strip()
    for principal in ['PUBLIC_VISITOR','VERIFIED_CUSTOMER']:
        result=json.loads(sql(f"SELECT customer_read_source('{visitor}','{principal}','test',repeat('a',64),'{merged_vid}','{merged_cid}');").stdout)
        assert result['chunk_id']==merged_cid
    rejected={'title':'old audience','filename':'old.md','declared_type':'MD','audience':'PUBLIC_CUSTOMER','request_id':str(uuid.uuid4())}
    assert sql(f"SELECT kb_admin_command('test','{actor}','upload_auto',NULL,{lit(json.dumps(rejected))}::jsonb);",check=False).returncode
    merged_down=(ROOT/'supabase/migrations/036_unified_customer_knowledge_down.sql').read_text()
    assert 'CUSTOMER_KNOWLEDGE_REQUIRES_EXPLICIT_RECLASSIFICATION' in sql(merged_down,check=False).stderr
    # Explicit fixture reclassification permits schema downgrade without guessing.
    sql("UPDATE kb_documents SET audience='ADMIN_ONLY'; UPDATE kb_document_versions SET upload_intent=jsonb_set(upload_intent,'{audience}','\"ADMIN_ONLY\"'),system_verification=jsonb_set(system_verification,'{audience}','\"ADMIN_ONLY\"'),document_review_identity=jsonb_set(document_review_identity,'{audience}','\"ADMIN_ONLY\"');")
    sql(merged_down)
    down=(ROOT/'supabase/migrations/032_ms76_customer_rag_foundations_down.sql').read_text()
    assert 'MS76_INCOMPATIBLE_DATA' in sql(down,check=False).stderr
    # Only disposable fixture data is changed to exercise a preservation-safe down.
    sql("UPDATE customer_assistant_controls SET cancelled=true; UPDATE kb_documents SET audience='ADMIN_ONLY'; UPDATE kb_document_versions SET upload_intent=jsonb_set(upload_intent,'{audience}','\"ADMIN_ONLY\"'),system_verification=jsonb_set(system_verification,'{audience}','\"ADMIN_ONLY\"');")
    sql("INSERT INTO customer_access_challenges VALUES('fixture','REWARDS_AND_ASSISTANT_ACCESS');")
    assert 'MS76_INCOMPATIBLE_DATA' in sql(down,check=False).stderr
    sql("DELETE FROM customer_access_challenges;")
    sql(down)
    print('MS76 PostgreSQL matrix, hybrid/source/expansion denial, RLS, cross-connection control, replay and rollback passed.')

if __name__=='__main__':
    lifecycle.main(acceptance)

