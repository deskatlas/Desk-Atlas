// MS78-R02/R03: bounded private reads, no browser-provided identity or authority.
import { z } from 'zod';

export const customerReservationCursorSchema = z.object({
  start_at: z.string().datetime({ offset: true }),
  id: z.string().uuid(),
}).strict();
export const customerAssistanceReservationsSchema = z.object({
  filter: z.enum(['UPCOMING', 'HISTORY']).default('UPCOMING'),
  cursor: z.string().max(512).optional(),
}).strict();
export const customerAssistanceActionSchema = z.enum([
  'VIEW_RESERVATION', 'REVIEW_CANCELLATION', 'REVIEW_RESCHEDULE',
  'REVIEW_RELOCATION', 'VIEW_CHECKIN_INSTRUCTIONS',
]);
export type CustomerAssistanceAction = z.infer<typeof customerAssistanceActionSchema>;

export const customerAssistanceSnapshotSchema = z.object({
  id: z.string().uuid(), reference: z.string().max(100), status: z.string().max(64),
  channel: z.enum(['WEB', 'KIOSK']),
  start_at: z.string().datetime({ offset: true }).nullable(),
  end_at: z.string().datetime({ offset: true }).nullable(),
  workspace: z.string().max(300).nullable(), assigned: z.boolean(),
  checked_in_at: z.string().nullable(), checked_out_at: z.string().nullable(),
  payment_status: z.string().max(64).nullable(),
  reschedule_count: z.number().int().nonnegative().nullable(),
  closure_pending: z.boolean(),
  timezone: z.string().max(100).nullable(),
  reschedule_cutoff_hours: z.number().nonnegative().nullable(),
  cancellation_cutoff_value: z.number().nonnegative().nullable(),
  cancellation_cutoff_unit: z.enum(['HOURS', 'DAYS']).nullable(),
}).strict();
export type CustomerAssistanceSnapshot = z.infer<typeof customerAssistanceSnapshotSchema>;

export const customerReservationChoiceSchema = z.object({
  id: z.string().uuid(), reference: z.string().max(100), status: z.string().max(64),
  start_at: z.string().datetime({ offset: true }).nullable(), end_at: z.string().datetime({ offset: true }).nullable(),
  workspace: z.string().max(300).nullable(),
}).strict();
const knownStatus = z.enum(['UNKNOWN', 'PENDING_PAYMENT', 'PAYMENT_UNDER_REVIEW', 'CONFIRMED',
  'NEEDS_MANUAL_RESOLUTION', 'CANCELLED', 'EXPIRED', 'COMPLETED', 'REJECTED']);
const eligibility = z.union([z.boolean(), z.literal('UNKNOWN')]);
export const customerBookingFactsSchema = z.object({
  status: z.enum(['UNKNOWN', 'PENDING_PAYMENT', 'PAYMENT_UNDER_REVIEW', 'PENDING_COUNTER_CONFIRMATION',
    'CHECKED_IN', 'CONFIRMED', 'NEEDS_MANUAL_RESOLUTION', 'CANCELLED', 'EXPIRED', 'COMPLETED', 'REJECTED']),
  tracking_status: knownStatus, channel: z.enum(['WEB', 'KIOSK']),
  start_at: z.string().datetime({ offset: true }).nullable(), end_at: z.string().datetime({ offset: true }).nullable(),
  workspace: z.string().max(300).nullable(),
  payment_status: z.enum(['UNKNOWN', 'PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED']),
  cancel: eligibility, reschedule: eligibility, relocation: eligibility,
  cancel_reason: z.enum(['UNAVAILABLE', 'ELIGIBLE_FOR_REVIEW', 'NOT_ELIGIBLE', 'STATUS_NOT_CONFIRMED',
    'ALREADY_CHECKED_IN', 'COMPLETED', 'NO_SCHEDULE', 'START_PASSED', 'CUTOFF_PASSED']),
  reschedule_reason: z.enum(['UNAVAILABLE', 'ELIGIBLE_FOR_REVIEW', 'NOT_ELIGIBLE', 'STATUS_NOT_CONFIRMED',
    'RESCHEDULE_USED', 'NO_SCHEDULE', 'CUTOFF_PASSED']),
  cancellation_cutoff_at: z.string().datetime({ offset: true }).nullable(),
  reschedule_cutoff_at: z.string().datetime({ offset: true }).nullable(),
  recovery: z.enum(['REVIEW_REQUIRED', 'UNKNOWN']),
}).strict();
export const customerBookingContextSchema = z.object({
  reservation: customerReservationChoiceSchema, facts: customerBookingFactsSchema,
  actions: z.array(customerAssistanceActionSchema).max(5), as_of: z.string().datetime({ offset: true }),
  business_timezone: z.string().max(100).nullable(), limitations: z.array(z.string().max(500)).max(12),
}).strict();
