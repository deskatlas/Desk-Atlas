"""MS45-TC01..05/11: real disposable PostgreSQL eligibility and rollback checks.

Reuses SPEC-5 fixtures and its array-backed vector domain. No application DBs.
This validates SQL predicates, not production pgvector/model integration.
"""
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location('lifecycle', Path(__file__).with_name('spec5-postgres-lifecycle.py'))
lifecycle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lifecycle)


def acceptance():
    sql = lifecycle.sql
    sql((lifecycle.ROOT / 'supabase/migrations/017_assistant_knowledge_availability.sql').read_text())
    admin = lifecycle.ACTOR
    staff = '00000000-0000-4000-8000-000000000002'

    def gate(actor=admin, scope='test', fingerprint="repeat('a',64)"):
        return f"public.assistant_knowledge_availability('{actor}','{scope}',{fingerprint})"

    def check(expected, label, actor=admin):
        sql(f"SELECT test_assert(({gate(actor)}->>'enabled')::boolean={str(expected).lower()},'{label}');")

    check(False, 'empty catalog')
    # Complete remaining cleanup before claiming the independent ingestion fixture.
    sql("""DO $$ DECLARE j jsonb; BEGIN LOOP j:=kb_worker_command('test','claim'); EXIT WHEN j IS NULL;
      PERFORM kb_worker_command('test','complete',(j->'job'->>'id')::uuid,jsonb_build_object('lease_token',j->'job'->>'lease_token','generation',j->'job'->>'generation'));
    END LOOP; END $$;
    SELECT test_upload('ms45');""")
    check(False, 'READY is invisible')
    version = "(SELECT (payload->>'id')::uuid FROM test_uploads WHERE name='ms45')"
    document = "(SELECT (payload->>'document_id')::uuid FROM test_uploads WHERE name='ms45')"
    sql(f"SELECT kb_admin_command('test','{admin}','publish',{version},jsonb_build_object('expected_revision',1,'audience','ADMIN_ONLY','acknowledge_warnings',true,'request_id',gen_random_uuid()));")
    check(True, 'admin published access')
    check(False, 'staff cannot infer restricted document', staff)
    sql(f"UPDATE kb_documents SET audience='ADMIN_AND_STAFF' WHERE id={document};")
    check(True, 'staff shared publication', staff)
    # Each mutation is rolled back within the disposable database.
    cases = [
        (f"UPDATE kb_documents SET deleted_at=now() WHERE id={document}", 'removed document'),
        (f"UPDATE kb_documents SET active_version_id=NULL WHERE id={document}", 'no active version'),
        (f"UPDATE kb_document_versions SET removed_at=now() WHERE id={version}", 'removed version'),
        (f"UPDATE kb_document_versions SET embedding_fingerprint='wrong' WHERE id={version}", 'wrong version fingerprint'),
        (f"DELETE FROM kb_chunks WHERE version_id={version}", 'missing chunks'),
        (f"UPDATE kb_chunks SET generation=2 WHERE version_id={version}", 'wrong chunk generation'),
        (f"UPDATE kb_chunks SET embedding_fingerprint='wrong' WHERE version_id={version}", 'wrong chunk fingerprint'),
        (f"UPDATE kb_chunks SET content='corrupted' WHERE version_id={version}", 'content integrity'),
        (f"UPDATE kb_document_versions SET manifest_sha256=repeat('0',64) WHERE id={version}", 'manifest integrity'),
    ]
    cases += [(f"UPDATE kb_document_versions SET status='{state}' WHERE id={version}", state) for state in ('UPLOADING','QUEUED','PROCESSING','READY','FAILED','SUPERSEDED','REMOVED')]
    for statement, label in cases:
        sql(f"BEGIN; {statement}; SELECT test_assert(NOT ({gate()}->>'enabled')::boolean,'{label}'); ROLLBACK;")
    sql("SELECT kb_initialize_catalog('other',repeat('a',64));")
    sql(f"SELECT test_assert(NOT ({gate(scope='other')}->>'enabled')::boolean,'scope isolation');")
    denied = sql(f"SELECT {gate(fingerprint=repr('wrong'))};", check=False)
    assert denied.returncode and 'FINGERPRINT_MISMATCH' in denied.stderr
    for role in ('anon', 'authenticated'):
        denied = sql(f"SET ROLE {role}; SELECT {gate()};", check=False)
        assert denied.returncode and 'permission denied' in denied.stderr
    sql(f"SELECT test_upload('ms45-replacement',{document},2);")
    check(True, 'replacement READY preserves predecessor')
    sql(f"SELECT kb_admin_command('test','{admin}','remove_document',{document},jsonb_build_object('expected_revision',2,'request_id',gen_random_uuid()));")
    check(False, 'withdrawal effective before purge')
    sql(f"UPDATE staff_profiles SET is_active=false WHERE user_id='{staff}';")
    denied = sql(f"SELECT {gate(staff)};", check=False)
    assert denied.returncode and 'FORBIDDEN' in denied.stderr
    sql((lifecycle.ROOT / 'supabase/migrations/017_assistant_knowledge_availability_down.sql').read_text())
    print('MS-45 PostgreSQL availability, audience, scope, integrity, replacement, revocation and rollback checks passed.')


if __name__ == '__main__':
    lifecycle.main(acceptance)
