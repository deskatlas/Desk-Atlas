import type { AssistantAnswer } from '@deskatlas/validation';

// MS58-TC01/02: document outcomes do not discard independently verified tables.
export function assistantOutcome(answer: Pick<AssistantAnswer, 'kind' | 'citations' | 'limitations'>) {
  const codes = answer.limitations.map(line => line.split(':', 1)[0]);
  if (codes.some(code => ['DATA_UNAVAILABLE', 'MODEL_UNAVAILABLE', 'MODEL_TIMEOUT', 'REQUEST_TIMEOUT', 'INVALID_MODEL_OUTPUT', 'CAPACITY_BUSY', 'KNOWLEDGE_CHANGED'].includes(code))) return 'SERVICE_FAILURE' as const;
  if (codes.includes('AMBIGUOUS_SCOPE') || answer.kind === 'CLARIFY') return 'CLARIFICATION' as const;
  if (codes.includes('CONFLICTING_SOURCES')) return 'CONFLICT' as const;
  if (codes.includes('INCOMPLETE_CONTEXT')) return 'SOURCE_REVIEW' as const;
  if (codes.includes('INCOMPLETE_EVIDENCE')) return 'LIMIT' as const;
  if (answer.kind === 'UNSUPPORTED') return 'UNSUPPORTED' as const;
  if (codes.includes('PARTIAL_GENERAL') && answer.citations.length) return 'PARTIAL' as const;
  if (codes.includes('NO_RELEVANT_SOURCE')) return 'INSUFFICIENT' as const;
  return 'SUPPORTED' as const;
}
