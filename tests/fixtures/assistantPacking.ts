import { createHash } from 'node:crypto';

// Existing gateway suites control model transport. MS60 packing behavior is
// separately exercised with the real packer and overflow-specific tests.
export function admittedPacking(options?: RequestInit): Response {
  return Response.json({ version: 'ms60-v1', binding: createHash('sha256').update(String(options?.body)).digest('hex'),
    quote_count: 1, max_quote_utf16: 100, fits: true, reason: null });
}
