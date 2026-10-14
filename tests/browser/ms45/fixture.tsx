import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AssistantLauncher } from '../../../apps/admin-portal/src/features/assistant/AssistantLauncher';
import '../../../apps/admin-portal/src/styles/tokens.css';
import '../../../packages/ui/src/styles/buttons.css';

// MS45-TC04/06..10/12: isolated synthetic browser fixture; no real API or credentials.
let eligible = false, epoch = 1, role = 'ADMIN', slow = false, cancelled = 0;
let availabilityDelay = false;
window.fetch = async (url, init) => {
  const endpoint = String(url), post = init?.method === 'POST';
  if (endpoint.endsWith('/cancel')) { cancelled++; return Response.json({ data: { cancelled: true } }); }
  if (endpoint.endsWith('/progress')) return Response.json({ data: { stage: 'retrieving' } });
  if (endpoint.includes('/sources/')) return Response.json({ data: { document_id: '00000000-0000-4000-8000-000000000004', version_id: '00000000-0000-4000-8000-000000000005', chunk_id: '00000000-0000-4000-8000-000000000006', title: 'Synthetic SOP', heading_path: 'Check-in', source_page: null, epoch, extraction_method: 'TEXT', content_hash: 'a'.repeat(64), content: 'Verify the booking QR before check-in.' } });
  if (!post) {
    const data = { enabled: eligible, knowledge_epoch: epoch, identity: { id: '00000000-0000-4000-8000-000000000001', role } };
    if (availabilityDelay) await new Promise(resolve => setTimeout(resolve, 4000));
    return Response.json({ data });
  }
  const request = JSON.parse(String(init?.body));
  if (slow) await new Promise(resolve => setTimeout(resolve, 4000)); // Deliberately ignores abort to test generation safety.
  return Response.json({ data: { kind: 'DOCUMENT', summary: 'Verify the booking QR before check-in.', request_id: request.request_id, knowledge_epoch: epoch, as_of: new Date().toISOString(), interpretation: ['Published synthetic SOP'], limitations: [], tables: [{ title: 'Synthetic aggregate', columns: ['Workspace', 'Count'], rows: [['Desk 1', 2]] }], citations: [{ document_id: '00000000-0000-4000-8000-000000000004', version_id: '00000000-0000-4000-8000-000000000005', chunk_id: '00000000-0000-4000-8000-000000000006', title: 'Synthetic SOP', heading_path: 'Check-in', source_page: null, epoch, extraction_method: 'TEXT', content_hash: 'a'.repeat(64) }] } });
};
function Fixture() {
  const [route, setRoute] = useState(0), [modal, setModal] = useState(false), [revision, render] = useState(0), [mobile, setMobile] = useState(false);
  const refresh = () => { render(n => n + 1); window.dispatchEvent(new Event('focus')); };
  return <main style={{ padding: 20, fontFamily: 'var(--da-font-family)', color: 'var(--da-text-primary)' }}>
    <h1>MS45 isolated {role === 'ADMIN' ? 'admin' : 'staff'} fixture</h1>
    <p>Synthetic APIs only. Route {route}. Revision {revision}. Cancellations {cancelled}.</p>
    <button onClick={() => { eligible = !eligible; epoch++; refresh(); }}>Toggle published knowledge</button>
    <button onClick={() => { role = role === 'ADMIN' ? 'STAFF' : 'ADMIN'; setRoute(n => n + 1); }}>Switch application role</button>
    <button onClick={() => { slow = !slow; render(n => n + 1); }}>Toggle slow answer: {String(slow)}</button>
    <button onClick={() => { availabilityDelay = !availabilityDelay; render(n => n + 1); }}>Toggle delayed availability: {String(availabilityDelay)}</button>
    <button onClick={() => setRoute(n => n + 1)}>Navigate fixture route</button>
    <button onClick={() => { epoch++; refresh(); }}>Replace publication</button>
    <button onClick={() => setModal(true)}>Open urgent dialog</button>
    <button onClick={() => setMobile(!mobile)}>Mobile preview</button>
    {mobile && <style>{'[data-assistant-panel]{width: min(100%, 375px) !important;}'}</style>}
    {modal && <div role="dialog" aria-modal="true" aria-label="Urgent test alert" style={{ position: 'fixed', inset: 0, background: 'white', zIndex: 150 }}><h2>Urgent test alert</h2><button onClick={() => setModal(false)}>Dismiss urgent dialog</button></div>}
    <AssistantLauncher key={`${role}:${route}`} token="synthetic-ui-fixture" />
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
