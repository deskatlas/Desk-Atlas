// MS78-TC10/12/13: document evidence never supplies private permission claims.
import { describe, it, expect, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { projectCustomerBooking } from '@deskatlas/domain';
import { buildVerifiedPolicyAddendum } from '../apps/customer-website/src/server/customer-assistant/verifiedKnowledge';

const quote = 'Cancellation requests must be reviewed through Manage Booking.';
const source = { chunk_id: randomUUID(), document_id: randomUUID(), version_id: randomUUID(),
  title: 'Cancellation', heading_path: 'Cancellation', extraction_method: 'TEXT', source_page: null,
  content: quote, content_hash: createHash('sha256').update(quote).digest('hex'), epoch: 7 };
const facts = projectCustomerBooking({ id: randomUUID(), reference: 'PRIVATE-REF', status: 'CANCELLED',
  channel: 'WEB', start_at: null, end_at: null, workspace: null, assigned: false, checked_in_at: null,
  checked_out_at: null, payment_status: null, reschedule_count: 0, closure_pending: false, timezone: 'Asia/Manila',
  cancellation_cutoff_value: 12, cancellation_cutoff_unit: 'HOURS', reschedule_cutoff_hours: 24,
}, new Date()).facts;

function fixture() {
  const read = vi.fn(async (op: string) => op === 'search' ? [source] : op === 'document' ? { contract: 'ms65-v1', epoch: 7, sources: [source] } : source);
  const model = vi.fn(async (path: string, body: unknown): Promise<unknown> => path === 'embed' ? { vector: [1, ...Array(1023).fill(0)] } : {
    contract: 'ms65-v1', binding: createHash('sha256').update(JSON.stringify(body)).digest('hex'), outcome: 'COMPLETE', clarification: null,
    spans: [{ chunk_id: source.chunk_id, quote, start: 0, end: quote.length }],
    synthesis: { version: 'ms57-v1', scope: 'FACTUAL', outcome: 'COMPLETE', gaps: [], blocks: [{ kind: 'text', text: 'Untrusted generated permission.', support: [0] }] },
    counts: { bundles: 1, calls: 1, units: 1 },
  });
  return { reader: { read }, model, message: 'Can I cancel PRIVATE-REF? Email: private@example.test', epoch: 7,
    minimumSimilarity: 0.5, authorize: vi.fn(async () => undefined) };
}
describe('MS78 policy evidence addendum', () => {
  it('retrieves one bounded batch, rechecks source and emits exact quotes with distinct fact evidence', async () => {
    const input = fixture();
    const result = await buildVerifiedPolicyAddendum(input, facts);
    expect(result.excerpts).toEqual([{ chunk_id: source.chunk_id, quote }]);
    expect(result.citations[0].chunk_id).toBe(source.chunk_id);
    expect(result.limitations[0]).toContain('cannot grant an exception');
    expect(input.reader.read).toHaveBeenCalledTimes(3);
    expect(input.authorize).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(input.model.mock.calls)).not.toMatch(/PRIVATE-REF|private@example|Untrusted generated/);
    expect(facts.cancel).toBe(false);
  });
  it('missing evidence yields a limitation, no claimed policy or inferred permissions', async () => {
    const input = fixture(); input.reader.read.mockResolvedValueOnce([]);
    const result = await buildVerifiedPolicyAddendum(input, facts);
    expect(result.excerpts).toEqual([]); expect(input.model).toHaveBeenCalledTimes(1);
  });
  it('a publication change before emission drops policy evidence', async () => {
    const input = fixture();
    input.reader.read.mockImplementation(async op => op === 'search' ? [source] : op === 'document'
      ? { contract: 'ms65-v1', epoch: 7, sources: [source] } : { ...source, epoch: 8 });
    await expect(buildVerifiedPolicyAddendum(input, facts)).rejects.toThrow('KNOWLEDGE_CHANGED');
  });
  it('invalid proof cannot turn generated policy into a definitive booking permission', async () => {
    const input = fixture();
    input.model.mockResolvedValueOnce({ vector: [1, ...Array(1023).fill(0)] }).mockResolvedValueOnce({ outcome: 'COMPLETE', text: 'Cancellation always allowed' });
    const result = await buildVerifiedPolicyAddendum(input, facts);
    expect(result.excerpts).toEqual([]); expect(result.citations).toEqual([]);
    expect(result.limitations[0]).toContain('Current booking facts remain authoritative');
  });
});
