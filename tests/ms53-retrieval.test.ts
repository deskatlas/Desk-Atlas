import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { assistantRetrievalQuery, proceduralDocumentPlan, selectProcedureSeed, selectFaqSeed } from '@deskatlas/domain';
import { groundedQuotes } from '../apps/admin-portal/src/server/assistant/gateway';

// MS53-TC01/02/03/04: routing is retrieval-only; complete exact source coverage.
describe('MS44 exact published FAQ selection', () => {
  const question = 'Where should safety incidents be reported?';
  const heading = `SOP / FAQ: Safety / Q7. ${question}`;
  const source = { chunk_id: randomUUID(), heading_path: heading, content: `${heading}\n\nReport incidents to management.` };
  it('selects a literal published question across topics without hardcoded answers', () => {
    expect(selectFaqSeed(question.toUpperCase(), [source])).toBe(source.chunk_id);
    expect(selectFaqSeed(question.slice(0, -1), [source])).toBe(source.chunk_id);
  });
  it('defers qualifiers, missing answer text, duplicate questions and non-FAQ headings', () => {
    expect(selectFaqSeed('Where should safety incidents be reported tomorrow?', [source])).toBeUndefined();
    expect(selectFaqSeed(question, [source, { ...source, chunk_id: randomUUID() }])).toBeUndefined();
    expect(selectFaqSeed(question, [{ ...source, content: heading }])).toBeUndefined();
    expect(selectFaqSeed(question, [{ ...source, content: 'Unbound text.' }])).toBeUndefined();
    expect(selectFaqSeed(question, [{ ...source, heading_path: `SOP / Q7. ${question}` }])).toBeUndefined();
  });
  it('matches ordered inflections and phrasing while retaining role, negation and condition changes', () => {
    const leaf = 'Can employees suggest improvements to the SOP?';
    const path = `SOP / FAQ: Review / Q8. ${leaf}`;
    const item = { chunk_id: randomUUID(), heading_path: path, content: `${path}\n\nEmployees submit suggestions to management for review.` };
    expect(selectFaqSeed('What should employees do if they have suggestions for improving the SOP?', [item])).toBe(item.chunk_id);
    expect(selectFaqSeed('Can employees not suggest improvements to the SOP?', [item])).toBeUndefined();
    expect(selectFaqSeed('Can employees suggest improvements without management approval?', [item])).toBeUndefined();
    expect(selectFaqSeed('Can managers suggest improvements to the SOP?', [item])).toBeUndefined();
    expect(selectFaqSeed('Can employees suggest improvements to the SOP tomorrow?', [item])).toBeUndefined();
    expect(selectFaqSeed('Can employees suggest improvements to the SOP 取消?', [item])).toBeUndefined();
    const roles = 'Can managers approve employee requests?';
    const rolePath = `SOP / FAQ: Approval / Q9. ${roles}`;
    expect(selectFaqSeed('Can employees approve manager requests?', [{ ...item, heading_path: rolePath, content: `${rolePath}\n\nOnly managers approve these requests.` }])).toBeUndefined();
  });
  it('keeps all retrieved competing permissions on the normal conflict path', () => {
    const permission = 'Can staff approve online payment proofs?';
    const path = `SOP / FAQ: Approval / Q9. ${permission}`;
    const allowed = { chunk_id: randomUUID(), heading_path: path, content: `${path}\n\nStaff may approve online payment proofs.` };
    const forbidden = { chunk_id: randomUUID(), heading_path: 'Restrictions', content: 'Only administrators may approve online payment proofs.' };
    expect(selectFaqSeed(permission, [allowed, forbidden])).toBeUndefined();
  });
});

describe('MS53 natural task routing', () => {
  it.each(['how do i checkout a customer', 'How do I check out a customer?', 'What should I do when a customer leaves?',
    "Steps to finish a customer's workspace session", 'Paano mag-check out ng customer?', 'Customer is leaving, paano ang checkout?'])('recognizes standalone procedure %s', message => {
    expect(proceduralDocumentPlan(message)).toEqual({ kind: 'DOCUMENT', query: message, tools: [] });
  });
  it.each(['Checkout this customer now', 'How do I checkout a customer early?', 'How do I checkout a customer with an unpaid balance?',
    'How do I use online payment checkout?', 'How do I checkout a customer and show revenue?', 'What about that?'])('defers material competing intent %s', message => {
    expect(proceduralDocumentPlan(message)).toBeUndefined();
  });
  it('normalizes ordinary task spelling without changing identifiers or negation', () => {
    expect(assistantRetrievalQuery('  Do NOT checkout Juan on 2026-10-15; booking AB-123  ')).toBe('Do NOT check out Juan on 2026-10-15; booking AB-123');
    expect(assistantRetrievalQuery('Check-Out and checkin')).toBe('check out and check in');
  });
  it('recognizes a fully specified task/numbered heading after a previous failed question, but not a true follow-up', () => {
    const context = { user_turns: ['how do i checkout a customer'] };
    for (const message of ['how do i checkout a customer', 'what is 4.2. Customer Check-Out']) expect(proceduralDocumentPlan(message, context)).toEqual({ kind: 'DOCUMENT', query: message, tools: [] });
    expect(proceduralDocumentPlan('What about that?', context)).toBeUndefined();
    expect(proceduralDocumentPlan('what is 4.2. Customer Check-Out', { ...context, selections: {} })).toBeUndefined();
  });
  it('selects a unique task heading only with independent numbered body corroboration', () => {
    const source = { chunk_id: randomUUID(), heading_path: 'SOP / 4.2. Customer Check-Out', content: '1. Verify the customer reservation.\n2. Record check-out when the customer leaves.' };
    expect(selectProcedureSeed('how do i checkout a customer', [source])).toBe(source.chunk_id);
    expect(selectProcedureSeed('what is 4.2. Customer Check-Out', [source])).toBe(source.chunk_id);
    expect(selectProcedureSeed('how do i checkout a customer early', [source])).toBeUndefined();
    expect(selectProcedureSeed('how do i checkout a customer with an unpaid balance', [source])).toBeUndefined();
    expect(selectProcedureSeed('how do i checkout a customer', [source, { ...source, chunk_id: randomUUID() }])).toBeUndefined();
    expect(selectProcedureSeed('how do i checkout a customer', [source, { ...source, chunk_id: randomUUID(), content: 'Continuation of customer check-out.' }])).toBeUndefined();
    expect(selectProcedureSeed('how do i checkout a customer', [{ ...source, content: '1. Clean the room.\n2. Close the door.' }])).toBeUndefined();
    expect(selectProcedureSeed('how do i checkout a customer', [{ ...source, heading_path: 'Early Customer Check-Out' }])).toBeUndefined();
    expect(selectProcedureSeed('how do i checkout a customer', [{ ...source, content: '```\n' + source.content + '\n```' }])).toBeUndefined();
  });
});

describe('MS53 independently verified quotation spans', () => {
  const make = (content: string) => ({ document_id: randomUUID(), version_id: randomUUID(), chunk_id: randomUUID(), title: 'Synthetic SOP',
    heading_path: 'Customer checkout', source_page: null, epoch: 1, extraction_method: 'TEXT', content_hash: 'a'.repeat(64), content });
  it('accepts a complete list across exact quote boundaries and maps canonical offsets', () => {
    const steps = Array.from({ length: 8 }, (_, i) => `${i + 1}\\. Perform supported task ${i + 1}.`);
    steps[2] += ' Do not charge automatic overtime or collect unapproved fees.';
    steps[3] += ' Collect outstanding payments only when applicable.';
    const source = make(steps.join('\r\n'));
    const quotes = [steps.slice(0,4).join('\r\n'), steps.slice(4).join('\r\n')].map(quote => ({ chunk_id: source.chunk_id, quote }));
    const groups = [{ id: 'checkout', chunk_ids: [source.chunk_id], requires: [] }];
    const result = groundedQuotes({ quotes }, [source], 'Checkout steps?', groups);
    expect(result.sources).toHaveLength(1);
    expect(result.evidence_spans).toHaveLength(2);
    for (const span of result.evidence_spans ?? []) expect(source.content.slice(span.start,span.end)).toBe(span.quote);
    expect(result.summary).toContain(steps[7]);
    expect(groundedQuotes({ quotes: [quotes[0]] }, [source], 'Checkout steps?', groups).summary).toBe('');
    const omittedRestriction = quotes[0].quote.replace(' Do not charge automatic overtime or collect unapproved fees.', '');
    expect(groundedQuotes({ quotes: [{ ...quotes[0], quote: omittedRestriction }, quotes[1]] }, [source], 'Checkout steps?', groups).summary).toBe('');
  });
  it('withholds structural rendering for quotes cut across a fenced literal', () => {
    const source = make('```text\n# Literal heading\n\nLiteral continuation\n```');
    const quotes = ['```text\n# Literal heading', 'Literal continuation\n```'].map(quote => ({ chunk_id: source.chunk_id, quote }));
    const result = groundedQuotes({ quotes }, [source], 'Example?', [{ id: 'example', chunk_ids: [source.chunk_id], requires: [] }]);
    expect(result.summary).toBe(quotes.map(q => q.quote).join('\n\n'));
    expect(result.evidence_spans).toBeUndefined();
  });
});
