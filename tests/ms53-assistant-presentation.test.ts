import { describe, expect, it } from 'vitest';
import React from '../apps/admin-portal/node_modules/react';
import { renderToStaticMarkup } from '../apps/admin-portal/node_modules/react-dom/server';
import { assistantAnswerSchema } from '../packages/validation/src/assistantSchema';
import { AssistantAnswerText, assistantLimitation, evidenceLines, readableAssistantTime } from '../packages/ui/src/components/assistantPresentation';

// MS53-TC06/07 / QAD-TC44: real semantic markup over exact canonical spans.
const chunk = '00000000-0000-4000-8000-000000000001';
const quote = '### Customer Check-Out\n**Admin only**\n1\\. Verify booking #42.\n2\\. Do not collect an unapproved fee. Keep `C:\\desk\\42` and PHP 1,000.00.\n<script>alert(1)</script> https://example.test';
const answer = () => assistantAnswerSchema.parse({ kind: 'DOCUMENT', summary: quote, tables: [], citations: [{ document_id: chunk, version_id: chunk, chunk_id: chunk, title: 'SOP', heading_path: 'Check-Out', source_page: 1, epoch: 1, extraction_method: 'TEXT', content_hash: 'a'.repeat(64) }], interpretation: [], as_of: '2026-10-15T06:16:00.861Z', limitations: [], knowledge_epoch: 1, request_id: chunk, evidence_spans: [{ chunk_id: chunk, quote, start: 23, end: 23 + quote.length }], business_timezone: 'Asia/Manila' });
describe('MS53-TC06 safe readable canonical presentation', () => {
  it('renders ordered steps, scope, emphasis and inert payloads without altering evidence', () => {
    const data = answer(), before = JSON.stringify(data);
    const html = renderToStaticMarkup(React.createElement(AssistantAnswerText, { answer: data, text: data.summary }));
    expect(html).toContain('<h3'); expect(html).toContain('Customer Check-Out</h3>');
    expect(html).toContain('<ol'); expect(html.match(/<li /g)).toHaveLength(2);
    expect(html).toContain('<strong>Admin only</strong>');
    expect(html).toContain('booking #42'); expect(html).toContain('<code>C:\\desk\\42</code>');
    expect(html).toContain('PHP 1,000.00'); expect(html).toContain('Do not collect an unapproved fee');
    expect(html).not.toContain('<script>'); expect(html).not.toContain('<a ');
    expect(html).toContain('&lt;script&gt;'); expect(html).not.toContain('1\\.');
    expect(html).toContain('data-source-start="23"'); expect(JSON.stringify(data)).toBe(before);
    for (const line of evidenceLines(quote)) expect(quote.slice(line.start, line.end)).toContain(line.text);
  });
  it('preserves literal code fences, headings inside examples and ordinary hashes/backslashes', () => {
    const data = answer();
    const literal = '```\n### literal\n**literal**\n```\nUse #42 and C:\\logs. Keep \\**literal**.\n\\# Escaped title';
    data.summary = literal; data.evidence_spans = [{ chunk_id: chunk, quote: literal, start: 0, end: literal.length }];
    const html = renderToStaticMarkup(React.createElement(AssistantAnswerText, { answer: data, text: literal }));
    expect(html).toContain('### literal'); expect(html).toContain('**literal**');
    expect(html).toContain('Use #42 and C:\\logs. Keep \\**literal**.'); expect(html).toContain('Escaped title</h3>');
  });
  it('leaves unmapped user/legacy text inert and preserves mixed report narrative', () => {
    expect(renderToStaticMarkup(React.createElement(AssistantAnswerText, { text: "### user supplied" }))).toContain('### user supplied');
    const data = answer(), text = `${quote}\n\nCurrent count: 5`;
    expect(renderToStaticMarkup(React.createElement(AssistantAnswerText, { answer: data, text }))).toContain('Current count: 5');
    expect(assistantAnswerSchema.safeParse({ ...data, evidence_spans: [{ ...data.evidence_spans![0], chunk_id: '00000000-0000-4000-8000-000000000002' }] }).success).toBe(false);
    expect(assistantAnswerSchema.safeParse({ ...data, summary: 'invented' }).success).toBe(false);
  });
});
describe('MS53-TC07 readable metadata', () => {
  it('uses configured business timezone and keeps error meanings distinct', () => {
    expect(readableAssistantTime('2026-10-15T06:16:00.861Z', 'Asia/Manila')).toBe('Oct 15, 2026, 2:16 PM (Asia/Manila)');
    expect(assistantLimitation('INCOMPLETE_EVIDENCE: CONTEXT_BUDGET: Complete procedure unavailable.')).toEqual({ text: 'Complete procedure unavailable.', diagnostic: 'INCOMPLETE_EVIDENCE: CONTEXT_BUDGET' });
    expect(assistantLimitation('CONFLICTING_SOURCES: Published sources disagree.').text).toBe('Published sources disagree.');
    expect(assistantLimitation('Snapshot may be stale.').text).toBe('Snapshot may be stale.');
    expect(assistantAnswerSchema.safeParse({ ...answer(), business_timezone: 'Invalid/Timezone' }).success).toBe(false);
  });
});

