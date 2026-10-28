import { z } from 'zod';
import { assistantSourceSchema, assistantPlanSchema } from './assistantSchema';

// PRD-F26/F27 / ERD-E25,E27 / QAD-TC44-TC46: derived discovery is not policy.
export const preparedSupportGroupSchema = z.object({
  id: z.number().int().min(0).max(63), label: z.string().min(1).max(100),
  applies_to: z.string().min(1).max(240),
  ranges: z.array(z.tuple([z.number().int().min(0).max(999), z.number().int().min(0).max(999)]))
    .min(1).max(64).refine(ranges => ranges.every(([first, last]) => last >= first)),
  requires: z.array(z.number().int().min(0).max(63)).max(64),
  scope: z.enum(['WORKFLOW', 'GLOBAL', 'DOCUMENT']),
  conditions: z.array(z.number().int().min(0).max(999)).max(128).default([]),
}).strict();
export const preparedSupportArtifactSchema = z.object({
  contract: z.literal('ragfix-prepared-v1'), source_binding: z.string().regex(/^[a-f0-9]{64}$/),
  groups: z.array(preparedSupportGroupSchema).min(1).max(64),
  units: z.array(z.object({ i: z.number().int().min(0).max(999),
    chunk_id: z.string().uuid(), heading: z.string().max(500), text: z.string().min(1).max(1500),
    start: z.number().int().nonnegative(), end: z.number().int().positive(),
  }).strict().refine(unit => unit.end - unit.start === unit.text.length)).min(1).max(1000),
}).strict().superRefine((artifact, context) => {
  const ids = new Set(artifact.groups.map(group => group.id));
  const covered = new Set<number>();
  if (ids.size !== artifact.groups.length || artifact.units.some((unit, index) => unit.i !== index)) {
    context.addIssue({ code: 'custom', message: 'Duplicate or unordered source addresses' });
  }
  for (const group of artifact.groups) {
    if (new Set(group.requires).size !== group.requires.length || group.requires.some(id => !ids.has(id))) {
      context.addIssue({ code: 'custom', message: 'Invalid support dependency' });
    }
    if (group.conditions.some(id => id >= artifact.units.length)) context.addIssue({ code: 'custom', message: 'Fabricated condition address' });
    for (const [first, last] of group.ranges) {
      if (last >= artifact.units.length) context.addIssue({ code: 'custom', message: 'Fabricated support address' });
      for (let i = first; i <= last; i++) covered.add(i);
    }
  }
  if (covered.size !== artifact.units.length) context.addIssue({ code: 'custom', message: 'Incomplete original accounting' });
  if (artifact.groups.some(group => group.requires.some(id => !ids.has(id)))) return;
  for (const group of artifact.groups) {
    const pending = artifact.groups.some(item => item.scope === 'DOCUMENT') ? [...ids]
      : [group.id, ...artifact.groups.filter(item => item.scope === 'GLOBAL').map(item => item.id)];
    const visited = new Set<number>(), available = new Set<number>();
    while (pending.length) {
      const id = pending.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);
      const required = artifact.groups.find(item => item.id === id)!;
      pending.push(...required.requires);
      for (const [first, last] of required.ranges) for (let i = first; i <= last; i++) available.add(i);
    }
    if (group.conditions.some(id => !available.has(id))) context.addIssue({ code: 'custom', message: 'Required condition missing from closure' });
  }
});
export const preparedSupportLeaseSchema = z.object({
  lease_token: z.string().uuid(), generation: z.number().int().positive(),
}).strict();
export const preparedSupportClaimSchema = z.object({
  job: z.object({ id: z.string().uuid(), version_id: z.string().uuid(),
    generation: z.number().int().positive(), lease_token: z.string().uuid(), compiler_fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  sources: z.array(assistantSourceSchema).min(1).max(1000),
}).strict().nullable();
export const preparedSupportCompletionSchema = preparedSupportLeaseSchema.extend({
  artifact_text: z.string().min(1).max(400000),
  compiler_fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  model: z.enum(['Qwen/Qwen3-32B', 'Qwen/Qwen3-235B-A22B-Instruct-2507', 'Qwen/Qwen3.6-35B-A3B']),
  calls: z.number().int().min(4).max(47), bytes: z.number().int().positive().max(2000000),
  input_tokens: z.number().int().nonnegative().max(2000000),
  output_tokens: z.number().int().nonnegative().max(44500),
}).strict();
export type PreparedSupportArtifact = z.infer<typeof preparedSupportArtifactSchema>;

export const preparedSupportIndexSchema = z.object({
  document_id: z.string().uuid(), version_id: z.string().uuid(), title: z.string().max(200),
  artifact_sha256: z.string().regex(/^[a-f0-9]{64}$/), source_binding: z.string().regex(/^[a-f0-9]{64}$/),
  groups: z.array(preparedSupportGroupSchema).min(1).max(64),
}).strict();
export const preparedSupportCatalogSchema = z.object({
  contract: z.literal('ragfix-prepared-v2'), epoch: z.number().int().nonnegative(), complete: z.boolean(),
  documents: z.array(preparedSupportIndexSchema).max(1000),
}).strict().refine(catalog => new Set(catalog.documents.map(document => document.version_id)).size === catalog.documents.length);
export const preparedSupportSelectionSchema = z.object({
  contract: z.literal('ragfix-prepared-v2'),
  selections: z.array(z.object({ version_id: z.string().uuid(), artifact_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    groups: z.array(z.number().int().min(0).max(63)).min(1).max(64),
  }).strict()).max(12),
  clarification: z.string().min(1).max(300).nullable(),
}).strict().refine(selection => !selection.clarification || selection.selections.length === 0)
  .refine(selection => !selection.clarification || assistantPlanSchema.safeParse({ kind: 'CLARIFY', query: '', tools: [], clarification: selection.clarification }).success)
  .refine(selection => new Set(selection.selections.map(item => item.version_id)).size === selection.selections.length);
export const preparedSupportEvidenceSchema = z.object({
  contract: z.literal('ragfix-prepared-v2'), epoch: z.number().int().nonnegative(),
  indexes: z.array(preparedSupportIndexSchema.extend({ selected_groups: z.array(z.number().int().min(0).max(63)).min(1).max(64) }).strict()).min(1).max(12),
  sources: z.array(assistantSourceSchema).min(1).max(1000),
  units: z.array(z.object({ i: z.number().int().nonnegative(), chunk_id: z.string().uuid(), heading: z.string().max(500),
    text: z.string().min(1).max(1500), start: z.number().int().nonnegative(), end: z.number().int().positive(),
  }).strict().refine(unit => unit.end - unit.start === unit.text.length)).min(1).max(1000),
}).strict().refine(evidence => new Set(evidence.sources.map(source => source.chunk_id)).size === evidence.sources.length);
