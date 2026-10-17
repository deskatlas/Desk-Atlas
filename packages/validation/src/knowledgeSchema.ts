import { z } from 'zod';
export { z as knowledgeValidation } from 'zod';

// SPEC-5 / PRD-F27 / SDD-C23,C24 / QAD-TC45.
export const KnowledgeAudienceSchema = z.enum(['ADMIN_ONLY', 'ADMIN_AND_STAFF']);
export const KnowledgeTypeSchema = z.enum(['MD', 'DOC', 'DOCX', 'PDF']);
const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const KnowledgeUploadSchema = z.object({
  // PRD-F27: administrators may name the document before confirming upload.
  title: z.string().trim().min(1).max(200).regex(/^[^<>\x00-\x1f]+$/).optional(),
  audience: KnowledgeAudienceSchema.default('ADMIN_ONLY'),
  filename: z.string().min(1).max(255).regex(/^[^/\\\x00-\x1f]+\.(md|doc|docx|pdf)$/i),
  declared_type: KnowledgeTypeSchema,
  replace_document_id: z.string().uuid().optional(),
  expected_revision: revision.optional(),
  request_id: z.string().uuid(),
}).strict().superRefine((v, c) => {
  if (v.filename.split('.').pop()?.toUpperCase() !== v.declared_type)
    c.addIssue({ code: 'custom', message: 'Filename and type must match' });
  if (v.replace_document_id && !v.expected_revision)
    c.addIssue({ code: 'custom', message: 'Replacement requires current revision' });
});
export const KnowledgePublishSchema = z.object({
  evidence_review: z.record(z.string().regex(/^s\d+$/), z.enum(['DIRECT', 'QUALIFICATION', 'CONTEXT'])).refine(roles => Object.keys(roles).length <= 1000).optional(),
  acknowledge_evidence: z.boolean().optional(),
  expected_revision: revision, audience: KnowledgeAudienceSchema,
  acknowledge_warnings: z.boolean(), request_id: z.string().uuid(),
  acknowledge_structure: z.boolean().default(false),
  document_review: z.object({
    source_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    content_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    structure_manifest_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    generation: z.number().int().positive(), audience: KnowledgeAudienceSchema,
  }).strict().optional(),
  structure_review: z.array(z.object({
    section_id: z.string().regex(/^(s\d+|unstructured)$/), scope: z.enum(['LOCAL', 'DOCUMENT', 'UNRESOLVED']),
    dependencies: z.array(z.string().regex(/^s\d+$/)).max(1000),
    acknowledge_references: z.boolean(),
  }).strict()).max(1000).default([]),
}).strict();
export const KnowledgeRevisionSchema = z.object({ expected_revision: revision, request_id: z.string().uuid() }).strict();
export const KnowledgeAudienceChangeSchema = KnowledgeRevisionSchema.extend({ audience: KnowledgeAudienceSchema });
export const KnowledgeFinalizeSchema = z.object({ request_id: z.string().uuid() }).strict();
export const KnowledgeLeaseSchema = z.object({ lease_token: z.string().uuid(), generation: z.number().int().positive() });
// MS46-TC10: null means no work, including a just-terminalized exhausted job.
export const KnowledgeClaimSchema = z.object({
  job: z.object({ id: z.string().uuid(), kind: z.enum(['INGEST', 'PURGE']),
    generation: z.number().int().positive(), lease_token: z.string().uuid() }).passthrough(),
  version: z.object({ id: z.string().uuid(), source_object_key: z.string().nullable(),
    preview_object_key: z.string().nullable() }).passthrough(),
}).strict().nullable();
const sectionContext = z.object({ version: z.literal(1), section_id: z.string().regex(/^(s\d+|unstructured)$/), dependencies: z.array(z.string().regex(/^s\d+$/)).max(10000), unresolved: z.boolean() }).strict();
export const KnowledgeChunkSchema = z.object({
  section_context: z.union([sectionContext, sectionContext.extend({
    version: z.literal(2), ancestors: z.array(z.string().regex(/^s\d+$/)).max(1000),
    references: z.array(z.string().regex(/^s\d+$/)).max(1000),
    scope: z.enum(['UNREVIEWED', 'LOCAL', 'DOCUMENT', 'UNRESOLVED']), structure_known: z.boolean(),
    unresolved_references: z.boolean(),
  }).strict()]).optional(),
  structure_sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  ordinal: z.number().int().nonnegative(), heading_path: z.string().max(2000),
  page_start: z.number().int().positive().nullable(), page_end: z.number().int().positive().nullable(),
  content: z.string().min(1), content_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  token_count: z.number().int().min(1).max(800), extraction_method: z.enum(['TEXT', 'OCR', 'MIXED']),
  embedding: z.array(z.number().finite()).length(1024).refine(v => Math.abs(Math.hypot(...v) - 1) < 0.001, 'Embedding must be normalized'),
}).strict();
export const KnowledgeCheckpointSchema = KnowledgeLeaseSchema.extend({
  stage: z.enum(['VALIDATING', 'CONVERTING', 'EXTRACTING', 'OCR', 'NORMALIZING', 'CHUNKING', 'EMBEDDING', 'VERIFYING']),
  chunks: z.array(KnowledgeChunkSchema).max(32).default([]),
}).strict();
export const KnowledgeCompleteSchema = KnowledgeLeaseSchema.extend({
  preparation_policy: z.literal('kb-auto-v1').optional(),
  error_code: z.enum(['TYPE_MISMATCH', 'UNSAFE_FILE', 'ENCRYPTED_FILE', 'MALFORMED_FILE', 'EMPTY_TEXT', 'PARSER_FAILED', 'PARSER_REVISION_MISMATCH', 'STORAGE_FAILED', 'EMBEDDING_FAILED', 'RESOURCE_LIMIT', 'MANIFEST_INVALID', 'CONTENT_LIMIT', 'UNREADABLE_PAGE']).optional(),
  retryable: z.boolean().default(false),
  expected_chunk_count: z.number().int().positive().optional(),
  content_sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  manifest_sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  structure_manifest_sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  parser_fingerprint: z.string().min(1).max(2000).optional(),
  embedding_fingerprint: z.string().min(1).max(2000).optional(),
  warning_codes: z.array(z.enum(['OCR_REVIEW', 'TABLE_REVIEW', 'WORD_EMBEDDED_CONTENT', 'TRACKED_CHANGES', 'LEGACY_CONVERSION', 'HTML_REMOVED', 'BLANK_PAGE_SKIPPED', 'MIXED_CONTENT_REVIEW', 'SECTION_SCOPE_REVIEW', 'SECTION_CONTEXT_UNRESOLVED'])).default([]),
  extraction_manifest: z.array(z.object({ heading: z.string(), page: z.number().int().positive().nullable(), method: z.enum(['TEXT', 'OCR', 'MIXED']), outcome: z.enum(['EXTRACTED', 'SKIPPED_BLANK']).default('EXTRACTED'),
    normalized_start: z.number().int().nonnegative().optional(), normalized_end: z.number().int().nonnegative().optional(),
    section_id: z.string().regex(/^s\d+$/).optional(),
  }).strict()).default([]),
}).strict();
