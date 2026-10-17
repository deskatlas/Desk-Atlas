'use client';
import React, { useEffect, useRef } from 'react';
import type { AssistantAnswer, AssistantSource } from '@deskatlas/domain';
import { Button } from './Button';
import { AssistantAnswerText, assistantLimitation, readableAssistantTime } from './assistantPresentation';
import { assistantOutcome } from '@deskatlas/domain';

// SPEC-4 DSD-UI16: controlled presentation only. The app owns request/session state.
export interface AssistantMessage { id: string; role: 'user' | 'assistant'; text: string; answer?: AssistantAnswer }
export interface AssistantPanelProps {
  role?: 'ADMIN' | 'STAFF'; messages: AssistantMessage[]; value: string; busy: boolean; status: string; error: string;
  epoch?: number; source?: AssistantSource; sourceError?: string; onValue: (value: string) => void;
  onSubmit: () => void; onRetry: () => void; onClose: () => void;
  onSource: (version: string, chunk: string) => void; onDismissSource: () => void;
}
export function AssistantPanel(props: AssistantPanelProps) {
  const dialog = useRef<HTMLDivElement>(null), input = useRef<HTMLTextAreaElement>(null), end = useRef<HTMLDivElement>(null);
  const sourceView = useRef<HTMLElement>(null), sourceTrigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { if (props.source || props.sourceError) sourceView.current?.focus(); }, [props.source, props.sourceError]);
  const dismissSource = () => { props.onDismissSource(); sourceTrigger.current?.focus(); };
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; input.current?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); props.onClose(); }
      if (event.key !== 'Tab') return;
      const items = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]');
      if (!items?.length) return;
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keyboard);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', keyboard); if (previous?.isConnected) previous.focus(); else (document.querySelector<HTMLElement>('[aria-modal="true"] button, [aria-modal="true"] [tabindex="0"]') ?? document.querySelector<HTMLElement>('main button,main a,header button,button'))?.focus(); };
  }, [props.onClose]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [props.messages, props.status]);
  return <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100 }} onClick={props.onClose}>
    <div ref={dialog} data-assistant-panel role="dialog" aria-modal="true" aria-labelledby="assistant-title" onClick={e => e.stopPropagation()}
      style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 'min(100%, 560px)', background: 'var(--da-canvas)', color: 'var(--da-text-primary)', display: 'flex', flexDirection: 'column', fontFamily: 'var(--da-font-family)', borderLeft: '1px solid var(--da-border)' }}>
      <header style={{ padding: '20px', background: '#fff', borderBottom: '1px solid var(--da-border)', display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
        <div><h2 id="assistant-title" style={{ fontSize: '18px', fontWeight: 800 }}>DeskAtlas Assistant</h2><p style={{ fontSize: '12px', color: 'var(--da-text-secondary)' }}>Read-only answers. Closing clears this conversation.</p></div>
        <Button variant="ghost" size="sm" onClick={props.onClose} aria-label="Close assistant">Close</Button>
      </header>
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px', minHeight: 0 }}>
        {!props.messages.length && <p style={{ color: 'var(--da-text-secondary)', fontSize: '14px' }}>{props.role === 'ADMIN' ? 'Ask about published procedures, current operations, or an aggregate report. Individual guest records are unavailable.' : 'Ask about published procedures or current operations. Individual guest records are unavailable.'}</p>}
        {props.messages.map(message => <article key={message.id} style={{ background: '#fff', border: '1px solid var(--da-border)', borderRadius: '12px', padding: '16px', marginBottom: '12px' }}>
          <div style={{ fontWeight: 800, fontSize: '12px', marginBottom: '8px' }}>{message.role === 'user' ? 'You' : 'Assistant'}</div>
          {message.answer && <p style={{ fontSize: '12px', color: 'var(--da-text-secondary)' }}>{({ SUPPORTED: '', PARTIAL: 'Supported parts with gaps below', CLARIFICATION: 'Clarification needed', INSUFFICIENT: 'Not verified from retrieved evidence', CONFLICT: 'Published rules disagree', SOURCE_REVIEW: 'Source review needed', LIMIT: 'Supported scope limit', SERVICE_FAILURE: 'Service unavailable; please retry', UNSUPPORTED: 'Outside the assistant scope' })[message.answer.outcome ?? assistantOutcome(message.answer)]}</p>}
          <div style={{ fontSize: '14px', overflowWrap: 'anywhere' }}><AssistantAnswerText answer={message.answer} text={message.text} /></div>
          {message.answer?.tables.map((table, index) => <div key={index} role="region" aria-label={table.title} tabIndex={0} style={{ overflowX: 'auto', marginTop: '12px' }}>
            <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
              <caption style={{ textAlign: 'left', fontWeight: 800, padding: '8px 0' }}>{table.title}</caption>
              <thead><tr>{table.columns.map((column, i) => <th key={i} scope="col" style={{ textAlign: 'left', borderBottom: '1px solid var(--da-border)', padding: '8px', whiteSpace: 'nowrap' }}>{column}</th>)}</tr></thead>
              <tbody>{table.rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j} style={{ padding: '8px', borderBottom: '1px solid var(--da-border)' }}>{cell ?? 'N/A'}</td>)}</tr>)}</tbody>
            </table>
            {!table.rows.length && <p>No matching records in this successful aggregate.</p>}
          </div>)}
          {!!message.answer?.interpretation.length && <details style={{ fontSize: '12px', marginTop: '12px' }}><summary>Interpretation and filters</summary>{message.answer.interpretation.map((line, i) => <p key={i}>{line}</p>)}</details>}
          {!!message.answer?.citations.length && <div aria-label="Answer sources" style={{ marginTop: '12px' }}>{message.answer.citations.map((citation, index) => <Button key={citation.chunk_id} size="sm" variant="ghost" title={citation.heading_path} aria-label={`Source ${index + 1}: ${citation.title}${citation.source_page ? `, page ${citation.source_page}` : ''}`} onClick={event => { sourceTrigger.current = event.currentTarget; props.onSource(citation.version_id, citation.chunk_id); }}>{citation.title}{citation.source_page ? `, page ${citation.source_page}` : ''}</Button>)}</div>}
          {!!message.answer?.citations.length && props.epoch !== undefined && message.answer.knowledge_epoch !== props.epoch && <p role="status" style={{ fontSize: '12px' }}>These sources may have changed. New answers retrieve current evidence.</p>}
          {!!message.answer?.limitations.length && <ul style={{ margin: '12px 0', paddingLeft: '16px', fontSize: '12px', color: 'var(--da-text-secondary)' }}>{message.answer.limitations.map((line, i) => <li key={i}>{assistantLimitation(line).text}</li>)}</ul>}
          {message.answer && <details style={{ fontSize: '12px', color: 'var(--da-text-secondary)', marginTop: '8px' }}><summary>Source and retrieval details</summary><p>{message.answer.kind === 'REPORT' || message.answer.kind === 'MIXED' || message.answer.kind === 'OPERATIONAL' ? 'Data as of' : 'Retrieved at'} <time dateTime={message.answer.as_of}>{readableAssistantTime(message.answer.as_of, message.answer.business_timezone)}</time></p>{message.answer.limitations.some(line => assistantLimitation(line).diagnostic) && <details><summary>Diagnostic details</summary>{message.answer.limitations.map((line, index) => assistantLimitation(line).diagnostic && <p key={index}>{assistantLimitation(line).diagnostic}</p>)}</details>}</details>}
          {message.answer && (message.answer.kind === 'REPORT' || message.answer.kind === 'MIXED' || message.answer.kind === 'OPERATIONAL') && <p style={{ fontSize: '11px', color: 'var(--da-text-secondary)', marginTop: '8px' }}>Data as of <time dateTime={message.answer.as_of}>{readableAssistantTime(message.answer.as_of, message.answer.business_timezone)}</time></p>}
        </article>)}
        {props.sourceError && <section ref={sourceView} tabIndex={-1} aria-label="Source unavailable" role="status"><p>{props.sourceError}</p><Button variant="ghost" onClick={dismissSource}>Dismiss source notice</Button></section>}
        {props.source && <section ref={sourceView} tabIndex={-1} aria-label="Published source excerpt" style={{ background: '#fff', border: '1px solid var(--da-border)', borderRadius: '12px', padding: '16px' }}>
          <h3>{props.source.title}</h3><p>{props.source.heading_path}</p><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{props.source.content}</p><Button variant="ghost" onClick={dismissSource}>Close source excerpt</Button>
        </section>}
        <p role="status" aria-live="polite" style={{ fontSize: '13px' }}>{props.status}</p>
        {!!props.error && <div role="alert"><p>{props.error}</p><Button variant="secondary" size="sm" disabled={props.busy} onClick={props.onRetry}>Retry</Button></div>}
        <div ref={end} />
      </div>
      <form onSubmit={e => { e.preventDefault(); props.onSubmit(); }} style={{ padding: '16px 20px', borderTop: '1px solid var(--da-border)', background: '#fff' }}>
        <label htmlFor="assistant-message" style={{ fontSize: '12px', fontWeight: 700 }}>Your question</label>
        <textarea ref={input} id="assistant-message" value={props.value} onChange={e => props.onValue(e.target.value)} maxLength={2000} rows={3}
          style={{ display: 'block', width: '100%', resize: 'vertical', margin: '8px 0', padding: '10px', border: '1px solid var(--da-border)', borderRadius: '10px', fontFamily: 'inherit', fontSize: '14px' }} />
        <Button type="submit" size="sm" isLoading={props.busy} disabled={!props.value.trim() || props.busy}>Send question</Button>
      </form>
    </div>
  </div>;
}
