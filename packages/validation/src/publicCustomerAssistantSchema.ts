import { z } from 'zod';
import { assistantSourceSchema } from './assistantSchema';
import { customerControlIdentitySchema } from './customerAssistantSchema';
import { customerReservationChoiceSchema, customerBookingContextSchema } from './customerAssistanceSchema';

// MS77-R01-R03 / SDD-C20-C22: strict inert customer input, never authority.
const id = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => {
  const d = new Date(`${v}T00:00:00Z`); return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
});
export const customerPreferencesSchema = z.object({
  focus: z.boolean().optional(), calls: z.boolean().optional(), power: z.boolean().optional(),
  group_size: z.number().int().min(1).max(100).optional(), budget: z.number().finite().min(0).max(100000).optional(),
}).strict();
export const customerDiscoveryContextSchema = z.object({
  workspace_id: id.optional(), template_id: id.optional(), floor_id: id.optional(),
  compared_ids: z.array(id).max(3).refine(v => new Set(v).size === v.length).optional(),
  date: date.optional(), start_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  duration_minutes: z.number().int().min(1).max(1440).optional(),
  preferences: customerPreferencesSchema.optional(),
}).strict();
export const publicCustomerQuerySchema = customerControlIdentitySchema.extend({
  conversation_contract: z.literal('constraints-v1').optional(),
  message: z.string().trim().min(1).max(2000), user_turns: z.array(z.string().min(1).max(2000)).max(4).default([]),
  discovery: customerDiscoveryContextSchema.optional(), knowledge_epoch: z.number().int().safe().nonnegative().optional(),
  offered_names: z.array(z.string().min(1).max(200)).max(3).optional(),
  // MS78-TC05: domain resolves malformed, absent and foreign pointers uniformly.
  selected_reservation_id: z.string().max(100).optional(), reservation_filter: z.enum(['UPCOMING', 'HISTORY']).optional(),
}).strict();
export const customerSourceRequestSchema = z.object({ version_id: id, chunk_id: id }).strict();
export const customerCitationSchema = assistantSourceSchema.omit({ content: true });
export const customerSpotSuggestionSchema = z.object({
  workspace_id: id, template_id: id, floor_id: id, map_version_id: id, name: z.string().max(200),
  capacity: z.number().int().positive(), score: z.number().int().min(0).max(3),
  reasons: z.array(z.object({ dimension: z.enum(['focus', 'calls', 'power']), chunk_id: id, quote: z.string().max(1000) }).strict()).max(3),
  catalog_reasons: z.array(z.object({ dimension: z.enum(['focus', 'power']), tag: z.enum(['Quiet', 'Power Outlet']) }).strict()).max(2).optional(),
  availability: z.enum(['AVAILABLE', 'NOT_CHECKED']), as_of: z.string().datetime(),
  quote: z.object({ amount: z.number().finite().nonnegative(), currency: z.literal('PHP'), rate_type: z.literal('HOURLY'), as_of: z.string().datetime() }).strict().optional(),
}).strict();
export const customerActionSchema = z.discriminatedUnion('id', [
  z.object({ id: z.literal('VIEW_SPOT'), workspace_id: id, floor_id: id, map_version_id: id }).strict(),
  z.object({ id: z.literal('VERIFY_CUSTOMER') }).strict(),
]);
export const publicCustomerResponseSchema = z.object({
  version: z.literal('ms77-v1'), kind: z.enum(['ANSWER', 'CLARIFY', 'VERIFY_REQUIRED', 'UNSUPPORTED']),
  summary: z.string().max(20000), citations: z.array(customerCitationSchema).max(128),
  suggestions: z.array(customerSpotSuggestionSchema).max(3), actions: z.array(customerActionSchema).max(4),
  as_of: z.string().datetime(), knowledge_epoch: z.number().int().safe().nonnegative(), request_id: id,
  limitations: z.array(z.string().max(500)).max(12),
  discovery: customerDiscoveryContextSchema.optional(),
  offered_names: z.array(z.string().min(1).max(200)).max(3).optional(),
  // MS78-R02/R04: private fields only follow combined-purpose authorization.
  booking_result: z.enum(['CONTEXT', 'CLARIFY', 'RESERVATION_UNAVAILABLE', 'BOOKING_CHANGED']).optional(),
  reservation_choices: z.array(customerReservationChoiceSchema).max(10).optional(),
  reservation_next_cursor: z.string().max(512).nullable().optional(),
  booking_context: customerBookingContextSchema.optional(),
  policy_excerpts: z.array(z.object({ chunk_id: id, quote: z.string().max(1500) }).strict()).max(6).optional(),
}).strict();
export type CustomerDiscoveryContext = z.infer<typeof customerDiscoveryContextSchema>;
export type PublicCustomerQuery = z.infer<typeof publicCustomerQuerySchema>;
export type PublicCustomerResponse = z.infer<typeof publicCustomerResponseSchema>;
export type CustomerSpotSuggestion = z.infer<typeof customerSpotSuggestionSchema>;
