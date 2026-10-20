'use client';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, useActiveTabPolling } from '@deskatlas/ui';
import type { KnowledgeAudience, KnowledgeCleanup, KnowledgeDocument, KnowledgeNotice, KnowledgeVersion } from '@deskatlas/domain';
import { knowledgeDisplayTitle, knowledgeProcessingRemedy, knowledgeWorkingDocument } from '@deskatlas/domain';
import { KnowledgeFreshness } from '../knowledgeFreshness';
import { useAuth } from '../../auth';
import s from './knowledge.module.css';

export type AudienceFilter = 'ALL' | 'ADMIN_ONLY' | 'ADMIN_AND_STAFF';

type PreviewChunk = { content: string; heading_path: string; page_start: number | null };

// MS-64 / MS-75 / PRD-F27 / DSD-UI17: one upload authorizes verified background publication.
export function KnowledgeBaseSettings() {
  const { user, loading, sessionGeneration, isSessionCurrent } = useAuth();
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [audienceFilter, setAudienceFilter] = useState<AudienceFilter>('ALL');
  const [notices, setNotices] = useState<KnowledgeNotice[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [cleanup, setCleanup] = useState<KnowledgeCleanup[]>([]);
  const [cleanupCursor, setCleanupCursor] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [upload, setUpload] = useState<{ target?: KnowledgeDocument } | null>(null);
  const [audience, setAudience] = useState<KnowledgeAudience>('ADMIN_ONLY');
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState('');
  const [fileNameEdited, setFileNameEdited] = useState(false);
  const [preview, setPreview] = useState<{ document: KnowledgeDocument; version: KnowledgeVersion; chunks: PreviewChunk[] } | null>(null);
  const [remove, setRemove] = useState<{ document: KnowledgeDocument; version?: KnowledgeVersion } | null>(null);

  const dialog = useRef<HTMLDialogElement>(null);
  const uploadButton = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const freshness = useRef(new KnowledgeFreshness());
  const cleanupPages = useRef(1);
  const seenNotices = useRef<Set<string> | null>(null);
  const uploadRequest = useRef<{ requestId: string; uploaded: boolean; started?: boolean }>({ requestId: '', uploaded: false });
  const identity = `${sessionGeneration}:${user?.id ?? ''}:${user?.token ?? ''}:${loading}`;
  const activeToken = useRef(identity);
  activeToken.current = identity;
  const loadedPages = useRef(1);
  const current = useCallback(() => activeToken.current === identity && isSessionCurrent(sessionGeneration, user?.token),
    [identity, isSessionCurrent, sessionGeneration, user?.token]);
  const request = useCallback(async <T,>(path: string, method = 'GET', data?: unknown): Promise<T> => {
    if (loading || !user?.token || !current()) throw new Error('Administrator session changed.');
    const response = await fetch(`/api/admin/knowledge/${path}`, { method, cache: 'no-store', headers: { Authorization: `Bearer ${user?.token ?? ''}`, ...(data ? { 'Content-Type': 'application/json' } : {}) }, body: data ? JSON.stringify(data) : undefined });
    const result = await response.json();
    if (!current()) throw new Error('Administrator session changed.');
    if (!response.ok) throw new Error(result.error?.message ?? 'Knowledge Base request failed.');
    return result.data;
  }, [user?.token, loading, current]);
  const load = useCallback(async () => {
    const read = freshness.current.beginRead();
    if (read === null) return;
    try {
      const [result, events, purges] = await Promise.all([
        request<{ documents: KnowledgeDocument[]; next_cursor: string | null }>('documents'),
        request<KnowledgeNotice[]>('notifications'),
        request<{ documents: KnowledgeCleanup[]; next_cursor: string | null }>('cleanup'),
      ]);
      const rows = [...result.documents];
      let next = result.next_cursor;
      for (let page = 1; page < loadedPages.current && next; page++) {
        const additional = await request<{ documents: KnowledgeDocument[]; next_cursor: string | null }>(`documents?cursor=${next}`);
        rows.push(...additional.documents); next = additional.next_cursor;
      }
      const cleanupRows = [...purges.documents];
      let cleanupNext = purges.next_cursor;
      for (let page = 1; page < cleanupPages.current && cleanupNext; page++) {
        const additional = await request<{ documents: KnowledgeCleanup[]; next_cursor: string | null }>(`cleanup?cursor=${cleanupNext}`);
        cleanupRows.push(...additional.documents); cleanupNext = additional.next_cursor;
      }
      if (!current() || !freshness.current.accepts(read)) return;
      setError('');
      const working = rows.map(knowledgeWorkingDocument).filter((row): row is KnowledgeDocument => row !== null);
      setDocuments(working);
      // Changed review targets must be reopened against their authoritative state.
      setPreview(previous => previous && working.some(row => row.id === previous.document.id && row.revision === previous.document.revision && row.versions.some(v => v.id === previous.version.id && v.status === previous.version.status && v.generation === previous.version.generation)) ? previous : null);
      setRemove(previous => {
        if (!previous) return null;
        const document = working.find(row => row.id === previous.document.id);
        if (!document) return null;
        const version = previous.version ? document.versions.find(v => v.id === previous.version?.id && v.id !== document.active_version_id) : undefined;
        return previous.version && !version ? null : { document, version };
      });
      setUpload(previous => {
        if (!previous?.target) return previous;
        const target = working.find(row => row.id === previous.target?.id);
        return target ? { target } : null;
      });
      if (seenNotices.current && events.some(event => !seenNotices.current!.has(event.id) && event.kind === 'AVAILABLE')) setMessage('Your document is available to its selected audience.');
      seenNotices.current = new Set(events.map(event => event.id));
      setCursor(next); setNotices(events); setCleanup(cleanupRows); setCleanupCursor(cleanupNext);
    } catch (e) { if (current() && freshness.current.accepts(read)) setError(e instanceof Error ? e.message : 'Unable to load Knowledge Base.'); }
  }, [request, current]);
  const modalOpen = Boolean(upload || preview || remove);
  useEffect(() => { if (modalOpen) dialog.current?.showModal(); else dialog.current?.close(); }, [modalOpen]);
  useEffect(() => { if (!busy && restoreFocus.current) { restoreFocus.current = false; uploadButton.current?.focus(); } }, [busy]);
  useEffect(() => {
    freshness.current.reset(); seenNotices.current = null; cleanupPages.current = 1; setCleanup([]); setCleanupCursor(null);
    loadedPages.current = 1; setUpload(null); setPreview(null); setRemove(null); setDocuments([]); setNotices([]);
    setCursor(null); setFile(null); setBusy(false); setError(''); setMessage('');
    uploadRequest.current = { requestId: '', uploaded: false };
  }, [identity]);
  useEffect(() => { activeToken.current = identity; return () => { activeToken.current = ''; }; }, [identity]);
  useActiveTabPolling(load, 15000, { enabled: Boolean(user?.token) && !loading });
  function close() { if (!busy) { setUpload(null); setPreview(null); setRemove(null); setFile(null); } }
  function trapDialogFocus(event: React.KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== 'Tab') return;
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]'));
    const first = controls[0], last = controls.at(-1);
    if (first && last && ((event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last))) {
      event.preventDefault(); (event.shiftKey ? last : first).focus();
    }
  }
  async function perform(action: () => Promise<void>, refresh = true) {
    if (loading || !user?.token || !freshness.current.beginWrite()) return;
    setBusy(true); setError(''); setMessage('');
    let failure = '';
    try { await action(); } catch (e) { failure = e instanceof Error ? e.message : 'Operation failed.'; }
    finally {
      if (current()) {
        freshness.current.endWrite();
        // Refresh after denied/conflicting/ambiguous writes, without replaying them.
        if (refresh) await load();
        if (failure) setError(failure);
        setBusy(false);
      }
    }
  }
  function openUpload(target?: KnowledgeDocument) {
    uploadRequest.current = { requestId: crypto.randomUUID(), uploaded: false };
    setAudience(target?.audience ?? 'ADMIN_ONLY'); setFile(null); setFileName(target?.title ?? ''); setFileNameEdited(false); setUpload({ target });
  }
  async function submitUpload(event: React.FormEvent) {
    event.preventDefault();
    if (!file || !fileName.trim()) return;
    await perform(async () => {
      const requestId = uploadRequest.current.requestId;
      if (uploadRequest.current.started) {
        const prior = await request<{ id: string; status: string } | null>(`uploads/${requestId}`);
        if (prior && !['UPLOADING', 'REMOVED'].includes(prior.status)) {
          setUpload(null); setFile(null); setMessage('Upload accepted. The current file status is shown below.'); restoreFocus.current = true;
          return;
        }
        if (prior?.status === 'REMOVED') throw new Error('This upload was removed. Select the file again.');
      }
      uploadRequest.current.started = true;
      const target = await request<{ upload_url: string; version_id: string }>('uploads', 'POST', {
        audience, title: fileName.trim(), filename: file.name, declared_type: file.name.split('.').pop()?.toUpperCase(), request_id: requestId,
        ...(upload?.target ? { replace_document_id: upload.target.id, expected_revision: upload.target.revision } : {}),
      });
      setMessage('Uploading');
      if (!uploadRequest.current.uploaded && target.upload_url) {
        const transferred = await fetch(target.upload_url, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream', 'x-upsert': 'false' }, body: file });
        if (!current()) throw new Error('Administrator session changed.');
        if (!transferred.ok && transferred.status !== 409) throw new Error('File transfer failed. No processing job was accepted.');
        uploadRequest.current.uploaded = true;
      }
      await request(`uploads/${target.version_id}/finalize`, 'POST', { request_id: requestId });
      setUpload(null); setFile(null); setMessage('Processing. You can leave Settings. We will notify you when the file is available.'); restoreFocus.current = true;
    });
  }
  function revision(document: Pick<KnowledgeDocument, 'revision'>) { return { expected_revision: document.revision, request_id: crypto.randomUUID() }; }
  async function openPreview(document: KnowledgeDocument, version: KnowledgeVersion) {
    await perform(async () => {
      const result = await request<{ chunks: PreviewChunk[] }>(`versions/${version.id}/preview`);
      setPreview({ document, version, chunks: result.chunks });
    });
  }
  async function more() {
    const read = freshness.current.beginRead();
    if (!cursor || read === null || busy) return;
    setBusy(true);
    try {
      const result = await request<{ documents: KnowledgeDocument[]; next_cursor: string | null }>(`documents?cursor=${cursor}`);
      if (!current() || !freshness.current.accepts(read)) return;
      loadedPages.current++;
      setDocuments(previous => [...new Map([...previous, ...result.documents].map(row => [row.id, knowledgeWorkingDocument(row)])).values()].filter((row): row is KnowledgeDocument => row !== null)); setCursor(result.next_cursor);
    } catch (e) { if (current() && freshness.current.accepts(read)) setError(e instanceof Error ? e.message : 'Unable to load more documents.'); }
    finally { if (current()) setBusy(false); }
  }
  const audienceCounts = useMemo(() => {
    let adminOnly = 0;
    let adminAndStaff = 0;
    for (const doc of documents) {
      if (doc.audience === 'ADMIN_ONLY') adminOnly++;
      else if (doc.audience === 'ADMIN_AND_STAFF') adminAndStaff++;
    }
    return {
      ALL: documents.length,
      ADMIN_ONLY: adminOnly,
      ADMIN_AND_STAFF: adminAndStaff,
    };
  }, [documents]);

  const filteredDocuments = useMemo(() => {
    if (audienceFilter === 'ALL') return documents;
    return documents.filter((doc) => doc.audience === audienceFilter);
  }, [documents, audienceFilter]);

  return <section className={s.root}>
    <div className={s.header}><div><h2>Knowledge Base</h2><p>Upload operating documents. We prepare them and make them available to your chosen audience.</p></div><Button ref={uploadButton} onClick={() => openUpload()} disabled={busy || loading || !user?.token}>Upload document</Button></div>
    {documents.length > 0 && (
      <div className={s.filterBar} role="group" aria-label="Filter documents by audience">
        <button
          type="button"
          className={`${s.filterPill} ${audienceFilter === 'ALL' ? s.filterPillActive : ''}`}
          aria-pressed={audienceFilter === 'ALL'}
          onClick={() => setAudienceFilter('ALL')}
        >
          All Files
          <span className={s.pillBadge}>{audienceCounts.ALL}</span>
        </button>
        <button
          type="button"
          className={`${s.filterPill} ${audienceFilter === 'ADMIN_ONLY' ? s.filterPillActive : ''}`}
          aria-pressed={audienceFilter === 'ADMIN_ONLY'}
          onClick={() => setAudienceFilter('ADMIN_ONLY')}
        >
          Admin Only
          <span className={s.pillBadge}>{audienceCounts.ADMIN_ONLY}</span>
        </button>
        <button
          type="button"
          className={`${s.filterPill} ${audienceFilter === 'ADMIN_AND_STAFF' ? s.filterPillActive : ''}`}
          aria-pressed={audienceFilter === 'ADMIN_AND_STAFF'}
          onClick={() => setAudienceFilter('ADMIN_AND_STAFF')}
        >
          Admin & Staff
          <span className={s.pillBadge}>{audienceCounts.ADMIN_AND_STAFF}</span>
        </button>
      </div>
    )}
    {error && <p role="alert" className={s.feedback}>{error}</p>}
    {message && <p role="status" className={s.feedback}>{message}</p>}
    {notices.some(n => !n.read_at) && <details className={s.feedback}><summary>Processing results ({notices.filter(n => !n.read_at).length} unread)</summary>{notices.filter(n => !n.read_at).map(n => <div className={s.header} key={n.id}><span>{n.kind === 'AVAILABLE' ? 'Document available to its selected audience' : n.kind === 'READY_FOR_REVIEW' ? 'Upload this file again to make it available' : n.kind === 'PURGE_FAILED' ? 'Cleanup needs attention' : 'Processing needs attention'}{n.error_code ? `: ${knowledgeProcessingRemedy(n.error_code)}` : ''}</span><Button variant="ghost" size="sm" disabled={busy} onClick={() => perform(async () => { await request(`notifications/${n.id}`, 'PATCH'); })}>Dismiss</Button></div>)}</details>}
    {documents.length === 0 && !error && <p>No knowledge documents yet. Upload a file to get started.</p>}
    {cleanup.length > 0 && <aside className={s.feedback} aria-label="Artifact cleanup">
      <details><summary>Artifact cleanup: {cleanup.reduce((total, row) => total + row.pending, 0)} pending, {cleanup.reduce((total, row) => total + row.failed, 0)} need attention{cleanupCursor ? ' (more available)' : ''}</summary>
        <p>Removed files are unavailable to the assistant. Storage cleanup continues separately.</p>
        {cleanup.map(row => <p key={`progress-${row.id}`}>{row.title}: {row.waiting_upload ? `${row.waiting_upload} waiting for upload authorization to expire. ` : ''}{row.retrying ? `${row.retrying} retrying after a cleanup error. ` : ''}{row.running ? `${row.running} cleaning up. ` : ''}{row.cleaning_chunks ? `${row.cleaning_chunks} removing indexed content in batches. ` : ''}{row.awaiting_worker ? `${row.awaiting_worker} awaiting a cleanup worker. Check the worker if this persists. ` : ''}</p>)}
        {cleanup.filter(row => row.failed > 0).map(row => <div className={s.header} key={row.id}><span>{row.title}: cleanup needs attention</span><Button variant="secondary" size="sm" disabled={busy} onClick={() => perform(async () => { await request(`documents/${row.id}/cleanup`, 'POST', revision(row)); setMessage('Cleanup queued.'); })}>Retry cleanup</Button></div>)}
        {cleanupCursor && <Button variant="ghost" size="sm" disabled={busy} onClick={() => { cleanupPages.current++; void load(); }}>More cleanup results</Button>}
      </details>
    </aside>}
    {filteredDocuments.map(document => <article className={s.card} key={document.id}>
      <div className={s.header}><div><h3>{document.title}</h3><p>{document.audience === 'ADMIN_ONLY' ? 'Admin only' : 'Admin and staff'}</p></div>
        <details className={s.menu}><summary>Document actions</summary><div className={s.actions}><Button variant="secondary" size="sm" disabled={busy} onClick={() => openUpload(document)}>Upload replacement</Button><Button variant="secondary" size="sm" disabled={busy} onClick={() => perform(async () => { await request(`documents/${document.id}/audience`, 'PATCH', { ...revision(document), audience: document.audience === 'ADMIN_ONLY' ? 'ADMIN_AND_STAFF' : 'ADMIN_ONLY' }); setMessage('Document audience updated.'); })}>{document.audience === 'ADMIN_ONLY' ? 'Share with staff' : 'Make admin only'}</Button><Button variant="danger" size="sm" disabled={busy} onClick={() => setRemove({ document })}>Remove document</Button></div></details>
      </div>
      {document.versions.map((version, index) => {
        const job = document.jobs.filter(j => j.version_id === version.id && j.kind === 'INGEST').at(-1);
        const status = { UPLOADING: 'Uploading', QUEUED: 'Processing', PROCESSING: 'Processing', READY: 'Upload again to make available', PUBLISHED: 'Available', FAILED: 'Could not process', REMOVED: 'Removed', SUPERSEDED: 'Replaced' }[version.status];
        return <div key={version.id} className={s.version}><div><strong>{version.original_filename}</strong><p>{index > 0 && document.active_version_id ? 'Pending replacement - ' : ''}{status} · Version {version.version_number}</p>
          {version.status === 'FAILED' && <p role="note">{knowledgeProcessingRemedy(job?.last_error_code)}</p>}</div>
          <div className={s.actions}>
            {['READY', 'PUBLISHED'].includes(version.status) && <Button size="sm" variant="secondary" disabled={busy} onClick={() => openPreview(document, version)}>Preview</Button>}
            {version.status !== 'UPLOADING' && <Button size="sm" variant="ghost" disabled={busy} onClick={() => perform(async () => { const result = await request<{ url: string }>(`versions/${version.id}/download`, 'POST'); window.location.assign(result.url); }, false)}>Download original</Button>}
            {version.status === 'FAILED' && version.automatic_preparation && <Button size="sm" variant="secondary" disabled={busy} onClick={() => perform(async () => { await request(`versions/${version.id}/retry`, 'POST', revision(document)); })}>Retry</Button>}
            {['READY', 'FAILED'].includes(version.status) && <Button size="sm" variant="secondary" disabled={busy} onClick={() => openUpload(document)}>Upload another file</Button>}
            {version.id !== document.active_version_id && <Button size="sm" variant="ghost" disabled={busy} onClick={() => setRemove({ document, version })}>Remove pending version</Button>}
          </div></div>;
      })}
    </article>)}
    {documents.length > 0 && filteredDocuments.length === 0 && (
      <p className={s.emptyNotice}>
        {audienceFilter === 'ADMIN_ONLY'
          ? 'No admin-only documents found.'
          : 'No documents shared with admin and staff found.'}
      </p>
    )}
    {cursor && <Button variant="secondary" disabled={busy} onClick={more}>Load more</Button>}

    <dialog ref={dialog} className={s.dialog} onKeyDown={trapDialogFocus} onCancel={event => { if (busy) event.preventDefault(); else close(); }} aria-label={upload ? 'Upload knowledge document' : preview ? 'Preview knowledge document' : 'Confirm removal'}>
      <div className={s.header}><h2>{upload ? upload.target ? 'Upload replacement' : 'Upload document' : preview ? 'Preview document' : 'Confirm removal'}</h2><Button variant="ghost" onClick={close} disabled={busy} aria-label="Close dialog">Close</Button></div>
      {error && <p role="alert">{error}</p>}
      {upload && <form onSubmit={submitUpload} className={s.form}>
        <label>File<input type="file" accept=".md,.doc,.docx,.pdf" required disabled={busy} onChange={e => { uploadRequest.current = { requestId: crypto.randomUUID(), uploaded: false }; const selected = e.target.files?.[0] ?? null; setFile(selected); if (!fileNameEdited) setFileName(upload.target?.title ?? (selected ? knowledgeDisplayTitle(selected.name) : '')); }} /></label>
        <p>Supported files: .md, .doc, .docx, .pdf</p>
        <label>File name<input type="text" value={fileName} required maxLength={200} pattern={'[^<>\\x00-\\x1f]+'} disabled={busy} onChange={e => { uploadRequest.current = { requestId: crypto.randomUUID(), uploaded: false }; setFileNameEdited(true); setFileName(e.target.value); }} /></label>
        <label>Who can use this document?<select value={audience} onChange={e => { uploadRequest.current = { requestId: crypto.randomUUID(), uploaded: false }; setAudience(e.target.value as KnowledgeAudience); }} disabled={busy}><option value="ADMIN_ONLY">Admin only</option><option value="ADMIN_AND_STAFF">Admin and staff</option></select></label>
        <p>We prepare your file and make it available to the chosen audience.{upload.target?.active_version_id ? ' The current file stays available until the replacement is ready.' : ''}</p>
        <Button type="submit" isLoading={busy} disabled={!file || !fileName.trim() || busy}>{busy ? 'Uploading' : 'Upload'}</Button>
      </form>}
      {preview && <div className={s.form}><p>{preview.document.title}</p><div className={s.preview}>{preview.chunks.map((chunk, i) => <section key={i}><p>{chunk.heading_path}{chunk.page_start ? ` Â· Page ${chunk.page_start}` : ''}</p><pre>{chunk.content}</pre></section>)}</div></div>}
      {remove && <div className={s.form}><p>{remove.version ? `Remove ${remove.version.original_filename} (version ${remove.version.version_number}) of ${remove.document.title}?${remove.document.active_version_id ? " The published version remains active." : " This pending file will be withdrawn."}` : `Remove ${remove.document.title}? It will stop appearing in retrieval immediately, and its source files will be queued for deletion.`}</p><Button variant="danger" isLoading={busy} onClick={() => perform(async () => { await request(remove.version ? `versions/${remove.version.id}` : `documents/${remove.document.id}`, 'DELETE', revision(remove.document)); setDocuments(rows => rows.flatMap(row => { if (row.id !== remove.document.id) return [row]; if (!remove.version) return []; const working = knowledgeWorkingDocument({ ...row, versions: row.versions.filter(v => v.id !== remove.version?.id) }); return working ? [working] : []; })); setMessage(remove.version ? 'Version removed.' : 'Document removed. Cleanup continues in the background.'); setRemove(null); restoreFocus.current = true; })}>Confirm removal</Button></div>}
    </dialog>
  </section>;
}
