// PRD-F26/F27 / SDD-C20-C24 / QAD-TC44/46: explicit local Qwen profile.
// Existing preview ports, identity checks and public quotas remain binding.
const { spawn } = require('node:child_process');
const { resolve } = require('node:path');

const mode = process.argv[2];
if (!['api', 'admin', 'production', 'staff', 'customer', 'customer-production'].includes(mode)) throw Error('INVALID_QWEN_PREVIEW_MODE');
const approved = new Set(['Qwen/Qwen3-32B', 'Qwen/Qwen3-235B-A22B-Instruct-2507', 'Qwen/Qwen3.6-35B-A3B']);
const planner = process.env.RAG_ANSWER_MODEL || 'Qwen/Qwen3-32B';
const document = process.env.RAG_DOCUMENT_ANSWER_MODEL || 'Qwen/Qwen3.6-35B-A3B';
if (!approved.has(planner) || !approved.has(document)) throw Error('UNAPPROVED_QWEN_MODEL');
const env = {
  ...process.env,
  RAG_PREVIEW_API_PORT: process.env.RAG_PREVIEW_API_PORT || '8014',
  RAG_ANSWER_MODEL: planner,
  RAG_DOCUMENT_ANSWER_MODEL: document,
  RAG_INTERNAL_DISCOVERY_MODEL: document,
  RAG_DEEPINFRA_SERVICE_TIER: 'standard',
  RAG_INTERNAL_CATALOG_DISCOVERY: 'true',
  CUSTOMER_ASSISTANT_CATALOG_DISCOVERY: 'true',
  RAG_CUSTOMER_BATCHED_SUPPORT: 'true',
  RAG_TASK_FRAMED_DRAFT: process.env.RAG_TASK_FRAMED_DRAFT || 'true',
  RAG_QWEN_COMPACT_DRAFT: process.env.RAG_QWEN_COMPACT_DRAFT || 'true',
  RAG_QWEN_COMPACT_CATALOG: process.env.RAG_QWEN_COMPACT_CATALOG || 'true',
  RAG_QWEN_CATALOG_RETRY: 'true',
  RAG_QWEN_INDEXED_SOURCES: process.env.RAG_QWEN_INDEXED_SOURCES || 'false',
  RAG_BENCHMARK_ENABLED: 'false',
  RAG_FAST_MODEL_RELEASE: 'false',
};
const child = spawn(process.execPath, [resolve(__dirname, 'ragfix-preview.cjs'), mode],
  { cwd: resolve(__dirname, '..'), env, stdio: 'inherit' });
child.on('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
