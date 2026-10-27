export type RetentionQuarter = 'Q1' | 'Q2' | 'Q3' | 'Q4';

export interface RetentionQuarterBounds {
  quarter: RetentionQuarter;
  year: number;
  start: Date;
  cutoff: Date;
  rangeLabel: string;
}

export interface RetentionPurgeRecordSet {
  reservations: Array<Record<string, unknown>>;
  reservationCandidates: Array<Record<string, unknown>>;
  paymentAttempts: Array<Record<string, unknown>>;
  paidCandidateRecovery: Array<Record<string, unknown>>;
  storageProofPaths: string[];
}

export interface RetentionBackupPayload {
  metadata: {
    system: string;
    exportReason: string;
    quarter: RetentionQuarter;
    year: number;
    generatedAt: string;
    reservationCount: number;
    paymentAttemptCount: number;
    storageProofCount: number;
  };
  reservations: Array<Record<string, unknown>>;
  reservationCandidates: Array<Record<string, unknown>>;
  paymentAttempts: Array<Record<string, unknown>>;
  paidCandidateRecovery: Array<Record<string, unknown>>;
  storageProofPaths: string[];
}

export interface RetentionPurgeResult {
  success: boolean;
  quarter: RetentionQuarter;
  year: number;
  cutoffTimestamp: string;
  recipientEmail: string;
  purgedReservationsCount: number;
  purgedPaymentAttemptsCount: number;
  purgedStorageFilesCount: number;
  totalRevenueArchived: number;
  currency: string;
  excelFilename: string;
  jsonFilename: string;
  backupEmailMessageId?: string;
  customerProfilesRetained: boolean;
  error?: string;
}

