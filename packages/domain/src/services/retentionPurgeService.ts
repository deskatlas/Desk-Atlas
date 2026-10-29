import {
  RetentionQuarter,
  RetentionQuarterBounds,
  RetentionBackupPayload,
  RetentionPurgeResult,
} from '../models/retention';
import { RetentionPurgeRepository } from './retentionPurgeRepository';
import { TransactionalEmailService } from './transactionalEmailService';
import { buildAdminExcelWorkbook } from './excelReportBuilder';
import { ReportsService } from './reportsService';
import { ReportsRepository } from './reportsRepository';

export interface ExecuteQuarterlyPurgeOptions {
  targetDate?: Date;
  cutoffTimestamp?: Date;
  quarter?: RetentionQuarter;
  year?: number;
  dryRun?: boolean;
  forceRecipientEmail?: string;
}

export function calculateQuarterBounds(targetDate: Date = new Date()): RetentionQuarterBounds {
  const year = targetDate.getUTCFullYear();
  const month = targetDate.getUTCMonth(); // 0 to 11

  if (month <= 2) {
    // Q1: Jan 1 00:00:00.000Z to March 31 23:59:59.999Z
    return {
      quarter: 'Q1',
      year,
      start: new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0)),
      cutoff: new Date(Date.UTC(year, 2, 31, 23, 59, 59, 999)),
      rangeLabel: `Q1 ${year}`,
    };
  } else if (month <= 5) {
    // Q2: Apr 1 00:00:00.000Z to June 30 23:59:59.999Z
    return {
      quarter: 'Q2',
      year,
      start: new Date(Date.UTC(year, 3, 1, 0, 0, 0, 0)),
      cutoff: new Date(Date.UTC(year, 5, 30, 23, 59, 59, 999)),
      rangeLabel: `Q2 ${year}`,
    };
  } else if (month <= 8) {
    // Q3: Jul 1 00:00:00.000Z to Sep 30 23:59:59.999Z
    return {
      quarter: 'Q3',
      year,
      start: new Date(Date.UTC(year, 6, 1, 0, 0, 0, 0)),
      cutoff: new Date(Date.UTC(year, 8, 30, 23, 59, 59, 999)),
      rangeLabel: `Q3 ${year}`,
    };
  } else {
    // Q4: Oct 1 00:00:00.000Z to Dec 31 23:59:59.999Z
    return {
      quarter: 'Q4',
      year,
      start: new Date(Date.UTC(year, 9, 1, 0, 0, 0, 0)),
      cutoff: new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999)),
      rangeLabel: `Q4 ${year}`,
    };
  }
}

export class RetentionPurgeService {
  constructor(
    private readonly repository: RetentionPurgeRepository,
    private readonly emailService: TransactionalEmailService,
    private readonly nowProvider: () => Date = () => new Date()
  ) {}

  async executeQuarterlyPurge(
    options?: ExecuteQuarterlyPurgeOptions
  ): Promise<RetentionPurgeResult> {
    const execNow = options?.targetDate || this.nowProvider();
    const bounds = calculateQuarterBounds(execNow);

    if (options?.quarter) bounds.quarter = options.quarter;
    if (options?.year) bounds.year = options.year;
    if (options?.cutoffTimestamp) {
      bounds.cutoff = options.cutoffTimestamp;
    } else if (options?.targetDate) {
      bounds.cutoff = options.targetDate;
    }

    const cutoffDateStr = bounds.cutoff.toISOString().slice(0, 10);

    const {
      reportReservations,
      reportPayments,
      reportRentals = [],
      recordSet,
      totalRevenue,
      currency,
    } = await this.repository.getPurgeEligibleRecords(bounds.cutoff);

    // 1. Build canonical 3-Month Excel Operations Summary Report
    const adhocReportsRepo: ReportsRepository = {
      listReportReservations: async () => reportReservations,
      listReportPaymentAttempts: async () => reportPayments,
      listReportRentals: async () => reportRentals,
    };
    const reportsService = new ReportsService(adhocReportsRepo, () => bounds.cutoff);
    const snapshot = await reportsService.getAdminReportsSnapshot('month');

    const excelBuffer = await buildAdminExcelWorkbook({
      exportType: 'operations-summary',
      range: 'month',
      snapshot,
      reservations: reportReservations,
      payments: reportPayments,
      rentals: reportRentals,
      now: bounds.cutoff,
    });

    const excelFilename = `deskatlas-operations-summary-${bounds.quarter}-${bounds.year}-${cutoffDateStr}.xlsx`;

    // 2. Assemble structured raw JSON backup payload
    const backupPayload: RetentionBackupPayload = {
      metadata: {
        system: 'DeskAtlas',
        exportReason: 'QUARTERLY_RETENTION_PURGE',
        quarter: bounds.quarter,
        year: bounds.year,
        generatedAt: bounds.cutoff.toISOString(),
        reservationCount: recordSet.reservations.length,
        paymentAttemptCount: recordSet.paymentAttempts.length,
        storageProofCount: recordSet.storageProofPaths.length,
        rentalCount: recordSet.bookingRentals?.length ?? 0,
        rentalExtensionCount: recordSet.rentalExtensions?.length ?? 0,
      },
      reservations: recordSet.reservations,
      reservationCandidates: recordSet.reservationCandidates,
      paymentAttempts: recordSet.paymentAttempts,
      paidCandidateRecovery: recordSet.paidCandidateRecovery,
      storageProofPaths: recordSet.storageProofPaths,
      bookingRentals: recordSet.bookingRentals ?? [],
      rentalExtensions: recordSet.rentalExtensions ?? [],
    };

    const jsonBuffer = Buffer.from(JSON.stringify(backupPayload, null, 2), 'utf-8');
    const jsonFilename = `deskatlas-backup-${bounds.quarter}-${bounds.year}-${cutoffDateStr}.json`;

    // 3. Resolve administrator email (Strictly superadmin / owner)
    const recipientEmail =
      options?.forceRecipientEmail ||
      (await this.repository.resolveAdminRecipientEmail());

    // 4. Pre-Purge Email Dispatch
    const emailResult = await this.emailService.sendQuarterlyRetentionBackupEmail({
      to: recipientEmail,
      quarter: bounds.quarter,
      year: bounds.year,
      purgedReservationsCount: recordSet.reservations.length,
      totalRevenueArchived: totalRevenue,
      currency,
      purgedStorageFilesCount: recordSet.storageProofPaths.length,
      excelReportBuffer: excelBuffer,
      excelFilename,
      jsonBackupBuffer: jsonBuffer,
      jsonFilename,
      cutoffDate: bounds.cutoff.toISOString(),
    });

    // 5. Failsafe Circuit Breaker
    if (!emailResult.success) {
      await this.repository.recordAuditLog({
        action: 'RETENTION_QUARTERLY_PURGE_FAILED',
        entityType: 'system_retention_worker',
        metadata: {
          quarter: bounds.quarter,
          year: bounds.year,
          cutoff_timestamp: bounds.cutoff.toISOString(),
          recipient_email: recipientEmail,
          reason: 'PURGE_ABORTED_EMAIL_FAILED',
          error: emailResult.error || 'Unknown email delivery failure',
          severity: 'CRITICAL',
        },
      });

      return {
        success: false,
        quarter: bounds.quarter,
        year: bounds.year,
        cutoffTimestamp: bounds.cutoff.toISOString(),
        recipientEmail,
        purgedReservationsCount: 0,
        purgedPaymentAttemptsCount: 0,
        purgedStorageFilesCount: 0,
        totalRevenueArchived: totalRevenue,
        currency,
        excelFilename,
        jsonFilename,
        customerProfilesRetained: true,
        error: 'PURGE_ABORTED_EMAIL_FAILED',
      };
    }

    if (options?.dryRun) {
      return {
        success: true,
        quarter: bounds.quarter,
        year: bounds.year,
        cutoffTimestamp: bounds.cutoff.toISOString(),
        recipientEmail,
        purgedReservationsCount: recordSet.reservations.length,
        purgedPaymentAttemptsCount: recordSet.paymentAttempts.length,
        purgedStorageFilesCount: recordSet.storageProofPaths.length,
        totalRevenueArchived: totalRevenue,
        currency,
        excelFilename,
        jsonFilename,
        backupEmailMessageId: emailResult.id,
        customerProfilesRetained: true,
      };
    }

    // 6. Execute atomic relational deletion cascade
    const purgeDbResult = await this.repository.executeDatabasePurge(bounds.cutoff);

    // 7. Delete cloud storage receipt images in batches
    const storageResult = await this.repository.deleteStorageProofs(
      recordSet.storageProofPaths
    );

    // 8. Log immutable audit trail
    await this.repository.recordAuditLog({
      action: 'RETENTION_QUARTERLY_PURGE_COMPLETED',
      entityType: 'system_retention_worker',
      metadata: {
        quarter: bounds.quarter,
        year: bounds.year,
        cutoff_timestamp: bounds.cutoff.toISOString(),
        recipient_email: recipientEmail,
        purged_reservations_count: purgeDbResult.purgedReservationsCount,
        purged_payment_attempts_count: purgeDbResult.purgedPaymentAttemptsCount,
        purged_storage_files_count: storageResult.deletedCount,
        backup_email_message_id: emailResult.id,
        customer_profiles_retained: true,
      },
    });

    return {
      success: true,
      quarter: bounds.quarter,
      year: bounds.year,
      cutoffTimestamp: bounds.cutoff.toISOString(),
      recipientEmail,
      purgedReservationsCount: purgeDbResult.purgedReservationsCount,
      purgedPaymentAttemptsCount: purgeDbResult.purgedPaymentAttemptsCount,
      purgedStorageFilesCount: storageResult.deletedCount,
      totalRevenueArchived: totalRevenue,
      currency,
      excelFilename,
      jsonFilename,
      backupEmailMessageId: emailResult.id,
      customerProfilesRetained: true,
    };
  }
}

export function createRetentionPurgeService(
  repository: RetentionPurgeRepository,
  emailService: TransactionalEmailService,
  nowProvider?: () => Date
): RetentionPurgeService {
  return new RetentionPurgeService(repository, emailService, nowProvider);
}
