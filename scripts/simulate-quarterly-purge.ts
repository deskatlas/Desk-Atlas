/**
 * Standalone Simulation Script for Automated Quarterly Retention Purge
 * 
 * Traceability: MS87-R02, MS87-R03, MS87-R04, MS87-R05, SDD-C25, PRD-F28
 * 
 * Usage:
 *   pnpm dlx tsx scripts/simulate-quarterly-purge.ts [options]
 * 
 * Options:
 *   --email=<recipient>   Force delivery to specific email address (e.g. --email=admin@example.com)
 *   --date=<YYYY-MM-DD>   Target cutoff date (defaults to current quarter cutoff or 2026-10-31)
 *   --dryRun              Generate Excel & JSON backups and send email, but DO NOT delete database/storage records
 *   --commit              Execute actual database and storage deletions after email delivery
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  RetentionPurgeSupabaseRepository,
  createRetentionPurgeService,
  createTransactionalEmailService,
} from '../packages/domain/src';

// 1. Helper to load environment variables from local configuration files
function loadEnv() {
  const envFiles = [
    '.env.local',
    '.env',
    'apps/admin-portal/.env.local',
    'apps/customer-website/.env.local',
  ];

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
          if (
            (val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))
          ) {
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

// 2. Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options: Record<string, string | boolean> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (key.includes('=')) {
        const [k, v] = key.split('=');
        options[k] = v;
      } else if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        options[key] = args[i + 1];
        i++;
      } else {
        options[key] = true;
      }
    }
  }
  return options;
}

async function main() {
  loadEnv();
  const options = parseArgs();

  console.log('================================================================');
  console.log(' DeskAtlas - Quarterly Retention Purge Worker Simulation');
  console.log('================================================================');

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[Error] Supabase configuration missing.');
    console.error('Please ensure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set.');
    process.exit(1);
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  const resendFromEmail = process.env.RESEND_FROM_EMAIL || 'DeskAtlas <bookings@thedeskatlas.com>';

  if (!resendApiKey) {
    console.warn('[Warning] RESEND_API_KEY is not configured in environment.');
    console.warn('Email dispatch will simulate local fallback without sending live outbound email.');
  }

  const targetDateStr = (options['date'] as string) || '2026-10-31T23:59:59+08:00';
  const targetDate = new Date(targetDateStr);
  const isDryRun = Boolean(options['dryRun'] || options['dry-run']) || !options['commit'];
  const forceEmail = (options['email'] as string) || undefined;

  console.log(`[Configuration]`);
  console.log(` - Target Cutoff Date: ${targetDate.toISOString()}`);
  console.log(` - Execution Mode:     ${isDryRun ? 'DRY-RUN (Email & Backups ONLY, No DB Deletion)' : 'COMMIT (Live Deletion)'}`);
  if (forceEmail) {
    console.log(` - Target Recipient:   ${forceEmail}`);
  }
  console.log('');

  const repository = new RetentionPurgeSupabaseRepository({
    supabaseUrl,
    serviceRoleKey,
  });

  const emailService = createTransactionalEmailService({
    apiKey: resendApiKey,
    fromEmail: resendFromEmail,
    webhookUrl: process.env.TRANSACTIONAL_EMAIL_WEBHOOK_URL,
  });

  const purgeService = createRetentionPurgeService(repository, emailService);

  console.log('[Worker] Identifying eligible records and compiling 3-Month Excel report...');
  
  try {
    const result = await purgeService.executeQuarterlyPurge({
      targetDate,
      dryRun: isDryRun,
      forceRecipientEmail: forceEmail,
    });

    if (!result.success) {
      console.error(`\n[Failed] Purge workflow aborted: ${result.error}`);
      process.exit(1);
    }

    console.log('\n================================================================');
    console.log(' PURGE EXECUTION SUMMARY');
    console.log('================================================================');
    console.log(` Quarter / Year:               ${result.quarter} ${result.year}`);
    console.log(` Cutoff Timestamp:             ${result.cutoffTimestamp}`);
    console.log(` Admin Recipient Email:        ${result.recipientEmail}`);
    console.log(` Excel Operations Summary:     ${result.excelFilename}`);
    console.log(` Raw JSON Archival Backup:     ${result.jsonFilename}`);
    console.log(` Email Message ID:             ${result.backupEmailMessageId || 'Simulated'}`);
    console.log(` Revenue Archived:             ${result.currency} ${result.totalRevenueArchived.toFixed(2)}`);
    console.log(` Purged Reservations Count:    ${result.purgedReservationsCount}`);
    console.log(` Purged Payment Attempts:      ${result.purgedPaymentAttemptsCount}`);
    console.log(` Purged Storage Files Count:   ${result.purgedStorageFilesCount}`);
    console.log(` Customer Profiles Retained:   ${result.customerProfilesRetained ? 'YES (100% Intact)' : 'NO'}`);
    console.log('================================================================\n');

    if (isDryRun) {
      console.log('Note: This run was executed in DRY-RUN mode. Zero database rows or storage files were deleted.');
      console.log('To perform live database deletion, pass --commit:');
      console.log(`  pnpm dlx tsx scripts/simulate-quarterly-purge.ts --commit ${forceEmail ? `--email=${forceEmail}` : ''}`);
    } else {
      console.log('Success: Full quarterly retention purge and email dispatch completed.');
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('\n[Fatal Error]:', errorMsg);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[Unhandled Exception]:', err);
  process.exit(1);
});

