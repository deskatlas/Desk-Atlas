'use client';
// MS64-TC01/05/08/15: synthetic responses; this fixture is never a production page.
import React, { useEffect, useState } from 'react';
import { AuthProvider } from '@/features/auth';
import { KnowledgeBaseSettings } from '@/features/settings/components/KnowledgeBaseSettings';
import type { KnowledgeDocument, KnowledgeStatus } from '@deskatlas/domain';

export default function Fixture() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const original = window.fetch;
    const state = new URLSearchParams(location.search).get('state') ?? 'empty';
    let rows: KnowledgeDocument[] = [];
    const version = (id: string, status: KnowledgeStatus) => ({ id, document_id: 'doc', version_number: id === 'v1' ? 1 : 2, status, original_filename: `${id}.md`, warning_codes: [], created_at: '2026-10-17', reviewed_at: null, published_at: null, chunk_count: 1, expected_revision: 1, generation: 1, automatic_preparation: true });
    if (state !== 'empty') rows = [{ id: 'doc', title: 'Operating guide', audience: 'ADMIN_AND_STAFF', revision: 1, active_version_id: 'v1', deleted_at: null, versions: [version('v1', 'PUBLISHED'), ...(state === 'replacement' ? [] : [version('v2', state === 'failed' ? 'FAILED' : 'PROCESSING')])], jobs: [{ id: 'job', version_id: 'v2', kind: 'INGEST', status: state === 'failed' ? 'FAILED' : 'RUNNING', stage: 'EMBEDDING', last_error_code: 'ENCRYPTED_FILE' }] }];
    localStorage.setItem('desk_atlas_user', JSON.stringify({ id: 'fixture', role: 'admin', token: 'synthetic-ms64' }));
    window.fetch = async (input, init) => {
      const url = String(input);
      if (!url.startsWith('/api/')) return original(input, init);
      if (url.includes('/auth/session')) return Response.json({ active: true, expiresAt: Date.now() + 3600000, user: { id: 'fixture', role: 'admin' } });
      if (url.endsWith('/uploads') && init?.method === 'POST') {
        document.documentElement.dataset.lastUpload = String(init.body);
        return Response.json({ data: { upload_url: '/api/ms64-bytes', version_id: 'v2' } });
      }
      if (url.endsWith('/ms64-bytes')) return new Response(null, { status: 200 });
      if (url.endsWith('/finalize')) {
        if (!rows.length) rows = [{ id: 'doc', title: 'Operating guide', audience: 'ADMIN_ONLY', revision: 1, active_version_id: null, deleted_at: null, versions: [], jobs: [] }];
        rows[0].versions.push(version('v2', 'PROCESSING'));
        return Response.json({ data: { status: 'QUEUED' } });
      }
      if (url.includes('/cleanup')) return Response.json({ data: { documents: [], next_cursor: null } });
      if (url.includes('/notifications')) return Response.json({ data: [] });
      return Response.json({ data: { documents: rows, next_cursor: null } });
    };
    setReady(true);
    return () => { window.fetch = original; localStorage.removeItem('desk_atlas_user'); };
  }, []);
  return ready ? <AuthProvider><KnowledgeBaseSettings /></AuthProvider> : <p>Preparing fixture</p>;
}
