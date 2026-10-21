// MS78-R02/R03, SDD-C3/C20-C22, QAD-TC38/44/46. Read-only and request-local.
import type { CustomerAssistanceAction, CustomerAssistanceSnapshot } from '@deskatlas/validation';
import type { GuestReservationTrackingRecord } from './guestReservationTrackingRepository';
import { mapGuestTrackingStatus } from './guestReservationTrackingService';
import { evaluateCustomerManagementEligibility } from './customerManagementEligibility';
import { evaluateCustomerCancellationEligibility } from './customerCancellationService';

export interface CustomerReservationChoice {
  id: string; reference: string; status: string;
  start_at: string | null; end_at: string | null; workspace: string | null;
}
export interface CustomerAssistanceRepository {
  list(customerId: string, filter: 'UPCOMING' | 'HISTORY', cursor?: string): Promise<{
    items: CustomerReservationChoice[]; next_cursor: string | null;
  }>;
  read(customerId: string, reservationId: string): Promise<CustomerAssistanceSnapshot | null>;
}
export interface CustomerBookingFacts {
  status: string;
  tracking_status: string;
  channel: 'WEB' | 'KIOSK';
  start_at: string | null; end_at: string | null; workspace: string | null;
  payment_status: string;
  cancel: boolean | 'UNKNOWN'; reschedule: boolean | 'UNKNOWN'; relocation: boolean | 'UNKNOWN';
  cancel_reason: string; reschedule_reason: string;
  cancellation_cutoff_at: string | null; reschedule_cutoff_at: string | null;
  recovery: 'REVIEW_REQUIRED' | 'UNKNOWN';
}
export interface CustomerAssistanceContext {
  reservation: CustomerReservationChoice;
  facts: CustomerBookingFacts;
  actions: CustomerAssistanceAction[];
  as_of: string;
  business_timezone: string | null;
  limitations: string[];
}
const paymentStates = new Set(['PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED']);

export function projectCustomerBooking(snapshot: CustomerAssistanceSnapshot, now: Date): CustomerAssistanceContext {
  // Explicit projection: identifiers, contact data and arbitrary row fields cannot become model facts.
  const record: GuestReservationTrackingRecord = {
    reservationId: snapshot.id, referenceCode: snapshot.reference, customerEmail: '',
    reservationStatus: snapshot.status, amountDue: 0, currency: '', confirmedAt: null,
    checkedInAt: snapshot.checked_in_at, checkedOutAt: snapshot.checked_out_at,
    paymentStatus: snapshot.payment_status, rescheduleCount: snapshot.reschedule_count ?? undefined,
    isClosureImpacted: snapshot.closure_pending,
    closureImpactStatus: snapshot.closure_pending ? 'AFFECTED_PENDING_ACTION' : null,
    finalAssignment: snapshot.assigned && snapshot.start_at && snapshot.end_at ? {
      workspaceInstanceId: '', workspaceInstanceCode: '', workspaceTemplateName: '', floorName: '',
      workspaceDisplayName: snapshot.workspace ?? '', bookingStartAt: snapshot.start_at, bookingEndAt: snapshot.end_at,
    } : null,
  };
  let status = 'UNKNOWN';
  try { status = mapGuestTrackingStatus(record, now.getTime()); } catch { /* Unknown stays unknown. */ }
  const facts: CustomerBookingFacts = {
    status: status === 'UNKNOWN' ? 'UNKNOWN' : snapshot.status, tracking_status: status,
    channel: snapshot.channel, start_at: snapshot.start_at, end_at: snapshot.end_at,
    workspace: snapshot.assigned ? snapshot.workspace : null,
    payment_status: snapshot.payment_status && paymentStates.has(snapshot.payment_status) ? snapshot.payment_status : 'UNKNOWN',
    cancel: 'UNKNOWN', reschedule: 'UNKNOWN', relocation: 'UNKNOWN',
    cancel_reason: 'UNAVAILABLE', reschedule_reason: 'UNAVAILABLE',
    cancellation_cutoff_at: null, reschedule_cutoff_at: null,
    recovery: status === 'CONFIRMED' && snapshot.closure_pending ? 'REVIEW_REQUIRED' : 'UNKNOWN',
  };
  const known = status !== 'UNKNOWN';
  const cancelHours = snapshot.cancellation_cutoff_value !== null && snapshot.cancellation_cutoff_unit
    ? snapshot.cancellation_cutoff_value * (snapshot.cancellation_cutoff_unit === 'DAYS' ? 24 : 1) : null;
  const scheduleKnown = snapshot.assigned && Boolean(snapshot.start_at && snapshot.end_at);
  if (known && cancelHours !== null && (status !== 'CONFIRMED' || scheduleKnown)) {
    const cancellation = evaluateCustomerCancellationEligibility(record, {
      customerCancellationCutoffValue: snapshot.cancellation_cutoff_value,
      customerCancellationCutoffUnit: snapshot.cancellation_cutoff_unit,
    }, now);
    facts.cancel = cancellation.canCancel;
    facts.cancel_reason = cancellation.canCancel ? 'ELIGIBLE_FOR_REVIEW' : cancellation.reasonCode ?? 'NOT_ELIGIBLE';
    if (record.finalAssignment) facts.cancellation_cutoff_at = new Date(Date.parse(record.finalAssignment.bookingStartAt) - cancellation.cutoffHours * 3600000).toISOString();
  }
  if (known) {
    const eligibility = evaluateCustomerManagementEligibility(record, status as ReturnType<typeof mapGuestTrackingStatus>, snapshot.reschedule_cutoff_hours ?? 12, cancelHours ?? 12, now.getTime());
    if (status !== 'CONFIRMED' || scheduleKnown || snapshot.closure_pending) facts.relocation = status === 'CONFIRMED' && eligibility.canRelocate;
    if (snapshot.reschedule_cutoff_hours !== null && snapshot.reschedule_count !== null && (status !== 'CONFIRMED' || scheduleKnown || snapshot.closure_pending)) {
      facts.reschedule = eligibility.canReschedule;
      facts.reschedule_reason = eligibility.rescheduleReason;
      if (record.finalAssignment) facts.reschedule_cutoff_at = new Date(Date.parse(record.finalAssignment.bookingStartAt) - snapshot.reschedule_cutoff_hours * 3600000).toISOString();
    }
  }
  const actions: CustomerAssistanceAction[] = ['VIEW_RESERVATION'];
  if (facts.cancel === true) actions.push('REVIEW_CANCELLATION');
  if (facts.reschedule === true) actions.push('REVIEW_RESCHEDULE');
  if (facts.relocation === true) actions.push('REVIEW_RELOCATION');
  if (status === 'CONFIRMED') actions.push('VIEW_CHECKIN_INSTRUCTIONS');
  return {
    reservation: { id: snapshot.id, reference: snapshot.reference, status: snapshot.status,
      start_at: snapshot.start_at, end_at: snapshot.end_at, workspace: snapshot.workspace },
    facts, actions, as_of: now.toISOString(), business_timezone: snapshot.timezone,
    limitations: ['Refund progress and recommendation rationale are not available through this assistant.',
      'Actions open the existing booking verification and confirmation workflow.'],
  };
}

// Provider output cannot grant permissions or introduce private facts. Every claim resolves exactly.
export function validateCustomerFactClaims(claims: Array<{ handle: string; value: unknown }>, facts: CustomerBookingFacts): boolean {
  return claims.length >= 1 && claims.length <= 30 && claims.every(claim =>
    Object.prototype.hasOwnProperty.call(facts, claim.handle) &&
    facts[claim.handle as keyof CustomerBookingFacts] === claim.value);
}

export class CustomerAssistanceService {
  constructor(private readonly repository: CustomerAssistanceRepository, private readonly now = () => new Date()) {}
  list(customerId: string, filter: 'UPCOMING' | 'HISTORY', cursor?: string) {
    return this.repository.list(customerId, filter, cursor);
  }
  async resolve(customerId: string, selectedId?: string, filter: 'UPCOMING' | 'HISTORY' = 'UPCOMING') {
    if (selectedId !== undefined && !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(selectedId)) return { kind: 'RESERVATION_UNAVAILABLE' as const };
    if (!selectedId) {
      const choices = await this.list(customerId, filter);
      // A page is unique only when the repository proves there is no following page.
      if (choices.items.length !== 1 || choices.next_cursor) return { kind: 'CLARIFY' as const, ...choices };
      selectedId = choices.items[0].id;
    }
    const snapshot = await this.repository.read(customerId, selectedId);
    if (!snapshot) return { kind: 'RESERVATION_UNAVAILABLE' as const };
    return { kind: 'CONTEXT' as const, context: projectCustomerBooking(snapshot, this.now()) };
  }
  async current(customerId: string, reservationId: string) {
    const snapshot = await this.repository.read(customerId, reservationId);
    return snapshot ? projectCustomerBooking(snapshot, this.now()) : null;
  }
  async revalidate(customerId: string, context: CustomerAssistanceContext) {
    const fresh = await this.current(customerId, context.reservation.id);
    if (!fresh) return { kind: 'RESERVATION_UNAVAILABLE' as const };
    const stable = JSON.stringify([context.facts, context.actions, context.business_timezone]) === JSON.stringify([fresh.facts, fresh.actions, fresh.business_timezone]);
    return { kind: stable ? 'CURRENT' as const : 'CHANGED' as const, context: fresh };
  }
}
