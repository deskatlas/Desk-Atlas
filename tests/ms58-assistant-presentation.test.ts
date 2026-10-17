import { describe, expect, it, vi } from 'vitest';
// Shared UI resolves React outside the app in this workspace. SSR must use
// the same installed React instance as the app's renderer.
vi.mock('react', async () => vi.importActual('../apps/admin-portal/node_modules/react'));
import React from '../apps/admin-portal/node_modules/react';
import { renderToStaticMarkup } from '../apps/admin-portal/node_modules/react-dom/server';
import { assistantAnswerSchema } from '../packages/validation/src/assistantSchema';
import { assistantOutcome } from '../packages/domain/src/services/assistantOutcome';
import { AssistantAnswerText } from '../packages/ui/src/components/assistantPresentation';
import { AssistantPanel } from '../packages/ui/src/components/AssistantPanel';

const id = '00000000-0000-4000-8000-000000000001';
const quote = 'Use "Review". Do not charge PHP 1,000.00 without approval.';
const citation = { document_id: id, version_id: id, chunk_id: id, title: 'Operations', heading_path: 'Parent / Child', source_page: 2, epoch: 1, extraction_method: 'TEXT', content_hash: 'a'.repeat(64) };
const base = { kind: 'DOCUMENT' as const, summary: quote, tables: [], citations: [citation], interpretation: [], as_of: '2026-10-15T06:16:00.861Z', limitations: [], knowledge_epoch: 1, request_id: id, evidence_spans: [{ chunk_id: id, quote, start: 0, end: quote.length }] };

describe('MS58-TC01/02/03 distinct helpful outcomes', () => {
  it.each([
    ['PARTIAL_GENERAL: Price not verified.', 'PARTIAL'],
    ['AMBIGUOUS_SCOPE: Choose normal or early checkout.', 'CLARIFICATION'],
    ['NO_RELEVANT_SOURCE: This point was not verified.', 'INSUFFICIENT'],
    ['CONFLICTING_SOURCES: Rules disagree.', 'CONFLICT'],
    ['INCOMPLETE_CONTEXT: REPROCESS_REQUIRED: Review replacement.', 'SOURCE_REVIEW'],
    ['INCOMPLETE_EVIDENCE: CONTEXT_BUDGET: Evidence too large.', 'LIMIT'],
    ['MODEL_TIMEOUT: Please retry.', 'SERVICE_FAILURE'],
  ])('%s has outcome %s', (limitation, expected) => {
    expect(assistantOutcome({ ...base, limitations: [limitation] })).toBe(expected);
  });
  it('service failures take precedence over evidence gaps and never discard tool tables', () => {
    expect(assistantOutcome({ ...base, limitations: ['MODEL_UNAVAILABLE: Retry.', 'NO_RELEVANT_SOURCE: No answer.'] })).toBe('SERVICE_FAILURE');
    expect(assistantOutcome({ ...base, kind: 'UNSUPPORTED' })).toBe('UNSUPPORTED');
  });
});

describe('MS58-TC01/04/05/10 safe accepted presentation', () => {
  it('groups generated steps and bullets semantically and separates exact evidence', () => {
    const blocks = [
      { kind: 'text' as const, text: '\\# Summary\n**Admin only**: Use `Review`.', support: [0] },
      { kind: 'step' as const, text: 'Keep the condition: no fee without approval.', support: [0] },
      { kind: 'step' as const, text: 'Keep PHP 1,000.00.', support: [0] },
      { kind: 'bullet' as const, text: '<script>alert(1)</script>', support: [0] },
      { kind: 'bullet' as const, text: 'https://untrusted.test', support: [0] },
    ];
    const answer = assistantAnswerSchema.parse({ ...base, summary: blocks.map(b => b.text).join('\n\n'), answer_mode: 'SYNTHESIZED', synthesis_status: 'ACCEPTED', synthesis: { version: 'ms57-v1', scope: 'MULTI_PART', outcome: 'COMPLETE', blocks, gaps: [] } });
    const before = JSON.stringify(answer);
    const html = renderToStaticMarkup(React.createElement(AssistantAnswerText, { answer, text: answer.summary }));
    expect(html.match(/<ol /g)).toHaveLength(1);
    expect(html.match(/<ul /g)).toHaveLength(1);
    expect(html).toContain('value="2"');
    expect(html).toContain('<strong>Admin only</strong>');
    expect(html).toContain('<code>Review</code>');
    expect(html).toContain('Evidence-based summary');
    expect(html).not.toContain('\\# Summary');
    expect(html).toContain('Exact supporting evidence');
    expect(html).toContain('data-source-start="0"');
    expect(html).not.toContain('<script>'); expect(html).not.toContain('<a ');
    expect(JSON.stringify(answer)).toBe(before);
  });
  it.each(['ADMIN', 'STAFF'] as const)('preserves %s tables when document answering fails and shows a separate unavailable citation', role => {
    const answer = assistantAnswerSchema.parse({ ...base, citations: [], evidence_spans: [], outcome: 'SERVICE_FAILURE', summary: 'Document service unavailable.', limitations: ['MODEL_TIMEOUT: Retry shortly.'], tables: [{ title: 'Current occupancy', columns: ['Count'], rows: [[5]] }] });
    const html = renderToStaticMarkup(React.createElement(AssistantPanel, { role, messages: [{ id, role: 'assistant', text: answer.summary, answer }], value: '', busy: false, status: '', error: '', sourceError: 'This published source is no longer available.', onValue() {}, onSubmit() {}, onRetry() {}, onClose() {}, onSource() {}, onDismissSource() {} }));
    expect(html).toContain('Current occupancy'); expect(html).toContain('>5</td>');
    expect(html).toContain('aria-label="Source unavailable"');
    expect(html).not.toContain('Published source excerpt');
    expect(html).toContain('Service unavailable; please retry');
  });
  it('keeps original evidence visible in flag-off exact mode', () => {
    const answer = assistantAnswerSchema.parse({ ...base, answer_mode: 'EXACT', synthesis_status: 'DISABLED' });
    const html = renderToStaticMarkup(React.createElement(AssistantAnswerText, { answer, text: answer.summary }));
    expect(html).toContain('Do not charge PHP 1,000.00');
    expect(html).not.toContain('Evidence-based summary');
  });
  it('rejects a generated payload marked as rejected or disabled', () => {
    const synthesis = { version: 'ms57-v1', scope: 'FACTUAL', outcome: 'COMPLETE', blocks: [{ kind: 'text', text: quote, support: [0] }], gaps: [] };
    for (const synthesis_status of ['DISABLED', 'NOT_ADMITTED', 'EXACT_FALLBACK']) {
      expect(assistantAnswerSchema.safeParse({ ...base, synthesis, answer_mode: 'SYNTHESIZED', synthesis_status }).success).toBe(false);
    }
  });
  it('preserves formatting punctuation inside quoted UI labels', () => {
    const quote = 'Choose "**Approve**" or "__Review__". Keep `C:\\desk\\42`.';
    const answer = assistantAnswerSchema.parse({ ...base, summary: quote, evidence_spans: [{ chunk_id: id, quote, start: 0, end: quote.length }] });
    const html = renderToStaticMarkup(React.createElement(AssistantAnswerText, { answer, text: quote }));
    expect(html).toContain('&quot;**Approve**&quot;');
    expect(html).toContain('&quot;__Review__&quot;');
    expect(html).not.toContain('<strong>Approve');
    expect(html).toContain('<code>C:\\desk\\42</code>');
  });
});
