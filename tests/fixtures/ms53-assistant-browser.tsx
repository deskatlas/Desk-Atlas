'use client';
import React, { useState } from 'react';
import { AssistantPanel, type AssistantMessage } from '../../packages/ui/src/components/AssistantPanel';

// MS53-TC06/07: synthetic exact evidence. Temporarily mount in both portal layouts.
const chunk = '00000000-0000-4000-8000-000000000001';
const quote = '### Customer Check-Out\n**Admin only: payment approval**\n1\\. Verify the customer reservation and recorded check-in.\n2\\. Confirm actual departure time.\n3\\. Review charges. Do not collect an unapproved fee.\n4\\. Collect outstanding payments, when applicable.\n5\\. Record check-out in the system.\n6\\. Confirm workspace vacancy.\n7\\. Inspect cleanliness, damage and forgotten belongings.\n8\\. Thank the customer.\nKeep reference #42 and `C:\\desk\\42`. <script>alert(1)</script> https://example.test';
const source = { document_id: chunk, version_id: chunk, chunk_id: chunk, title: 'Synthetic Operations SOP', heading_path: 'Operations / Customer Check-Out', source_page: 2, epoch: 1, extraction_method: 'TEXT', content_hash: 'a'.repeat(64), content: quote };
export default function AssistantBrowserFixture() {
  const [open, setOpen] = useState(false), [shown, setShown] = useState(false);
  const messages: AssistantMessage[] = [{ id: 'answer', role: 'assistant', text: quote, answer: { kind: 'MIXED', summary: quote, tables: [{ title: 'Current occupancy', columns: ['Count'], rows: [[5]] }], citations: [source], interpretation: [], limitations: ['Snapshot may be stale.', 'INCOMPLETE_EVIDENCE: CONTEXT_BUDGET: Synthetic diagnostic example.'], as_of: '2026-10-15T06:16:00.861Z', business_timezone: 'Asia/Manila', knowledge_epoch: 1, request_id: chunk, evidence_spans: [{ chunk_id: chunk, quote, start: 0, end: quote.length }] } }];
  return <main><button id="fixture-open" onClick={() => setOpen(true)}>Open synthetic assistant</button>{open && <AssistantPanel role={typeof window !== 'undefined' && window.location.port === '3003' ? 'STAFF' : 'ADMIN'} messages={messages} value="" busy={false} status="" error="" epoch={2} source={shown ? source : undefined} onValue={() => undefined} onSubmit={() => undefined} onRetry={() => undefined} onClose={() => setOpen(false)} onSource={(version, selected) => { if (version === source.version_id && selected === source.chunk_id) setShown(true); }} onDismissSource={() => setShown(false)} />}</main>;
}
