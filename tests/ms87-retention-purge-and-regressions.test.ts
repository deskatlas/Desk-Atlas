import { describe, it, expect } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import {
  calculateQuarterBounds,
  createRetentionPurgeService,
  RetentionPurgeMemoryRepository,
  renderQuarterlyRetentionBackupEmail,
  createTransactionalEmailService,
  TransactionalEmailService,
} from '../packages/domain/src';

describe('MS-87: Retention Purge Worker & Regression Resolutions', () => {
  const rootDir = path.resolve(__dirname, '..');

  describe('Part 1: Four Regression Resolutions (MS87-TC01 - MS87-TC04)', () => {
    it('MS87-TC01 & TC02: Transactional email survey subjects use standard hyphen without em-dashes', () => {
      const emailServicePath = path.join(
        rootDir,
        'packages/domain/src/services/transactionalEmailService.ts'
      );
      const emailContent = fs.readFileSync(emailServicePath, 'utf-8');

      // Assert BAN-PUNCT-01 compliance in survey subject
      expect(emailContent).toContain('Booking Has Ended - We Value Your Feedback!');
      expect(emailContent).not.toContain('Booking Has Ended \u2014 We Value Your Feedback!');

      // Assert tests have been reconciled
      const mf71Content = fs.readFileSync(path.join(rootDir, 'tests/mf71-transactional-email-lifecycle.test.ts'), 'utf-8');
      expect(mf71Content).toContain('"Your DeskAtlas Booking Has Ended - We Value Your Feedback!"');
      expect(mf71Content).not.toContain('"Your DeskAtlas Booking Has Ended \u2014 We Value Your Feedback!"');

      const mf78Content = fs.readFileSync(path.join(rootDir, 'tests/mf78-transactional-email-refinements.test.ts'), 'utf-8');
      expect(mf78Content).toContain('"Your DeskAtlas Booking Has Ended - We Value Your Feedback!"');
      expect(mf78Content).not.toContain('"Your DeskAtlas Booking Has Ended \u2014 We Value Your Feedback!"');
    });

    it('MS87-TC03: PaymentQueue component source contains defensive sorting contract', () => {
      const paymentQueuePath = path.join(
        rootDir,
        'apps/admin-portal/src/features/payments/components/PaymentQueue.tsx'
      );
      const content = fs.readFileSync(paymentQueuePath, 'utf-8');

      expect(content).toContain(
        'a.proofSubmittedAt ? new Date(a.proofSubmittedAt).getTime() : Number.POSITIVE_INFINITY'
      );
    });

    it('MS87-TC04: Supabase consolidated schema includes overdue_notified_at column for DrawSQL parity', () => {
      const schema001 = fs.readFileSync(path.join(rootDir, 'supabase/001_schema.sql'), 'utf-8');
      const sqlSchema = fs.readFileSync(path.join(rootDir, 'supabase/sql_schema.sql'), 'utf-8');

      expect(schema001).toContain('overdue_notified_at timestamptz,');
      expect(sqlSchema).toContain('overdue_notified_at timestamptz,');
    });
  });

  describe('Part 2: Automated Quarterly Data Retention Purge Worker', () => {
    it('MS87-TC06: calculates quarter bounds and identifies cutoff timestamps correctly', () => {
      // Q1 test
      const q1Date = new Date('2026-03-31T23:59:59.000Z');
      const q1Bounds = calculateQuarterBounds(q1Date);
      expect(q1Bounds.quarter).toBe('Q1');
      expect(q1Bounds.year).toBe(2026);
      expect(q1Bounds.cutoff.toISOString()).toBe('2026-03-31T23:59:59.999Z');

      // Q2 test
      const q2Date = new Date('2026-06-30T12:00:00.000Z');
      const q2Bounds = calculateQuarterBounds(q2Date);
      expect(q2Bounds.quarter).toBe('Q2');
      expect(q2Bounds.cutoff.toISOString()).toBe('2026-06-30T23:59:59.999Z');

      // Q3 test
      const q3Date = new Date('2026-09-30T23:59:59.000Z');
      const q3Bounds = calculateQuarterBounds(q3Date);
      expect(q3Bounds.quarter).toBe('Q3');
      expect(q3Bounds.cutoff.toISOString()).toBe('2026-09-30T23:59:59.999Z');

      // Q4 test
      const q4Date = new Date('2026-12-31T23:59:59.000Z');
      const q4Bounds = calculateQuarterBounds(q4Date);
      expect(q4Bounds.quarter).toBe('Q4');
      expect(q4Bounds.cutoff.toISOString()).toBe('2026-12-31T23:59:59.999Z');
    });

    it('MS87-TC07: protects active and future bookings outside the quarterly cutoff', async () => {
      const q1Cutoff = new Date('2026-03-31T23:59:59.999Z');

      const repo = new RetentionPurgeMemoryRepository({
        reservations: [
          // Eligible for purge: completed in Q1
          {
            id: 'res-q1-past',
            reference_code: 'DA-20260115-001',
            start_at: '2026-01-15T09:00:00Z',
            end_at: '2026-01-15T18:00:00Z',
            created_at: '2026-01-10T10:00:00Z',
            status: 'COMPLETED',
          },
          // Excluded from purge: active reservation extending into Q2
          {
            id: 'res-inflight-future',
            reference_code: 'DA-20260331-ACTIVE',
            start_at: '2026-03-31T20:00:00Z',
            end_at: '2026-04-01T04:00:00Z',
            created_at: '2026-03-31T19:00:00Z',
            status: 'CHECKED_IN',
          },
          // Excluded from purge: scheduled entirely in Q2
          {
            id: 'res-q2-future',
            reference_code: 'DA-20260405-FUTURE',
            start_at: '2026-04-05T09:00:00Z',
            end_at: '2026-04-05T17:00:00Z',
            created_at: '2026-03-25T10:00:00Z',
            status: 'CONFIRMED',
          },
        ],
      });

      const records = await repo.getPurgeEligibleRecords(q1Cutoff);
      expect(records.recordSet.reservations).toHaveLength(1);
      expect(records.recordSet.reservations[0].id).toBe('res-q1-past');
    });

    it('MS87-TC08: strictly preserves customer profile facts across quarterly purge execution', async () => {
      const q1Cutoff = new Date('2026-03-31T23:59:59.999Z');

      const repo = new RetentionPurgeMemoryRepository({
        customers: [
          {
            id: 'cust-loyalty-01',
            customer_code: 'CUST01',
            email: 'loyalguest@example.com',
            first_name: 'Maria',
            last_name: 'Santos',
            phone: '+639171234567',
            total_visits: 14,
            loyalty_tier: 'GOLD',
            first_confirmed_reservation_id: 'res-to-purge-01',
          },
        ],
        reservations: [
          {
            id: 'res-to-purge-01',
            reference_code: 'DA-20260120-P01',
            start_at: '2026-01-20T08:00:00Z',
            end_at: '2026-01-20T17:00:00Z',
            created_at: '2026-01-18T10:00:00Z',
            status: 'COMPLETED',
          },
        ],
      });

      const purgeResult = await repo.executeDatabasePurge(q1Cutoff);
      expect(purgeResult.purgedReservationsCount).toBe(1);

      // Verify customer table state
      const customerProfiles = await repo.listCustomerProfiles();
      expect(customerProfiles).toHaveLength(1);
      const cust = customerProfiles[0];
      expect(cust.id).toBe('cust-loyalty-01');
      expect(cust.customer_code).toBe('CUST01');
      expect(cust.email).toBe('loyalguest@example.com');
      expect(cust.first_name).toBe('Maria');
      expect(cust.last_name).toBe('Santos');
      expect(cust.loyalty_tier).toBe('GOLD');
      expect(cust.total_visits).toBe(14);
      // FK reference was nullified cleanly without profile mutation
      expect(cust.first_confirmed_reservation_id).toBeNull();
    });

    it('MS87-TC09: generates pre-purge Excel operations workbook with canonical worksheets parity', async () => {
      const q1Cutoff = new Date('2026-03-31T23:59:59.999Z');

      const repo = new RetentionPurgeMemoryRepository({
        reservations: [
          {
            id: 'res-q1-001',
            reference_code: 'DA-20260210-001',
            start_at: '2026-02-10T09:00:00Z',
            end_at: '2026-02-10T18:00:00Z',
            created_at: '2026-02-08T10:00:00Z',
            status: 'COMPLETED',
            total_amount: 500,
            customer_first_name: 'Juan',
            customer_last_name: 'Dela Cruz',
          },
        ],
        paymentAttempts: [
          {
            id: 'pay-q1-001',
            reservation_id: 'res-q1-001',
            amount: 500,
            status: 'APPROVED',
            channel: 'WEB',
            created_at: '2026-02-08T10:05:00Z',
            processed_at: '2026-02-08T10:10:00Z',
          },
        ],
      });

      const emailService = new TransactionalEmailService();
      const purgeService = createRetentionPurgeService(repo, emailService, () => q1Cutoff);

      const result = await purgeService.executeQuarterlyPurge({
        targetDate: q1Cutoff,
        dryRun: true,
      });

      expect(result.success).toBe(true);
      expect(result.quarter).toBe('Q1');
      expect(result.year).toBe(2026);
      expect(result.excelFilename).toBe('deskatlas-operations-summary-Q1-2026-2026-03-31.xlsx');
      expect(result.jsonFilename).toBe('deskatlas-backup-Q1-2026-2026-03-31.json');

      // Verify the generated Excel workbook structure directly
      const { reportReservations, reportPayments } = await repo.getPurgeEligibleRecords(q1Cutoff);
      const { buildAdminExcelWorkbook, ReportsService } = await import('../packages/domain/src');
      const snapshot = await new ReportsService({
        listReportReservations: async () => reportReservations,
        listReportPaymentAttempts: async () => reportPayments,
      }, () => q1Cutoff).getAdminReportsSnapshot('month');

      const excelBuffer = await buildAdminExcelWorkbook({
        exportType: 'operations-summary',
        range: 'month',
        snapshot,
        reservations: reportReservations,
        payments: reportPayments,
        now: q1Cutoff,
      });

      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(excelBuffer);

      const sheetNames = wb.worksheets.map((ws) => ws.name);
      expect(sheetNames).toContain('Executive Dashboard');
      expect(sheetNames).toContain('Reservations History');
      expect(sheetNames).toContain('Payment Records');
      expect(sheetNames).toContain('Workspace Utilization');
      expect(sheetNames).toContain('Check-in Records');
      expect(sheetNames).toContain('Cancellations & Resolutions');
    });

    it('MS87-TC10: enforces pre-purge delivery circuit breaker (failsafe abort when email dispatch fails)', async () => {
      const q1Cutoff = new Date('2026-03-31T23:59:59.999Z');

      const repo = new RetentionPurgeMemoryRepository({
        reservations: [
          {
            id: 'res-important-01',
            reference_code: 'DA-20260215-FAILSAFE',
            start_at: '2026-02-15T09:00:00Z',
            end_at: '2026-02-15T18:00:00Z',
            created_at: '2026-02-10T10:00:00Z',
            status: 'COMPLETED',
          },
        ],
        paymentAttempts: [
          {
            id: 'pay-important-01',
            reservation_id: 'res-important-01',
            amount: 750,
            status: 'APPROVED',
            proof_storage_path: 'proofs/important_receipt.png',
            created_at: '2026-02-10T10:05:00Z',
          },
        ],
        storageFiles: ['proofs/important_receipt.png'],
      });

      // Mock an email service that fails transmission (e.g. Resend outage or network error)
      const failingEmailService = createTransactionalEmailService({
        apiKey: 're_mock_key',
        fetcher: async () => {
          return new Response(JSON.stringify({ message: 'Email provider temporary outage' }), {
            status: 500,
            statusText: 'Internal Server Error',
          });
        },
      });

      const purgeService = createRetentionPurgeService(repo, failingEmailService, () => q1Cutoff);

      const result = await purgeService.executeQuarterlyPurge({
        targetDate: q1Cutoff,
      });

      // 1. Verify purge operation aborted
      expect(result.success).toBe(false);
      expect(result.error).toBe('PURGE_ABORTED_EMAIL_FAILED');
      expect(result.purgedReservationsCount).toBe(0);

      // 2. Verify zero database records were deleted
      expect(repo.reservations).toHaveLength(1);
      expect(repo.paymentAttempts).toHaveLength(1);

      // 3. Verify storage receipt file was NOT deleted
      expect(repo.storageBucket.has('proofs/important_receipt.png')).toBe(true);

      // 4. Verify critical audit log entry was created
      expect(repo.auditLogs).toHaveLength(1);
      const audit = repo.auditLogs[0];
      expect(audit.action).toBe('RETENTION_QUARTERLY_PURGE_FAILED');
      expect((audit.metadata as any)?.severity).toBe('CRITICAL');
      expect((audit.metadata as any)?.reason).toBe('PURGE_ABORTED_EMAIL_FAILED');
    });

    it('MS87-TC11: batch deletes storage receipt proofs from bucket alongside database purge', async () => {
      const q1Cutoff = new Date('2026-03-31T23:59:59.999Z');

      const repo = new RetentionPurgeMemoryRepository({
        reservations: [
          {
            id: 'res-storage-01',
            reference_code: 'DA-20260220-ST1',
            start_at: '2026-02-20T09:00:00Z',
            end_at: '2026-02-20T18:00:00Z',
            created_at: '2026-02-18T10:00:00Z',
            status: 'COMPLETED',
          },
        ],
        paymentAttempts: [
          {
            id: 'pay-storage-01',
            reservation_id: 'res-storage-01',
            amount: 600,
            status: 'APPROVED',
            proof_storage_path: 'proofs/receipt_20260220.png',
            created_at: '2026-02-18T10:05:00Z',
          },
        ],
        storageFiles: ['proofs/receipt_20260220.png', 'proofs/keep_active.png'],
      });

      const successfulEmailService = createTransactionalEmailService({
        apiKey: 're_mock_key',
        fetcher: async () => {
          return new Response(JSON.stringify({ id: 'msg_backup_success_123' }), {
            status: 200,
          });
        },
      });

      const purgeService = createRetentionPurgeService(repo, successfulEmailService, () => q1Cutoff);

      const result = await purgeService.executeQuarterlyPurge({
        targetDate: q1Cutoff,
      });

      expect(result.success).toBe(true);
      expect(result.purgedReservationsCount).toBe(1);
      expect(result.purgedStorageFilesCount).toBe(1);

      // Verify the targeted proof was removed from storage bucket
      expect(repo.storageBucket.has('proofs/receipt_20260220.png')).toBe(false);
      // Verify other storage proofs remain intact
      expect(repo.storageBucket.has('proofs/keep_active.png')).toBe(true);
    });

    it('MS87-TC12: registers immutable audit log upon successful retention purge completion', async () => {
      const q1Cutoff = new Date('2026-03-31T23:59:59.999Z');

      const repo = new RetentionPurgeMemoryRepository({
        adminEmail: 'ops-admin@deskatlas.com',
        reservations: [
          {
            id: 'res-audit-01',
            reference_code: 'DA-20260301-AUD1',
            start_at: '2026-03-01T09:00:00Z',
            end_at: '2026-03-01T18:00:00Z',
            created_at: '2026-02-28T10:00:00Z',
            status: 'COMPLETED',
          },
        ],
      });

      const mockEmailService = createTransactionalEmailService({
        apiKey: 're_mock_key',
        fetcher: async () => new Response(JSON.stringify({ id: 'msg_audit_test' }), { status: 200 }),
      });

      const purgeService = createRetentionPurgeService(repo, mockEmailService, () => q1Cutoff);
      const result = await purgeService.executeQuarterlyPurge({ targetDate: q1Cutoff });

      expect(result.success).toBe(true);
      expect(repo.auditLogs).toHaveLength(1);

      const audit = repo.auditLogs[0];
      expect(audit.action).toBe('RETENTION_QUARTERLY_PURGE_COMPLETED');
      expect(audit.entity_type).toBe('system_retention_worker');
      const meta = audit.metadata as any;
      expect(meta.quarter).toBe('Q1');
      expect(meta.year).toBe(2026);
      expect(meta.recipient_email).toBe('ops-admin@deskatlas.com');
      expect(meta.purged_reservations_count).toBe(1);
      expect(meta.backup_email_message_id).toBe('msg_audit_test');
      expect(meta.customer_profiles_retained).toBe(true);
    });

    it('validates retention backup email template formatting and BAN-PUNCT-01 compliance', () => {
      const rendered = renderQuarterlyRetentionBackupEmail({
        to: 'admin@deskatlas.com',
        quarter: 'Q1',
        year: 2026,
        purgedReservationsCount: 150,
        totalRevenueArchived: 45000,
        currency: 'PHP',
        purgedStorageFilesCount: 142,
        excelFilename: 'deskatlas-operations-summary-Q1-2026-2026-03-31.xlsx',
        jsonFilename: 'deskatlas-backup-Q1-2026-2026-03-31.json',
      });

      expect(rendered.subject).toBe(
        '[DeskAtlas] Quarterly Data Retention Backup and 3-Month Operations Report (Q1 2026)'
      );
      // BAN-PUNCT-01 compliance: no em-dashes
      expect(rendered.subject).not.toContain('\u2014');
      expect(rendered.html).not.toContain('\u2014');
      expect(rendered.text).not.toContain('\u2014');

      // Required advisory phrasing
      const advisory =
        'In accordance with DeskAtlas quarterly data retention policies, historical booking records and customer-uploaded receipts for the past 3 months have been archived. Customer profiles and loyalty identities remain intact.';
      expect(rendered.html).toContain(advisory);
      expect(rendered.text).toContain(advisory);
    });
  });
});

