import { describe, expect, it } from 'vitest';
import launcher from '../scripts/rag-start.cjs';

const secret = 'synthetic-launcher-secret-at-least-32-characters';
const saved = {
  KB_ENABLED: 'true', KB_WORKER_TOKEN: secret,
  RAG_SERVICE_TOKEN: secret, RAG_CAPABILITY_SECRET: secret,
  RAG_SCOPE_ID: 'synthetic', RAG_EMBEDDING_FINGERPRINT: 'a'.repeat(64),
  SUPABASE_SERVICE_ROLE_KEY: 'must-not-reach-python',
};
const answer = { model: 'synthetic-model', manifest_digest: 'b'.repeat(64) };

describe('SPEC6-TC01: saved local launcher configuration', () => {
  it('preserves explicit customer access settings for the API without enabling them by default', () => {
    const configured = { ...saved, CUSTOMER_ASSISTANT_ENABLED: 'true', CUSTOMER_ASSISTANT_VERIFIED_ENABLED: 'false' };
    const env = launcher.runtimeEnvironment('api', configured, {}, answer);
    expect(env.CUSTOMER_ASSISTANT_ENABLED).toBe('true');
    expect(env.CUSTOMER_ASSISTANT_VERIFIED_ENABLED).toBe('false');
    expect(launcher.runtimeEnvironment('api', saved, {}, answer).CUSTOMER_ASSISTANT_ENABLED).toBeUndefined();
  });
  it('forwards the provider key only to an explicitly hosted ingestion worker', () => {
    const env = launcher.runtimeEnvironment('worker', { ...saved, RAG_EMBEDDING_PROVIDER: 'deepinfra',
      DEEPINFRA_API_KEY: secret }, {}, answer);
    expect(env.RAG_EMBEDDING_PROVIDER).toBe('deepinfra');
    expect(env.DEEPINFRA_API_KEY).toBe(secret);
    const purge = launcher.runtimeEnvironment('purge', { ...saved, RAG_EMBEDDING_PROVIDER: 'deepinfra',
      DEEPINFRA_API_KEY: secret }, {}, answer);
    expect(purge.DEEPINFRA_API_KEY).toBeUndefined();
  });
  it('selects DeepInfra without starting the saved local GPU profile', () => {
    const env = launcher.runtimeEnvironment('api', { ...saved, RAG_MODEL_PROVIDER: 'deepinfra',
      DEEPINFRA_API_KEY: secret, OLLAMA_URL: 'http://127.0.0.1:11435', RAG_MODEL_GPU_LAYERS: '-1' }, {}, answer);
    expect(env.RAG_ANSWER_MODEL).toBe('Qwen/Qwen3-32B');
    expect(env.DEEPINFRA_API_KEY).toBe(secret);
    expect(launcher.runtimeCommand('api', env, 'synthetic-service')).toEqual([expect.stringContaining('serve_local.py')]);
  });
  it('does not forward inherited provider credentials to either worker lane', () => {
    for (const mode of ['worker', 'purge']) {
      const env = launcher.runtimeEnvironment(mode, saved, { DEEPINFRA_API_KEY: secret }, answer);
      expect(env.DEEPINFRA_API_KEY).toBeUndefined();
    }
  });
  it('rejects missing DeepInfra credentials and unknown provider selection', () => {
    expect(() => launcher.runtimeEnvironment('api', { ...saved, RAG_MODEL_PROVIDER: 'deepinfra' }, {}, answer)).toThrow('DEEPINFRA_API_KEY');
    expect(() => launcher.runtimeEnvironment('api', { ...saved, RAG_MODEL_PROVIDER: 'unknown' }, {}, answer)).toThrow('RAG_MODEL_PROVIDER');
  });
  it('preserves the saved prompt batch and explicit runtime override', () => {
    const env = launcher.runtimeEnvironment('api', { ...saved, RAG_MODEL_BATCH_SIZE: '64' }, {}, answer);
    expect(env.RAG_MODEL_BATCH_SIZE).toBe('64');
    const override = launcher.runtimeEnvironment('api', { ...saved, RAG_MODEL_BATCH_SIZE: '64' }, { RAG_MODEL_BATCH_SIZE: '1024' }, answer);
    expect(override.RAG_MODEL_BATCH_SIZE).toBe('1024');
  });
  it('reuses the existing Vulkan launcher for the saved isolated GPU profile', () => {
    const env = launcher.runtimeEnvironment('api', { ...saved, OLLAMA_URL: 'http://127.0.0.1:11435', RAG_MODEL_GPU_LAYERS: '-1' }, {}, answer);
    expect(launcher.runtimeCommand('api', env, 'synthetic-service')).toEqual([expect.stringContaining('serve_local.py'), '--gpu']);
  });
  it('preserves explicit CPU overrides and the single-process private binding', () => {
    const env = launcher.runtimeEnvironment('api', { ...saved, OLLAMA_URL: 'http://127.0.0.1:11435', RAG_MODEL_GPU_LAYERS: '-1' }, { RAG_MODEL_GPU_LAYERS: '0' }, answer);
    expect(launcher.runtimeCommand('api', env, 'synthetic-service')).toEqual([expect.stringContaining('serve_local.py')]);
    expect(launcher.runtimeCommand('worker', env, 'synthetic-service')).toEqual(['-m', 'knowledge.worker']);
  });
  it('forwards only worker settings while retaining system executable paths', () => {
    const env = launcher.runtimeEnvironment('worker', saved, {
      PATH: 'synthetic-path', SUPABASE_SERVICE_ROLE_KEY: 'inherited-secret',
      RAG_SERVICE_TOKEN: secret, KB_WORKER_TOKEN: secret,
    }, answer);
    expect(env.KB_WORKER_TOKEN).toBe(secret);
    expect(env.KB_GATEWAY_URL).toBe('http://127.0.0.1:3000');
    expect(env.PATH).toBe('synthetic-path');
    expect(env).not.toHaveProperty('SUPABASE_SERVICE_ROLE_KEY');
    expect(env).not.toHaveProperty('RAG_SERVICE_TOKEN');
  });
  it('uses pinned answer defaults and respects explicit terminal overrides', () => {
    const env = launcher.runtimeEnvironment('api', saved, { RAG_SCOPE_ID: 'override', KB_WORKER_TOKEN: secret }, answer);
    expect(env.RAG_SCOPE_ID).toBe('override');
    expect(env.RAG_ANSWER_DIGEST).toBe(answer.manifest_digest);
    expect(env).not.toHaveProperty('KB_WORKER_TOKEN');
    expect(env).not.toHaveProperty('SUPABASE_SERVICE_ROLE_KEY');
  });
  it('rejects disabled workers and missing or short credentials without displaying their values', () => {
    expect(() => launcher.runtimeEnvironment('worker', { ...saved, KB_ENABLED: 'false' }, {}, answer)).toThrow('KB_ENABLED=true');
    expect(() => launcher.runtimeEnvironment('api', { ...saved, RAG_SERVICE_TOKEN: '' }, {}, answer)).toThrow('Missing RAG_SERVICE_TOKEN');
    expect(() => launcher.runtimeEnvironment('worker', { ...saved, KB_WORKER_TOKEN: 'short' }, {}, answer)).toThrow('at least 32 characters');
    expect(() => launcher.runtimeEnvironment('api', { ...saved, RAG_EMBEDDING_FINGERPRINT: '' }, {}, answer)).toThrow('Missing RAG_EMBEDDING_FINGERPRINT');
  });
});
