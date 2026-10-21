// MS78-R03 / SDD-C20-C22: approved policy and exact live facts remain separate evidence.
import { createHash } from 'node:crypto';
import { assistantDocumentEvidenceSchema, assistantSearchSchema, assistantSourceSchema, knowledgeValidation as z,
  type AssistantSource, type PublicCustomerResponse } from '@deskatlas/validation';
import { validateDocumentSupport, validateCustomerFactClaims, type CustomerBookingFacts } from '@deskatlas/domain';

interface PolicyReader {
  read(operation: 'search' | 'document' | 'source', args: Record<string, unknown>): Promise<unknown>;
}
export interface VerifiedPolicyAddendum {
  citations: PublicCustomerResponse['citations'];
  excerpts: Array<{ chunk_id: string; quote: string }>;
  limitations: string[];
}
export interface VerifiedPolicyInput {
  reader: PolicyReader;
  model: (path: string, body: unknown) => Promise<unknown>;
  message: string;
  epoch: number;
  minimumSimilarity: number;
  authorize: () => Promise<void>;
}

function policyQuestion(message: string): string {
  // Raw identifiers and incidental contact data in chat are not retrieval authority
  // and need not enter private-policy model requests.
  const topics = [
    [/cancel/i, 'Explain the customer cancellation policy and cutoff.'],
    [/reschedul/i, 'Explain the customer rescheduling policy and cutoff.'],
    [/refund/i, 'Explain customer refund review procedures without promising approval.'],
    [/payment|proof|review/i, 'Explain payment review and reservation status procedures.'],
    [/check.?in|qr/i, 'Explain customer check-in instructions.'],
    [/relocat|workspace|spot/i, 'Explain customer workspace change and relocation review procedures.'],
  ] as const;
  return topics.filter(([pattern]) => pattern.test(message)).map(([, question]) => question).join(' ') ||
    'Explain customer reservation status and next steps through the existing booking management workflow.';
}

export async function buildVerifiedPolicyAddendum(input: VerifiedPolicyInput, facts: CustomerBookingFacts): Promise<VerifiedPolicyAddendum> {
  const missing = (message: string): VerifiedPolicyAddendum => ({ citations: [], excerpts: [], limitations: [message] });
  if (!Number.isFinite(input.minimumSimilarity) || input.minimumSimilarity < -1 || input.minimumSimilarity > 1) return missing('Approved policy guidance is unavailable.');
  await input.authorize();
  const query = policyQuestion(input.message);
  const vector = assistantSearchSchema.parse(await input.model('embed', { query }));
  let seeds = assistantSourceSchema.array().max(12).parse(await input.reader.read('search', { p_vector: vector.vector, p_min_similarity: input.minimumSimilarity }));
  if (!seeds.length) return missing('No approved policy evidence was found for this reservation question.');
  if (seeds.length > 1) {
    const selection = z.object({ chunk_ids: z.array(z.string().uuid()).max(12) }).strict().parse(await input.model('knowledge-selection', { message: query, sources: seeds }));
    if (new Set(selection.chunk_ids).size !== selection.chunk_ids.length || selection.chunk_ids.some(id => !seeds.some(source => source.chunk_id === id))) throw new Error('INVALID_EVIDENCE');
    seeds = seeds.filter(source => selection.chunk_ids.includes(source.chunk_id));
    if (!seeds.length) return missing('No approved policy evidence was found for this reservation question.');
  }
  const evidence = assistantDocumentEvidenceSchema.parse(await input.reader.read('document', { p_chunks: seeds.map(source => source.chunk_id) }));
  if (evidence.epoch !== input.epoch || evidence.sources.some(source => source.epoch !== input.epoch ||
    createHash('sha256').update(source.content).digest('hex') !== source.content_hash)) throw new Error('KNOWLEDGE_CHANGED');
  const sources: AssistantSource[] = evidence.sources;
  const payload = { contract: 'ms65-v1', synthesis: false, query, sources };
  if (Buffer.byteLength(JSON.stringify(payload)) > 260000) return missing('Please narrow the policy question to view complete approved guidance.');
  const proof = validateDocumentSupport(await input.model('document-support', payload), createHash('sha256').update(JSON.stringify(payload)).digest('hex'), sources);
  if (!proof || proof.outcome !== 'COMPLETE' || !proof.spans.length) return missing('Approved policy evidence does not establish a complete consistent explanation. Current booking facts remain authoritative.');
  // The text that accompanies live facts is exact source text, never generated eligibility.
  const selected = proof.spans.slice(0, 6);
  if (selected.length !== proof.spans.length || selected.some(span => span.quote.length > 1500 || /https?:\/\/|<\/?\w|\]\(/i.test(span.quote))) return missing('Please narrow the policy question to safely view complete approved guidance.');
  const used = new Set(selected.map(span => span.chunk_id));
  const citations: PublicCustomerResponse['citations'] = [];
  for (const source of sources.filter(source => used.has(source.chunk_id))) {
    const current = assistantSourceSchema.parse(await input.reader.read('source', { p_version: source.version_id, p_chunk: source.chunk_id }));
    if (current.epoch !== input.epoch || current.content_hash !== source.content_hash || current.content !== source.content) throw new Error('KNOWLEDGE_CHANGED');
    const { content: _content, ...citation } = current; citations.push(citation);
  }
  // These server-selected typed claims are independent of policy quote claims.
  if (!validateCustomerFactClaims(Object.entries(facts).map(([handle, value]) => ({ handle, value })), facts)) throw new Error('INVALID_BOOKING_EVIDENCE');
  await input.authorize();
  return { citations, excerpts: selected.map(span => ({ chunk_id: span.chunk_id, quote: span.quote })),
    limitations: ['Policy excerpts are general guidance. Current booking eligibility and settings above determine available review actions; excerpts cannot grant an exception.'] };
}
