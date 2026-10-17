import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { assistantSearchQueries, fuseAssistantCandidates } from '@deskatlas/domain';
import { assistantEmbeddingBatchSchema, assistantHybridCandidatesSchema, assistantPlanSchema } from '@deskatlas/validation';

const source = (content: string) => ({ document_id: randomUUID(), version_id: randomUUID(), chunk_id: randomUUID(), title: 'Synthetic',
  heading_path: 'Rules', source_page: null, epoch: 1, extraction_method: 'TEXT', content_hash: 'a'.repeat(64), content });
const search = (original: string, standalone?: string, alternatives: string[] = []) => ({ version: 'ms55-v1', original, standalone, alternatives });

describe('MS55-TC03/04/08 bounded query understanding', () => {
  it('retains original conditions, labels, names and identifiers in every input', () => {
    const original = 'Do NOT checkout Juan early on 2026-10-15 with an unpaid balance; AB-123, My Activity';
    const queries = assistantSearchQueries(original, search(original, 'Guest early departure', ['Checkout restrictions', 'Unpaid balance']));
    expect(queries).toHaveLength(4);
    expect(queries[0]).toBe(original);
    expect(queries.every(query => query.startsWith(original))).toBe(true);
  });
  it('deduplicates equivalent phrases and falls back for malformed/mismatched variants', () => {
    const original = 'Paano ang check out?';
    expect(assistantSearchQueries(original, search(original, ' PAANO ang check out? ', ['Guest departure', 'guest  departure']))).toHaveLength(2);
    for (const bad of [undefined, { ...search(original), version: 'future' }, search('other'), search(original, 'x', ['a','b','c']), { ...search(original), role: 'ADMIN' }]) {
      expect(assistantSearchQueries(original, bad)).toEqual([original]);
    }
    expect(assistantSearchQueries('x'.repeat(2000), search('x'.repeat(2000), 'y'.repeat(2000)))).toEqual(['x'.repeat(2000)]);
  });
  it('preserves a valid plan when search aids are invalid, but rejects unknown tools', () => {
    expect(assistantPlanSchema.safeParse({ kind: 'DOCUMENT', query: 'Original', tools: [], search: { version: 'bad' } }).success).toBe(true);
    expect(assistantPlanSchema.safeParse({ kind: 'DOCUMENT', query: '', tools: [{ name: 'run_sql', args: {} }] }).success).toBe(false);
  });
  it('rejects invalid vectors, unbounded branches and fabricated source fields', () => {
    expect(assistantEmbeddingBatchSchema.safeParse({ embeddings: [{ vector: Array(1024).fill(0) }] }).success).toBe(false);
    expect(assistantHybridCandidatesSchema.safeParse({ semantic: [[{ ...source('rule'), role: 'ADMIN' }]], lexical: [[]] }).success).toBe(false);
    expect(assistantHybridCandidatesSchema.safeParse({ semantic: [Array.from({ length: 13 }, () => source('rule'))], lexical: [[]] }).success).toBe(false);
  });
});

describe('MS55-TC05/07 deterministic rank fusion', () => {
  it('retains semantic-only, lexical-only and contrary rules with unchanged provenance', () => {
    const semantic = source('Use an interview workspace.'), lexical = source('AB-123 is a screen label.'), contrary = source('Staff must not approve proofs.');
    const fused = fuseAssistantCandidates({ semantic: [[semantic, contrary]], lexical: [[lexical, contrary]] });
    expect(fused[0]).toEqual(contrary);
    expect(new Set(fused.map(item => item.chunk_id))).toEqual(new Set([semantic.chunk_id, lexical.chunk_id, contrary.chunk_id]));
    expect(fused).toContainEqual(semantic); expect(fused).toContainEqual(lexical);
  });
  it('ignores repeated hits within a branch and bounds the union with stable ties', () => {
    const items = Array.from({ length: 12 }, () => source('Synthetic description'));
    expect(fuseAssistantCandidates({ semantic: [[items[0],items[0]]], lexical: [[items[1]]] })[0]).toEqual(
      [items[0], items[1]].sort((a,b) => a.document_id < b.document_id ? -1 : 1)[0]);
    const branches = { semantic: [items], lexical: [[...items].reverse()] };
    expect(fuseAssistantCandidates(branches)).toHaveLength(12);
    expect(fuseAssistantCandidates(branches)).toEqual(fuseAssistantCandidates(branches));
  });
  it('rejects identity/hash/epoch changes rather than merging incompatible publications', () => {
    const item = source('Rule');
    for (const changed of [{ ...item, epoch: 2 }, { ...item, content_hash: 'b'.repeat(64) }, { ...item, content: 'Changed' }]) {
      expect(() => fuseAssistantCandidates({ semantic: [[item]], lexical: [[changed]] })).toThrow('Published knowledge changed');
    }
    expect(() => fuseAssistantCandidates({ semantic: [[]], lexical: [] })).toThrow('Invalid retrieval branches');
  });
});
