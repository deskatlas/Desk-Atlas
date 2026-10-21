import { z } from 'zod';

// MS76-R02 / SDD-C20-C22: customer authority is separate from staff roles.
export const customerPrincipalSchema = z.enum(['PUBLIC_VISITOR', 'VERIFIED_CUSTOMER']);
export const customerOperationSchema = z.enum(['customer_knowledge', 'public_workspace', 'public_availability', 'public_price', 'owned_bookings', 'owned_booking_context']);
export const customerCapabilitySchema = z.object({
  iss: z.literal('deskatlas'), aud: z.literal('rag'), surface: z.literal('customer'),
  principal: customerPrincipalSchema, sub: z.string().uuid(), scope: z.string().min(1).max(200),
  request_id: z.string().uuid(), session_id: z.string().uuid(), generation: z.string().uuid(),
  ops: z.array(customerOperationSchema).min(1).max(6),
  audiences: z.array(z.literal('CUSTOMER')).length(1),
  iat: z.number().int().nonnegative(), exp: z.number().int().positive(),
}).strict().superRefine((value, ctx) => {
  if (value.exp <= value.iat || value.exp - value.iat > 60) ctx.addIssue({ code: 'custom', message: 'Invalid capability lifetime' });
  if (new Set(value.ops).size !== value.ops.length || value.principal === 'PUBLIC_VISITOR' && value.ops.some(op => op.startsWith('owned_')))
    ctx.addIssue({ code: 'custom', message: 'Invalid operation binding' });
});
export type CustomerCapability = z.infer<typeof customerCapabilitySchema>;

// Plans cannot supply a principal, scope, customer ID or arbitrary tool name.
export const customerPlanSchema = z.object({
  kind: z.enum(['KNOWLEDGE', 'WORKSPACE', 'BOOKING', 'REFUSE']),
  search_query: z.string().min(1).max(1000).optional(),
  comparison_names: z.array(z.string().min(1).max(200)).max(3).optional(),
  operations: z.array(z.object({
    name: customerOperationSchema,
    workspace_id: z.string().uuid().optional(), reservation_id: z.string().uuid().optional(),
  }).strict()).max(6),
}).strict();
export const customerControlIdentitySchema = z.object({
  request_id: z.string().uuid(), session_id: z.string().uuid(), generation: z.string().uuid(),
}).strict();
