import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

// ----------------------------------------------------------------------------
// 1. Environment Loader
// ----------------------------------------------------------------------------
function loadEnv() {
  const envFiles = ['.env.local', '.env', 'apps/admin-portal/.env.local'];
  for (const file of envFiles) {
    const fullPath = path.resolve(process.cwd(), file);
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx !== -1) {
          const key = trimmed.slice(0, eqIdx).trim();
          let val = trimmed.slice(eqIdx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          if (!process.env[key]) {
            process.env[key] = val;
          }
        }
      }
    }
  }
}

// ----------------------------------------------------------------------------
// 2. CLI Argument Parser
// ----------------------------------------------------------------------------
interface CliOptions {
  action?: string;
  email?: string;
  userId?: string;
  password?: string;
  baseUrl?: string;
  help?: boolean;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: Record<string, string> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      options.help = 'true';
    } else if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (key.includes('=')) {
        const [k, v] = key.split('=');
        options[k] = v;
      } else if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        options[key] = args[i + 1];
        i++;
      } else {
        options[key] = 'true';
      }
    }
  }

  return {
    action: options.action || (options['reset-sealed'] ? 'reset' : options['provision-password'] ? 'set-password' : options['setup-url'] ? 'setup-url' : 'diagnose'),
    email: options.email,
    userId: options.userId || options['user-id'],
    password: options.password,
    baseUrl: options.baseUrl || options['base-url'] || process.env.NEXT_PUBLIC_ADMIN_URL || 'http://localhost:3000',
    help: Boolean(options.help),
  };
}

// ----------------------------------------------------------------------------
// 3. Main Recovery Logic
// ----------------------------------------------------------------------------
export async function runUnsealRecovery(customOptions?: CliOptions) {
  loadEnv();
  const cliArgs = customOptions || parseArgs();

  if (cliArgs.help) {
    console.log(`
DeskAtlas Admin Setup Unseal & Recovery Tool (MS-10)

Usage:
  pnpm tsx scripts/unseal-admin-setup.ts [options]

Options:
  --action=diagnose      Inspect admin setup and sealing state (default)
  --action=setup-url     Generate direct browser password setup link
  --action=set-password  Provision admin password directly via Service Role
  --action=reset         Reset admin bootstrap state to allow fresh setup
  --password=<pass>      Password for --action=set-password
  --email=<email>        Target specific admin by email
  --user-id=<id>         Target specific admin by user ID
  --base-url=<url>       Admin Portal base URL (default: http://localhost:3000)
  --help, -h             Show this help message
`);
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('Error: Missing required environment variables.');
    console.error('Please ensure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are defined in .env.local');
    process.exitCode = 1;
    return;
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  // Fetch admin profiles from staff_profiles
  const { data: profiles, error: profileErr } = await supabase
    .from('staff_profiles')
    .select('*')
    .eq('role', 'ADMIN');

  if (profileErr) {
    console.error('Failed to query staff_profiles:', profileErr.message);
    process.exitCode = 1;
    return;
  }

  // Fetch users from Auth API
  const { data: usersData, error: authErr } = await supabase.auth.admin.listUsers();
  if (authErr) {
    console.error('Failed to query Auth users:', authErr.message);
    process.exitCode = 1;
    return;
  }

  const adminProfiles = profiles || [];
  const authUsers = usersData?.users || [];

  // Match profiles with Auth users
  const adminList = adminProfiles.map((p) => {
    const authUser = authUsers.find((u) => u.id === p.user_id || u.email?.toLowerCase() === p.email?.toLowerCase());
    const rawUser = authUser as unknown as Record<string, unknown> | undefined;
    const encryptedPass = typeof rawUser?.encrypted_password === 'string' ? rawUser.encrypted_password : '';
    const isConfigured = Boolean(
      authUser?.user_metadata?.password_configured ||
      authUser?.user_metadata?.password_set ||
      (encryptedPass.length > 0)
    );
    return {
      userId: p.user_id,
      email: p.email,
      displayName: p.display_name,
      isActive: p.is_active,
      isSuperAdmin: p.is_superadmin ?? true,
      authUser,
      isPasswordConfigured: isConfigured,
      setupPending: !isConfigured,
    };
  });

  console.log('\n============================================================');
  console.log('DeskAtlas Admin Setup Unseal & Diagnosis Protocol (MS-10)');
  console.log('============================================================');
  console.log(`Supabase URL    : ${supabaseUrl}`);
  console.log(`Admin Profiles  : ${adminProfiles.length}`);
  console.log(`Auth Users Count: ${authUsers.length}`);
  console.log('============================================================\n');

  if (cliArgs.action === 'diagnose') {
    if (adminList.length === 0) {
      console.log('Status: UNINITIALIZED');
      console.log('No administrator account exists in database.');
      console.log('Setup is OPEN at /manage/setup for initial bootstrap.\n');
      return { status: 'UNINITIALIZED', admins: [] };
    }

    console.log(`Found ${adminList.length} Administrator Record(s):\n`);
    for (const admin of adminList) {
      console.log(`- User ID             : ${admin.userId}`);
      console.log(`  Email               : ${admin.email}`);
      console.log(`  Display Name        : ${admin.displayName}`);
      console.log(`  Active Status       : ${admin.isActive ? 'Active' : 'Inactive'}`);
      console.log(`  Password Configured : ${admin.isPasswordConfigured ? 'Yes (Sealed)' : 'No (Pending Setup)'}`);
      console.log(`  Auth Identity Match : ${admin.authUser ? 'Linked' : 'Orphaned (No Auth User)'}`);
      console.log('------------------------------------------------------------');
    }

    const hasPending = adminList.some((a) => a.setupPending);
    if (hasPending) {
      console.log('\nNotice: One or more administrators have NOT finalized their password.');
      console.log('Run with --action=setup-url to obtain a direct password setup link,');
      console.log('or --action=set-password --password=<secure_password> to provision credentials.\n');
    } else {
      console.log('\nStatus: All administrator accounts are fully sealed and configured.\n');
    }

    return { status: hasPending ? 'SETUP_PENDING' : 'SEALED', admins: adminList };
  }

  // Filter target admin
  let target = adminList[0];
  if (cliArgs.userId) {
    target = adminList.find((a) => a.userId === cliArgs.userId) || target;
  } else if (cliArgs.email) {
    target = adminList.find((a) => a.email?.toLowerCase() === cliArgs.email?.toLowerCase()) || target;
  }

  if (!target && cliArgs.action !== 'reset') {
    console.error('Error: No target administrator found to perform action.');
    process.exitCode = 1;
    return;
  }

  if (cliArgs.action === 'setup-url') {
    const cleanBase = (cliArgs.baseUrl || 'http://localhost:3000').replace(/\/$/, '');
    const setupUrl = `${cleanBase}/manage/setup/password?userId=${encodeURIComponent(target.userId)}&email=${encodeURIComponent(target.email)}`;
    console.log('One-Time Password Setup Link Generated:');
    console.log(`Target Admin : ${target.email} (${target.userId})`);
    console.log(`Setup URL    : ${setupUrl}\n`);
    return { setupUrl, target };
  }

  if (cliArgs.action === 'set-password') {
    const newPassword = cliArgs.password || 'AdminPassword123!';
    console.log(`Provisioning master password for admin: ${target.email} (${target.userId})...`);

    const { error: updateErr } = await supabase.auth.admin.updateUserById(target.userId, {
      password: newPassword,
      email_confirm: true,
      user_metadata: {
        ...target.authUser?.user_metadata,
        password_configured: true,
        password_set: true,
      },
    });

    if (updateErr) {
      console.error('Failed to update admin password:', updateErr.message);
      process.exitCode = 1;
      return;
    }

    console.log('Password successfully provisioned via Service Role API!');
    console.log(`Email    : ${target.email}`);
    console.log(`Password : ${newPassword}`);
    console.log('Status   : Sealed (Ready for login at /manage/login)\n');
    return { success: true, target, password: newPassword };
  }

  if (cliArgs.action === 'reset') {
    console.log('Resetting Administrator Bootstrap State...');
    // Remove staff_profiles records
    const { error: delProfileErr } = await supabase
      .from('staff_profiles')
      .delete()
      .eq('role', 'ADMIN');

    if (delProfileErr) {
      console.error('Failed to clear staff_profiles:', delProfileErr.message);
      process.exitCode = 1;
      return;
    }

    console.log('Admin staff profiles cleared.');
    console.log('Deployment re-initialized: /manage/setup is now open for new bootstrap.\n');
    return { success: true, reset: true };
  }

  console.warn(`Unknown action: ${cliArgs.action}`);
}

// Execute when run directly as CLI
if (typeof require !== 'undefined' && require.main === module) {
  runUnsealRecovery().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Unexpected error in recovery tool:', msg);
    process.exit(1);
  });
}
