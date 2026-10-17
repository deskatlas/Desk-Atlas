'use client';
// MS51-TC01-11 / QAD-TC45: isolated UI fixture, never a production route.
import React, { useEffect, useState } from 'react';
import { AuthProvider } from '@/features/auth';
import { KnowledgeBaseSettings } from '@/features/settings/components/KnowledgeBaseSettings';
import type { KnowledgeDocument, KnowledgeStatus } from '@deskatlas/domain';

const version = (n: number, status: KnowledgeStatus) => ({ id: `v${n}`, document_id: 'doc', version_number: n, status, original_filename: `operating-guide-${n}.md`, warning_codes: [], created_at: '2026-10-15T00:00:00Z', reviewed_at: null, published_at: null, chunk_count: 1, expected_revision: 1, generation: 1 });
export default function Fixture() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const original = window.fetch;
    const state = new URLSearchParams(location.search).get('state') ?? 'mixed';
    const replacementStatus: KnowledgeStatus = state === 'failed' ? 'FAILED' : state === 'processing' ? 'PROCESSING' : state === 'uploading' ? 'UPLOADING' : state === 'queued' ? 'QUEUED' : 'READY';
    let rows: KnowledgeDocument[] = state === 'empty' ? [] : [{ id: 'doc', title: 'Operating guide', audience: 'ADMIN_AND_STAFF', revision: 1, active_version_id: 'v2', deleted_at: null, versions: [version(1, 'SUPERSEDED'), version(2, 'PUBLISHED'), version(3, replacementStatus), version(4, 'REMOVED')], jobs: [] }, { id: 'removed', title: 'Removed guide', audience: 'ADMIN_ONLY', revision: 2, active_version_id: null, deleted_at: '2026-10-15T01:00:00Z', versions: [version(9, 'REMOVED')], jobs: [{ id: 'purge', version_id: 'v9', kind: 'PURGE', status: 'FAILED', stage: null, last_error_code: 'STORAGE_UNAVAILABLE' }] }];
    if (state === 'cleanup') rows = rows.filter(row => row.deleted_at);
    const saved = sessionStorage.getItem(`ms51-fixture-${state}`);
    if (saved) rows = JSON.parse(saved) as KnowledgeDocument[];
    const save = () => sessionStorage.setItem(`ms51-fixture-${state}`, JSON.stringify(rows));
    let delayNext = false;
    let release: (() => void) | undefined;
    const delay = () => { delayNext = true; };
    const resume = () => release?.();
    window.addEventListener('ms51-delay-read', delay);
    window.addEventListener('ms51-release-read', resume);
    localStorage.setItem('desk_atlas_user', JSON.stringify({ id: 'fixture', role: 'admin', token: 'synthetic-ms51' }));
    window.fetch = async (input, init) => {
      const url = String(input);
      if (!url.startsWith('/api/')) return original(input, init);
      if (url.includes('/auth/session')) return Response.json({ active: true, expiresAt: Date.now() + 3600000, user: { id: 'fixture', role: 'admin' } });
      if (init?.method === 'DELETE') {
        if (state === 'denied') return Response.json({ error: { message: 'This document changed. Refresh before continuing.' } }, { status: 409 });
        if (url.includes('/versions/')) rows = rows.map(row => ({ ...row, versions: row.versions.filter(v => !url.endsWith(`/${v.id}`)) }));
        else rows = rows.filter(row => !url.endsWith(`/${row.id}`));
        save();
        if (state === 'lost') throw new Error('Synthetic lost response. Reconcile before continuing.');
        return Response.json({ data: { document_id: 'doc', active_version_id: null, revision: 2 } });
      }
      if (url.endsWith('/publish')) {
        rows = rows.map(row => row.id === 'doc' ? { ...row, revision: 2, active_version_id: 'v3', versions: row.versions.map(v => ({ ...v, status: v.id === 'v3' ? 'PUBLISHED' : v.status === 'PUBLISHED' ? 'SUPERSEDED' : v.status })) } : row);
        save();
        return Response.json({ data: { document_id: 'doc', active_version_id: 'v3', revision: 2 } });
      }
      if (url.endsWith('/preview')) return Response.json({ data: { chunks: [{ content: 'Reviewed operating procedure.', heading_path: 'Operating guide', page_start: null, section_context: { version: 2, section_id: 's0', scope: 'DOCUMENT', dependencies: [], ancestors: [], references: [], structure_known: true, unresolved: false, unresolved_references: false } }], extraction_manifest: [] } });
      if (url.includes('/cleanup') && init?.method === 'POST') { rows = rows.map(row => ({ ...row, jobs: row.jobs.map(job => ({ ...job, status: 'QUEUED' })) })); return Response.json({ data: {} }); }
      if (url.includes('/cleanup')) return Response.json({ data: { documents: rows.filter(row => row.jobs.length).map(row => ({ id: row.id, title: row.title, revision: row.revision, pending: row.jobs.filter(j => j.status !== 'FAILED').length, failed: row.jobs.filter(j => j.status === 'FAILED').length })), next_cursor: null } });
      if (delayNext && url.includes('/documents')) {
        delayNext = false;
        const snapshot = structuredClone(rows);
        return new Promise<Response>(resolve => { release = () => resolve(Response.json({ data: { documents: snapshot, next_cursor: null } })); });
      }
      return Response.json({ data: url.includes('/notifications') ? [] : { documents: rows, next_cursor: null } });
    };
    setReady(true);
    return () => { window.fetch = original; localStorage.removeItem('desk_atlas_user'); window.removeEventListener('ms51-delay-read', delay); window.removeEventListener('ms51-release-read', resume); };
  }, []);
  return ready ? <AuthProvider><main style={{ padding: 24, maxWidth: 1100, margin: 'auto' }}><KnowledgeBaseSettings /></main></AuthProvider> : <p>Preparing fixture</p>;
}
