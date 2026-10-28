import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { validatePreparedOriginals } from '../apps/admin-portal/src/server/assistant/preparation';
import { readPreparedSupport } from '../apps/admin-portal/src/server/assistant/preparedReader';
import { validateDocumentSupport } from '../packages/domain/src/services/assistantDocumentSupport';
import { discoveryIndexes, packPreparedOriginals } from '../apps/admin-portal/src/server/assistant/preparedTransport';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const source = { document_id: '00000000-0000-4000-8000-000000000001',
  version_id: '00000000-0000-4000-8000-000000000002', chunk_id: '00000000-0000-4000-8000-000000000003',
  title: 'Guide', heading_path: '', source_page: null, epoch: 1, extraction_method: 'MD',
  content: 'Review payment.\n\nNever approve mismatched amounts.',
  content_hash: hash('Review payment.\n\nNever approve mismatched amounts.') };
const binding = hash(JSON.stringify([Object.fromEntries(['document_id', 'version_id', 'chunk_id', 'heading_path', 'content_hash']
  .map(key => [key, source[key as keyof typeof source]]))]));
function artifact() {
  return { contract: 'ragfix-prepared-v1', source_binding: binding,
    groups: [{ id: 0, label: 'Payments', applies_to: 'Reviewing payments', ranges: [[0, 1]], requires: [], scope: 'WORKFLOW' }],
    units: [{ i: 0, chunk_id: source.chunk_id, heading: '', text: 'Review payment.', start: 0, end: 15 },
      { i: 1, chunk_id: source.chunk_id, heading: '', text: 'Never approve mismatched amounts.', start: 17, end: source.content.length }] };
}
describe('QAD-TC44-TC46: prepared publication boundary', () => {
  it('accepts exact complete original accounting', () => {
    expect(validatePreparedOriginals(artifact(), [source])).toBe(true);
  });
  it.each(['omitted_rule', 'invented_quote', 'stale_hash', 'fabricated_dependency'])('rejects %s before persistence', failure => {
    const candidate = artifact();
    if (failure === 'omitted_rule') { candidate.units.pop(); candidate.groups[0].ranges = [[0, 0]]; }
    if (failure === 'invented_quote') candidate.units[1].text = 'Approve every customer payment.';
    if (failure === 'stale_hash') candidate.source_binding = 'f'.repeat(64);
    if (failure === 'fabricated_dependency') candidate.groups[0].requires = [63];
    expect(validatePreparedOriginals(candidate, [source])).toBe(false);
  });
  it('rejects a declared condition outside the computed dependency closure', () => {
    const candidate = artifact();
    const groups = [{ ...candidate.groups[0], ranges: [[0,0]], conditions: [1] },
      { ...candidate.groups[0], id: 1, ranges: [[1,1]], conditions: [] }];
    expect(validatePreparedOriginals({ ...candidate, groups }, [source])).toBe(false);
  });
});

function reader() {
  const index = { document_id: source.document_id, version_id: source.version_id, title: source.title,
    artifact_sha256: 'a'.repeat(64), source_binding: binding, groups: artifact().groups };
  const catalog = { contract: 'ragfix-prepared-v2', epoch: 1, complete: true, documents: [index] };
  const selections = [{ version_id: source.version_id, artifact_sha256: index.artifact_sha256, groups: [0] }];
  const evidence = { contract: 'ragfix-prepared-v2', epoch: 1, indexes: [{ ...index, selected_groups: [0] }], sources: [source], units: artifact().units };
  const ports = { catalog: vi.fn(async () => catalog),
    select: vi.fn(async (_payload: unknown) => ({ contract: 'ragfix-prepared-v2', selections, clarification: null })),
    evidence: vi.fn(async (_selected: unknown) => evidence),
    answer: vi.fn(async (payload: unknown) => ({ contract: 'ragfix-prepared-v2', binding: hash(JSON.stringify(payload)),
      outcome: 'COMPLETE', clarification: null,
      spans: artifact().units.map(unit => ({ chunk_id:unit.chunk_id, quote:unit.text, start:unit.start,end:unit.end })),
      synthesis: { version: 'ms57-v1', scope: 'FACTUAL', outcome: 'COMPLETE', gaps: [],
        blocks: [{ kind: 'text', text: 'Review proof and do not approve a mismatched amount.', support: [0,1] }] },
      counts: { bundles: 1, calls: 2, units: 2 } })),
  };
  return { catalog, selections, evidence, ports };
}
describe('QAD-TC44-TC46: prepared reader negotiation and proof', () => {
  it('collapses only equivalent dependency closures and retains every task description', () => {
    const fixture=reader();
    const group=fixture.catalog.documents[0].groups[0];
    const index={...fixture.catalog.documents[0],groups:[{...group,id:0,ranges:[[0,0]],requires:[1]},
      {...group,id:1,label:'Restriction',ranges:[[1,1]],requires:[0]}]};
    const projected=discoveryIndexes([index])[0];
    expect(projected.groups).toHaveLength(2);
    expect(projected.entrypoints).toEqual([{id:0,units:2,covers:[0,1]}]);
    const narrower=discoveryIndexes([{...index,groups:[{...index.groups[0],requires:[]},index.groups[1]]}])[0];
    expect(narrower.entrypoints).toEqual([{id:0,units:1,covers:[0]},{id:1,units:2,covers:[0,1]}]);
  });
  it('rejects a missing closure unit and forged original text before inference', () => {
    const missing = reader(); missing.evidence.units.pop();
    expect(() => packPreparedOriginals(missing.evidence)).toThrow();
    const forged = reader(); forged.evidence.units[0].text = 'Approve payment';
    expect(() => packPreparedOriginals(forged.evidence)).toThrow();
  });
  it('fits repeated original contexts without transporting neighboring chunk text or losing addresses', () => {
    const fixture = reader();
    const text = 'Review proof and never approve an unmatched amount.';
    const sources = Array.from({length:400}, (_, i) => ({ ...source,
      chunk_id:`00000000-0000-4000-8000-${String(i+10).padStart(12,'0')}`, heading_path:'Heading '.repeat(60),
      content:text+'\n\n'+ 'Unrelated neighboring material. '.repeat(30), content_hash:'a'.repeat(64) }));
    const evidence = {...fixture.evidence, sources, indexes:fixture.evidence.indexes.map(index=>({...index,
      groups:index.groups.map(group=>({...group,ranges:[[0,399]] as [number,number][]}))})),
      units:sources.map((item,i)=>({i,chunk_id:item.chunk_id,heading:item.heading_path,text,start:0,end:text.length}))};
    expect(Buffer.byteLength(JSON.stringify(evidence))).toBeGreaterThan(260000);
    const packed=packPreparedOriginals(evidence);
    expect(Buffer.byteLength(JSON.stringify(packed))).toBeLessThan(100000);
    expect(packed.units).toHaveLength(400);
    expect(packed.texts).toEqual([text]);
    packed.units.forEach((unit,i)=>{
      expect(packed.chunks[unit.c].c).toBe(sources[i].chunk_id);
      expect(packed.headings[packed.chunks[unit.c].h]).toBe(sources[i].heading_path);
      expect(packed.texts[unit.t]).toBe(sources[i].content.slice(unit.s,unit.e));
    });
  });
  it('selects workflows before fetching and answering from original evidence', async () => {
    const fixture = reader();
    const answer = await readPreparedSupport('How do we review payments?', 1, true, fixture.ports);
    expect(answer?.result.outcome).toBe('COMPLETE');
    expect(fixture.ports.evidence).toHaveBeenCalledWith(fixture.selections);
    expect(fixture.ports.select.mock.invocationCallOrder[0]).toBeLessThan(fixture.ports.evidence.mock.invocationCallOrder[0]);
    expect(fixture.ports.answer.mock.calls[0][0]).toMatchObject({ contract:'ragfix-prepared-v2', evidence: {texts:artifact().units.map(unit=>unit.text)} });
  });
  it('retains the complete-document path until every authorized index is ready', async () => {
    const fixture = reader();
    fixture.catalog.complete = false;
    expect(await readPreparedSupport('What should I do?', 1, true, fixture.ports)).toBeUndefined();
    expect(fixture.ports.select).not.toHaveBeenCalled();
  });
  it('rejects fabricated selection ids before evidence access', async () => {
    const fixture = reader();
    fixture.selections[0].groups = [63];
    await expect(readPreparedSupport('What should I do?', 1, true, fixture.ports)).rejects.toMatchObject({ code: 'INVALID_MODEL_OUTPUT' });
    expect(fixture.ports.evidence).not.toHaveBeenCalled();
  });
  it('rejects an epoch change before sending original evidence to inference', async () => {
    const fixture = reader();
    fixture.evidence.epoch = 2;
    await expect(readPreparedSupport('What should I do?', 1, true, fixture.ports)).rejects.toMatchObject({ code: 'KNOWLEDGE_CHANGED' });
    expect(fixture.ports.answer).not.toHaveBeenCalled();
  });
  it('rejects proof from a neighboring original unit outside the admitted closure', async () => {
    const fixture = reader();
    fixture.evidence.units = [fixture.evidence.units[0]];
    fixture.evidence.indexes[0].groups[0].ranges = [[0,0]];
    await expect(readPreparedSupport('How do we review payments?',1,true,fixture.ports)).rejects.toMatchObject({code:'INVALID_MODEL_OUTPUT'});
  });
  it('does not silently accept a prepared response through the old contract', async () => {
    const fixture = reader();
    const result = await fixture.ports.answer({});
    expect(validateDocumentSupport(result, result.binding, [source])).toBeUndefined();
    expect(validateDocumentSupport(result, result.binding, [source], 'ragfix-prepared-v2')).toBeDefined();
  });
});
