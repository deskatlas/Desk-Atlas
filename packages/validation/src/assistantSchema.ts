import { z } from 'zod';

// SPEC-4: PRD-F26, SDD-C20/C22, QAD-TC44. All boundaries reject extra fields.
const id = z.string().uuid();
export const assistantIdSchema = id;
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const assistantRoleSchema = z.enum(['ADMIN', 'STAFF']);
// MS-45 / SDD-C20/C24: minimal authenticated launcher projection.
export const assistantAvailabilitySchema = z.object({
  enabled: z.boolean(), identity: z.object({ id, role: assistantRoleSchema }).strict(),
  knowledge_epoch: z.number().int().safe().nonnegative(),
}).strict();
export const assistantKnowledgeAvailabilitySchema = assistantAvailabilitySchema.omit({ identity: true });
export const assistantFiltersSchema = z.object({
  period: z.enum(['today', 'yesterday', 'last7', 'last30', 'this_month', 'this_year']).optional(),
  start_date: date.optional(), end_date: date.optional(),
  start_at: z.string().datetime({ offset: true }).optional(),
  end_at: z.string().datetime({ offset: true }).optional(),
  basis: z.enum(['scheduled', 'created']).default('scheduled'),
  grouping: z.enum(['day', 'week', 'month']).default('day'),
  source: z.enum(['WEB', 'KIOSK']).optional(),
  statuses: z.array(z.enum(['PENDING_PAYMENT', 'PAYMENT_UNDER_REVIEW', 'PENDING_COUNTER_CONFIRMATION', 'CONFIRMED', 'NEEDS_MANUAL_RESOLUTION', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'EXPIRED'])).max(9).optional(),
  floor_id: id.optional(), template_id: id.optional(), desk_id: id.optional(), method_id: id.optional(),
  metric: z.enum(['booking_count', 'booked_hours', 'booked_occupancy', 'actual_usage', 'status_cohorts', 'review_backlog', 'cancellation_events']).optional(),
  compare: z.enum(['previous_period', 'previous_month', 'previous_year']).optional(),
}).strict();
export const assistantToolSchema = z.object({
  name: z.enum(['operational_snapshot', 'workspace_availability', 'booking_report', 'payment_report', 'workspace_usage_report', 'operational_report']),
  args: assistantFiltersSchema,
}).strict();
export const assistantContextSchema = z.object({
  user_turns: z.array(z.string().min(1).max(2000)).max(4).default([]),
  selections: assistantToolSchema.optional(),
  knowledge_epoch: z.number().int().nonnegative().optional(),
}).strict();
export const assistantQuerySchema = z.object({
  session_id: id, request_id: id, message: z.string().trim().min(1).max(2000),
  recent_context: assistantContextSchema.optional(),
}).strict();
export const assistantCancelSchema = assistantQuerySchema.pick({ session_id: true, request_id: true });
export const assistantPlanSchema = z.object({
  kind: z.enum(['DOCUMENT', 'OPERATIONAL', 'REPORT', 'MIXED', 'CLARIFY', 'UNSUPPORTED']),
  query: z.string().max(3000),
  clarification: z.string().max(300).optional(),
  tools: z.array(assistantToolSchema).max(3),
}).strict();
export const assistantTableSchema = z.object({
  title: z.string().max(180), columns: z.array(z.string().max(120)).min(1).max(12),
  rows: z.array(z.array(z.union([z.string().max(250), z.number().int().safe(), z.null()])).max(12)).max(500),
}).strict().refine(t => t.rows.every(r => r.length === t.columns.length), 'Invalid table dimensions');
export const assistantSourceSchema = z.object({
  document_id: id, version_id: id, chunk_id: id, title: z.string().max(200),
  heading_path: z.string().max(500), source_page: z.number().int().positive().nullable(),
  epoch: z.number().int().nonnegative(), extraction_method: z.string().max(50),
  content_hash: z.string().regex(/^[a-f0-9]{64}$/), content: z.string().max(16000),
}).strict();
export const assistantAnswerSchema = z.object({
  kind: assistantPlanSchema.shape.kind, summary: z.string().max(20000),
  tables: z.array(assistantTableSchema).max(12),
  citations: z.array(assistantSourceSchema.omit({ content: true })).max(6),
  interpretation: z.array(z.string().max(1000)).max(30),
  as_of: z.string().datetime(), limitations: z.array(z.string().max(500)).max(30),
  knowledge_epoch: z.number().int().nonnegative(), request_id: id,
  selections: assistantToolSchema.optional(),
}).strict();
export const assistantSearchSchema = z.object({
  vector: z.array(z.number().finite()).length(1024),
}).strict().refine(v => Math.abs(Math.hypot(...v.vector) - 1) < 0.001, 'Expected normalized embedding');
export const assistantExtractSchema = z.object({
  quotes: z.array(z.object({ chunk_id: id, quote: z.string().min(1).max(1500) }).strict()).max(6),
  conflicting_sources: z.boolean().default(false),
}).strict();
export const assistantToolResultSchema = z.object({ tables: z.array(assistantTableSchema).max(4), limitations: z.array(z.string().max(500)).max(10), interpretation: z.array(z.string().max(1000)).max(10) }).strict();
export const assistantSourcesSchema = z.array(assistantSourceSchema).max(12);
export type AssistantQuery = z.infer<typeof assistantQuerySchema>;
export type AssistantTool = z.infer<typeof assistantToolSchema>;
export type AssistantFilters = z.infer<typeof assistantFiltersSchema>;
export type AssistantPlan = z.infer<typeof assistantPlanSchema>;
export type AssistantAnswer = z.infer<typeof assistantAnswerSchema>;
export type AssistantSource = z.infer<typeof assistantSourceSchema>;
export type AssistantTable = z.infer<typeof assistantTableSchema>;
