import { expect, it } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import { renderToStaticMarkup } from '../apps/admin-portal/node_modules/react-dom/server';
import React from '../apps/admin-portal/node_modules/react';
import { validateAssistantSynthesis, assistantSynthesisSupported } from '../packages/domain/src/services/assistantSynthesis';
import { assistantSynthesisSchema, assistantAnswerSchema, type AssistantCoverage } from '../packages/validation/src/assistantSchema';
import { AssistantAnswerText } from '../packages/ui/src/components/assistantPresentation';

// MS57-TC01..10 / QAD-TC44: mechanical invariants and inert presentation.
const content = '😀 Rooms have desks. Rooms are not soundproof. Use "Review" within 30 minutes.';
const source = { document_id: randomUUID(), version_id: randomUUID(), chunk_id: randomUUID(), title: 'Rooms', heading_path: '',
  source_page: null, epoch: 1, extraction_method: 'TEXT', content_hash: createHash('sha256').update(content).digest('hex'), content };
const spans = [{ chunk_id: source.chunk_id, quote: content.slice(3), start: 3, end: content.length }];
const coverage: AssistantCoverage = { scope: 'FACTUAL', outcome: 'COMPLETE', gaps: [] };
const candidate = (text = 'The rooms provide desks, but they are not soundproof. Use "Review" within 30 minutes.') => ({
  version: 'ms57-v1' as const, scope: coverage.scope, outcome: 'COMPLETE' as const, gaps: [],
  blocks: [{ kind: 'text' as const, text, support: [0] }],
});
it('MS57-TC01 accepts a mapped paraphrase only with a separate complete support verdict', () => {
  const checked = validateAssistantSynthesis(candidate(), coverage, spans, [source])!;
  expect(checked).toBeDefined();
  expect(assistantSynthesisSupported({ supported: [true], complete: true, consistent: true, evidence_safe: true }, checked)).toBe(true);
  for (const verdict of [{ supported: [false], complete: true, consistent: true, evidence_safe: true }, { supported: [true], complete: false, consistent: true, evidence_safe: true },
    { supported: [true], complete: true, consistent: false, evidence_safe: true }, { supported: [true, true], complete: true, consistent: true, evidence_safe: true }, { supported: true }])
    expect(assistantSynthesisSupported(verdict, checked)).toBe(false);
});
it('QAD-TC44 duplicate factual prose merges every support index without trimming proof', () => {
  const value = candidate();
  const checked = validateAssistantSynthesis({ ...value, blocks: [value.blocks[0], { ...value.blocks[0], support: [1] }] }, coverage, [...spans, ...spans], [source]);
  expect(checked?.blocks).toHaveLength(1);
  expect(checked?.blocks[0].support).toEqual([0, 1]);
});
it.each(['Rooms are soundproof.', 'Rooms are not soundproof and cost 100 pesos.', 'Rooms are not soundproof. Use "Approve".',
  'Rooms are not soundproof. Use "Review" within 30 hours.', 'Staff may approve rooms that are not soundproof.',
  'Rooms are not soundproof. https://example.org', '<script>not safe</script>'])('MS57-TC04/06 rejects changed fidelity: %s', text => {
  expect(validateAssistantSynthesis(candidate(text), coverage, spans, [source])).toBeUndefined();
});
it('MS57-TC06 rejects fabricated indexes, duplicate indexes and mixed code-point offsets', () => {
  expect(validateAssistantSynthesis({ ...candidate(), blocks: [{ ...candidate().blocks[0], support: [1] }] }, coverage, spans, [source])).toBeUndefined();
  expect(validateAssistantSynthesis({ ...candidate(), blocks: [{ ...candidate().blocks[0], support: [0, 0] }] }, coverage, spans, [source])).toBeUndefined();
  expect(validateAssistantSynthesis(candidate(), coverage, [{ ...spans[0], start: 2 }], [source])).toBeUndefined();
});
it('MS57-TC02 partial answers keep exactly the verified gaps; partial procedures are invalid', () => {
  const partial = { ...coverage, scope: 'MULTI_PART' as const, outcome: 'PARTIAL_GENERAL' as const, gaps: ['Room price'] };
  expect(validateAssistantSynthesis({ ...candidate(), ...partial }, partial, spans, [source])).toBeDefined();
  expect(validateAssistantSynthesis({ ...candidate(), ...partial, gaps: ['Different gap'] }, partial, spans, [source])).toBeUndefined();
  expect(assistantSynthesisSchema.safeParse({ ...candidate(), ...partial, scope: 'COMPLETE_PROCEDURE' }).success).toBe(false);
});
it('MS57-TC03 preserves every exact procedure unit in order', () => {
  const procedure: AssistantCoverage = { scope: 'COMPLETE_PROCEDURE', outcome: 'COMPLETE', gaps: [] };
  const s = ['Rooms have desks.', 'Rooms are not soundproof.'].map(quote => ({ chunk_id: source.chunk_id, quote,
    start: content.indexOf(quote), end: content.indexOf(quote) + quote.length }));
  const good = { ...candidate(), scope: procedure.scope, blocks: s.map((span, i) => ({ kind: 'step', text: span.quote, support: [i] })) };
  expect(validateAssistantSynthesis(good, procedure, s, [source])).toBeDefined();
  expect(validateAssistantSynthesis({ ...good, blocks: [...good.blocks].reverse() }, procedure, s, [source])).toBeUndefined();
  expect(validateAssistantSynthesis({ ...good, blocks: good.blocks.slice(0, 1) }, procedure, s, [source])).toBeUndefined();
});
it.each(['May desks ang rooms pero hindi soundproof.', 'The rooms have desks pero hindi soundproof.'])('MS57-TC10 keeps translated prose separate from original evidence: %s', text => {
  expect(validateAssistantSynthesis(candidate(text), coverage, spans, [source])).toBeDefined();
});
it('MS57-TC06/13 renders prose separately from unchanged evidence with no executable markup', () => {
  const synthesis = candidate('Rooms are not soundproof.');
  const { content: _content, ...citation } = source;
  const answer = assistantAnswerSchema.parse({ kind: 'DOCUMENT', summary: synthesis.blocks[0].text, tables: [],
    citations: [citation], interpretation: [], as_of: new Date().toISOString(), limitations: [], knowledge_epoch: 1,
    request_id: randomUUID(), evidence_spans: spans, synthesis, answer_mode: 'SYNTHESIZED' });
  const html = renderToStaticMarkup(React.createElement(AssistantAnswerText, { answer, text: answer.summary }));
  expect(html).toContain('Exact supporting evidence');
  expect(html).toContain('data-answer-block');
  expect(html).toContain('data-source-start="3"');
  expect(assistantAnswerSchema.safeParse({ ...answer, synthesis: undefined }).success).toBe(false);
});
