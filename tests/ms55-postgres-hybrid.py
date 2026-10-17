"""MS55-TC05/06/09: disposable real full-text SQL and lifecycle boundaries.

The established array vector domain is used when pgvector is unavailable.
This does not certify real embedding quality or production pgvector acceptance.
"""
import importlib.util
import json
import os
from pathlib import Path

os.environ.setdefault('SPEC5_POSTGRES_PORT', '55455')
spec = importlib.util.spec_from_file_location('lifecycle', Path(__file__).with_name('spec5-postgres-lifecycle.py'))
lifecycle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lifecycle)
ROOT = lifecycle.ROOT


def acceptance():
    sql = lifecycle.sql
    sql("DO $$ DECLARE j jsonb; BEGIN LOOP j:=kb_worker_command('test','claim'); EXIT WHEN j IS NULL; PERFORM kb_worker_command('test','complete',(j->'job'->>'id')::uuid,jsonb_build_object('lease_token',j->'job'->>'lease_token','generation',j->'job'->>'generation')); END LOOP; END $$;")
    sql("SELECT test_upload('ms55-current');")
    sql(f"SELECT kb_admin_command('test','{lifecycle.ACTOR}','publish',(SELECT (payload->>'id')::uuid FROM test_uploads WHERE name='ms55-current'),jsonb_build_object('expected_revision',1,'audience','ADMIN_ONLY','acknowledge_warnings',true,'request_id',gen_random_uuid()));")
    sql('CREATE FUNCTION extensions.vector_dims(extensions.vector) RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT cardinality($1) $$;')
    sql('CREATE OR REPLACE FUNCTION extensions.cosine_test(extensions.vector,extensions.vector) RETURNS double precision LANGUAGE sql IMMUTABLE AS $$ SELECT 1-sum(a*b)/(extensions.vector_norm($1)*extensions.vector_norm($2)) FROM unnest($1,$2) t(a,b) $$;')
    migration = (ROOT / 'supabase/migrations/023_assistant_hybrid_retrieval.sql').read_text()
    migration = migration.replace('extensions.vector(1024)', 'extensions.vector')
    migration = migration.replace('value::text::extensions.vector', "translate(value::text,'[]','{}')::extensions.vector")
    migration = migration.replace("(p_vectors->(q.ordinality::integer-1))::text::extensions.vector", "translate((p_vectors->(q.ordinality::integer-1))::text,'[]','{}')::extensions.vector")
    sql(migration)
    admin = lifecycle.ACTOR
    staff = '00000000-0000-4000-8000-000000000002'
    vector = json.dumps([[1.0] + [0.0] * 1023])

    def search(actor=admin, scope='test', fingerprint='a' * 64, query='synthetic', threshold=0.5):
        return f"assistant_search_hybrid('{actor}','{scope}','{fingerprint}','{vector}'::jsonb,ARRAY['{query}'],{threshold})"

    # This fixture creates one active ADMIN_ONLY publication through lifecycle APIs.
    # Capture identities and canonical hashes before the lexical migration tests.
    result = json.loads(sql(f'SELECT {search()};').stdout)
    assert len(result['semantic'][0]) == 1 and len(result['lexical'][0]) == 1
    identity = result['semantic'][0][0]
    assert identity == result['lexical'][0][0]
    doc, vid, cid = identity['document_id'], identity['version_id'], identity['chunk_id']
    assert identity['content'] == 'synthetic text'
    assert json.loads(sql(f"SELECT {search(query='unmatchedzz')};").stdout)['lexical'] == [[]]
    for kwargs in [{'actor': staff}, {'scope': 'other'}, {'fingerprint': 'b' * 64}]:
        result = json.loads(sql(f'SELECT {search(**kwargs)};').stdout)
        assert result == {'semantic': [[]], 'lexical': [[]]}
    # Lexical-only query is independent of the cosine cutoff.
    opposite = json.dumps([[-1.0] + [0.0] * 1023])
    result = json.loads(sql(f"SELECT {search().replace(vector, opposite)};").stdout)
    assert result['semantic'] == [[]] and len(result['lexical'][0]) == 1
    # Semantic-only hits require no lexical vocabulary match.
    result = json.loads(sql(f"SELECT {search(query='unmatchedzz')};").stdout)
    assert len(result['semantic'][0]) == 1 and result['lexical'] == [[]]
    for change in [f"UPDATE kb_documents SET deleted_at=now() WHERE id='{doc}'",
                   f"UPDATE kb_documents SET active_version_id=NULL WHERE id='{doc}'",
                   f"UPDATE kb_document_versions SET status='SUPERSEDED' WHERE id='{vid}'",
                   f"UPDATE kb_chunks SET generation=2 WHERE id='{cid}'",
                   f"UPDATE kb_chunks SET content='tampered' WHERE id='{cid}'",
                   f"UPDATE kb_document_versions SET expected_chunk_count=2,chunk_count=2 WHERE id='{vid}'"]:
        output = sql(f'BEGIN; {change}; SELECT {search()}; ROLLBACK;').stdout
        data = json.loads(next(line for line in output.splitlines() if line.startswith('{')))
        assert data == {'semantic': [[]], 'lexical': [[]]}, change
    sql(f"BEGIN; UPDATE kb_documents SET audience='ADMIN_AND_STAFF' WHERE id='{doc}'; SELECT test_assert(jsonb_array_length({search(actor=staff)}->'lexical'->0)=1,'staff audience'); ROLLBACK;")
    assert 'permission denied' in sql(f'SET ROLE authenticated; SELECT {search()};', check=False).stderr
    assert 'FORBIDDEN' in sql(f"SELECT {search(actor='00000000-0000-4000-8000-000000000099')};", check=False).stderr
    # Validate bound before expensive branch work.
    assert 'INVALID_INPUT' in sql(f"SELECT {search().replace('0.5)', '2)')};", check=False).stderr
    sql(f"SELECT test_assert(to_tsvector('english','checking')@@assistant_lexical_query('checked','english'),'English stemming');")
    sql("SELECT test_assert(to_tsvector('simple','panauhin')@@assistant_lexical_query('panauhin','simple'),'Tagalog tokens');")
    sql((ROOT / 'supabase/migrations/023_assistant_hybrid_retrieval_down.sql').read_text())
    sql(f"SELECT test_assert((SELECT content_sha256='{identity['content_hash']}' AND content='synthetic text' FROM kb_chunks WHERE id='{cid}'),'rollback preserves content and hashes');")
    sql("SELECT test_assert(to_regprocedure('public.assistant_search_hybrid(uuid,text,text,jsonb,text[],double precision)') IS NULL,'hybrid rollback');")
    sql("SELECT test_assert(to_regprocedure('public.assistant_search_knowledge(uuid,text,text,extensions.vector,double precision)') IS NOT NULL,'vector baseline retained');")
    print('MS55 disposable SQL: lexical/semantic-only hits, shared isolation, generation/hash checks, stemming, bounds and rollback passed. Real pgvector acceptance pending.')


if __name__ == '__main__':
    lifecycle.main(acceptance)
