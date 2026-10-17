'use client';
import React, { useCallback, useState } from 'react';
import { AssistantPanel, type AssistantMessage } from '../../packages/ui/src/components/AssistantPanel';

// MS58-TC01/04/05: synthetic fixture; mount only in local development for QA.
const id = '00000000-0000-4000-8000-000000000001';
const quote = '### Room guidance\nRooms have desks. Rooms are not soundproof.\nDo not charge PHP 1,000.00 without approval.';
const source = { document_id: id, version_id: id, chunk_id: id, title: 'Synthetic Operations', heading_path: 'Operations / Rooms', source_page: 2, epoch: 1, extraction_method: 'TEXT', content_hash: 'a'.repeat(64), content: quote };
const blocks = [{ kind: 'text' as const, text: 'Rooms may suit desk work, but they are **not soundproof**.', support: [0] }, { kind: 'step' as const, text: 'Use `Review` to examine the booking.', support: [0] }, { kind: 'step' as const, text: 'Do not charge PHP 1,000.00 without approval.', support: [0] }];
const summary = blocks.map(b => b.text).join('\n\n');
const messages: AssistantMessage[] = [{ id, role: 'assistant', text: summary, answer: { kind: 'MIXED', summary, outcome: 'PARTIAL', answer_mode: 'PARTIAL_GENERAL', synthesis_status: 'ACCEPTED', synthesis: { version: 'ms57-v1', scope: 'MULTI_PART', outcome: 'PARTIAL_GENERAL', blocks, gaps: ['Room price'] }, evidence_spans: [{ chunk_id: id, quote, start: 0, end: quote.length }], citations: [source], tables: [{ title: 'Current occupancy', columns: ['Count'], rows: [[5]] }], interpretation: [], limitations: ['PARTIAL_GENERAL: Room price was not verified from retrieved passages.'], as_of: '2026-10-15T06:16:00.861Z', business_timezone: 'Asia/Manila', knowledge_epoch: 1, request_id: id } }];
export default function AssistantBrowserFixture() {
  const [open, setOpen] = useState(false), [shown, setShown] = useState(false), [unavailable, setUnavailable] = useState(false);
  const close = useCallback(() => { setOpen(false); setShown(false); setUnavailable(false); }, []);
  return <main><button id="fixture-open" onClick={() => setOpen(true)}>Open synthetic assistant</button><button id="fixture-withdraw" onClick={() => { setShown(false); setUnavailable(true); }}>Simulate withdrawal</button>{open && <AssistantPanel role={typeof window !== 'undefined' && window.location.port === '3003' ? 'STAFF' : 'ADMIN'} messages={messages} value="" busy={false} status="" error="" source={shown ? source : undefined} sourceError={unavailable ? 'This published source is no longer available.' : undefined} onValue={() => undefined} onSubmit={() => undefined} onRetry={() => undefined} onClose={close} onSource={() => { setShown(!unavailable); }} onDismissSource={() => { setShown(false); setUnavailable(false); }} />}</main>;
}
