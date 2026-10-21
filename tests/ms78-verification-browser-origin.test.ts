import { randomUUID } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';

const services = vi.hoisted(() => ({ createAccessChallenge: vi.fn(), consumeTogether: vi.fn() }));
vi.mock('../apps/customer-website/src/app/api/customer/_services', () => ({ getCustomerServices: () => ({
  customerService: { createAccessChallenge: services.createAccessChallenge }, rateLimiterService: { consumeTogether: services.consumeTogether },
}) }));
import { POST } from '../apps/customer-website/src/app/api/customer/verify-identity/route';

beforeEach(() => {
  services.consumeTogether.mockResolvedValue({ allowed: true });
  services.createAccessChallenge.mockResolvedValue({ accessToken: 'test-only-token', expiresAt: '2026-10-22T00:00:00Z',
    customer: { customerCode: 'ABC123', firstName: 'Test', lastName: 'Guest', createdAt: '2026-10-21T00:00:00Z' } });
});
const request = (origin: string, forwarded?: string) => new Request('http://0.0.0.0:3001/api/customer/verify-identity', {
  method: 'POST', headers: { host: 'localhost:3001', origin, 'Content-Type': 'application/json', ...(forwarded ? { 'x-forwarded-host': forwarded } : {}) },
  body: JSON.stringify({ customer_code: 'ABC123', email: `guest-${randomUUID()}@example.test`, access_intent: 'REWARDS_AND_ASSISTANT' }),
}) as Parameters<typeof POST>[0];

it('accepts a same-origin browser when Next.js exposes its bind address in Request.url', async () => {
  const result = await POST(request('http://localhost:3001'));
  expect(result.status).toBe(200);
  expect((await result.json()).data.purpose).toBe('REWARDS_AND_ASSISTANT_ACCESS');
});

it('rejects a foreign browser origin even with a forged forwarded host', async () => {
  const result = await POST(request('https://attacker.example', 'attacker.example'));
  expect(result.status).toBe(403);
  expect((await result.json()).error.message).toContain('this website');
});
