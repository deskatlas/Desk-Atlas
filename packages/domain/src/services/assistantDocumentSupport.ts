import { assistantDocumentSupportSchema, type AssistantSource } from '@deskatlas/validation';

// MS65 / SDD-C21 / QAD-TC44: mechanical checks remain independent of inference.
export function validateDocumentSupport(value: unknown, binding: string, sources: AssistantSource[], contract: 'ms65-v1' | 'ragfix-prepared-v2' = 'ms65-v1') {
  const parsed = assistantDocumentSupportSchema.safeParse(value);
  if (!parsed.success || parsed.data.contract !== contract || parsed.data.binding !== binding) return undefined;
  if (sources.some(source => /ignore\s+(?:all\s+|previous\s+)?instructions|reveal\s+(?:secret|credentials)|execute\s+sql|fetch\s+https?:\/\/|bypass\s+permissions/i.test(source.content))) return undefined;
  const result = parsed.data;
  const cursors = new Map<string, number>();
  for (const span of result.spans) {
    const source = sources.find(s => s.chunk_id === span.chunk_id);
    if (!source || source.content.slice(span.start, span.end) !== span.quote || span.start < (cursors.get(span.chunk_id) ?? 0)) return undefined;
    cursors.set(span.chunk_id, span.end);
  }
  if (result.synthesis) {
    const referenced = new Set(result.synthesis.blocks.flatMap(b => b.support));
    if (referenced.size !== result.spans.length) return undefined;
    if (result.synthesis.blocks.some(block => /https?:\/\/|<\/?\w|\]\(/i.test(block.text))) return undefined;
  }
  return result;
}
