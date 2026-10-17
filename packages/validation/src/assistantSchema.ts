import { z } from 'zod';
// QAD-TC44: a bounded model explanation is not a user-facing clarification.
const focusedClarification = (text: string) => !text.trim() || (text.trim().endsWith('?') && /^(which|what|when|where|who|how|do|does|did|is|are|can|could|would|should|will|please|ano|alin|saan|sino|kailan|paano|puwede|pwede|maaari|pakilinaw)\b/i.test(text.trim()));
import { assistantEvidenceBudget as evidenceBudget } from './assistantEvidenceBudget';

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
// MS55-TC03/08: optional versioned retrieval aids, never evidence or tool policy.
export const assistantQueryUnderstandingSchema = z.object({
  version: z.literal('ms55-v1'), original: z.string().min(1).max(2000),
  standalone: z.string().trim().min(1).max(2000).optional(),
  topic: z.string().trim().min(1).max(120).nullable().optional(),
  alternatives: z.array(z.string().trim().min(1).max(500)).max(2),
}).strict();
export const assistantPlanSchema = z.object({
  kind: z.enum(['DOCUMENT', 'OPERATIONAL', 'REPORT', 'MIXED', 'CLARIFY', 'UNSUPPORTED']),
  query: z.string().max(3000),
  clarification: z.string().max(300).refine(focusedClarification, 'Invalid focused clarification').optional(),
  tools: z.array(assistantToolSchema).max(3),
  // Invalid aids are discarded independently; an invalid tool plan still fails.
  search: z.unknown().optional(),
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
// MS57-TC01/06: each inert answer block is a material claim, mapped to
// request-local exact evidence indexes. No model-authored source identities.
const synthesisBlock = z.object({ kind: z.enum(['text', 'bullet', 'step']), text: z.string().trim().min(1).max(1800),
  support: z.array(z.number().int().min(0).max(127)).min(1).max(128),
}).strict();
const mainBlock = synthesisBlock.extend({ actions: z.array(z.number().int().min(0).max(127)).max(12) }).strict()
  .refine(b => new Set(b.support).size === b.support.length && new Set(b.actions).size === b.actions.length, 'Duplicate mapping');
export const assistantSynthesisSchema = z.object({
  version: z.literal('ms57-v1'),
  scope: z.enum(['FACTUAL', 'MULTI_PART', 'RECOMMENDATION', 'COMPLETE_PROCEDURE', 'DOCUMENT_WIDE']),
  outcome: z.enum(['COMPLETE', 'PARTIAL_GENERAL']),
  blocks: z.array(synthesisBlock.refine(b => new Set(b.support).size === b.support.length, 'Duplicate support')).min(1).max(12),
  // MS60 / QAD-TC44: independently reviewed main prose; exact proof is unchanged.
  main_blocks: z.array(mainBlock).min(1).max(12).optional(),
  gaps: z.array(z.string().trim().min(1).max(200)).max(3),
}).strict().refine(c => c.outcome === 'COMPLETE' ? c.gaps.length === 0 :
  ['FACTUAL', 'MULTI_PART', 'RECOMMENDATION'].includes(c.scope) && c.gaps.length > 0, 'Unsafe synthesis coverage')
  .refine(c => [...c.blocks, ...(c.main_blocks ?? [])].map(b => b.text).join('\n\n').length <= 16000, 'Synthesis budget');
export const assistantSupportVerdictSchema = z.object({
  supported: z.array(z.boolean()).min(1).max(12), complete: z.boolean(), consistent: z.boolean(), evidence_safe: z.boolean(),
}).strict();
export type AssistantSynthesis = z.infer<typeof assistantSynthesisSchema>;
export type AssistantEvidenceSpan = { chunk_id: string; quote: string; start: number; end: number };
// MS59-TC05/17: exact display atoms are separate from packed proof spans.
export const assistantPresentationSchema = z.object({ version: z.literal('ms59-v1'), atoms: z.array(z.object({
  kind: z.enum(['heading', 'text', 'step', 'bullet']), evidence: z.number().int().min(0).max(127),
  start: z.number().int().nonnegative(), end: z.number().int().positive(),
}).strict().refine(a => a.end > a.start, 'Empty atom')).min(1).max(128) }).strict().refine(p => p.atoms.filter(a => a.kind === 'step').length <= 12, 'Action budget');
export const assistantAnswerSchema = z.object({
  // MS58-TC01/02: optional for compatible rollout with existing exact callers.
  outcome: z.enum(['SUPPORTED', 'PARTIAL', 'CLARIFICATION', 'INSUFFICIENT', 'CONFLICT', 'SOURCE_REVIEW', 'LIMIT', 'SERVICE_FAILURE', 'UNSUPPORTED']).optional(),
  kind: assistantPlanSchema.shape.kind, summary: z.string().max(20000),
  tables: z.array(assistantTableSchema).max(12),
  citations: z.array(assistantSourceSchema.omit({ content: true })).max(128),
  interpretation: z.array(z.string().max(1000)).max(30),
  as_of: z.string().datetime(), limitations: z.array(z.string().max(500)).max(30),
  knowledge_epoch: z.number().int().nonnegative(), request_id: id,
  selections: assistantToolSchema.optional(),
  synthesis: assistantSynthesisSchema.optional(),
  presentation: assistantPresentationSchema.optional(),
  answer_mode: z.enum(['EXACT', 'SYNTHESIZED', 'PARTIAL_GENERAL', 'CLARIFICATION', 'EVIDENCE_GAP', 'CONFLICT', 'FAILURE']).optional(),
  synthesis_status: z.enum(['DISABLED', 'NOT_ADMITTED', 'ACCEPTED', 'EXACT_FALLBACK']).optional(),
  // MS53-TC06: exact canonical source offsets, in JavaScript UTF-16 code units.
  evidence_spans: z.array(z.object({ chunk_id: id, quote: z.string().min(1).max(evidenceBudget.quote_utf16), start: z.number().int().nonnegative(), end: z.number().int().positive() }).strict().refine(span => span.end - span.start === span.quote.length, 'Invalid evidence span')).max(128).optional(),
  business_timezone: z.string().max(100).refine(value => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; } }, 'Invalid business timezone').optional(),
}).strict().refine(answer => !answer.evidence_spans?.length || ((answer.synthesis
  ? answer.summary.startsWith((answer.synthesis.main_blocks ?? answer.synthesis.blocks).map(block => block.text).join('\n\n'))
  : answer.summary.startsWith(answer.evidence_spans.map(span => span.quote).join('\n\n'))) && answer.evidence_spans.every(span => answer.citations.some(citation => citation.chunk_id === span.chunk_id))), 'Unmapped evidence presentation')
  .refine(answer => !answer.synthesis || Boolean(answer.evidence_spans?.length && [...answer.synthesis.blocks, ...(answer.synthesis.main_blocks ?? [])].every(block => block.support.every(i => i < answer.evidence_spans!.length))) && ['SYNTHESIZED', 'PARTIAL_GENERAL'].includes(answer.answer_mode ?? ''), 'Unmapped synthesis')
  .refine(answer => !['SYNTHESIZED', 'PARTIAL_GENERAL'].includes(answer.answer_mode ?? '') || Boolean(answer.synthesis), 'Missing generated answer')
  .refine(answer => !answer.synthesis || answer.synthesis_status === undefined || answer.synthesis_status === 'ACCEPTED', 'Unaccepted generated answer')
  .refine(answer => {
    if (!answer.presentation) return true;
    if (answer.synthesis || !answer.evidence_spans?.length) return false;
    let previous = -1, end = 0;
    for (const atom of answer.presentation.atoms) {
      const span = answer.evidence_spans[atom.evidence];
      if (!span || atom.evidence < previous || atom.end > span.quote.length || atom.evidence === previous && atom.start < end) return false;
      previous = atom.evidence; end = atom.end;
    }
    return answer.evidence_spans.every((span, i) => {
      let cursor = 0;
      for (const atom of answer.presentation!.atoms.filter(a => a.evidence === i)) {
        if (span.quote.slice(cursor, atom.start).trim()) return false;
        cursor = atom.end;
      }
      return !span.quote.slice(cursor).trim();
    });
  }, 'Incomplete exact presentation');
export const assistantSearchSchema = z.object({
  vector: z.array(z.number().finite()).length(1024),
}).strict().refine(v => Math.abs(Math.hypot(...v.vector) - 1) < 0.001, 'Expected normalized embedding');
export const assistantEmbeddingBatchSchema = z.object({ embeddings: z.array(assistantSearchSchema).min(1).max(4) }).strict();
export const assistantHybridCandidatesSchema = z.object({
  semantic: z.array(z.array(assistantSourceSchema).max(12)).min(1).max(4),
  lexical: z.array(z.array(assistantSourceSchema).max(12)).min(1).max(4),
}).strict();
export const assistantExtractSchema = z.object({
  quotes: z.array(z.object({ chunk_id: id, quote: z.string().min(1).max(evidenceBudget.quote_utf16) }).strict()).max(evidenceBudget.quotes),
  conflicting_sources: z.boolean().default(false),
}).strict();
export const assistantToolResultSchema = z.object({ tables: z.array(assistantTableSchema).max(4), limitations: z.array(z.string().max(500)).max(10), interpretation: z.array(z.string().max(1000)).max(10) }).strict();
export const assistantEvidenceGroupSchema = z.object({
  id: z.string().max(100), chunk_ids: z.array(id).min(1).max(6),
  requires: z.array(z.string().max(100)).max(6),
}).strict();
export const assistantEvidenceSchema = z.discriminatedUnion('complete', [
  z.object({ complete: z.literal(true), sources: z.array(assistantSourceSchema).max(evidenceBudget.sources), groups: z.array(assistantEvidenceGroupSchema).max(evidenceBudget.sources).optional(), context_sources: z.array(assistantSourceSchema).max(12).optional() }).strict(),
  z.object({ complete: z.literal(false), sources: z.array(assistantSourceSchema).max(0), reason: z.enum(['CONTEXT_BUDGET', 'REPROCESS_REQUIRED', 'UNRESOLVED_CONTEXT']).default('CONTEXT_BUDGET') }).strict(),
]);
export const assistantEvidenceCostsSchema = z.object({ version: z.literal(3), epoch: z.number().int().nonnegative(),
  roots: z.array(z.object({ chunk_id: id, complete: z.boolean(), members: z.array(id).max(1000),
    source_count: z.number().int().nonnegative(), bytes: z.number().int().nonnegative(),
  }).strict()).max(12),
}).strict().refine(c => new Set(c.roots.map(r => r.chunk_id)).size === c.roots.length, 'Duplicate costs');
// MS60-TC08/28: bind canonical packing costs to the exact authenticated payload.
export const assistantPackingCostSchema = z.object({ version: z.literal('ms60-v1'), binding: z.string().regex(/^[a-f0-9]{64}$/),
  quote_count: z.number().int().nonnegative(), max_quote_utf16: z.number().int().nonnegative(), fits: z.boolean(),
  reason: z.literal('OUTPUT_BUDGET_EXCEEDED').nullable(),
}).strict().refine(c => c.fits ? c.reason === null && c.quote_count > 0 && c.quote_count <= evidenceBudget.quotes && c.max_quote_utf16 <= evidenceBudget.quote_utf16 : c.reason !== null, 'Invalid packing admission');
export const assistantSourcesSchema = z.array(assistantSourceSchema).max(evidenceBudget.candidates);
// MS56-TC03/04: legacy selections remain conservative complete-procedure scope.
export const assistantCoverageSchema = z.object({
  scope: z.enum(['FACTUAL', 'MULTI_PART', 'RECOMMENDATION', 'COMPLETE_PROCEDURE', 'DOCUMENT_WIDE']),
  outcome: z.enum(['COMPLETE', 'PARTIAL_GENERAL', 'INSUFFICIENT', 'CONFLICT', 'CLARIFY']),
  gaps: z.array(z.string().trim().min(1).max(200)).max(3),
  clarification: z.string().trim().min(1).max(300).refine(focusedClarification, 'Invalid focused clarification').optional(),
}).strict().refine(c => c.outcome !== 'PARTIAL_GENERAL' || (['FACTUAL', 'MULTI_PART', 'RECOMMENDATION'].includes(c.scope) && c.gaps.length > 0), 'Unsafe partial scope')
  .refine(c => c.outcome !== 'COMPLETE' || c.gaps.length === 0, 'Incomplete coverage')
  .refine(c => c.outcome !== 'CLARIFY' || Boolean(c.clarification), 'Missing focused clarification');
export const assistantObligationSchema = z.object({ id: z.string().regex(/^o[0-2]$/), request: z.string().min(1).max(200),
  kind: z.enum(['FACT', 'AMOUNT', 'PERMISSION', 'PROCEDURE', 'RECOMMENDATION']),
  status: z.enum(['SUPPORTED', 'UNVERIFIED']), chunk_ids: z.array(assistantIdSchema).max(12),
}).strict().refine(o => o.status === 'SUPPORTED' ? o.chunk_ids.length > 0 : o.chunk_ids.length === 0, 'Invalid obligation support');
export type AssistantObligation = z.infer<typeof assistantObligationSchema>;
export const assistantContextSelectionSchema = z.object({
  chunk_ids: z.array(id).max(evidenceBudget.candidates), ambiguous: z.boolean(),
  coverage: assistantCoverageSchema.optional(),
  obligations: z.array(assistantObligationSchema).max(3).optional(),
}).strict().refine(s => new Set(s.chunk_ids).size === s.chunk_ids.length, 'Duplicate support')
  .refine(s => !s.ambiguous || s.chunk_ids.length === 0, 'Ambiguous support')
  .refine(s => !s.coverage || (s.ambiguous === (s.coverage.outcome === 'CLARIFY') &&
    (['COMPLETE', 'PARTIAL_GENERAL'].includes(s.coverage.outcome) ? s.chunk_ids.length > 0 : s.chunk_ids.length === 0)), 'Invalid coverage');
export type AssistantCoverage = z.infer<typeof assistantCoverageSchema>;
export type AssistantQuery = z.infer<typeof assistantQuerySchema>;
export type AssistantTool = z.infer<typeof assistantToolSchema>;
export type AssistantFilters = z.infer<typeof assistantFiltersSchema>;
export type AssistantPlan = z.infer<typeof assistantPlanSchema>;
export type AssistantAnswer = z.infer<typeof assistantAnswerSchema>;
export type AssistantSource = z.infer<typeof assistantSourceSchema>;
export type AssistantTable = z.infer<typeof assistantTableSchema>;

// MS65 / SDD-C20,C21: contract negotiation never silently uses legacy closure.
export const assistantDocumentEvidenceSchema = z.object({
  contract: z.literal('ms65-v1'), epoch: z.number().int().nonnegative(),
  sources: z.array(assistantSourceSchema).min(1).max(1000),
}).strict().refine(v => new Set(v.sources.map(s => s.chunk_id)).size === v.sources.length, 'Duplicate sources');
export const assistantDocumentSupportSchema = z.object({
  contract: z.literal('ms65-v1'), binding: z.string().regex(/^[a-f0-9]{64}$/),
  outcome: z.enum(['COMPLETE', 'INSUFFICIENT', 'CONFLICT', 'CLARIFY']),
  clarification: z.string().min(1).max(300).refine(focusedClarification).nullable(),
  spans: z.array(z.object({chunk_id: id, quote: z.string().min(1).max(evidenceBudget.quote_utf16),
    start: z.number().int().nonnegative(), end: z.number().int().positive(),
  }).strict().refine(s => s.end - s.start === s.quote.length)).max(128),
  synthesis: assistantSynthesisSchema.nullable(),
  counts: z.object({ bundles: z.number().int().min(1).max(24), calls: z.number().int().min(1).max(50), units: z.number().int().min(1).max(1000) }).strict(),
}).strict().refine(v => v.outcome === 'COMPLETE' ? Boolean(v.synthesis && v.spans.length && v.synthesis.blocks.every(b => b.support.every(i => i < v.spans.length)))
  : !v.synthesis && !v.spans.length, 'Invalid document support')
  .refine(v => v.outcome !== 'CLARIFY' || Boolean(v.clarification), 'Missing clarification');
