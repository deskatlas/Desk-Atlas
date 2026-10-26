"""MS83-TC01/03/04/07/08/09/10: disposable real PostgreSQL, no hosted access."""
from pathlib import Path
import importlib.util
import json
import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor

spec = importlib.util.spec_from_file_location('fixture', Path(__file__).with_name('spec5-postgres-lifecycle.py'))
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
fixture.PORT = '55483'
ROOT = fixture.ROOT
sql = fixture.sql


def fails(statement, expected):
    result = sql(statement, check=False)
    assert result.returncode and expected.lower() in result.stderr.lower(), result.stderr


def read(reference):
    return json.loads(sql(f"SELECT read_paid_candidate_recovery('{reference}','guest@example.invalid');").stdout.strip() or 'null')


def command(reference, remedy='REPOSITION', workspace=2, start='NULL'):
    episode = read(reference)['episodeId']
    return f"SELECT recover_paid_reservation('{reference}','guest@example.invalid','{episode}','{remedy}','00000000-0000-4000-8000-{workspace:012}',{start});"


def seed(reference, workspace=1, approved=True, transition=True, days=3):
    sql(f"""INSERT INTO reservations(reference_code,source,customer_first_name,customer_last_name,customer_email,status,rate_snapshot,amount_due,reschedule_count)
    VALUES ('{reference}','WEB','Synthetic','Guest','guest@example.invalid','PAYMENT_UNDER_REVIEW',100,200,1);
    INSERT INTO reservation_candidates(reservation_id,rank,workspace_instance_id,start_at,end_at)
      SELECT id,0,'00000000-0000-4000-8000-{workspace:012}',date_trunc('day',now())+interval '{days} days 10 hours',date_trunc('day',now())+interval '{days} days 12 hours' FROM reservations WHERE reference_code='{reference}';
    INSERT INTO payment_attempts(reservation_id,attempt_number,channel,amount,status,token_hash,expires_at,processed_at,processed_by_user_id,proof_storage_path,proof_submitted_at)
      SELECT id,1,'WEB',200,'{'APPROVED' if approved else 'UNDER_REVIEW'}','{reference}',now()+interval '1 hour',{'now()' if approved else 'NULL'},{"'00000000-0000-4000-8000-000000000099'" if approved else 'NULL'},'proof-{reference}',now() FROM reservations WHERE reference_code='{reference}';
    {f"UPDATE reservations SET status='NEEDS_MANUAL_RESOLUTION' WHERE reference_code='{reference}';" if transition else ''}""")


def acceptance():
    sql("""CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE SCHEMA extensions;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE EXTENSION pgcrypto WITH SCHEMA extensions;""")
    sql((ROOT/'supabase/001_schema.sql').read_text(encoding='utf-8'))
    sql((ROOT/'supabase/002_functions.sql').read_text(encoding='utf-8'))
    for name in ['006_spec1_guest_customer_identity.sql','010_fix_customer_identity_pgcrypto_resolution.sql','009_fix_payment_allocation_column_ambiguity.sql','042_paid_candidate_recovery.sql']:
        sql((ROOT/'supabase/migrations'/name).read_text(encoding='utf-8'))
    sql((ROOT/'supabase/migrations/042_paid_candidate_recovery_down.sql').read_text(encoding='utf-8'))
    sql((ROOT/'supabase/migrations/042_paid_candidate_recovery.sql').read_text(encoding='utf-8'))
    sql("""INSERT INTO auth.users VALUES('00000000-0000-4000-8000-000000000099');
    INSERT INTO staff_profiles(user_id,role,display_name,is_active) VALUES('00000000-0000-4000-8000-000000000099','ADMIN','Synthetic',true);
    INSERT INTO business_settings(id,business_name,booking_interval_minutes,timezone) VALUES(1,'Synthetic Venue',30,'Asia/Manila');
    INSERT INTO operating_hours(day_of_week,opens_at,closes_at) SELECT d,'00:00','23:59:59' FROM generate_series(0,6) d;
    INSERT INTO floors(id,name,display_order) VALUES('00000000-0000-4000-8000-000000000001','Floor 1',0);
    INSERT INTO workspace_templates(id,name,capacity,rate_amount,default_shape,default_color) VALUES
      ('00000000-0000-4000-8000-000000000001','Desk',1,100,'rectangle','#ffffff'),
      ('00000000-0000-4000-8000-000000000002','Other',1,200,'rectangle','#ffffff');
    INSERT INTO workspace_instances(id,template_id,floor_id,instance_code,display_name)
    SELECT ('00000000-0000-4000-8000-'||lpad(d::text,12,'0'))::uuid,('00000000-0000-4000-8000-'||lpad((CASE WHEN d=4 THEN 2 ELSE 1 END)::text,12,'0'))::uuid,'00000000-0000-4000-8000-000000000001','D'||d,'Desk '||d FROM generate_series(1,4) d;
    INSERT INTO map_versions(id,floor_id,version_number,status,canvas_width,canvas_height,grid_size) VALUES('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001',1,'DRAFT',1000,1000,20);
    INSERT INTO map_elements(map_version_id,element_role,element_type,workspace_instance_id,x,y,width,height)
      SELECT '00000000-0000-4000-8000-000000000001','WORKSPACE','desk',id,0,0,100,100 FROM workspace_instances; UPDATE map_versions SET status='PUBLISHED',published_by_user_id='00000000-0000-4000-8000-000000000099';""")
    seed('UNPAID', approved=False)
    assert read('UNPAID') is None
    seed('FIRST')
    assert read('FIRST')['eligible']
    assert sql("SELECT count(*) FROM notification_outbox WHERE kind='PAID_CANDIDATE_EXHAUSTED';").stdout.strip()=='1'
    sql("UPDATE reservations SET status=status WHERE reference_code='FIRST';")
    assert sql("SELECT count(*) FROM notification_outbox WHERE kind='PAID_CANDIDATE_EXHAUSTED';").stdout.strip()=='1'
    for role in ['anon','authenticated']:
        fails(f"SET ROLE {role}; SELECT read_paid_candidate_recovery('FIRST','guest@example.invalid');",'permission denied')
    assert sql("SELECT read_paid_candidate_recovery('FIRST','wrong@example.invalid') IS NULL;").stdout.strip()=='t'
    fails("SELECT read_paid_candidate_recovery('FIRST',NULL);",'Verification required')
    fails(command('FIRST',workspace=4),'original template')
    fails("SELECT recover_paid_reservation('FIRST','guest@example.invalid','00000000-0000-4000-8000-000000000090','REFUND');",'episode changed')
    fails("SELECT recover_paid_reservation('FIRST','wrong@example.invalid','00000000-0000-4000-8000-000000000090','REFUND');",'not found')
    # Two connections, same paid episode. Exactly one transition/audit/assignment.
    with ThreadPoolExecutor(2) as pool:
        results=list(pool.map(lambda _:sql(command('FIRST')),range(2)))
    assert all(result.returncode==0 for result in results)
    assert read('FIRST')['status']=='CONFIRMED'
    assert sql("SELECT count(*) FROM audit_logs WHERE action='paid_candidate_recovery_reposition';").stdout.strip()=='1'
    assert sql("SELECT reschedule_count=1 AND amount_due=200 AND booking_token_hash=encode(extensions.digest(booking_token,'sha256'),'hex') FROM reservations WHERE reference_code='FIRST';").stdout.strip()=='t'
    assert sql("SELECT payload->>'bookingStartAt' IS NOT NULL FROM notification_outbox WHERE kind='BOOKING_CONFIRMED';").stdout.strip()=='t'
    seed('OVERLAP')
    fails(command('OVERLAP'),'conflicting key')
    assert read('OVERLAP')['eligible']
    # Recovery against refund on one row: one winner and no mixed obligation.
    seed('RACE')
    with ThreadPoolExecutor(2) as pool:
        results=list(pool.map(lambda cmd:sql(cmd),[command('RACE',workspace=3),command('RACE','REFUND')]))
    assert all(result.returncode==0 for result in results)
    assert sql("SELECT (r.status='CONFIRMED' AND p.refund_status='NONE' AND c.is_assigned) OR (r.status='CANCELLED' AND p.refund_status='REQUIRED' AND NOT c.is_assigned) FROM reservations r JOIN payment_attempts p ON p.reservation_id=r.id JOIN reservation_candidates c ON c.reservation_id=r.id WHERE r.reference_code='RACE';").stdout.strip()=='t'
    seed('REFUND')
    sql(command('REFUND','REFUND'))
    sql(command('REFUND','REFUND'))
    assert read('REFUND')['refundPending']
    assert sql("SELECT refunded_at IS NULL AND refund_status='REQUIRED' FROM payment_attempts p JOIN reservations r ON r.id=p.reservation_id WHERE r.reference_code='REFUND';").stdout.strip()=='t'
    # Audit failure rolls back allocation, token, state, outbox and resolution metadata.
    seed('AUDIT')
    seed('AUDIT_ALLOC')
    sql("CREATE FUNCTION fail_recovery_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action LIKE 'paid_candidate_recovery_%' THEN RAISE EXCEPTION 'injected audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_recovery_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_recovery_audit();")
    fails(command('AUDIT','REFUND'),'injected audit failure')
    assert read('AUDIT')['eligible']
    assert sql("SELECT refund_status='NONE' FROM payment_attempts p JOIN reservations r ON r.id=p.reservation_id WHERE r.reference_code='AUDIT';").stdout.strip()=='t'
    fails(command('AUDIT_ALLOC','RESCHEDULE',workspace=1,start="date_trunc('day',now())+interval '6 days 10 hours'"),'injected audit failure')
    assert read('AUDIT_ALLOC')['eligible']
    assert sql("SELECT booking_token IS NULL AND status='NEEDS_MANUAL_RESOLUTION' FROM reservations WHERE reference_code='AUDIT_ALLOC';").stdout.strip()=='t'
    assert sql("SELECT count(*) FROM notification_outbox o JOIN reservations r ON r.id=o.reservation_id WHERE r.reference_code='AUDIT_ALLOC' AND o.kind='BOOKING_CONFIRMED';").stdout.strip()=='0'
    sql('DROP TRIGGER fail_recovery_audit ON audit_logs;')
    seed('PAST', days=-2)
    fails(command('PAST'),'future start')
    sql(command('PAST','RESCHEDULE',workspace=1,start="date_trunc('day',now())+interval '5 days 10 hours'"))
    assert read('PAST')['status']=='CONFIRMED'
    assert sql("SELECT c.end_at-c.start_at=interval '2 hours' AND r.reschedule_count=1 AND r.amount_due=200 FROM reservations r JOIN reservation_candidates c ON c.reservation_id=r.id WHERE r.reference_code='PAST' AND c.is_assigned;").stdout.strip()=='t'
    # Choosing a previously submitted alternative is explicit new consent, not a unique-key failure.
    seed('ALT', workspace=2, transition=False)
    sql("INSERT INTO reservation_candidates(reservation_id,rank,workspace_instance_id,start_at,end_at) SELECT reservation_id,1,'00000000-0000-4000-8000-000000000001',start_at,end_at FROM reservation_candidates WHERE reservation_id=(SELECT id FROM reservations WHERE reference_code='ALT'); UPDATE reservations SET status='NEEDS_MANUAL_RESOLUTION' WHERE reference_code='ALT';")
    sql(command('ALT','RESCHEDULE',workspace=1,start="date_trunc('day',now())+interval '3 days 10 hours'"))
    assert sql("SELECT rank FROM reservation_candidates c JOIN reservations r ON r.id=c.reservation_id WHERE r.reference_code='ALT' AND c.is_assigned;").stdout.strip()=='1'
    # Real initial payment approval still evaluates only the submitted ranks.
    seed('PRIORITY',workspace=2,approved=False,transition=False,days=8)
    # Use FIRST's assigned interval as the competing booking.
    sql("UPDATE reservation_candidates SET start_at=date_trunc('day',now())+interval '3 days 10 hours',end_at=date_trunc('day',now())+interval '3 days 12 hours' WHERE reservation_id=(SELECT id FROM reservations WHERE reference_code='PRIORITY'); INSERT INTO reservation_candidates(reservation_id,rank,workspace_instance_id,start_at,end_at) SELECT reservation_id,1,'00000000-0000-4000-8000-000000000001',start_at+interval '4 hours',end_at+interval '4 hours' FROM reservation_candidates WHERE reservation_id=(SELECT id FROM reservations WHERE reference_code='PRIORITY');")
    sql("SELECT * FROM approve_online_payment_and_allocate((SELECT p.id FROM payment_attempts p JOIN reservations r ON r.id=p.reservation_id WHERE r.reference_code='PRIORITY'),'00000000-0000-4000-8000-000000000099',now());")
    assert sql("SELECT rank FROM reservation_candidates c JOIN reservations r ON r.id=c.reservation_id WHERE r.reference_code='PRIORITY' AND c.is_assigned;").stdout.strip()=='1'
    assert read('PRIORITY') is None
    seed('EXHAUST',workspace=2,approved=False,transition=False)
    sql("SELECT * FROM approve_online_payment_and_allocate((SELECT p.id FROM payment_attempts p JOIN reservations r ON r.id=p.reservation_id WHERE r.reference_code='EXHAUST'),'00000000-0000-4000-8000-000000000099',now());")
    assert read('EXHAUST')['eligible']
    assert sql("SELECT booking_token IS NULL FROM reservations WHERE reference_code='EXHAUST';").stdout.strip()=='t'
    # The same paid candidate desk remains valid at a different, unoccupied time.
    fails(command('EXHAUST',workspace=2),'conflicting key')
    sql(command('EXHAUST','RESCHEDULE',workspace=2,start="date_trunc('day',now())+interval '9 days 10 hours'"))
    assert sql("SELECT c.workspace_instance_id='00000000-0000-4000-8000-000000000002' AND c.end_at-c.start_at=interval '2 hours' FROM reservation_candidates c JOIN reservations r ON r.id=c.reservation_id WHERE r.reference_code='EXHAUST' AND c.is_assigned;").stdout.strip()=='t'
    fails((ROOT/'supabase/migrations/042_paid_candidate_recovery_down.sql').read_text(encoding='utf-8'),'Retained recovery history')
    print('MS83 real PostgreSQL: ownership, grants, dedupe, same-template restriction, recovery races, overlap exclusion, refund pending, audit rollback and guarded rollback passed.')

def main():
    with tempfile.TemporaryDirectory(prefix='deskatlas-ms83-postgres-') as directory:
        folder = Path(directory).resolve()
        assert folder.parent == Path(tempfile.gettempdir()).resolve() and folder.name.startswith('deskatlas-ms83-')
        result = fixture.run([fixture.BIN / 'initdb', '-D', folder / 'data', '-U', 'postgres', '-A', 'trust', '--encoding=UTF8', '--locale=C'])
        if result.returncode:
            raise RuntimeError(result.stderr)
        with (folder / 'startup.log').open('w') as output:
            result = subprocess.run([str(fixture.BIN / 'pg_ctl'), '-D', str(folder / 'data'), '-l', str(folder / 'server.log'),
                                     '-o', f'-p {fixture.PORT} -h 127.0.0.1', '-w', 'start'], stdout=output, stderr=output, creationflags=fixture.FLAGS)
        if result.returncode:
            raise RuntimeError('TEMPORARY_POSTGRES_START_FAILED')
        try:
            acceptance()
        finally:
            result = fixture.run([fixture.BIN / 'pg_ctl', '-D', folder / 'data', '-m', 'fast', '-w', 'stop'])
            if result.returncode:
                raise RuntimeError('TEMPORARY_POSTGRES_STOP_FAILED')


if __name__ == '__main__':
    main()
