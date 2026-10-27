import { ReportReservationRecord, ReportPaymentAttemptRecord } from '../models/reports';
import { RetentionPurgeRecordSet } from '../models/retention';
import { RetentionPurgeRepository } from './retentionPurgeRepository';

export interface MemoryReservationRecord {
  id: string;
  reference_code: string;
  source?: 'WEB' | 'KIOSK';
  start_at: string;
  end_at: string;
  created_at: string;
  confirmed_at?: string | null;
  status: string;
  customer_first_name?: string;
  customer_last_name?: string;
  customer_email?: string;
  customer_phone?: string;
  workspace_name?: string;
  workspace_type?: string;
  total_amount?: number;
  currency?: string;
  checked_in_at?: string | null;
  checked_out_at?: string | null;
  cancelled_at?: string | null;
  cancellation_reason?: string | null;
  [key: string]: unknown;
}

export interface MemoryPaymentAttemptRecord {
  id: string;
  reservation_id: string;
  amount: number;
  status: string;
  proof_storage_path?: string | null;
  proof_submitted_at?: string | null;
  payment_method?: string;
  channel?: 'WEB' | 'KIOSK' | string;
  currency?: string;
  processed_at?: string | null;
  refund_status?: 'NONE' | 'REQUIRED' | 'REFUNDED' | 'ELIGIBLE' | string;
  refundedAt?: string | null;
  refunded_at?: string | null;
  created_at: string;
  [key: string]: unknown;
}

export interface MemoryCustomerRecord {
  id: string;
  customer_code: string;
  email: string;
  first_name: string;
  last_name: string;
  phone?: string;
  total_visits?: number;
  loyalty_tier?: string;
  first_confirmed_reservation_id?: string | null;
  created_at?: string;
  [key: string]: unknown;
}

export class RetentionPurgeMemoryRepository implements RetentionPurgeRepository {
  public customers: MemoryCustomerRecord[] = [];
  public reservations: MemoryReservationRecord[] = [];
  public candidates: Array<Record<string, unknown>> = [];
  public paymentAttempts: MemoryPaymentAttemptRecord[] = [];
  public paidCandidateRecovery: Array<Record<string, unknown>> = [];
  public notificationOutbox: Array<Record<string, unknown>> = [];
  public vouchers: Array<Record<string, unknown>> = [];
  public qualifyingFacts: Array<Record<string, unknown>> = [];
  public storageBucket: Set<string> = new Set();
  public auditLogs: Array<Record<string, unknown>> = [];
  public adminEmail = 'admin@deskatlas.com';

  constructor(initialData?: {
    customers?: MemoryCustomerRecord[];
    reservations?: MemoryReservationRecord[];
    candidates?: Array<Record<string, unknown>>;
    paymentAttempts?: MemoryPaymentAttemptRecord[];
    paidCandidateRecovery?: Array<Record<string, unknown>>;
    storageFiles?: string[];
    adminEmail?: string;
  }) {
    if (initialData?.customers) this.customers = [...initialData.customers];
    if (initialData?.reservations) this.reservations = [...initialData.reservations];
    if (initialData?.candidates) this.candidates = [...initialData.candidates];
    if (initialData?.paymentAttempts) this.paymentAttempts = [...initialData.paymentAttempts];
    if (initialData?.paidCandidateRecovery) this.paidCandidateRecovery = [...initialData.paidCandidateRecovery];
    if (initialData?.storageFiles) initialData.storageFiles.forEach((f) => this.storageBucket.add(f));
    if (initialData?.adminEmail) this.adminEmail = initialData.adminEmail;
  }

  async getPurgeEligibleRecords(cutoffTimestamp: Date): Promise<{
    reportReservations: ReportReservationRecord[];
    reportPayments: ReportPaymentAttemptRecord[];
    recordSet: RetentionPurgeRecordSet;
    totalRevenue: number;
    currency: string;
  }> {
    const cutoffTime = cutoffTimestamp.getTime();
    const eligibleReservations = this.reservations.filter(
      (r) => new Date(r.end_at).getTime() <= cutoffTime
    );
    const targetIds = new Set(eligibleReservations.map((r) => r.id));

    const eligibleCandidates = this.candidates.filter(
      (c) => targetIds.has(c.reservation_id as string)
    );
    const eligiblePayments = this.paymentAttempts.filter(
      (p) => targetIds.has(p.reservation_id)
    );
    const eligibleRecovery = this.paidCandidateRecovery.filter(
      (rec) => targetIds.has(rec.reservation_id as string)
    );

    const storageProofPaths: string[] = [];
    for (const p of eligiblePayments) {
      if (p.proof_storage_path) {
        storageProofPaths.push(p.proof_storage_path);
      }
    }

    const reportReservations: ReportReservationRecord[] = eligibleReservations.map((r) => ({
      reservationId: r.id,
      referenceCode: r.reference_code,
      source: (r.source as any) || 'WEB',
      customerFirstName: r.customer_first_name || 'Guest',
      customerLastName: r.customer_last_name || '',
      customerEmail: r.customer_email || 'guest@example.com',
      reservationStatus: r.status as any,
      amountDue: Number(r.total_amount || 0),
      currency: (r.currency as any) || 'PHP',
      createdAt: r.created_at,
      confirmedAt: (r.confirmed_at as string) ?? null,
      checkedInAt: (r.checked_in_at as string) ?? null,
      checkedOutAt: (r.checked_out_at as string) ?? null,
      bookingStartAt: r.start_at ?? null,
      bookingEndAt: r.end_at ?? null,
      assignedCandidateRank: 0,
      workspaceDisplayName: r.workspace_name || 'Workspace Spot',
      workspaceInstanceCode: r.workspace_name || 'SPOT-01',
      workspaceTemplateName: r.workspace_type || 'Dedicated Desk',
      floorName: 'Main Floor',
      rescheduleCount: 0,
      updatedAt: r.created_at,
    }));

    const refCodeByResId = new Map(eligibleReservations.map((r) => [r.id, r.reference_code]));

    const reportPayments: ReportPaymentAttemptRecord[] = eligiblePayments.map((p) => ({
      paymentAttemptId: p.id,
      reservationId: p.reservation_id,
      reservationReferenceCode: refCodeByResId.get(p.reservation_id) || '',
      channel: ((p.channel as any) || 'WEB'),
      paymentStatus: (p.status as any) || 'PENDING',
      refundStatus: ((p.refund_status as any) || 'NONE'),
      amount: Number(p.amount || 0),
      currency: (p.currency as any) || 'PHP',
      paymentMethodId: null,
      paymentMethodType: ((p.channel as any) === 'GCASH' ? 'GCASH' : 'BANK'),
      paymentMethodDisplayName: p.payment_method || 'Online Payment',
      createdAt: p.created_at,
      proofSubmittedAt: p.proof_submitted_at ?? null,
      processedAt: p.processed_at ?? null,
      refundedAt: (p.refunded_at as string) ?? (p.refundedAt as string) ?? null,
    }));

    const approvedPayments = eligiblePayments.filter((p) => p.status === 'APPROVED');
    const totalRevenue = approvedPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const currency = approvedPayments[0]?.currency || 'PHP';

    return {
      reportReservations,
      reportPayments,
      recordSet: {
        reservations: eligibleReservations,
        reservationCandidates: eligibleCandidates,
        paymentAttempts: eligiblePayments,
        paidCandidateRecovery: eligibleRecovery,
        storageProofPaths,
      },
      totalRevenue,
      currency,
    };
  }

  async resolveAdminRecipientEmail(): Promise<string> {
    return this.adminEmail;
  }

  async executeDatabasePurge(cutoffTimestamp: Date): Promise<{
    purgedReservationsCount: number;
    purgedPaymentAttemptsCount: number;
  }> {
    const cutoffTime = cutoffTimestamp.getTime();
    const targetRes = this.reservations.filter(
      (r) => new Date(r.end_at).getTime() <= cutoffTime
    );
    const targetIds = new Set(targetRes.map((r) => r.id));

    if (targetIds.size === 0) {
      return { purgedReservationsCount: 0, purgedPaymentAttemptsCount: 0 };
    }

    // 1. Strictly retain customer profiles! Only nullify foreign key reference
    for (const c of this.customers) {
      if (c.first_confirmed_reservation_id && targetIds.has(c.first_confirmed_reservation_id)) {
        c.first_confirmed_reservation_id = null;
      }
    }

    // 2. Nullify vouchers
    for (const v of this.vouchers) {
      if (v.pending_reservation_id && targetIds.has(v.pending_reservation_id as string)) {
        v.pending_reservation_id = null;
      }
      if (v.redeemed_reservation_id && targetIds.has(v.redeemed_reservation_id as string)) {
        v.redeemed_reservation_id = null;
      }
    }

    // 3. Remove qualifying booking facts
    this.qualifyingFacts = this.qualifyingFacts.filter(
      (q) => !targetIds.has(q.reservation_id as string)
    );

    // 4. Remove notification outbox
    this.notificationOutbox = this.notificationOutbox.filter(
      (o) => !targetIds.has(o.reservation_id as string)
    );

    // 5. Remove paid recovery
    this.paidCandidateRecovery = this.paidCandidateRecovery.filter(
      (rec) => !targetIds.has(rec.reservation_id as string)
    );

    // 6. Delete payment attempts
    const initialPaymentCount = this.paymentAttempts.length;
    this.paymentAttempts = this.paymentAttempts.filter(
      (p) => !targetIds.has(p.reservation_id)
    );
    const purgedPaymentAttemptsCount = initialPaymentCount - this.paymentAttempts.length;

    // 7. Delete reservation candidates
    this.candidates = this.candidates.filter(
      (c) => !targetIds.has(c.reservation_id as string)
    );

    // 8. Delete primary reservations
    const initialResCount = this.reservations.length;
    this.reservations = this.reservations.filter((r) => !targetIds.has(r.id));
    const purgedReservationsCount = initialResCount - this.reservations.length;

    return {
      purgedReservationsCount,
      purgedPaymentAttemptsCount,
    };
  }

  async deleteStorageProofs(storagePaths: string[]): Promise<{
    deletedCount: number;
    errors?: string[];
  }> {
    let deletedCount = 0;
    const errors: string[] = [];
    for (const p of storagePaths) {
      if (this.storageBucket.has(p)) {
        this.storageBucket.delete(p);
        deletedCount++;
      }
    }
    return { deletedCount, errors: errors.length > 0 ? errors : undefined };
  }

  async recordAuditLog(entry: {
    action: string;
    entityType: string;
    metadata: Record<string, unknown>;
  }): Promise<void> {
    this.auditLogs.push({
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      action: entry.action,
      entity_type: entry.entityType,
      metadata: entry.metadata,
      created_at: new Date().toISOString(),
    });
  }

  async listCustomerProfiles(): Promise<Array<Record<string, unknown>>> {
    return [...this.customers];
  }
}

