import React from 'react';
import type { AssistantAnswer } from '@deskatlas/domain';
import { exactAssistantMainAtoms } from '@deskatlas/domain';

// MS53-TC06 / DSD-UI16: a deliberately small inert formatting vocabulary.
// Offsets always address the unchanged quote, including its original punctuation.
export interface EvidenceLine { kind: 'heading' | 'ordered' | 'bullet' | 'text'; text: string; start: number; end: number; number?: number; literal?: boolean }
// QAD-TC44: omit only proven navigation from the main summary, never its proof.
function synthesisNavigation(block: NonNullable<AssistantAnswer['synthesis']>['blocks'][number], answer: AssistantAnswer): boolean {
  const label = (text: string) => text.replace(/^#{1,6}\s*/, '').trim();
  if (/\b(only|not|never|must|cannot|without|staff|admin(?:istrator)?s?|management|hindi|bawal)\b/i.test(block.text)) return false;
  const names = new Set(answer.citations.flatMap(source => {
    const parts = source.heading_path.split(' / ');
    return [source.title, ...parts, ...parts.map((_part, index) => parts.slice(0, index + 1).join(' / '))].map(label);
  }));
  return block.text.split(/\n+/).filter(line => line.trim()).every(line => names.has(label(line))) && block.support.every(index => {
    const span = answer.evidence_spans?.[index];
    return span && span.quote.split(/\n+/).filter(line => line.trim()).every(line => names.has(label(line)));
  });
}
export function evidenceLines(quote: string): EvidenceLine[] {
  let offset = 0, fenced = false;
  return quote.split('\n').map(line => {
    const start = offset; offset += line.length + 1;
    const fence = /^\s*```/.test(line);
    const literal = fenced || fence || /^ {4}/.test(line);
    if (fence) fenced = !fenced;
    // Only structural prefixes are normalized. Backslashes inside content survive.
    const heading = !literal && /^(?:#{1,6}|\\#{1,6}|(?:\\#){1,6})\s+(.+)$/.exec(line);
    const ordered = !literal && /^\s{0,3}(\d+)(?:\\?[.)])\s+(.+)$/.exec(line);
    const bullet = !literal && /^\s{0,3}[-*+]\s+(.+)$/.exec(line);
    if (heading) return { kind: 'heading', text: heading[1], start, end: start + line.length };
    if (ordered) return { kind: 'ordered', text: ordered[2], number: Number(ordered[1]), start, end: start + line.length };
    if (bullet) return { kind: 'bullet', text: bullet[1], start, end: start + line.length };
    return { kind: 'text', text: line, start, end: start + line.length, literal };
  });
}
function inline(text: string): React.ReactNode[] {
  // Code spans and quoted UI labels are opaque. No HTML parsing, URL
  // detection, or link generation. Punctuation inside literal labels survives.
  return text.split(/((?<![\\*_`])(?:`[^`\n]+`|"[^"\n]+"|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*))/g).map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>;
    if ((part.startsWith('**') && part.endsWith('**')) || (part.startsWith('__') && part.endsWith('__'))) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('*') && part.endsWith('*')) return <em key={index}>{part.slice(1, -1)}</em>;
    return part;
  });
}
function ReadableText({ quote, chunk, sourceStart = 0 }: { quote: string; chunk?: string; sourceStart?: number }) {
  const lines = evidenceLines(quote), blocks: React.ReactNode[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const mapping = chunk ? { 'data-source-chunk': chunk, 'data-source-start': sourceStart + line.start, 'data-source-end': sourceStart + line.end } : {};
    if (line.kind === 'ordered' || line.kind === 'bullet') {
      const items: React.ReactNode[] = [], ordered = line.kind === 'ordered';
      let cursor = index;
      while (cursor < lines.length && lines[cursor].kind === line.kind) {
        const item = lines[cursor];
        items.push(<li key={cursor} value={ordered ? item.number : undefined} {...(chunk ? { 'data-source-chunk': chunk, 'data-source-start': sourceStart + item.start, 'data-source-end': sourceStart + item.end } : {})} style={{ marginBottom: '8px' }}>{inline(item.text)}</li>);
        cursor++;
      }
      blocks.push(ordered ? <ol key={index} start={line.number} style={{ listStyleType: 'decimal', paddingLeft: '24px', margin: '12px 0' }}>{items}</ol> : <ul key={index} style={{ listStyleType: 'disc', paddingLeft: '24px', margin: '12px 0' }}>{items}</ul>);
      index = cursor - 1;
    } else if (line.kind === 'heading') {
      // All labels, including scope-bearing parent headings, remain visible.
      blocks.push(<h3 key={index} {...mapping} style={{ fontSize: '14px', fontWeight: 800, margin: '12px 0 8px' }}>{inline(line.text)}</h3>);
    } else {
      blocks.push(<p key={index} {...mapping} style={{ whiteSpace: 'pre-wrap', margin: line.text ? '8px 0' : 0 }}>{line.literal ? line.text : inline(line.text)}</p>);
    }
  }
  return <>{blocks}</>;
}
export function EvidenceText(props: { quote: string; chunk: string; sourceStart: number }) {
  return <ReadableText {...props} />;
}
export function AssistantAnswerText({ answer, text }: { answer?: AssistantAnswer; text: string }) {
  if (answer?.presentation?.version === 'ms59-v1' && answer.evidence_spans?.length && !answer.synthesis) {
    // MS59-TC05/17: render complete exact proof as actual actions, not span steps.
    // Each slice was checked for ordered, non-overlapping complete coverage.
    const projection = exactAssistantMainAtoms(answer.evidence_spans, answer.presentation.atoms, answer.citations);
    const visible = projection.atoms.map(atom => {
      const span = answer.evidence_spans![atom.evidence];
      return { ...atom, chunk: span.chunk_id, sourceStart: span.start + atom.start, quote: span.quote.slice(atom.start, atom.end) };
    });
    const blocks: React.ReactNode[] = [];
    for (let i = 0; i < visible.length; i++) {
      const atom = visible[i];
      if (atom.kind === 'step' || atom.kind === 'bullet') {
        const items: React.ReactNode[] = [];
        let cursor = i;
        while (cursor < visible.length && visible[cursor].kind === atom.kind) {
          const item = visible[cursor], line = evidenceLines(item.quote)[0];
          items.push(<li key={cursor} value={item.kind === 'step' ? line.number : undefined} data-source-chunk={item.chunk} data-source-start={item.sourceStart} data-source-end={item.sourceStart + item.quote.length} style={{ marginBottom: '8px' }}>{inline(line.text)}</li>);
          cursor++;
        }
        blocks.push(atom.kind === 'step' ? <ol key={i} start={evidenceLines(atom.quote)[0].number} style={{ listStyleType: 'decimal', paddingLeft: '24px', margin: '12px 0' }}>{items}</ol> : <ul key={i} style={{ listStyleType: 'disc', paddingLeft: '24px', margin: '12px 0' }}>{items}</ul>);
        i = cursor - 1;
      } else blocks.push(<EvidenceText key={i} quote={atom.quote} chunk={atom.chunk} sourceStart={atom.sourceStart} />);
    }
    const prefix = answer.evidence_spans.map(span => span.quote).join('\n\n');
    return <>{blocks}{text.startsWith(prefix) && text.slice(prefix.length).trim() && <p>{text.slice(prefix.length)}</p>}
      <details><summary>Exact supporting evidence</summary>{answer.evidence_spans.map((span, index) => <EvidenceText key={index} quote={span.quote} chunk={span.chunk_id} sourceStart={span.start} />)}</details></>;
  }
  if (answer?.synthesis && answer.evidence_spans?.length) {
    const mainBlocks = answer.synthesis.main_blocks ?? answer.synthesis.blocks;
    const prefix = mainBlocks.map(block => block.text).join('\n\n');
    // MS58-TC01/04/05: one semantic list per consecutive run, with exact
    // procedure text retained. Generated prose never gets source offsets.
    const blocks: React.ReactNode[] = [];
    let step = 0;
    for (let index = 0; index < mainBlocks.length; index++) {
      const block = mainBlocks[index];
      if (!answer.synthesis.main_blocks && synthesisNavigation(block, answer)) continue;
      const mapping = { 'data-answer-block': index, 'data-evidence-indexes': block.support.join(',') };
      if (block.kind === 'text') {
        blocks.push(<div key={index} {...mapping}><ReadableText quote={block.text} /></div>);
        continue;
      }
      const items: React.ReactNode[] = [], start = step + 1;
      let cursor = index;
      while (cursor < mainBlocks.length && mainBlocks[cursor].kind === block.kind) {
        const item = mainBlocks[cursor];
        if (!answer.synthesis.main_blocks && synthesisNavigation(item, answer)) { cursor++; continue; }
        if (item.kind === 'step') step++;
        items.push(<li key={cursor} value={item.kind === 'step' ? step : undefined} data-answer-block={cursor} data-evidence-indexes={item.support.join(',')} style={{ whiteSpace: 'pre-wrap', marginBottom: '8px' }}><ReadableText quote={item.text} /></li>);
        cursor++;
      }
      blocks.push(block.kind === 'step' ? <ol key={index} start={start} style={{ listStyleType: 'decimal', paddingLeft: '24px', margin: '12px 0' }}>{items}</ol> : <ul key={index} style={{ listStyleType: 'disc', paddingLeft: '24px', margin: '12px 0' }}>{items}</ul>);
      index = cursor - 1;
    }
    if (text.startsWith(prefix)) return <><p style={{ fontSize: '12px', color: 'var(--da-text-secondary)' }}>Evidence-based summary</p>{blocks}
      {text.slice(prefix.length).trim() && <p style={{ whiteSpace: 'pre-wrap' }}>{text.slice(prefix.length)}</p>}
      <details><summary>Exact supporting evidence</summary>{answer.evidence_spans.map((span, index) => <EvidenceText key={index} quote={span.quote} chunk={span.chunk_id} sourceStart={span.start} />)}</details></>;
  }
  const spans = answer?.evidence_spans, prefix = spans?.map(span => span.quote).join('\n\n');
  if (!spans?.length || !prefix || !text.startsWith(prefix) || spans.some(span => !answer?.citations.some(citation => citation.chunk_id === span.chunk_id))) return <p style={{ whiteSpace: 'pre-wrap' }}>{text}</p>;
  return <>{spans.map((span, index) => <EvidenceText key={index} quote={span.quote} chunk={span.chunk_id} sourceStart={span.start} />)}{text.slice(prefix.length).trim() && <p style={{ whiteSpace: 'pre-wrap' }}>{text.slice(prefix.length)}</p>}</>;
}
export function readableAssistantTime(timestamp: string, timezone?: string): string {
  const zone = timezone ?? 'UTC';
  try { return `${new Intl.DateTimeFormat('en', { timeZone: zone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(timestamp))} (${zone})`; }
  catch { return `${timestamp} (timezone unavailable)`; }
}
export function assistantLimitation(line: string): { text: string; diagnostic?: string } {
  const match = /^([A-Z][A-Z_]+):\s*(?:(SELECTION_EXHAUSTED(?::\s*(?:CONTEXT_BUDGET|OUTPUT_BUDGET_EXCEEDED))?|OUTPUT_BUDGET_EXCEEDED|CONTEXT_BUDGET_EXCEEDED|CONTEXT_BUDGET|REPROCESS_REQUIRED|UNRESOLVED_CONTEXT):\s*)?(.+)$/.exec(line);
  return match ? { text: match[3], diagnostic: [match[1], match[2]].filter(Boolean).join(': ') } : { text: line };
}
