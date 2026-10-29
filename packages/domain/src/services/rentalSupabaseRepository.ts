import type {
  BookingRental,
  RentalExtension,
  AssignRentalInput,
  ExtendRentalInput,
  ReturnRentalInput,
  RentalEndAlert,
  RentalBillingMode,
  RentalStatus,
} from '../models/rental';
import type { RentalFilter, RentalRepository } from './rentalRepository';

type BookingRentalRow = {
  id: string;
  rental_code: string;
  reservation_id: string;
  customer_id: string | null;
  service_id: string;
  unit_count: number;
  billing_mode: string;
  duration_units: number;
  rate_applied: number | string;
  total_amount: number | string;
  id_verified: boolean;
  id_notes: string;
  status: string;
  rented_at: string;
  due_at: string;
  returned_at: string | null;
  staff_user_id: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
  confirmation_sent_at?: string | null;
  end_alert_sent_at?: string | null;
  customers?: {
    first_name?: string;
    last_name?: string;
    email?: string;
  } | null;
  additional_services?: {
    name?: string;
  } | null;
  reservations?: {
    reference_code?: string;
    status?: string;
    customer_first_name?: string;
    customer_last_name?: string;
    customer_email?: string;
    reservation_candidates?: Array<{
      is_assigned?: boolean;
      workspace_instances?: {
        display_name?: string;
        instance_code?: string;
      } | null;
    }> | null;
  } | null;
};

type RentalExtensionRow = {
  id: string;
  rental_id: string;
  extension_mode: string;
  additional_units: number;
  rate_applied: number | string;
  additional_amount: number | string;
  previous_due_at: string;
  new_due_at: string;
  staff_user_id: string | null;
  extended_at: string;
};

function extractSpotName(reservations?: BookingRentalRow['reservations']): string | undefined {
  const candidates = Array.isArray(reservations?.reservation_candidates)
    ? reservations.reservation_candidates
    : [];
  const assigned = candidates.find((c) => c.is_assigned) ?? candidates[0];
  return (
    assigned?.workspace_instances?.display_name ||
    assigned?.workspace_instances?.instance_code ||
    undefined
  );
}

function mapBookingRentalRow(row: BookingRentalRow): BookingRental {
  const customerName =
    row.reservations && (row.reservations.customer_first_name || row.reservations.customer_last_name)
      ? `${row.reservations.customer_first_name || ''} ${row.reservations.customer_last_name || ''}`.trim()
      : row.customers && (row.customers.first_name || row.customers.last_name)
      ? `${row.customers.first_name || ''} ${row.customers.last_name || ''}`.trim()
      : undefined;
  const customerEmail = row.reservations?.customer_email || row.customers?.email;
  const spotName = extractSpotName(row.reservations);
  const nowMs = Date.now();
  const dueMs = new Date(row.due_at).getTime();
  const diffMs = dueMs - nowMs;

  return {
    id: row.id,
    rentalCode: row.rental_code,
    reservationId: row.reservation_id,
    customerId: row.customer_id,
    serviceId: row.service_id,
    unitCount: row.unit_count,
    billingMode: row.billing_mode as RentalBillingMode,
    durationUnits: row.duration_units,
    rateApplied: Number(row.rate_applied),
    totalAmount: Number(row.total_amount),
    idVerified: row.id_verified,
    idNotes: row.id_notes || '',
    status: row.status as RentalStatus,
    rentedAt: row.rented_at,
    dueAt: row.due_at,
    returnedAt: row.returned_at,
    staffUserId: row.staff_user_id,
    notes: row.notes || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    confirmationSentAt: row.confirmation_sent_at ?? null,
    endAlertSentAt: row.end_alert_sent_at ?? null,
    referenceCode: row.reservations?.reference_code,
    customerName: customerName || 'Customer',
    customerEmail,
    spotName: spotName || 'Workspace',
    serviceName: row.additional_services?.name || 'Rental Item',
    isOverdue: row.status === 'active' && diffMs <= 0,
    isNearingEnd: row.status === 'active' && diffMs > 0 && diffMs <= 5 * 60 * 1000,
    timeRemainingMinutes: Math.round(diffMs / 60000),
  };
}

export class SupabaseRentalRepository implements RentalRepository {
  private readonly restUrl: string;
  private readonly serviceRoleKey: string;

  constructor(options?: { supabaseUrl?: string; serviceRoleKey?: string }) {
    const supabaseUrl =
      options?.supabaseUrl ?? process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = options?.serviceRoleKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl) {
      throw new Error('SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL is required for rental repository');
    }

    if (!serviceRoleKey) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for rental repository');
    }

    this.restUrl = `${supabaseUrl.replace(/\/$/, '')}/rest/v1`;
    this.serviceRoleKey = serviceRoleKey;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('apikey', this.serviceRoleKey);
    headers.set('Authorization', `Bearer ${this.serviceRoleKey}`);
    headers.set('Content-Type', 'application/json');

    const res = await fetch(`${this.restUrl}${path}`, {
      ...init,
      headers,
    });

    if (!res.ok) {
      const body = await res.text();
      let errorMsg = body;
      try {
        const parsed = JSON.parse(body);
        errorMsg = parsed.message || parsed.error || body;
      } catch {}
      throw new Error(`Rental Supabase error [${res.status}]: ${errorMsg}`);
    }

    if (res.status === 204) {
      return undefined as T;
    }

    return (await res.json()) as T;
  }

  async listRentals(filter?: RentalFilter): Promise<BookingRental[]> {
    let query =
      '/booking_rentals?select=*,customers(first_name,last_name,email),additional_services(name),reservations(reference_code,status,customer_first_name,customer_last_name,customer_email,reservation_candidates(is_assigned,workspace_instances(display_name,instance_code)))&order=created_at.desc';

    if (filter?.status) {
      query += `&status=eq.${filter.status}`;
    }
    if (filter?.reservationId) {
      query += `&reservation_id=eq.${filter.reservationId}`;
    }
    if (filter?.customerId) {
      query += `&customer_id=eq.${filter.customerId}`;
    }

    const rows = await this.request<BookingRentalRow[]>(query);
    return rows.map(mapBookingRentalRow);
  }

  async getRentalById(id: string): Promise<BookingRental | null> {
    const query = `/booking_rentals?id=eq.${id}&select=*,customers(first_name,last_name,email),additional_services(name),reservations(reference_code,status,customer_first_name,customer_last_name,customer_email,reservation_candidates(is_assigned,workspace_instances(display_name,instance_code)))&limit=1`;
    const rows = await this.request<BookingRentalRow[]>(query);
    return rows.length > 0 ? mapBookingRentalRow(rows[0]) : null;
  }

  async getRentalByCode(code: string): Promise<BookingRental | null> {
    const query = `/booking_rentals?rental_code=eq.${code}&select=*,customers(first_name,last_name,email),additional_services(name),reservations(reference_code,status,customer_first_name,customer_last_name,customer_email,reservation_candidates(is_assigned,workspace_instances(display_name,instance_code)))&limit=1`;
    const rows = await this.request<BookingRentalRow[]>(query);
    return rows.length > 0 ? mapBookingRentalRow(rows[0]) : null;
  }

  async assignRental(input: AssignRentalInput): Promise<BookingRental> {
    const rpcRes = await this.request<{
      success: boolean;
      rentalId: string;
      rentalCode: string;
      dueAt: string;
      totalAmount: number;
    }>('/rpc/assign_booking_rental', {
      method: 'POST',
      body: JSON.stringify({
        p_reservation_id: input.reservationId,
        p_service_id: input.serviceId,
        p_billing_mode: input.billingMode,
        p_duration_units: input.durationUnits,
        p_id_notes: input.idNotes || '',
        p_staff_user_id: input.staffUserId || null,
      }),
    });

    if (!rpcRes?.rentalId) {
      throw new Error('Failed to assign rental');
    }

    const created = await this.getRentalById(rpcRes.rentalId);
    if (!created) {
      throw new Error('Assigned rental could not be retrieved');
    }
    return created;
  }

  async extendRental(input: ExtendRentalInput): Promise<BookingRental> {
    const rpcRes = await this.request<{
      success: boolean;
      extensionId: string;
      previousDueAt: string;
      newDueAt: string;
      additionalAmount: number;
      totalAmount: number;
    }>('/rpc/extend_booking_rental', {
      method: 'POST',
      body: JSON.stringify({
        p_rental_id: input.rentalId,
        p_extension_mode: input.extensionMode,
        p_additional_units: input.additionalUnits,
        p_staff_user_id: input.staffUserId || null,
      }),
    });

    if (!rpcRes?.success) {
      throw new Error('Failed to extend rental');
    }

    try {
      await this.request(`/booking_rentals?id=eq.${input.rentalId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          end_alert_sent_at: null,
          updated_at: new Date().toISOString(),
        }),
      });
    } catch {}

    const updated = await this.getRentalById(input.rentalId);
    if (!updated) {
      throw new Error('Extended rental could not be retrieved');
    }
    return updated;
  }

  async returnRental(input: ReturnRentalInput): Promise<BookingRental> {
    const rpcRes = await this.request<{
      success: boolean;
      returnedAt: string;
    }>('/rpc/return_booking_rental', {
      method: 'POST',
      body: JSON.stringify({
        p_rental_id: input.rentalId,
        p_staff_user_id: input.staffUserId || null,
      }),
    });

    if (!rpcRes?.success) {
      throw new Error('Failed to return rental');
    }

    const updated = await this.getRentalById(input.rentalId);
    if (!updated) {
      throw new Error('Returned rental could not be retrieved');
    }
    return updated;
  }

  async listExtensions(rentalId: string): Promise<RentalExtension[]> {
    const query = `/rental_extensions?rental_id=eq.${rentalId}&order=extended_at.desc`;
    const rows = await this.request<RentalExtensionRow[]>(query);
    return rows.map((r) => ({
      id: r.id,
      rentalId: r.rental_id,
      extensionMode: r.extension_mode as RentalBillingMode,
      additionalUnits: r.additional_units,
      rateApplied: Number(r.rate_applied),
      additionalAmount: Number(r.additional_amount),
      previousDueAt: r.previous_due_at,
      newDueAt: r.new_due_at,
      staffUserId: r.staff_user_id,
      extendedAt: r.extended_at,
    }));
  }

  async markRentalConfirmationSent(rentalId: string, sentAt: string = new Date().toISOString()): Promise<void> {
    try {
      await this.request(`/booking_rentals?id=eq.${rentalId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          confirmation_sent_at: sentAt,
          updated_at: new Date().toISOString(),
        }),
      });
    } catch (err) {
      console.warn(`[SupabaseRentalRepository] Failed to mark confirmation sent for ${rentalId}:`, err);
    }
  }

  async markRentalEndAlertSent(rentalId: string, sentAt: string | null = new Date().toISOString()): Promise<void> {
    try {
      await this.request(`/booking_rentals?id=eq.${rentalId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          end_alert_sent_at: sentAt,
          updated_at: new Date().toISOString(),
        }),
      });
    } catch (err) {
      console.warn(`[SupabaseRentalRepository] Failed to mark end alert sent for ${rentalId}:`, err);
    }
  }

  async getRentalAlerts(thresholdMinutes: number, now: Date = new Date()): Promise<RentalEndAlert[]> {
    const query =
      '/booking_rentals?status=eq.active&select=*,customers(first_name,last_name,email),additional_services(name),reservations(reference_code,status,customer_first_name,customer_last_name,customer_email,reservation_candidates(is_assigned,workspace_instances(display_name,instance_code)))';
    const rows = await this.request<BookingRentalRow[]>(query);

    const nowMs = now.getTime();
    const thresholdMs = thresholdMinutes * 60 * 1000;
    const alerts: RentalEndAlert[] = [];

    for (const row of rows) {
      const dueMs = new Date(row.due_at).getTime();
      const diffMs = dueMs - nowMs;
      const isOverdue = diffMs <= 0;
      const isNearingEnd = diffMs <= thresholdMs && diffMs > 0;

      if (isNearingEnd || isOverdue) {
        const customerName =
          row.reservations && (row.reservations.customer_first_name || row.reservations.customer_last_name)
            ? `${row.reservations.customer_first_name || ''} ${row.reservations.customer_last_name || ''}`.trim()
            : row.customers && (row.customers.first_name || row.customers.last_name)
            ? `${row.customers.first_name || ''} ${row.customers.last_name || ''}`.trim()
            : 'Customer';
        const customerEmail = row.reservations?.customer_email || row.customers?.email || undefined;
        const spotName = extractSpotName(row.reservations) || 'Workspace';

        alerts.push({
          rentalId: row.id,
          rentalCode: row.rental_code,
          reservationId: row.reservation_id,
          referenceCode: row.reservations?.reference_code,
          spotName,
          customerName,
          customerEmail,
          itemName: row.additional_services?.name || 'Rental Item',
          dueAt: row.due_at,
          timeRemainingMinutes: Math.round(diffMs / 60000),
          isOverdue,
          endAlertSentAt: row.end_alert_sent_at ?? null,
        });
      }
    }

    return alerts;
  }
}

