import { ReportReservationRecord, ReportPaymentAttemptRecord } from '../models/reports';
import { RetentionPurgeRecordSet } from '../models/retention';

export interface RetentionPurgeRepository {
  /**
   * Retrieves all historical reservations and child records where reservations.end_at <= cutoffTimestamp.
   */
  getPurgeEligibleRecords(cutoffTimestamp: Date): Promise<{
    reportReservations: ReportReservationRecord[];
    reportPayments: ReportPaymentAttemptRecord[];
    recordSet: RetentionPurgeRecordSet;
    totalRevenue: number;
    currency: string;
  }>;

  /**
   * Resolves the configured administrative contact email.
   */
  resolveAdminRecipientEmail(): Promise<string>;

  /**
   * Executes the cascade deletion of purge-eligible reservations and child records.
   * Customer profiles in public.customers are strictly preserved.
   */
  executeDatabasePurge(cutoffTimestamp: Date): Promise<{
    purgedReservationsCount: number;
    purgedPaymentAttemptsCount: number;
  }>;

  /**
   * Removes receipt images from payment-proofs storage bucket in batches.
   */
  deleteStorageProofs(storagePaths: string[]): Promise<{
    deletedCount: number;
    errors?: string[];
  }>;

  /**
   * Appends an audit log entry for purge execution or critical aborts.
   */
  recordAuditLog(entry: {
    action: string;
    entityType: string;
    metadata: Record<string, unknown>;
  }): Promise<void>;

  /**
   * Lists customer profile records to verify immutability and retention.
   */
  listCustomerProfiles(): Promise<Array<Record<string, unknown>>>;
}

