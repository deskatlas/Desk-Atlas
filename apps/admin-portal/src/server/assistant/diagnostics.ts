import { createHash } from 'node:crypto';

// MS54-TC01/04/05/08 / SDD-C20: request-local metadata, never messages or source text.
export const diagnosticStages = ['validate', 'auth', 'settings', 'catalog', 'plan', 'embed', 'retrieve', 'tools', 'answer', 'evidence', 'serialize', 'context', 'expand', 'grounding', 'synthesis', 'support', 'fallback'] as const;
export type DiagnosticStage = typeof diagnosticStages[number];
const reasons = {
  SELECTION_OVERFLOW: 'overflow', SELECTION_EXHAUSTED: 'overflow',
  UNSUPPORTED: 'out_of_scope', AMBIGUOUS_SCOPE: 'clarification_required', CLARIFY: 'clarification_required',
  NO_RELEVANT_SOURCE: 'evidence_gap', CONFLICTING_SOURCES: 'conflicting_sources',
  REPROCESS_REQUIRED: 'unresolved_context', UNRESOLVED_CONTEXT: 'unresolved_context', INCOMPLETE_CONTEXT: 'unresolved_context',
  CONTEXT_BUDGET: 'overflow', CONTEXT_BUDGET_EXCEEDED: 'overflow', OUTPUT_BUDGET_EXCEEDED: 'overflow', INCOMPLETE_EVIDENCE: 'overflow',
  INVALID_MODEL_OUTPUT: 'invalid_model_output', INVALID_PLAN: 'invalid_model_output', INVALID_SELECTION: 'invalid_model_output',
  INVALID_QUOTES: 'verification_failure', INCOMPLETE_COVERAGE: 'verification_failure', INVALID_GROUPS: 'verification_failure',
  INJECTION_REJECTED: 'verification_failure', INVALID_SOURCE_QUOTE: 'verification_failure',
  MODEL_UNAVAILABLE: 'service_failure', DATA_UNAVAILABLE: 'service_failure', INVALID_REQUEST: 'service_failure',
  MODEL_TIMEOUT: 'timeout_capacity', REQUEST_TIMEOUT: 'timeout_capacity', REQUEST_CANCELLED: 'timeout_capacity', CAPACITY_BUSY: 'timeout_capacity',
  KNOWLEDGE_CHANGED: 'knowledge_identity_change', FORBIDDEN: 'knowledge_identity_change', AUTH_REQUIRED: 'knowledge_identity_change',
} as const;
export type DiagnosticReason = keyof typeof reasons;
const metrics = ['aggregate_model_bytes', 'aggregate_output_reserved', 'bundle_count', 'support_passes', 'support_units', 'support_claims', 'support_accepted', 'support_complete', 'support_consistent', 'support_evidence_safe', 'packed_quote_count', 'max_quote_utf16', 'first_union_count', 'final_union_count', 'requested_count', 'supported_count', 'selection_attempts', 'expansion_attempts', 'context_source_count', 'candidate_count', 'selected_count', 'closure_count', 'group_count', 'evidence_bytes', 'selection_bytes', 'model_request_bytes', 'model_response_bytes', 'epoch', 'shortcut', 'system_bytes', 'serialized_model_bytes', 'context_tokens', 'output_budget', 'template_headroom'] as const;
type Metric = typeof metrics[number] | 'evidence_packed' | 'evidence_supported' | 'plan_invalid_filters' | 'plan_invalid_clarification';
export class AssistantDiagnostics {
  private authorized = false;
  private stage: DiagnosticStage = 'auth';
  private failures: { stage: DiagnosticStage; reason: DiagnosticReason; category: string }[] = [];
  private counts: Partial<Record<Metric, number>> = {};
  private ranked: string[] = [];
  private closure: string[] = [];
  private fallbackReason?: 'DISABLED' | 'TRANSLATION_GATED' | 'BUDGET_NOT_ADMITTED' | 'PROCEDURE_EXACT' | 'SCHEMA_REJECTED' | 'SUPPORT_SCHEMA_REJECTED' | 'SUPPORT_REJECTED' | 'TIMEOUT' | 'SERVICE_FAILURE';
  private fallbackStage?: 'ADMISSION' | 'SYNTHESIS' | 'SUPPORT';
  private exactPresentation?: { status: 'STRUCTURAL_ONLY' | 'ORIGINAL_EXACT'; omitted_atoms: number; visible_atoms: number; acceptance: 'PENDING' };
  exact(status: 'STRUCTURAL_ONLY' | 'ORIGINAL_EXACT', omitted: number, visible: number): void {
    this.exactPresentation = { status, omitted_atoms: omitted, visible_atoms: visible, acceptance: 'PENDING' };
  }
  fallback(reason: NonNullable<AssistantDiagnostics['fallbackReason']>, stage: NonNullable<AssistantDiagnostics['fallbackStage']> = 'ADMISSION'): void {
    this.fallbackReason = reason; this.fallbackStage = stage;
  }
  constructor(private readonly enabled: boolean, private readonly schemaVersion: 1 | 2 = 1) {}
  authorize(): void { this.authorized = true; }
  enter(stage: DiagnosticStage): void { this.stage = stage; }
  count(key: Metric, value: number): void {
    if (Number.isSafeInteger(value) && value >= 0) this.counts[key] = value;
  }
  units(kind: 'ranked' | 'closure', ids: string[]): void {
    this[kind] = ids.slice(0, this.schemaVersion === 2 ? kind === 'closure' ? 128 : 12 : 6).map(id => createHash('sha256').update(id).digest('hex'));
  }
  fail(reason: DiagnosticReason, stage: DiagnosticStage = this.stage): void {
    // Unknown runtime strings cannot be reflected even if a caller violates the type.
    if (Object.hasOwn(reasons, reason) && this.failures.length < 12) this.failures.push({ stage, reason, category: reasons[reason] });
  }
  error(error: unknown, stage: DiagnosticStage = this.stage): void {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
    this.fail(typeof code === 'string' && Object.hasOwn(reasons, code) ? code as DiagnosticReason : 'DATA_UNAVAILABLE', stage);
  }
  finish(response: Response): Response {
    if (this.enabled && this.authorized) response.headers.set('X-RAG-Diagnostics', JSON.stringify({
      schema_version: this.schemaVersion, stage: this.stage, failures: this.failures, counts: this.counts,
      ranked_units: this.ranked, closure_units: this.closure, ...(this.fallbackReason ? { fallback_reason: this.fallbackReason, fallback_stage: this.fallbackStage } : {}),
      ...(this.exactPresentation ? { exact_presentation: this.exactPresentation } : {}),
    }));
    return response;
  }
}
