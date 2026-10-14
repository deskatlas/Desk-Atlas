'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, useActiveTabPolling } from '@deskatlas/ui';
import type { KnowledgeAudience, KnowledgeDocument, KnowledgeNotice, KnowledgeVersion } from '@deskatlas/domain';
import { useAuth } from '../../auth';
import s from './knowledge.module.css';

// SPEC-5 / DSD-UI17: external editing, explicit review, no automatic publication.
export function KnowledgeBaseSettings() {
  const { user } = useAuth();
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [notices, setNotices] = useState<KnowledgeNotice[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [upload, setUpload] = useState<{ target?: KnowledgeDocument } | null>(null);
  const [title, setTitle] = useState('');
  const [audience, setAudience] = useState<KnowledgeAudience>('ADMIN_ONLY');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{ document: KnowledgeDocument; version: KnowledgeVersion; chunks: { content: string; heading_path: string; page_start: number | null }[] } | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [remove, setRemove] = useState<{ document: KnowledgeDocument; version?: KnowledgeVersion } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const uploadRequest = useRef<{ requestId: string; uploaded: boolean }>({ requestId: '', uploaded: false });
  const activeToken = useRef(user?.token);
  activeToken.current = user?.token;
  const loadedPages = useRef(1);
  const request = useCallback(async <T,>(path: string, method = 'GET', data?: unknown): Promise<T> => {
    const response = await fetch(`/api/admin/knowledge/${path}`, { method, cache: 'no-store', headers: { Authorization: `Bearer ${user?.token ?? ''}`, ...(data ? { 'Content-Type': 'application/json' } : {}) }, body: data ? JSON.stringify(data) : undefined });
    const result = await response.json();
    if (activeToken.current !== user?.token) throw new Error('Administrator session changed.');
    if (!response.ok) throw new Error(result.error?.message ?? 'Knowledge Base request failed.');
    return result.data;
  }, [user?.token]);
  const load = useCallback(async () => {
    try {
      const [result, events] = await Promise.all([
        request<{ documents: KnowledgeDocument[]; next_cursor: string | null }>('documents'),
        request<KnowledgeNotice[]>('notifications'),
      ]);
      const rows = [...result.documents];
      let next = result.next_cursor;
      for (let page = 1; page < loadedPages.current && next; page++) {
        const additional = await request<{ documents: KnowledgeDocument[]; next_cursor: string | null }>(`documents?cursor=${next}`);
        rows.push(...additional.documents); next = additional.next_cursor;
      }
      setDocuments(rows); setCursor(next); setNotices(events);
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to load Knowledge Base.'); }
  }, [request]);
  useActiveTabPolling(load, 15000, { enabled: Boolean(user?.token) });
  const modalOpen = Boolean(upload || preview || remove);
  useEffect(() => { if (modalOpen) dialog.current?.showModal(); else dialog.current?.close(); }, [modalOpen]);
  useEffect(() => { loadedPages.current = 1; setUpload(null); setPreview(null); setRemove(null); setDocuments([]); setNotices([]); }, [user?.token]);
  function close() { if (!busy) { setUpload(null); setPreview(null); setRemove(null); setFile(null); } }
  async function perform(action: () => Promise<void>, refresh = true) {
    setBusy(true); setError(''); setMessage('');
    try { await action(); if (refresh) await load(); } catch (e) { setError(e instanceof Error ? e.message : 'Operation failed.'); }
    finally { setBusy(false); }
  }
  function openUpload(target?: KnowledgeDocument) {
    uploadRequest.current = { requestId: crypto.randomUUID(), uploaded: false };
    setTitle(target?.title ?? ''); setAudience(target?.audience ?? 'ADMIN_ONLY'); setFile(null); setUpload({ target });
  }
  async function submitUpload(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return;
    await perform(async () => {
      const requestId = uploadRequest.current.requestId;
      const target = await request<{ upload_url: string; version_id: string }>('uploads', 'POST', {
        title, audience, filename: file.name, declared_type: file.name.split('.').pop()?.toUpperCase(), request_id: requestId,
        ...(upload?.target ? { replace_document_id: upload.target.id, expected_revision: upload.target.revision } : {}),
      });
      setMessage('Uploading file. Processing has not been queued yet.');
      if (!uploadRequest.current.uploaded && target.upload_url) {
        const transferred = await fetch(target.upload_url, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream', 'x-upsert': 'false' }, body: file });
        if (!transferred.ok && transferred.status !== 409) throw new Error('File transfer failed. No processing job was accepted.');
        uploadRequest.current.uploaded = true;
      }
      await request(`uploads/${target.version_id}/finalize`, 'POST', { request_id: requestId });
      setUpload(null); setFile(null); setMessage('Queued. You can leave Settings; a notification will arrive when processing finishes.');
    });
  }
  function revision(document: KnowledgeDocument) { return { expected_revision: document.revision, request_id: crypto.randomUUID() }; }
  async function openPreview(document: KnowledgeDocument, version: KnowledgeVersion) {
    await perform(async () => {
      const result = await request<{ chunks: { content: string; heading_path: string; page_start: number | null }[] }>(`versions/${version.id}/preview`);
      setAudience(document.audience); setAcknowledged(false); setPreview({ document, version, chunks: result.chunks });
    });
  }
  async function more() {
    await perform(async () => {
      const result = await request<{ documents: KnowledgeDocument[]; next_cursor: string | null }>(`documents?cursor=${cursor}`);
      loadedPages.current++;
      setDocuments(previous => [...previous, ...result.documents]); setCursor(result.next_cursor);
    }, false);
  }
  return <section className={s.root}>
    <div className={s.header}><div><h2>Knowledge Base</h2><p>Upload operating documents, review extracted content, then publish for the selected audience.</p></div><Button onClick={() => openUpload()} disabled={busy}>Upload document</Button></div>
    {error && <p role="alert" className={s.feedback}>{error}</p>}
    {message && <p role="status" className={s.feedback}>{message}</p>}
    {notices.some(n => !n.read_at) && <div className={s.card}><h3>Processing results</h3>{notices.filter(n => !n.read_at).map(n => <div className={s.header} key={n.id}><span>{n.kind === 'READY_FOR_REVIEW' ? 'Document ready for review' : 'Processing needs attention'}{n.error_code ? `: ${n.error_code.replaceAll('_', ' ')}` : ''}</span><Button variant="ghost" size="sm" onClick={() => perform(async () => { await request(`notifications/${n.id}`, 'PATCH'); })}>Dismiss</Button></div>)}</div>}
    {documents.length === 0 && !error && <p>No knowledge documents yet. Uploaded content requires review before publication.</p>}
    {documents.map(document => <article className={s.card} key={document.id}>
      <div className={s.header}><div><h3>{document.title}</h3><p>{document.deleted_at ? 'Removed. Artifact cleanup is queued.' : document.audience === 'ADMIN_ONLY' ? 'Admin only' : 'Admin and staff'} · Revision {document.revision}</p></div>
        {!document.deleted_at && <div className={s.actions}><Button variant="secondary" size="sm" disabled={busy} onClick={() => openUpload(document)}>Upload replacement</Button><Button variant="danger" size="sm" disabled={busy} onClick={() => setRemove({ document })}>Remove document</Button></div>}
        {document.jobs.some(j => j.kind === 'PURGE' && j.status === 'FAILED') && <Button variant="secondary" size="sm" disabled={busy} onClick={() => perform(async () => { await request(`documents/${document.id}/cleanup`, 'POST', revision(document)); })}>Retry cleanup</Button>}</div>
      {document.versions.slice().sort((a, b) => b.version_number - a.version_number).map(version => {
        const job = document.jobs.filter(j => j.version_id === version.id && j.kind === 'INGEST').at(-1);
        const purge = document.jobs.find(j => j.version_id === version.id && j.kind === 'PURGE');
        return <div key={version.id} className={s.version}><div><strong>Version {version.version_number} · {version.status}</strong><p>{version.original_filename} · Uploaded {new Date(version.created_at).toLocaleString()}{version.reviewed_at ? ` · Reviewed ${new Date(version.reviewed_at).toLocaleString()}` : ''}</p>
          {version.status === 'PROCESSING' && <p>Stage: {job?.stage ?? 'VALIDATING'}</p>}{job?.last_error_code && <p>{job.last_error_code.replaceAll('_', ' ')}</p>}
          {version.status === 'REMOVED' && <p>{purge?.status === 'SUCCEEDED' ? 'Cleanup complete' : purge?.status === 'FAILED' ? 'Cleanup failed; administrator attention required' : 'Cleanup pending'}</p>}</div>
          {!document.deleted_at && version.status !== 'REMOVED' && <div className={s.actions}>
            {['READY', 'PUBLISHED', 'SUPERSEDED'].includes(version.status) && <Button size="sm" variant="secondary" disabled={busy} onClick={() => openPreview(document, version)}>Preview{version.status === 'READY' ? ' and review' : ''}</Button>}
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => perform(async () => { const result = await request<{ url: string }>(`versions/${version.id}/download`, 'POST'); window.location.assign(result.url); })}>Download original</Button>
            {version.status === 'FAILED' && <Button size="sm" variant="secondary" disabled={busy} onClick={() => perform(async () => { await request(`versions/${version.id}/retry`, 'POST', revision(document)); })}>Retry</Button>}
            {version.id !== document.active_version_id && <Button size="sm" variant="ghost" disabled={busy} onClick={() => setRemove({ document, version })}>Remove version</Button>}
          </div>}</div>;
      })}
    </article>)}
    {cursor && <Button variant="secondary" disabled={busy} onClick={more}>Load more</Button>}
    <dialog ref={dialog} className={s.dialog} onCancel={event => { if (busy) event.preventDefault(); else close(); }} aria-label={upload ? 'Upload knowledge document' : preview ? 'Review knowledge document' : 'Confirm removal'}>
      <div className={s.header}><h2>{upload ? upload.target ? 'Upload replacement' : 'Upload document' : preview ? 'Review extracted content' : 'Confirm removal'}</h2><Button variant="ghost" onClick={close} disabled={busy} aria-label="Close dialog">Close</Button></div>
      {error && <p role="alert">{error}</p>}
      {upload && <form onSubmit={submitUpload} className={s.form}>
        <label>Title<input value={title} onChange={e => setTitle(e.target.value)} required maxLength={200} disabled={busy || Boolean(upload.target)} /></label>
        <label>Audience<select value={audience} onChange={e => setAudience(e.target.value as KnowledgeAudience)} disabled={busy}><option value="ADMIN_ONLY">Admin only</option><option value="ADMIN_AND_STAFF">Admin and staff</option></select></label>
        <label>Source file<input type="file" accept=".md,.doc,.docx,.pdf" required disabled={busy} onChange={e => { uploadRequest.current = { requestId: crypto.randomUUID(), uploaded: false }; setFile(e.target.files?.[0] ?? null); }} /></label>
        <p>Edit documents externally. A replacement keeps the published version active until the new content is reviewed and published.</p>
        <Button type="submit" isLoading={busy} disabled={!file}>{busy ? 'Uploading and queuing' : 'Upload and queue processing'}</Button>
      </form>}
      {preview && <div className={s.form}>
        <p>{preview.document.title} · Version {preview.version.version_number}</p>
        {preview.version.warning_codes.length > 0 && <div role="note"><strong>Extraction limitations requiring review</strong><ul>{preview.version.warning_codes.map(code => <li key={code}>{code.replaceAll('_', ' ')}</li>)}</ul></div>}
        <div className={s.preview}>{preview.chunks.map((chunk, i) => <section key={i}><p>{chunk.heading_path}{chunk.page_start ? ` · Page ${chunk.page_start}` : ''}</p><pre>{chunk.content}</pre></section>)}</div>
        <label>Publication audience<select value={audience} onChange={e => setAudience(e.target.value as KnowledgeAudience)}><option value="ADMIN_ONLY">Admin only</option><option value="ADMIN_AND_STAFF">Admin and staff</option></select></label>
        <label className={s.check}><input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} />I reviewed the complete extraction, warnings, policy correctness, and audience.</label>
        {preview.version.status === 'READY' && <Button disabled={!acknowledged || busy} onClick={() => perform(async () => { await request(`versions/${preview.version.id}/publish`, 'POST', { ...revision(preview.document), audience, acknowledge_warnings: acknowledged }); setPreview(null); setMessage('Document published.'); })}>Publish reviewed version</Button>}
        {preview.version.status === 'PUBLISHED' && audience !== preview.document.audience && <Button disabled={!acknowledged || busy} onClick={() => perform(async () => { await request(`documents/${preview.document.id}/audience`, 'PATCH', { ...revision(preview.document), audience }); setPreview(null); })}>Apply reviewed audience change</Button>}
      </div>}
      {remove && <div className={s.form}><p>{remove.version ? `Remove version ${remove.version.version_number} of ${remove.document.title}? The published version remains active.` : `Remove ${remove.document.title}? It will stop appearing in retrieval immediately, and its source files will be queued for deletion.`}</p><Button variant="danger" isLoading={busy} onClick={() => perform(async () => { await request(remove.version ? `versions/${remove.version.id}` : `documents/${remove.document.id}`, 'DELETE', revision(remove.document)); setRemove(null); })}>Confirm removal</Button></div>}
    </dialog>
  </section>;
}
