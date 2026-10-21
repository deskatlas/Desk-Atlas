import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { knowledgeAudienceAllowed, knowledgeCanRetrieve, CustomerService } from '../packages/domain/src';
import type { CustomerRepository } from '../packages/domain/src/services/customerRepository';
import { KnowledgeUploadSchema, customerCapabilitySchema } from '../packages/validation/src';
import { signCustomerCapability, verifyCustomerCapability, admitCustomerPlan, subjectDigest, CustomerKnowledgeReader, CustomerRequestControl } from '../packages/server/src/assistant';
import type { SupabaseClient } from '@supabase/supabase-js';

const secret = 'ms76-fixture-key-'.repeat(3);
function capability() {
  return customerCapabilitySchema.parse({ iss: 'deskatlas', aud: 'rag', surface: 'customer', principal: 'PUBLIC_VISITOR',
    sub: randomUUID(), scope: 'test', request_id: randomUUID(), session_id: randomUUID(), generation: randomUUID(),
    ops: ['customer_knowledge'], audiences: ['CUSTOMER'], iat: 100, exp: 160 });
}

describe('MS76 customer foundations', () => {
  it('MS76-TC01 enforces all twelve audience/principal combinations', () => {
    const audiences = ['ADMIN_ONLY', 'ADMIN_AND_STAFF', 'CUSTOMER'] as const;
    const principals = ['ADMIN', 'STAFF', 'PUBLIC_VISITOR', 'VERIFIED_CUSTOMER'] as const;
    const allowed = [[true, true, false], [false, true, false], [false, false, true], [false, false, true]];
    for (const [i, principal] of principals.entries()) for (const [j, audience] of audiences.entries()) {
      expect(knowledgeAudienceAllowed(audience, principal)).toBe(allowed[i][j]);
      expect(knowledgeCanRetrieve({ audience, active_version_id: 'v', deleted_at: null }, { id: 'v', status: 'PUBLISHED' }, principal, 'fp', 'fp')).toBe(allowed[i][j]);
    }
  });
  it('MS76-TC04 keeps the private default for every existing supported format', () => {
    for (const declared_type of ['MD', 'DOC', 'DOCX', 'PDF'] as const) {
      expect(KnowledgeUploadSchema.parse({ filename: `test.${declared_type.toLowerCase()}`, declared_type, request_id: randomUUID() }).audience).toBe('ADMIN_ONLY');
      for (const audience of ['CUSTOMER']) expect(KnowledgeUploadSchema.parse({ audience, filename: `test.${declared_type.toLowerCase()}`, declared_type, request_id: randomUUID() }).audience).toBe(audience);
    }
  });
  it('MS76-TC07/11/12 binds capabilities and rejects escalation', () => {
    const c = capability();
    const token = signCustomerCapability(c, secret);
    expect(verifyCustomerCapability(token, secret, c, 120)).toEqual(c);
    for (const patch of [{ scope: 'other' }, { sub: randomUUID() }, { generation: randomUUID() }, { session_id: randomUUID() }, { request_id: randomUUID() }, { principal: 'VERIFIED_CUSTOMER' as const }])
      expect(() => verifyCustomerCapability(token, secret, { ...c, ...patch }, 120)).toThrow();
    expect(() => verifyCustomerCapability(token, secret, c, 160)).toThrow();
    for (const value of [{ ...c, role: 'ADMIN' }, { ...c, surface: 'admin' }, { ...c, ops: ['owned_bookings'] }, { ...c, audiences: ['VERIFIED_CUSTOMER'] }]) expect(customerCapabilitySchema.safeParse(value).success).toBe(false);
    for (const name of ['operational_snapshot', 'tools', 'sql', 'owned_bookings']) expect(() => admitCustomerPlan({ kind: 'WORKSPACE', operations: [{ name }] }, c)).toThrow();
  });
  it('MS76-TC09 requires the combined purpose and preserves rewards compatibility', async () => {
    const customer = { id: randomUUID() };
    const now = new Date('2026-10-21T00:00:00Z');
    let purpose = 'REWARDS_ACCESS';
    const repository = { findAccessChallengeByHash: vi.fn(async () => ({ purpose, customerId: customer.id, expiresAt: '2026-10-21T00:15:00Z', revokedAt: null })), findCustomerById: vi.fn(async () => customer) } as unknown as CustomerRepository;
    const service = new CustomerService(repository, undefined, () => now);
    expect(await service.verifyAccessToken('opaque', now)).toEqual(customer);
    expect(await service.verifyAccessToken('opaque', now, 'REWARDS_AND_ASSISTANT_ACCESS')).toBeNull();
    purpose = 'REWARDS_AND_ASSISTANT_ACCESS';
    expect(await service.verifyAccessToken('opaque', now)).toEqual(customer);
    expect(await service.verifyAccessToken('opaque', now, 'REWARDS_AND_ASSISTANT_ACCESS')).toEqual(customer);
    expect(await service.verifyAccessToken('opaque', new Date('2026-10-21T00:16:00Z'))).toBeNull();
  });
  it('MS76-TC06 discards an answer when the knowledge epoch changes', async () => {
    const rpc = vi.fn(async () => ({ data: { knowledge_epoch: 2 }, error: null }));
    const authorize = vi.fn(async () => {});
    const reader = new CustomerKnowledgeReader({ rpc } as unknown as SupabaseClient, capability(), 'fp', authorize);
    await expect(reader.release(1, async () => 'withdrawn')).rejects.toThrow('KNOWLEDGE_CHANGED');
    await expect(reader.release(2, async () => 'current')).resolves.toBe('current');
    expect(authorize).toHaveBeenCalled();
  });
  it('MS76-TC12 fails closed on cancellation and never returns provider output', async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: { stage: 'preparing', cancelled: false }, error: null })
      .mockResolvedValue({ data: { stage: 'preparing', cancelled: true }, error: null });
    const control = new CustomerRequestControl({ rpc } as unknown as SupabaseClient, { scope: 'test', principal: 'PUBLIC_VISITOR', subject_digest: subjectDigest(secret, 'PUBLIC_VISITOR', randomUUID()) });
    await expect(control.run(capabilityIdentity(), async () => 'cancelled answer')).rejects.toThrow('REQUEST_CANCELLED');
  });
  it('MS76-TC12 cancels a provider wait even when the provider ignores abort', async () => {
    vi.useFakeTimers();
    try {
      const rpc = vi.fn().mockResolvedValueOnce({ data: { stage: 'preparing', cancelled: false }, error: null })
        .mockResolvedValue({ data: { stage: 'preparing', cancelled: true }, error: null });
      const control = new CustomerRequestControl({ rpc } as unknown as SupabaseClient, { scope: 'test', principal: 'PUBLIC_VISITOR', subject_digest: 'a'.repeat(64) });
      const pending = control.run(capabilityIdentity(), async () => new Promise<string>(() => {}));
      const rejected = expect(pending).rejects.toThrow('REQUEST_CANCELLED');
      await vi.advanceTimersByTimeAsync(250);
      await rejected;
    } finally { vi.useRealTimers(); }
  });
});
function capabilityIdentity() {
  const { request_id, session_id, generation } = capability();
  return { request_id, session_id, generation };
}
