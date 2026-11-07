import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { ReportReservationRecord, ReportPaymentAttemptRecord } from '../models/reports';
import { ReservationStatus } from '../models/reservation';

interface RetentionCandidateRow {
  id?: string;
  reservation_id: string;
  workspace_instance_id?: string | null;
  start_at?: string | null;
  end_at?: string | null;
  rank?: 0 | 1 | 2 | null;
  is_assigned?: boolean | null;
}

interface RetentionInstanceRow {
  id: string;
  template_id?: string | null;
  floor_id?: string | null;
  instance_code?: string | null;
  display_name?: string | null;
}

interface RetentionTemplateRow {
  id: string;
  name?: string | null;
}

interface RetentionFloorRow {
  id: string;
  name?: string | null;
}

interface RetentionPaymentMethodRow {
  id: string;
  method_type?: 'GCASH' | 'BANK' | 'CASH' | string | null;
  display_name?: string | null;
}

interface RetentionReservationRow {
  id: string;
  reference_code: string;
  source?: 'WEB' | 'KIOSK' | null;
  customer_first_name?: string | null;
  customer_last_name?: string | null;
  customer_email?: string | null;
  status: ReservationStatus;
  amount_due?: number | string | null;
  currency?: string | null;
  created_at: string;
  confirmed_at?: string | null;
  checked_in_at?: string | null;
  checked_out_at?: string | null;
  reschedule_count?: number | null;
  updated_at?: string | null;
  workspace_name?: string | null;
  workspace_type?: string | null;
}

interface RetentionPaymentAttemptRow {
  id: string;
  reservation_id: string;
  attempt_number?: number;
  channel?: 'WEB' | 'KIOSK' | string | null;
  status?: 'PENDING' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'CANCELLED' | string | null;
  refund_status?: 'NONE' | 'REQUIRED' | 'REFUNDED' | 'ELIGIBLE' | string | null;
  amount?: number | string | null;
  currency?: string | null;
  payment_method_id?: string | null;
  payment_method?: string | null;
  payment_method_type?: 'GCASH' | 'BANK' | 'CASH' | string | null;
  proof_storage_path?: string | null;
  proof_submitted_at?: string | null;
  processed_at?: string | null;
  refunded_at?: string | null;
  created_at: string;
}
import { RetentionPurgeRecordSet } from '../models/retention';
import { RetentionPurgeRepository } from './retentionPurgeRepository';

export interface RetentionPurgeSupabaseConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
  supabaseClient?: SupabaseClient;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export class RetentionPurgeSupabaseRepository implements RetentionPurgeRepository {
  private readonly client: SupabaseClient;

  constructor(config: RetentionPurgeSupabaseConfig) {
    if (config.supabaseClient) {
      this.client = config.supabaseClient;
    } else {
      this.client = createClient(config.supabaseUrl, config.serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
    }
  }

  async getPurgeEligibleRecords(cutoffTimestamp: Date): Promise<{
    reportReservations: ReportReservationRecord[];
    reportPayments: ReportPaymentAttemptRecord[];
    recordSet: RetentionPurgeRecordSet;
    totalRevenue: number;
    currency: string;
  }> {
    const cutoffIso = cutoffTimestamp.toISOString();

    // 1. Identify future/active bookings whose candidate end_at extends beyond cutoff
    const { data: futureCandidates, error: fcError } = await this.client
      .from('reservation_candidates')
      .select('reservation_id')
      .gt('end_at', cutoffIso);

    if (fcError) {
      throw new Error(`Failed to query future reservation candidates: ${fcError.message}`);
    }

    const futureReservationIds = new Set(
      (futureCandidates || []).map((c: RetentionCandidateRow) => c.reservation_id)
    );

    // 2. Query reservations created on or before cutoff
    const { data: rawReservations, error: resError } = await this.client
      .from('reservations')
      .select('*')
      .lte('created_at', cutoffIso)
      .limit(5000);

    if (resError) {
      throw new Error(`Failed to query purge-eligible reservations: ${resError.message}`);
    }

    // Eligible reservations: created <= cutoff AND not extending beyond cutoff
    const reservations = (rawReservations || []).filter(
      (r: RetentionReservationRow) => !futureReservationIds.has(r.id)
    );
    const targetIds = reservations.map((r: RetentionReservationRow) => r.id);

    if (targetIds.length === 0) {
      return {
        reportReservations: [],
        reportPayments: [],
        recordSet: {
          reservations: [],
          reservationCandidates: [],
          paymentAttempts: [],
          paidCandidateRecovery: [],
          storageProofPaths: [],
        },
        totalRevenue: 0,
        currency: 'PHP',
      };
    }

    // 3. Batch query candidates, payment attempts, and recovery in chunks of 50
    const targetChunks = chunkArray(targetIds, 50);
    const candidates: RetentionCandidateRow[] = [];
    const payments: RetentionPaymentAttemptRow[] = [];
    const paidCandidateRecovery: Record<string, unknown>[] = [];

    for (const chunk of targetChunks) {
      const [candRes, payRes, recRes] = await Promise.all([
        this.client.from('reservation_candidates').select('*').in('reservation_id', chunk),
        this.client.from('payment_attempts').select('*').in('reservation_id', chunk),
        this.client.from('paid_candidate_recovery').select('*').in('reservation_id', chunk),
      ]);
      if (candRes.data) candidates.push(...(candRes.data as RetentionCandidateRow[]));
      if (payRes.data) payments.push(...(payRes.data as RetentionPaymentAttemptRow[]));
      if (recRes.data) paidCandidateRecovery.push(...(recRes.data as Record<string, unknown>[]));
    }

    const storageProofPaths: string[] = [];
    for (const p of payments) {
      if (p.proof_storage_path) {
        storageProofPaths.push(p.proof_storage_path);
      }
    }

    const refCodeByResId = new Map(reservations.map((r) => [r.id, r.reference_code]));
    const candidatesByResId = new Map<string, RetentionCandidateRow[]>();
    for (const c of candidates) {
      const list = candidatesByResId.get(c.reservation_id) || [];
      list.push(c);
      candidatesByResId.set(c.reservation_id, list);
    }

    // MS-105: Query workspace instances, templates, floors, and payment methods
    const candidateInstanceIds = [
      ...new Set(
        candidates
          .map((c) => c.workspace_instance_id)
          .filter((id): id is string => Boolean(id))
      ),
    ];

    const instances: RetentionInstanceRow[] = [];
    if (candidateInstanceIds.length > 0) {
      const instanceChunks = chunkArray(candidateInstanceIds, 50);
      for (const chunk of instanceChunks) {
        const { data, error } = await this.client
          .from('workspace_instances')
          .select('id, template_id, floor_id, instance_code, display_name')
          .in('id', chunk);
        if (!error && data) {
          instances.push(...(data as RetentionInstanceRow[]));
        }
      }
    }

    const [templatesRes, floorsRes, paymentMethodsRes] = await Promise.all([
      this.client.from('workspace_templates').select('id, name'),
      this.client.from('floors').select('id, name'),
      this.client.from('payment_methods').select('id, method_type, display_name'),
    ]);

    const templates = (templatesRes.data || []) as RetentionTemplateRow[];
    const floors = (floorsRes.data || []) as RetentionFloorRow[];
    const paymentMethods = (paymentMethodsRes.data || []) as RetentionPaymentMethodRow[];

    const instancesById = new Map<string, RetentionInstanceRow>(
      instances.map((i) => [i.id, i])
    );
    const templatesById = new Map<string, RetentionTemplateRow>(
      templates.map((t) => [t.id, t])
    );
    const floorsById = new Map<string, RetentionFloorRow>(
      floors.map((f) => [f.id, f])
    );
    const paymentMethodsById = new Map<string, RetentionPaymentMethodRow>(
      paymentMethods.map((m) => [m.id, m])
    );

    const reportReservations: ReportReservationRecord[] = reservations.map((r: RetentionReservationRow) => {
      const cList = candidatesByResId.get(r.id) || [];
      const assigned = cList.find((c) => c.is_assigned) || cList[0] || null;
      const instance = assigned?.workspace_instance_id ? instancesById.get(assigned.workspace_instance_id) : null;
      const template = instance?.template_id ? templatesById.get(instance.template_id) : null;
      const floor = instance?.floor_id ? floorsById.get(instance.floor_id) : null;

      const displayName =
        instance?.display_name ??
        template?.name ??
        instance?.instance_code ??
        r.workspace_name ??
        'Workspace Spot';
      const instanceCode =
        instance?.instance_code ??
        r.workspace_name ??
        'SPOT-01';
      const templateName =
        template?.name ??
        r.workspace_type ??
        'Dedicated Desk';
      const floorName =
        floor?.name ??
        'Main Floor';
      return {
        reservationId: r.id,
        referenceCode: r.reference_code,
        source: (r.source as 'WEB' | 'KIOSK') || 'WEB',
        customerFirstName: r.customer_first_name || 'Guest',
        customerLastName: r.customer_last_name || '',
        customerEmail: r.customer_email || 'guest@example.com',
        reservationStatus: r.status,
        amountDue: Number(r.amount_due || 0),
        currency: r.currency || 'PHP',
        createdAt: r.created_at,
        confirmedAt: r.confirmed_at ?? null,
        checkedInAt: r.checked_in_at ?? null,
        checkedOutAt: r.checked_out_at ?? null,
        bookingStartAt: assigned?.start_at ?? null,
        bookingEndAt: assigned?.end_at ?? null,
        assignedCandidateRank: (assigned?.rank ?? 0) as 0 | 1 | 2,
        workspaceDisplayName: displayName,
        workspaceInstanceCode: instanceCode,
        workspaceTemplateName: templateName,
        floorName: floorName,
        rescheduleCount: Number(r.reschedule_count || 0),
        updatedAt: r.updated_at || r.created_at,
      };
    });

    const reportPayments: ReportPaymentAttemptRecord[] = payments.map((p: RetentionPaymentAttemptRow) => {
      const method = p.payment_method_id ? paymentMethodsById.get(p.payment_method_id) : null;
      let methodType: 'GCASH' | 'BANK' | 'CASH' = 'BANK';

      const candidateMethodType = ((method?.method_type as string) || (p.payment_method_type as string) || '');
      if (candidateMethodType === 'CASH' || candidateMethodType === 'GCASH' || candidateMethodType === 'BANK') {
        methodType = candidateMethodType as 'GCASH' | 'BANK' | 'CASH';
      } else if (p.channel === 'KIOSK' || String(p.payment_method || '').toUpperCase().includes('CASH')) {
        methodType = 'CASH';
      } else if (p.channel === 'GCASH' || String(p.payment_method || '').toUpperCase().includes('GCASH')) {
        methodType = 'GCASH';
      }

      const methodDisplayName =
        method?.display_name ||
        p.payment_method ||
        (methodType === 'CASH' ? 'Cash at Counter' : methodType === 'GCASH' ? 'GCash QR' : 'Bank Transfer');

      return {
      paymentAttemptId: p.id,
      reservationId: p.reservation_id,
      reservationReferenceCode: refCodeByResId.get(p.reservation_id) || '',
      channel: p.channel === 'KIOSK' ? 'KIOSK' : 'WEB',
      paymentStatus: (['PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED'].includes(p.status as string) ? p.status : 'PENDING') as ReportPaymentAttemptRecord['paymentStatus'],
      refundStatus: (p.refund_status as ReportPaymentAttemptRecord['refundStatus']) || 'NONE',
      amount: Number(p.amount || 0),
      currency: p.currency || 'PHP',
      paymentMethodId: p.payment_method_id ?? null,
      paymentMethodType: methodType,
      paymentMethodDisplayName: methodDisplayName,
      createdAt: p.created_at,
      proofSubmittedAt: p.proof_submitted_at ?? null,
      processedAt: p.processed_at ?? null,
      refundedAt: p.refunded_at ?? null,
    };
    });

    const approvedPayments = payments.filter((p) => p.status === 'APPROVED');
    const totalRevenue = approvedPayments.reduce((sum: number, p) => sum + Number(p.amount || 0), 0);
    const currency = approvedPayments[0]?.currency || 'PHP';

    return {
      reportReservations,
      reportPayments,
      recordSet: {
        reservations,
        reservationCandidates: candidates as unknown as Record<string, unknown>[],
        paymentAttempts: payments as unknown as Record<string, unknown>[],
        paidCandidateRecovery,
        storageProofPaths,
      },
      totalRevenue,
      currency,
    };
  }

  async resolveAdminRecipientEmail(): Promise<string> {
    // 1. Resolve Superadmin user from staff_profiles where is_super_admin = true
    const { data: superAdminProfile } = await this.client
      .from('staff_profiles')
      .select('user_id')
      .eq('is_super_admin', true)
      .eq('role', 'ADMIN')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    if (superAdminProfile?.user_id) {
      try {
        const { data: authUser } = await this.client.auth.admin.getUserById(
          superAdminProfile.user_id
        );
        if (authUser?.user?.email && authUser.user.email.trim().length > 0) {
          return authUser.user.email.trim();
        }
      } catch {
        // ignore and fallback
      }
    }

    // 2. Fallback to business_settings
    const { data: settings } = await this.client
      .from('business_settings')
      .select('contact_email')
      .limit(1)
      .maybeSingle();

    if (settings?.contact_email && settings.contact_email.trim().length > 0) {
      return settings.contact_email.trim();
    }

    return 'thedeskatlas@gmail.com';
  }

  async executeDatabasePurge(cutoffTimestamp: Date): Promise<{
    purgedReservationsCount: number;
    purgedPaymentAttemptsCount: number;
  }> {
    const cutoffIso = cutoffTimestamp.toISOString();

    // 1. Try calling the stored procedure first
    const { data: rpcData, error: rpcError } = await this.client.rpc(
      'execute_quarterly_retention_purge',
      { p_cutoff_timestamp: cutoffIso }
    );

    if (!rpcError && rpcData) {
      return {
        purgedReservationsCount: Number(rpcData.purged_reservations_count || 0),
        purgedPaymentAttemptsCount: Number(rpcData.purged_payment_attempts_count || 0),
      };
    }

    if (rpcError) {
      console.warn('[RetentionPurge] Stored procedure execution notice:', rpcError.message);
    }

    // 2. Identify future/active bookings
    const { data: futureCandidates } = await this.client
      .from('reservation_candidates')
      .select('reservation_id')
      .gt('end_at', cutoffIso);
    const futureIds = new Set((futureCandidates || []).map((c: any) => c.reservation_id));

    // 2. Query target reservations
    const { data: rawRes } = await this.client
      .from('reservations')
      .select('id')
      .lte('created_at', cutoffIso)
      .limit(5000);

    const targetIds = (rawRes || [])
      .map((r: any) => r.id)
      .filter((id: string) => !futureIds.has(id));

    if (targetIds.length === 0) {
      return { purgedReservationsCount: 0, purgedPaymentAttemptsCount: 0 };
    }

    // 3. Delete in batches of 50 in strict topological foreign-key order
    const targetChunks = chunkArray(targetIds, 50);
    let purgedReservationsCount = 0;
    let purgedPaymentAttemptsCount = 0;

    for (const chunk of targetChunks) {
      // a. Nullify customer profile FK reference (preserving customer profiles!)
      await this.client
        .from('customers')
        .update({ first_confirmed_reservation_id: null })
        .in('first_confirmed_reservation_id', chunk);

      // b. Break circular voucher references and delete vouchers
      try {
        await this.client
          .from('reservations')
          .update({ requested_voucher_id: null, applied_voucher_id: null })
          .in('id', chunk);
        await this.client
          .from('notification_outbox')
          .delete()
          .in('reservation_id', chunk);
        await this.client
          .from('vouchers')
          .delete()
          .in('redeemed_reservation_id', chunk);
        await this.client
          .from('vouchers')
          .delete()
          .in('pending_reservation_id', chunk);
      } catch {}

      // c. Clean rewards work & processing jobs if present
      try {
        await this.client.from('reward_work').delete().in('source_reservation_id', chunk);
      } catch {}
      try {
        await this.client.from('reward_processing_jobs').delete().in('source_reservation_id', chunk);
      } catch {}
      try {
        await this.client
          .from('customer_rewards_ledger')
          .update({ source_reservation_id: null })
          .in('source_reservation_id', chunk);
      } catch {}

      // d. Delete qualifying_booking_facts
      try {
        await this.client.from('qualifying_booking_facts').delete().in('reservation_id', chunk);
      } catch {}

      // e. Delete notification_outbox
      try {
        await this.client.from('notification_outbox').delete().in('reservation_id', chunk);
      } catch {}

      // f. Delete paid_candidate_recovery
      try {
        await this.client.from('paid_candidate_recovery').delete().in('reservation_id', chunk);
      } catch {}

      // f2. Delete booking_rentals (and cascading rental_extensions)
      try {
        await this.client.from('booking_rentals').delete().in('reservation_id', chunk);
      } catch {}

      // g. Delete payment_attempts
      const { data: delPayments } = await this.client
        .from('payment_attempts')
        .delete()
        .in('reservation_id', chunk)
        .select('id');
      purgedPaymentAttemptsCount += delPayments?.length || 0;

      // h. Delete reservation_candidates
      await this.client
        .from('reservation_candidates')
        .delete()
        .in('reservation_id', chunk);

      // i. Delete reservations
      const { data: delRes } = await this.client
        .from('reservations')
        .delete()
        .in('id', chunk)
        .select('id');
      purgedReservationsCount += delRes?.length || 0;
    }

    return {
      purgedReservationsCount,
      purgedPaymentAttemptsCount,
    };
  }

  async deleteStorageProofs(storagePaths: string[]): Promise<{
    deletedCount: number;
    errors?: string[];
  }> {
    if (!storagePaths || storagePaths.length === 0) {
      return { deletedCount: 0 };
    }

    let deletedCount = 0;
    const errors: string[] = [];
    const batchSize = 100;

    for (let i = 0; i < storagePaths.length; i += batchSize) {
      const batch = storagePaths.slice(i, i + batchSize);
      try {
        const { data, error } = await this.client.storage
          .from('payment-proofs')
          .remove(batch);

        if (error) {
          errors.push(error.message);
        } else if (data) {
          deletedCount += data.length;
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(msg);
      }
    }

    return { deletedCount, errors: errors.length > 0 ? errors : undefined };
  }

  async recordAuditLog(entry: {
    action: string;
    entityType: string;
    metadata: Record<string, unknown>;
  }): Promise<void> {
    const entityId = '00000000-0000-0000-0000-000000000000';
    await this.client.from('audit_logs').insert({
      actor_role: 'SYSTEM',
      actor_user_id: null,
      action: entry.action,
      entity_type: entry.entityType,
      entity_id: entityId,
      metadata: entry.metadata,
    });
  }

  async listCustomerProfiles(): Promise<Array<Record<string, unknown>>> {
    const { data } = await this.client.from('customers').select('*');
    return data || [];
  }
}
