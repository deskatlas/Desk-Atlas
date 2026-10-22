import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// PRD-F26/F27 / SDD-C20-C24 / QAD-TC44-TC46: release admission, no inference.
const require = createRequire(import.meta.url);
const { assessReadiness } = require('../scripts/rag-evidence-readiness.cjs') as {
  assessReadiness(input: { contract?: string; publishedContracts: (string | null)[]; serviceContracts: string[] }): { ready: boolean; reason: string };
};

describe('payment audit evidence reader release admission', () => {
  const current = { publishedContracts: [null, 'ms65-v1'], serviceContracts: ['ms65-v1'] };
  it('blocks an unconfigured production reader even with an otherwise ready service', () => {
    expect(assessReadiness(current)).toEqual({ ready: false, reason: 'READER_NOT_CONFIGURED' });
  });
  it.each(['legacy', 'ms59-v1'])('blocks %s against newer publications', contract => {
    expect(assessReadiness({ ...current, contract })).toEqual({ ready: false, reason: 'READER_INCOMPATIBLE' });
  });
  it('admits the document reader for mixed original and MS65 publications', () => {
    expect(assessReadiness({ ...current, contract: 'ms65-v1' })).toEqual({ ready: true, reason: 'COMPATIBLE' });
  });
  it('does not infer remote capability from a healthy old service', () => {
    expect(assessReadiness({ ...current, contract: 'ms65-v1', serviceContracts: [] }).ready).toBe(false);
  });
  it('retains explicit legacy deployments with only legacy publications', () => {
    expect(assessReadiness({ contract: 'legacy', publishedContracts: [null], serviceContracts: [] }).ready).toBe(true);
  });
  it('rejects unknown reader and publication contracts', () => {
    expect(assessReadiness({ ...current, contract: 'future' }).ready).toBe(false);
    expect(assessReadiness({ ...current, contract: 'ms65-v1', publishedContracts: ['future'] }).ready).toBe(false);
  });
});
