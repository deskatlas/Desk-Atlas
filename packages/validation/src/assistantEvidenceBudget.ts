// MS56-TC08 / SDD-C20/C21: measured wire limits shared with Python.
// SQL retains the same six-source and 1,000-unit closure bounds.
export const assistantEvidenceBudget: {
  version: number; candidates: number; sources: number; quotes: number;
  quote_utf16: number; request_bytes: number; model_request_bytes: number;
  context_tokens: number; template_headroom: number; passages: number; graph_units: number;
} = require('../../../services/rag/rag/evidence-budget.json');
