/**
 * Supabase PostgreSQL Customer and Notification Outbox Repository
 * Traceability: SPEC-1, SDD-C13, PRD-F22, ERD-E15, ERD-E21
 */

import type { Customer, NotificationOutboxJob } from '../models/customer';
import type {
  CustomerRepository,
  AccessChallengeData,
  CreateCustomerData,
  EnqueueOutboxJobData,
  UpdateOutboxJobStatusData,
} from './customerRepository';
import { normalizeEmail, normalizeCustomerCode } from '@deskatlas/validation';

export interface CustomerSupabaseConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
  fetcher?: typeof fetch;
}

export class CustomerSupabaseRepository implements CustomerRepository {
  private readonly supabaseUrl: string;
  private readonly serviceRoleKey: string;
  private readonly fetcher: typeof fetch;

  constructor(config: CustomerSupabaseConfig) {
    this.supabaseUrl = config.supabaseUrl.replace(/\/$/, '');
    this.serviceRoleKey = config.serviceRoleKey;
    this.fetcher = config.fetcher || fetch;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.supabaseUrl}/rest/v1${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
    const headers: Record<string, string> = {
      apikey: this.serviceRoleKey,
      Authorization: `Bearer ${this.serviceRoleKey}`,
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    };

    const response = await this.fetcher(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Supabase request failed (${response.status}): ${errorText}`);
    }

    const text = await response.text();
    return text ? (JSON.parse(text) as T) : ({} as T);
  }

  private mapCustomer(row: any): Customer {
    return {
      id: row.id,
      customerCode: row.customer_code,
      email: row.email,
      firstName: row.first_name,
      lastName: row.last_name,
      phone: row.phone || null,
      firstConfirmedReservationId: row.first_confirmed_reservation_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapOutboxJob(row: any): NotificationOutboxJob {
    return {
      id: row.id,
      dedupeKey: row.dedupe_key,
      kind: row.kind,
      customerId: row.customer_id || null,
      reservationId: row.reservation_id || null,
      voucherId: row.voucher_id || null,
      recipientEmail: row.recipient_email,
      payload: row.payload || {},
      dependsOnId: row.depends_on_id || null,
      status: row.status,
      attempts: row.attempts,
      nextAttemptAt: row.next_attempt_at,
      leaseUntil: row.lease_until || null,
      providerMessageId: row.provider_message_id || null,
      lastErrorCode: row.last_error_code || null,
      createdAt: row.created_at,
      sentAt: row.sent_at || null,
    };
  }

  async findCustomerByEmail(email: string): Promise<Customer | null> {
    const normalized = normalizeEmail(email);
    const rows = await this.request<any[]>(`/customers?email=eq.${encodeURIComponent(normalized)}&limit=1`);
    if (!rows || rows.length === 0) return null;
    return this.mapCustomer(rows[0]);
  }

  async findCustomerByCode(customerCode: string): Promise<Customer | null> {
    const normalized = normalizeCustomerCode(customerCode);
    const rows = await this.request<any[]>(`/customers?customer_code=eq.${encodeURIComponent(normalized)}&limit=1`);
    if (!rows || rows.length === 0) return null;
    return this.mapCustomer(rows[0]);
  }

  async findCustomerById(id: string): Promise<Customer | null> {
    const rows = await this.request<any[]>(`/customers?id=eq.${encodeURIComponent(id)}&limit=1`);
    if (!rows || rows.length === 0) return null;
    return this.mapCustomer(rows[0]);
  }

  async createCustomer(data: CreateCustomerData): Promise<Customer> {
    const normalizedEmail = normalizeEmail(data.email);
    const normalizedCode = normalizeCustomerCode(data.customerCode);

    const rows = await this.request<any[]>('/customers', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        customer_code: normalizedCode,
        email: normalizedEmail,
        first_name: data.firstName.trim(),
        last_name: data.lastName.trim(),
        phone: data.phone ? data.phone.trim() : null,
        first_confirmed_reservation_id: data.firstConfirmedReservationId,
      }),
    });

    if (!rows || rows.length === 0) {
      throw new Error('Failed to create customer row');
    }
    return this.mapCustomer(rows[0]);
  }

  async linkCustomerToReservation(reservationId: string, customerId: string): Promise<void> {
    await this.request(`/reservations?id=eq.${encodeURIComponent(reservationId)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ customer_id: customerId }),
    });
  }

  async enqueueOutboxJob(data: EnqueueOutboxJobData): Promise<NotificationOutboxJob> {
    const rows = await this.request<any[]>('/notification_outbox', {
      method: 'POST',
      headers: { Prefer: 'return=representation,resolution=ignore-duplicates' },
      body: JSON.stringify({
        dedupe_key: data.dedupeKey,
        kind: data.kind,
        customer_id: data.customerId || null,
        reservation_id: data.reservationId || null,
        voucher_id: data.voucherId || null,
        recipient_email: normalizeEmail(data.recipientEmail),
        payload: data.payload,
        depends_on_id: data.dependsOnId || null,
        status: data.status || 'PENDING',
        next_attempt_at: data.nextAttemptAt || new Date().toISOString(),
      }),
    });

    if (rows && rows.length > 0) {
      return this.mapOutboxJob(rows[0]);
    }

    const existing = await this.getOutboxJobByDedupeKey(data.dedupeKey);
    if (existing) return existing;
    throw new Error(`Failed to enqueue outbox job: ${data.dedupeKey}`);
  }

  async getDueOutboxJobs(limit: number = 50): Promise<NotificationOutboxJob[]> {
    const nowIso = new Date().toISOString();
    const rows = await this.request<any[]>(
      `/notification_outbox?or=(and(status.in.(PENDING,RETRY),next_attempt_at.lte.${encodeURIComponent(
        nowIso
      )}),and(status.eq.PROCESSING,lease_until.lte.${encodeURIComponent(nowIso)}))&order=next_attempt_at.asc&limit=${limit}`
    );
    return (rows || []).map((r) => this.mapOutboxJob(r));
  }

  async claimDueOutboxJobs(limit: number = 50, leaseDurationSeconds: number = 60): Promise<NotificationOutboxJob[]> {
    const rows = await this.request<any[]>('/rpc/claim_due_notification_outbox_jobs', {
      method: 'POST',
      body: JSON.stringify({
        p_limit: limit,
        p_lease_seconds: leaseDurationSeconds,
      }),
    });
    return (rows || []).map((r) => this.mapOutboxJob(r));
  }

  async updateOutboxJobStatus(id: string, update: UpdateOutboxJobStatusData): Promise<NotificationOutboxJob> {
    const payload: Record<string, any> = {
      status: update.status,
    };
    if (update.attempts !== undefined) payload.attempts = update.attempts;
    if (update.nextAttemptAt !== undefined) payload.next_attempt_at = update.nextAttemptAt;
    if (update.leaseUntil !== undefined) payload.lease_until = update.leaseUntil;
    if (update.providerMessageId !== undefined) payload.provider_message_id = update.providerMessageId;
    if (update.lastErrorCode !== undefined) payload.last_error_code = update.lastErrorCode;
    if (update.sentAt !== undefined) payload.sent_at = update.sentAt;

    const rows = await this.request<any[]>(`/notification_outbox?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(payload),
    });

    if (!rows || rows.length === 0) {
      throw new Error(`Outbox job not found for update: ${id}`);
    }
    return this.mapOutboxJob(rows[0]);
  }

  async requeueOutboxJob(id: string): Promise<NotificationOutboxJob> {
    const rows = await this.request<any[]>('/rpc/requeue_notification_outbox_job', {
      method: 'POST',
      body: JSON.stringify({
        p_job_id: id,
      }),
    });

    if (!rows || rows.length === 0) {
      throw new Error(`Failed to requeue outbox job: ${id}`);
    }
    return this.mapOutboxJob(rows[0]);
  }

  async getOutboxJobsByCustomerId(customerId: string): Promise<NotificationOutboxJob[]> {
    const rows = await this.request<any[]>(
      `/notification_outbox?customer_id=eq.${encodeURIComponent(customerId)}&order=created_at.asc`
    );
    return (rows || []).map((r) => this.mapOutboxJob(r));
  }

  async getOutboxJobById(id: string): Promise<NotificationOutboxJob | null> {
    const rows = await this.request<any[]>(`/notification_outbox?id=eq.${encodeURIComponent(id)}&limit=1`);
    if (!rows || rows.length === 0) return null;
    return this.mapOutboxJob(rows[0]);
  }

  async getOutboxJobByDedupeKey(dedupeKey: string): Promise<NotificationOutboxJob | null> {
    const rows = await this.request<any[]>(
      `/notification_outbox?dedupe_key=eq.${encodeURIComponent(dedupeKey)}&limit=1`
    );
    if (!rows || rows.length === 0) return null;
    return this.mapOutboxJob(rows[0]);
  }

  async createAccessChallenge(data: AccessChallengeData): Promise<void> {
    await this.request('/customer_access_challenges', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        token_hash: data.tokenHash,
        customer_id: data.customerId,
        purpose: data.purpose,
        created_at: data.createdAt,
        expires_at: data.expiresAt,
        revoked_at: data.revokedAt ?? null,
      }),
    });
  }

  async findAccessChallengeByHash(tokenHash: string): Promise<AccessChallengeData | null> {
    const rows = await this.request<Array<{
      token_hash: string;
      customer_id: string;
      purpose: string;
      created_at: string;
      expires_at: string;
      revoked_at: string | null;
    }>>(
      `/customer_access_challenges?token_hash=eq.${encodeURIComponent(tokenHash)}&limit=1`
    );
    const row = rows[0];
    if (!row) return null;

    return {
      tokenHash: row.token_hash,
      customerId: row.customer_id,
      purpose: row.purpose,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
    };
  }

  async revokeAccessChallenge(tokenHash: string): Promise<void> {
    await this.request(
      `/customer_access_challenges?token_hash=eq.${encodeURIComponent(tokenHash)}`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ revoked_at: new Date().toISOString() }),
      }
    );
  }

  async countRateLimitEvents(
    scope: string,
    subjectHash: string,
    windowSeconds: number
  ): Promise<number> {
    const windowStart = new Date(Date.now() - windowSeconds * 1000).toISOString();
    const rows = await this.request<Array<{ id: string }>>(
      `/rate_limit_events?select=id&scope=eq.${encodeURIComponent(scope)}` +
        `&subject_hash=eq.${encodeURIComponent(subjectHash)}` +
        `&created_at=gte.${encodeURIComponent(windowStart)}`
    );
    return rows.length;
  }

  async getOldestRateLimitEventInWindow(
    scope: string,
    subjectHash: string,
    windowSeconds: number
  ): Promise<{ createdAt: string } | null> {
    const windowStart = new Date(Date.now() - windowSeconds * 1000).toISOString();
    const rows = await this.request<Array<{ created_at: string }>>(
      `/rate_limit_events?select=created_at&scope=eq.${encodeURIComponent(scope)}` +
        `&subject_hash=eq.${encodeURIComponent(subjectHash)}` +
        `&created_at=gte.${encodeURIComponent(windowStart)}` +
        '&order=created_at.asc&limit=1'
    );
    return rows[0] ? { createdAt: rows[0].created_at } : null;
  }

  async recordRateLimitEvent(
    scope: string,
    subjectHash: string,
    requestId?: string | null
  ): Promise<void> {
    await this.request('/rate_limit_events', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        scope,
        subject_hash: subjectHash,
        request_id: requestId ?? null,
      }),
    });
  }
}
