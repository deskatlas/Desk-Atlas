'use client';
// MS49-TC01-07 / DSD-UI16: mount temporarily as /ms49-fixture in each app.
// Uses each real root layout and its CSS. Never deploy this synthetic route.
import React, { useEffect, useState } from 'react';
import { AssistantPanel, type AssistantMessage } from '../../packages/ui/src/components/AssistantPanel';
import { AssistantLauncher } from '../../apps/admin-portal/src/features/assistant/AssistantLauncher';

export default function AssistantBrowserFixture() {
  const [ready, setReady] = useState(false), [open, setOpen] = useState(false), [value, setValue] = useState('Synthetic question');
  const state = typeof window === 'undefined' ? 'empty' : new URLSearchParams(window.location.search).get('state') ?? 'empty';
  const role = typeof window !== 'undefined' && window.location.port === '3003' ? 'STAFF' : 'ADMIN';
  useEffect(() => {
    const original = window.fetch;
    window.fetch = async () => Response.json({ data: { enabled: true, identity: { id: '00000000-0000-4000-8000-000000000001', role }, knowledge_epoch: 2 } });
    setReady(true);
    return () => { window.fetch = original; };
  }, [role]);
  const source = { document_id: 'document', version_id: 'version', chunk_id: 'chunk', title: 'Published procedure', heading_path: 'Operations / Check-in', source_page: 1, epoch: 1, extraction_method: 'text', content_hash: 'a'.repeat(64), content: 'Synthetic source excerpt. '.repeat(30) };
  const messages: AssistantMessage[] = state === 'empty' ? [] : [{ id: 'question', role: 'user', text: 'How do I check in?' }, { id: 'answer', role: 'assistant', text: state === 'long' ? 'https://example.test/'.concat('long'.repeat(150)) : 'Follow the published check-in procedure.', answer: { kind: 'DOCUMENT', summary: 'Synthetic answer', tables: [{ title: 'Operational summary', columns: ['Area', 'Status'], rows: [['Front desk', 'Available']] }], citations: [source], interpretation: ['Published procedures only.'], limitations: ['Synthetic visual fixture.'], as_of: '2026-10-15T00:00:00Z', knowledge_epoch: 1, request_id: 'request' } }];
  return <main>
    <button id="fixture-open" onClick={() => setOpen(true)}>Open synthetic state</button>
    {ready && !open && <AssistantLauncher token="synthetic-ms49-token" />}
    {open && <AssistantPanel role={role} messages={messages} value={value} busy={state === 'loading'} status={state === 'loading' ? 'Retrieving published evidence...' : ''} error={state === 'error' ? 'Assistant unavailable. Please retry.' : ''} epoch={2} source={state === 'source' || state === 'long' ? source : undefined} onValue={setValue} onSubmit={() => undefined} onRetry={() => undefined} onClose={() => setOpen(false)} onSource={() => undefined} onDismissSource={() => undefined} />}
  </main>;
}
