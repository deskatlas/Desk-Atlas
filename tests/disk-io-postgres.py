"""QAD-TC35/44/45/48: isolated SQL counts, exact search parity and rollback.

Uses the existing disposable PostgreSQL harness and its array vector adapter.
No application environment credentials or production database are accessed.
"""
import importlib.util
import json
import os
from pathlib import Path

os.environ.setdefault('SPEC5_POSTGRES_PORT', '55438')
spec = importlib.util.spec_from_file_location('lifecycle', Path(__file__).with_name('spec5-postgres-lifecycle.py'))
lifecycle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lifecycle)
ROOT = lifecycle.ROOT


def acceptance():
    sql = lifecycle.sql
    sql("DO $$ DECLARE j jsonb; BEGIN LOOP j:=kb_worker_command('test','claim'); EXIT WHEN j IS NULL; PERFORM kb_worker_command('test','complete',(j->'job'->>'id')::uuid,jsonb_build_object('lease_token',j->'job'->>'lease_token','generation',j->'job'->>'generation')); END LOOP; END $$;")
    sql("SELECT test_upload('io-current');")
    sql(f"SELECT kb_admin_command('test','{lifecycle.ACTOR}','publish',(SELECT (payload->>'id')::uuid FROM test_uploads WHERE name='io-current'),jsonb_build_object('expected_revision',1,'audience','ADMIN_AND_STAFF','acknowledge_warnings',true,'request_id',gen_random_uuid()));")
    def migration(name):
        source = (ROOT / 'supabase/migrations' / name).read_text(encoding='utf-8')
        source = source.replace('extensions.vector(1024)', 'extensions.vector')
        source = source.replace("(c->'embedding')::text::extensions.vector", "translate((c->'embedding')::text,'[]','{}')::extensions.vector")
        source = source.replace('value::text::extensions.vector', "translate(value::text,'[]','{}')::extensions.vector")
        source = source.replace("(p_vectors->(q.ordinality::integer-1))::text::extensions.vector", "translate((p_vectors->(q.ordinality::integer-1))::text,'[]','{}')::extensions.vector")
        sql(source)
    for name in [
        '017_assistant_knowledge_availability.sql', '018_knowledge_correctness_and_cleanup.sql',
        '019_section_context.sql', '020_reviewed_section_scope.sql', '021_knowledge_purge_scheduling.sql',
        '022_ordinary_document_review.sql', '023_assistant_hybrid_retrieval.sql',
        '024_assistant_evidence_projection.sql', '025_automatic_knowledge_publication.sql',
        '026_knowledge_upload_repair.sql', '027_rag_evidence_contract_repair.sql', '028_ms65_document_support.sql',
    ]:
        migration(name)
    sql('''CREATE TABLE customer_access_challenges(purpose text,
 CONSTRAINT customer_access_challenges_purpose_check CHECK(purpose='REWARDS_ACCESS'));
 CREATE FUNCTION extensions.vector_dims(extensions.vector) RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT cardinality($1) $$;''')
    migration('032_ms76_customer_rag_foundations.sql')
    migration('036_unified_customer_knowledge.sql')
    # More candidates than the branch limit; verify nonempty top-12 parity.
    sql("""INSERT INTO kb_chunks(version_id,generation,ordinal,heading_path,content,content_sha256,
 token_count,extraction_method,embedding,embedding_fingerprint)
 SELECT c.version_id,c.generation,n,c.heading_path,c.content,c.content_sha256,c.token_count,
 c.extraction_method,c.embedding,c.embedding_fingerprint FROM kb_chunks c
 CROSS JOIN generate_series(1,39) n WHERE c.version_id IN (SELECT active_version_id FROM kb_documents);
 UPDATE kb_document_versions v SET expected_chunk_count=40,chunk_count=40,
 manifest_sha256=(SELECT encode(extensions.digest(string_agg(c.content_sha256,'' ORDER BY c.ordinal),'sha256'),'hex')
 FROM kb_chunks c WHERE c.version_id=v.id AND c.generation=v.generation) WHERE status='PUBLISHED';""")
    baseline_availability = sql("SELECT pg_get_functiondef('assistant_knowledge_availability(uuid,text,text)'::regprocedure)").stdout
    baseline_search = {name: sql(f"SELECT pg_get_functiondef('{name}'::regproc)").stdout
                       for name in ['assistant_search_hybrid', 'customer_search_hybrid']}
    migration('038_assistant_disk_io.sql')
    # Install the real 033 control wrapper without its unrelated catalog tables.
    wrapper = (ROOT / 'supabase/migrations/033_ms77_public_assistant.sql').read_text(encoding='utf-8')
    sql(wrapper[wrapper.index('ALTER FUNCTION public.customer_assistant_control'):wrapper.index('-- PRD-F1-F4')])
    control_baseline = sql("SELECT pg_get_functiondef('customer_assistant_control_ms76(text,text,text,text,uuid,uuid,uuid,text)'::regprocedure)").stdout
    # Hosted export: both names contain the same full MS76 implementation.
    # Reproduce that drift without requiring the private customer export file.
    wrapper_baseline = sql("SELECT pg_get_functiondef('customer_assistant_control(text,text,text,text,uuid,uuid,uuid,text)'::regprocedure)").stdout
    sql(control_baseline.replace('FUNCTION public.customer_assistant_control_ms76(',
                                 'FUNCTION public.customer_assistant_control('))
    duplicate_baseline = {name: sql(f"SELECT pg_get_functiondef('{name}'::regproc)").stdout
                          for name in ['customer_assistant_control', 'customer_assistant_control_ms76']}
    sql(duplicate_baseline['customer_assistant_control'].replace(
        "IF p_operation='claim' THEN", "IF p_operation='claim' THEN /* divergent implementation */"))
    rejected = sql((ROOT / 'supabase/migrations/039_customer_control_read_locks.sql').read_text(encoding='utf-8'), check=False)
    assert 'UNEXPECTED_CONTROL_IMPLEMENTATION' in rejected.stderr
    assert sql("SELECT count(*) FROM pg_proc WHERE proname LIKE 'customer_assistant_control%io_baseline'").stdout.strip() == '0'
    sql(duplicate_baseline['customer_assistant_control'])
    migration('039_customer_control_read_locks.sql')
    for name in duplicate_baseline:
        definition = sql(f"SELECT pg_get_functiondef('{name}'::regproc)").stdout
        assert "IF p_operation IN ('check','progress') THEN" in definition
        assert 'deadline>t FOR UPDATE;' in definition
        assert 'permission denied' in sql(f"SET ROLE service_role; SELECT {name}_io_baseline(NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL)", check=False).stderr
    migration('039_customer_control_read_locks_down.sql')
    for name, definition in duplicate_baseline.items():
        assert definition == sql(f"SELECT pg_get_functiondef('{name}'::regproc)").stdout
    sql(wrapper_baseline)
    migration('039_customer_control_read_locks.sql')
    migration('040_customer_verification_dedup.sql')
    assert baseline_availability == sql("SELECT pg_get_functiondef('assistant_knowledge_availability(uuid,text,text)'::regprocedure)").stdout
    for signature in ['assistant_knowledge_status(uuid,text,text)', 'customer_knowledge_status(uuid,text,text,text)']:
        definition = sql(f"SELECT pg_get_functiondef('{signature}'::regprocedure)").stdout
        assert 'kb_chunks' not in definition and 'kb_customer_version_valid' not in definition
        assert 'permission denied' in sql(f"SET ROLE authenticated; SELECT {signature.split('(')[0]}(NULL,NULL,NULL" + (',NULL' if signature.startswith('customer') else '') + ');', check=False).stderr
    vector = json.dumps([[1.] + [0.] * 1023] * 2)
    actor = lifecycle.ACTOR
    args = f"'{actor}','test','{'a' * 64}','{vector}'::jsonb,ARRAY['synthetic','unmatchedzz'],0.5"
    for name, params in [('assistant_search_hybrid', args),
                         ('customer_search_hybrid', args.replace(f"'{actor}',", f"'{actor}','PUBLIC_VISITOR',", 1))]:
        # Verify shared, admin-only and customer audiences without changing scores.
        for audience in ['ADMIN_AND_STAFF', 'ADMIN_ONLY', 'CUSTOMER']:
            sql(f"UPDATE kb_documents SET audience='{audience}' WHERE active_version_id IS NOT NULL")
            for threshold in ['0.5', '1', '-1']:
                p = params.rsplit(',', 1)[0] + ',' + threshold
                actual = json.loads(sql(f'SELECT {name}({p})').stdout)
                expected = json.loads(sql(f'SELECT {name}_io_baseline({p})').stdout)
                assert actual == expected, (name, audience, threshold)
                if (name.startswith('assistant') and audience in ['ADMIN_ONLY', 'ADMIN_AND_STAFF']) or (name.startswith('customer') and audience == 'CUSTOMER'):
                    assert len(actual['semantic'][0]) == 12
                    assert len(actual['lexical'][0]) == 12
                    assert actual['lexical'][1] == []
        assert 'permission denied' in sql(f'SET ROLE service_role; SELECT {name}_io_baseline({params})', check=False).stderr
    sql("UPDATE kb_documents SET audience='ADMIN_AND_STAFF' WHERE active_version_id IS NOT NULL")
    customer_args = args.replace(f"'{actor}',", f"'{actor}','PUBLIC_VISITOR',", 1)
    for change in ["UPDATE kb_chunks SET content='tampered' WHERE version_id IN (SELECT active_version_id FROM kb_documents)",
                   "UPDATE kb_chunks SET embedding_fingerprint='wrong' WHERE version_id IN (SELECT active_version_id FROM kb_documents)",
                   "UPDATE kb_document_versions SET manifest_sha256=repeat('0',64) WHERE status='PUBLISHED'",
                   "UPDATE kb_document_versions SET expected_chunk_count=41,chunk_count=41 WHERE status='PUBLISHED'"]:
        sql(f"BEGIN; UPDATE kb_documents SET audience='CUSTOMER' WHERE active_version_id IS NOT NULL; {change}; SELECT test_assert(customer_search_hybrid({customer_args})='{{\"semantic\":[[],[]],\"lexical\":[[],[]]}}'::jsonb,'deduplicated verifier fails closed'); SELECT test_assert(NOT (customer_knowledge_availability('{actor}','PUBLIC_VISITOR','test',repeat('a',64))->>'enabled')::boolean,'customer availability fails closed'); ROLLBACK;")
    sql(f"SELECT test_assert((assistant_knowledge_status('{actor}','test',repeat('a',64))->>'enabled')::boolean,'lightweight status');")
    sql(f"BEGIN; UPDATE kb_chunks SET content='tampered' WHERE version_id IN (SELECT active_version_id FROM kb_documents); SELECT test_assert(NOT (assistant_knowledge_availability('{actor}','test',repeat('a',64))->>'enabled')::boolean,'answer availability fails closed'); SELECT test_assert(assistant_search_hybrid({args})='{{\"semantic\":[[],[]],\"lexical\":[[],[]]}}'::jsonb,'tampered search fails closed'); ROLLBACK;")
    # Reads must not wait for a concurrent state mutation; mutations retain locks.
    from concurrent.futures import ThreadPoolExecutor
    import time
    request = '20000000-0000-4000-8000-000000000001'
    identity = f"'test','PUBLIC_VISITOR','{'c' * 64}','{request}','{request}','{request}'"
    sql(f"SELECT customer_assistant_control('claim',{identity},NULL)")
    with ThreadPoolExecutor(max_workers=1) as pool:
        blocker = pool.submit(sql, f"BEGIN; SELECT 1 FROM customer_assistant_controls WHERE request_id='{request}' FOR UPDATE; SELECT pg_advisory_xact_lock(992140); SELECT pg_sleep(2); ROLLBACK;")
        for _ in range(30):
            if sql('SELECT pg_try_advisory_lock(992140)').stdout.strip() == 'f':
                break
            time.sleep(.03)
        else:
            raise AssertionError('BLOCKER_NOT_READY')
        assert 'checking' in sql(f"SET lock_timeout='100ms'; SELECT customer_assistant_control('check',{identity},NULL)").stdout
        assert 'lock timeout' in sql(f"SET lock_timeout='100ms'; SELECT customer_assistant_control('stage',{identity},'retrieving')", check=False).stderr
        blocker.result()
    sql(f"SELECT customer_assistant_control('cancel',{identity},NULL)")
    assert json.loads(sql(f"SELECT customer_assistant_control('check',{identity},NULL)").stdout)['cancelled']
    assert sql(f"SELECT customer_assistant_control('check',{identity.replace('c' * 64, 'd' * 64)},NULL) IS NULL").stdout.strip() == 't'
    sql(f"UPDATE customer_assistant_controls SET deadline=now()-interval '1 second' WHERE request_id='{request}'")
    assert sql(f"SELECT customer_assistant_control('progress',{identity},NULL) IS NULL").stdout.strip() == 't'
    migration('040_customer_verification_dedup_down.sql')
    migration('039_customer_control_read_locks_down.sql')
    assert control_baseline == sql("SELECT pg_get_functiondef('customer_assistant_control_ms76(text,text,text,text,uuid,uuid,uuid,text)'::regprocedure)").stdout
    migration('038_assistant_disk_io_down.sql')
    for name, definition in baseline_search.items():
        assert definition == sql(f"SELECT pg_get_functiondef('{name}'::regproc)").stdout
    assert sql("SELECT to_regprocedure('assistant_knowledge_status(uuid,text,text)') IS NULL").stdout.strip() == 't'
    assert baseline_availability == sql("SELECT pg_get_functiondef('assistant_knowledge_availability(uuid,text,text)'::regprocedure)").stdout

    # Actual badge SQL with over 500 records, expiry boundaries, latest attempt,
    # candidate priority, refunds, empty results and authorization.
    sql('''CREATE TABLE reservations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),status text,
 created_at timestamptz DEFAULT now(),checked_out_at timestamptz);
 CREATE TABLE payment_attempts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),reservation_id uuid REFERENCES reservations,
 status text,expires_at timestamptz,created_at timestamptz DEFAULT now(),channel text,refund_status text);
 CREATE TABLE reservation_candidates(reservation_id uuid REFERENCES reservations,rank integer,is_assigned boolean,
 start_at timestamptz,end_at timestamptz);
 INSERT INTO reservations(status) SELECT 'PENDING_PAYMENT' FROM generate_series(1,501);''')
    migration('037_admin_badge_counts.sql')
    def counts():
        return json.loads(sql(f"SELECT admin_badge_counts('{actor}')").stdout)
    assert counts()['reservationsCount'] == 501
    sql('''INSERT INTO reservations(id,status,created_at) VALUES
 ('10000000-0000-4000-8000-000000000001','PENDING_PAYMENT',now()-interval '2 hours'),
 ('10000000-0000-4000-8000-000000000002','PENDING_COUNTER_CONFIRMATION',now()),
 ('10000000-0000-4000-8000-000000000003','PAYMENT_UNDER_REVIEW',now()),
 ('10000000-0000-4000-8000-000000000004','PENDING_PAYMENT',now());
 INSERT INTO payment_attempts(reservation_id,status,channel,refund_status) VALUES
 ('10000000-0000-4000-8000-000000000003','UNDER_REVIEW','WEB',NULL),
 ('10000000-0000-4000-8000-000000000004','REJECTED','WEB',NULL);
 INSERT INTO reservation_candidates VALUES
 ('10000000-0000-4000-8000-000000000003',0,false,now()+interval '1 hour',now()+interval '2 hours'),
 ('10000000-0000-4000-8000-000000000003',1,true,now()-interval '1 hour',now()+interval '1 hour');''')
    result = counts()
    assert result['reservationsCount'] == 503 and result['kioskCount'] == 1
    assert result['overdueCount'] == 1 and result['awaitingReviewCount'] == 0
    sql("UPDATE payment_attempts SET refund_status='REFUNDED' WHERE status='UNDER_REVIEW'")
    assert counts()['paymentsCount'] == 0
    sql("UPDATE reservations SET checked_out_at=now() WHERE status='PENDING_COUNTER_CONFIRMATION'")
    assert counts()['kioskCount'] == 0
    sql("UPDATE reservations SET created_at=now()-interval '2 hours' WHERE status='PENDING_PAYMENT'")
    assert counts()['reservationsCount'] == 1
    assert 'FORBIDDEN' in sql("SELECT admin_badge_counts('00000000-0000-4000-8000-000000000002')", check=False).stderr
    assert 'permission denied' in sql(f"SET ROLE anon; SELECT admin_badge_counts('{actor}')", check=False).stderr
    migration('037_admin_badge_counts_down.sql')
    print('Disk I/O SQL: badge boundaries and >500 rows, exact hybrid parity, tamper isolation, privileges and rollback passed.')


if __name__ == '__main__':
    lifecycle.main(acceptance)
