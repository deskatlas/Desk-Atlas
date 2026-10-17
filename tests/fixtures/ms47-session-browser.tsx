'use client';
// MS47-TC08/09/10/12: disposable browser fixture. Copy to src/app/ms47-fixture/page.tsx
// on a local dev server, use a separate browser origin, and remove before building.
import React, { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from '@/features/auth';
import { KnowledgeBaseSettings } from '@/features/settings/components/KnowledgeBaseSettings';

let expired = true;
let unavailable = false;
let writes = 0;
let reads = 0;
function Harness() {
  const { user, loading, login, logout } = useAuth();
  const [counts, setCounts] = useState('');
  return <main><h1>MS-47 isolated session verification</h1>
    <p role="status">{loading ? 'Verifying' : user ? 'Signed in as verified administrator' : 'Signed out'}</p>
    <p>{counts}</p>
    <button onClick={() => { expired = false; unavailable = false; login('admin', 'Synthetic admin', { token: 'synthetic-browser-credential' }); }}>Synthetic sign-in</button>
    <button onClick={() => {
      expired = true;
      void Promise.all([fetch('/api/admin/knowledge/documents', { headers: { Authorization: `Bearer ${user?.token}` } }), fetch('/api/admin/knowledge/notifications', { headers: { Authorization: `Bearer ${user?.token}` } })]);
    }}>Expire concurrent reads</button>
    <button onClick={() => { expired = true; void fetch('/api/admin/knowledge/versions/test/publish', { method: 'POST', headers: { Authorization: `Bearer ${user?.token}` } }); }}>Expire during write</button>
    <button onClick={() => { unavailable = true; void fetch('/api/admin/knowledge/documents', { headers: { Authorization: `Bearer ${user?.token}` } }); }}>Verification outage</button>
    <button onClick={() => { unavailable = false; }}>Restore provider</button>
    <button onClick={() => setCounts(`Reads: ${reads}; writes: ${writes}`)}>Inspect counts</button>
    <button onClick={logout}>Log out</button>
    {user && !loading && <KnowledgeBaseSettings />}
  </main>;
}
export default function Fixture() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const original = window.fetch;
    localStorage.setItem('desk_atlas_user', JSON.stringify({ id: 'untrusted-local-id', role: 'admin', token: 'synthetic-browser-credential' }));
    window.fetch = async (input, init) => {
      const url = String(input);
      if (!url.startsWith('/api/')) return original(input, init);
      if (url.includes('/knowledge/')) {
        if (init?.method && init.method !== 'GET') writes++; else reads++;
      }
      if (unavailable) return Response.json({ error: { code: 'AUTH_UNAVAILABLE' } }, { status: 503 });
      if (expired) return Response.json({ error: { code: 'AUTH_REQUIRED', message: 'Your session ended. Sign in again.' } }, { status: 401 });
      if (url.includes('/auth/session')) return Response.json({ active: true, expiresAt: Date.now() + 3600000, user: { id: 'verified-browser-admin', role: 'admin' } });
      return Response.json({ data: url.includes('/notifications') ? [] : { documents: [], next_cursor: null } });
    };
    setReady(true);
    return () => { window.fetch = original; localStorage.removeItem('desk_atlas_user'); };
  }, []);
  return ready ? <AuthProvider><Harness /></AuthProvider> : <p>Preparing isolated fixture</p>;
}
