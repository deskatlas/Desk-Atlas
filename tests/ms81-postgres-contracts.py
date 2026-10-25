"""MS81-TC01..07 / QAD-TC23/35: real SQL in a disposable local cluster.

Auth users are synthetic schema fixtures. No configured application DB is read.
Hosted Auth/PostgREST, installed definitions and route authorization are separate.
"""
from pathlib import Path
import importlib.util
import re
import subprocess
import tempfile

spec = importlib.util.spec_from_file_location('fixture', Path(__file__).with_name('spec5-postgres-lifecycle.py'))
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
fixture.PORT = '55481'
ROOT = fixture.ROOT
sql = fixture.sql
FORWARD = ROOT / 'supabase/migrations/041_staff_rpc_ambiguity.sql'
DOWN = FORWARD.with_name('041_staff_rpc_ambiguity_down.sql')
ACTOR = '00000000-0000-4000-8000-000000000001'
ADMIN = '00000000-0000-4000-8000-000000000002'
STAFF = '00000000-0000-4000-8000-000000000003'
INACTIVE = '00000000-0000-4000-8000-000000000004'


def create(actor=ACTOR, email='new@example.invalid', role='STAFF', password='Synthetic123!', name='Synthetic User'):
    actor_sql = 'NULL' if actor is None else "'" + actor + "'"
    return f"SELECT * FROM admin_create_staff({actor_sql},'{email}','{password}','{name}','{role}');"


def fails(statement, expected):
    result = sql('\\set VERBOSITY verbose\n' + statement, check=False)
    assert result.returncode and expected in result.stderr, result.stderr


def snapshot():
    return sql("""SELECT jsonb_agg(jsonb_build_array(oid,proowner,proacl,proargnames,proallargtypes,proargmodes,prosecdef,proconfig)
      ORDER BY proname) FROM pg_proc WHERE pronamespace='public'::regnamespace
      AND proname IN ('admin_create_staff','admin_update_staff');""").stdout


def counts():
    return sql('SELECT (SELECT count(*) FROM auth.users),(SELECT count(*) FROM staff_profiles),(SELECT count(*) FROM audit_logs);').stdout


def acceptance():
    sql('''CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth; CREATE SCHEMA extensions; CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
CREATE TABLE auth.users(id uuid PRIMARY KEY,instance_id uuid,email text UNIQUE,encrypted_password text,
 email_confirmed_at timestamptz,raw_app_meta_data jsonb,raw_user_meta_data jsonb,created_at timestamptz,
 updated_at timestamptz,role text,aud text,confirmation_token text,last_sign_in_at timestamptz);
GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
''')
    sql((ROOT / 'supabase/001_schema.sql').read_text(encoding='utf-8'))
    old = re.findall(r'EXECUTE \$ms81_replacement\$([\s\S]*?)\$ms81_replacement\$;', DOWN.read_text(encoding='utf-8'))
    for definition in old:
        sql(definition)
    # Actual repository privilege statements, rather than a guessed ACL.
    security = (ROOT / 'supabase/004_security_and_rls.sql').read_text(encoding='utf-8')
    for statement in re.findall(r'(?:REVOKE|GRANT)[^;]+;', security):
        if re.search(r'public.admin_(?:create|update)_staff\(', statement):
            sql(statement)
    for actor, role, active, superadmin in [(ACTOR,'ADMIN',True,True),(ADMIN,'ADMIN',True,False),(STAFF,'STAFF',True,False),(INACTIVE,'ADMIN',False,False)]:
        sql(f"INSERT INTO auth.users(id,email) VALUES('{actor}','{actor}@example.invalid'); INSERT INTO staff_profiles(user_id,role,display_name,is_active,is_super_admin) VALUES('{actor}','{role}','Synthetic',{str(active).lower()},{str(superadmin).lower()});")
    original_counts = counts()
    fails(create(), '42702')
    # Isolate the second create collision after repairing only the actor query.
    actor_only = old[0].replace('COALESCE(is_super_admin, false)', 'COALESCE(actor.is_super_admin, false)').replace(
        "FROM public.staff_profiles\n  WHERE user_id = p_actor_user_id\n    AND role = 'ADMIN'\n    AND is_active = true;",
        "FROM public.staff_profiles actor\n  WHERE actor.user_id = p_actor_user_id\n    AND actor.role = 'ADMIN'\n    AND actor.is_active = true;")
    sql(actor_only)
    fails(create(), '42702')
    sql(old[0])
    fails(f"SELECT * FROM admin_update_staff('{ACTOR}','{STAFF}','Changed','STAFF',true,'Synthetic456!');", '42702')
    fails(f"SELECT * FROM admin_update_staff('{ACTOR}','{STAFF}','Changed');", '42702')
    assert counts() == original_counts
    print('Reproduced SQLSTATE 42702 in original create and update functions.')
    before = snapshot()
    sql(FORWARD.read_text(encoding='utf-8'))
    assert snapshot() == before
    for actor, expected in [(None,'actor is required'),(STAFF,'Only active ADMIN'),(INACTIVE,'Only active ADMIN')]:
        fails(create(actor), expected)
    fails(create(ADMIN, role='ADMIN'), 'Only the Superadmin')
    for role in ('anon','authenticated'):
        fails('SET ROLE ' + role + ';' + create(), '42501')
    for statement, expected in [(create(email='invalid'),'valid email'),(create(password='short'),'Password must'),(create(name=' '),'Display name')]:
        fails(statement, expected)
    assert counts() == original_counts
    result = sql('SET ROLE service_role; ' + create(ADMIN))
    assert 'new@example.invalid|STAFF|Synthetic User|t|' in result.stdout
    sql('SET ROLE service_role; ' + create(email='admin@example.invalid', role='ADMIN'))
    fails(create(), 'already exists')
    sql(f"SELECT * FROM admin_update_staff('{ACTOR}','{STAFF}','Changed','STAFF',false,'Synthetic456!');")
    assert sql(f"SELECT display_name='Changed' AND NOT is_active FROM staff_profiles WHERE user_id='{STAFF}';").stdout.strip() == 't'
    assert sql(f"SELECT encrypted_password=extensions.crypt('Synthetic456!',encrypted_password) FROM auth.users WHERE id='{STAFF}';").stdout.strip() == 't'
    assert sql(f"SELECT count(*) FROM audit_logs WHERE action='CREATE_STAFF_ACCOUNT' AND actor_user_id IN ('{ADMIN}','{ACTOR}') AND actor_role='ADMIN';").stdout.strip() == '2'
    # Fail at the final audit write, after both account/profile inserts.
    sql("CREATE FUNCTION ms81_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'MS81_INJECTED'; END $$; CREATE TRIGGER ms81_fail BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ms81_fail_audit();")
    saved_counts = counts()
    fails(create(email='rollback@example.invalid'), 'MS81_INJECTED')
    assert counts() == saved_counts
    sql('DROP TRIGGER ms81_fail ON audit_logs; DROP FUNCTION ms81_fail_audit();')
    # No callable backup function exists; exact old definitions live in down SQL.
    saved_profiles = sql('SELECT jsonb_agg(to_jsonb(p) ORDER BY user_id) FROM staff_profiles p;').stdout
    sql(DOWN.read_text(encoding='utf-8'))
    assert snapshot() == before
    fails(create(email='after-down@example.invalid'), '42702')
    sql(FORWARD.read_text(encoding='utf-8'))
    assert snapshot() == before
    assert sql('SELECT jsonb_agg(to_jsonb(p) ORDER BY user_id) FROM staff_profiles p;').stdout == saved_profiles
    # Second function drift rolls back the entire migration, including first replacement.
    sql(DOWN.read_text(encoding='utf-8'))
    sql("ALTER FUNCTION admin_update_staff(uuid,uuid,text,staff_role,boolean,text) SET search_path=public;")
    fails(FORWARD.read_text(encoding='utf-8'), 'MS81_UNSUPPORTED_DEFINITION')
    fails(create(email='drift@example.invalid'), '42702')
    sql("ALTER FUNCTION admin_update_staff(uuid,uuid,text,staff_role,boolean,text) SET search_path=public,auth,extensions;")
    sql(FORWARD.read_text(encoding='utf-8'))
    repaired = sql("SELECT jsonb_agg(pg_get_functiondef(oid) ORDER BY proname) FROM pg_proc WHERE proname IN ('admin_create_staff','admin_update_staff');").stdout
    baseline = (ROOT / 'supabase/002_functions.sql').read_text(encoding='utf-8')
    for definition in re.findall(r'CREATE OR REPLACE FUNCTION public.admin_(?:create|update)_staff\([\s\S]*?\$\$;', baseline):
        sql(definition)
    assert sql("SELECT jsonb_agg(pg_get_functiondef(oid) ORDER BY proname) FROM pg_proc WHERE proname IN ('admin_create_staff','admin_update_staff');").stdout == repaired
    assert snapshot() == before
    print('MS81: allowed/denied roles, return contract, atomic failures, ACL/owner/signature preservation, forward/down/forward, drift rejection and baseline parity passed.')


def main():
    with tempfile.TemporaryDirectory(prefix='deskatlas-ms81-postgres-') as directory:
        folder = Path(directory).resolve()
        assert folder.parent == Path(tempfile.gettempdir()).resolve() and folder.name.startswith('deskatlas-ms81-')
        result = fixture.run([fixture.BIN / 'initdb','-D',folder / 'data','-U','postgres','-A','trust','--encoding=UTF8','--locale=C'])
        if result.returncode:
            raise RuntimeError(result.stderr)
        with (folder / 'startup.log').open('w') as output:
            result = subprocess.run([str(fixture.BIN / 'pg_ctl'),'-D',str(folder / 'data'),'-l',str(folder / 'server.log'),'-o',f'-p {fixture.PORT} -h 127.0.0.1','-w','start'],stdout=output,stderr=output,creationflags=fixture.FLAGS)
        if result.returncode:
            raise RuntimeError('TEMPORARY_POSTGRES_START_FAILED')
        try:
            acceptance()
        finally:
            stopped = fixture.run([fixture.BIN / 'pg_ctl','-D',folder / 'data','-m','fast','-w','stop'])
            if stopped.returncode:
                raise RuntimeError('TEMPORARY_POSTGRES_STOP_FAILED')


if __name__ == '__main__':
    main()
