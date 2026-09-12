import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  SupabaseAdminPasswordResetRepository,
  createAdminPasswordResetService,
  InMemoryAdminPasswordResetRepository,
} from '@deskatlas/domain';

describe('MF-74: Admin Password Reset Fix & Auth Provider Synchronization', () => {
  const fakeUrl = 'https://fake-project.supabase.co';
  const fakeKey = 'fake-service-role-key';

  it('SQL audit log entity_id type verification: no invalid ::text cast on entity_id in 002_functions.sql', () => {
    const functionsSqlPath = path.resolve(process.cwd(), 'supabase/002_functions.sql');
    const schemaSqlPath = path.resolve(process.cwd(), 'supabase/001_schema.sql');

    expect(fs.existsSync(functionsSqlPath)).toBe(true);
    expect(fs.existsSync(schemaSqlPath)).toBe(true);

    const functionsSql = fs.readFileSync(functionsSqlPath, 'utf8');
    const schemaSql = fs.readFileSync(schemaSqlPath, 'utf8');

    // Schema must define admin_password_resets table
    expect(schemaSql).toContain('CREATE TABLE public.admin_password_resets');

    // 002_functions.sql must have admin_complete_password_reset defined
    expect(functionsSql).toContain('CREATE OR REPLACE FUNCTION public.admin_complete_password_reset');

    // 002_functions.sql must NOT cast v_reset.user_id::text for entity_id
    expect(functionsSql).not.toContain('v_reset.user_id::text');

    // 002_functions.sql must assign v_reset.user_id (UUID) to entity_id
    expect(functionsSql).toMatch(
      /entity_id,\s*\n\s*metadata,\s*\n\s*created_at\s*\n\s*\)\s*\n\s*VALUES\s*\(\s*\n\s*gen_random_uuid\(\),\s*\n\s*v_reset\.user_id,\s*\n\s*'ADMIN',\s*\n\s*'ADMIN_PASSWORD_RESET',\s*\n\s*'staff_profiles',\s*\n\s*v_reset\.user_id,/
    );
  });

  it('SupabaseAdminPasswordResetRepository.completeReset synchronizes new password directly to Supabase Auth GoTrue API', async () => {
    const fetchCalls: Array<{ url: string; method: string; body?: any }> = [];

    const mockFetch = vi.fn(async (input: any, init?: any) => {
      const urlStr = typeof input === 'string' ? input : input.url;
      const method = init?.method || 'GET';
      const body = init?.body ? JSON.parse(init.body) : undefined;
      fetchCalls.push({ url: urlStr, method, body });

      // 1. GoTrue admin user update
      if (urlStr.includes('/auth/v1/admin/users/') && method === 'PUT') {
        return new Response(JSON.stringify({ id: 'test-user-123', email: 'admin@test.com' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // 2. Patch reset record
      if (urlStr.includes('/admin_password_resets') && method === 'PATCH') {
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // 3. Audit log insert
      if (urlStr.includes('/audit_logs') && method === 'POST') {
        return new Response(JSON.stringify({ id: 'audit-123' }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // 4. RPC call
      if (urlStr.includes('/rest/v1/rpc/admin_complete_password_reset')) {
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response('{}', { status: 200 });
    });

    // Temporarily replace global fetch
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as any;

    try {
      const repo = new SupabaseAdminPasswordResetRepository({
        supabaseUrl: fakeUrl,
        serviceRoleKey: fakeKey,
      });

      const success = await repo.completeReset(
        'apr_test_token_123',
        'NewStrongPassword2026@#',
        'user-uuid-999'
      );

      expect(success).toBe(true);

      // Verify GoTrue Auth update was invoked
      const authCall = fetchCalls.find(
        (c) => c.url === `${fakeUrl}/auth/v1/admin/users/user-uuid-999` && c.method === 'PUT'
      );
      expect(authCall).toBeDefined();
      expect(authCall?.body).toEqual({ password: 'NewStrongPassword2026@#' });

      // Verify reset record was patched to USED
      const patchCall = fetchCalls.find(
        (c) => c.url.includes('/admin_password_resets') && c.method === 'PATCH'
      );
      expect(patchCall).toBeDefined();
      expect(patchCall?.body.status).toBe('USED');
      expect(patchCall?.body.used_at).toBeDefined();

      // Verify audit log call
      const auditCall = fetchCalls.find(
        (c) => c.url.includes('/audit_logs') && c.method === 'POST'
      );
      expect(auditCall).toBeDefined();
      expect(auditCall?.body.action).toBe('ADMIN_PASSWORD_RESET');
      expect(auditCall?.body.actor_user_id).toBe('user-uuid-999');
      expect(auditCall?.body.entity_id).toBe('user-uuid-999');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('SupabaseAdminPasswordResetRepository.completeReset throws error and leaves token un-used if Auth update fails', async () => {
    const fetchCalls: Array<{ url: string; method: string }> = [];

    const mockFetch = vi.fn(async (input: any, init?: any) => {
      const urlStr = typeof input === 'string' ? input : input.url;
      const method = init?.method || 'GET';
      fetchCalls.push({ url: urlStr, method });

      // Auth update fails with 500
      if (urlStr.includes('/auth/v1/admin/users/') && method === 'PUT') {
        return new Response('Auth provider down', { status: 500 });
      }

      return new Response('{}', { status: 200 });
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as any;

    try {
      const repo = new SupabaseAdminPasswordResetRepository({
        supabaseUrl: fakeUrl,
        serviceRoleKey: fakeKey,
      });

      await expect(
        repo.completeReset('apr_test_token_fail', 'NewStrongPassword2026@#', 'user-uuid-999')
      ).rejects.toThrow(/Failed to update administrator password in authentication service/);

      // Verify that reset record was NOT patched to USED
      const patchCall = fetchCalls.find(
        (c) => c.url.includes('/admin_password_resets') && c.method === 'PATCH'
      );
      expect(patchCall).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('End-to-end admin password reset service flow invalidates old password and sets new password', async () => {
    const memRepo = new InMemoryAdminPasswordResetRepository([
      {
        userId: 'admin-001',
        email: 'admin@deskatlas.com',
        displayName: 'Test Admin',
        password: 'OldPassword123!',
      },
    ]);

    const service = createAdminPasswordResetService(memRepo);

    // 1. Request reset
    const req = await service.requestPasswordReset({ email: 'admin@deskatlas.com' });
    expect(req.success).toBe(true);
    expect(req.token).toBeDefined();

    // 2. Complete reset with new password
    const result = await service.completePasswordReset({
      token: req.token!,
      newPassword: 'BrandNewSecure2026!@#',
    });

    expect(result.success).toBe(true);

    // 3. Verify repository state
    const admin = await memRepo.findActiveAdminByEmail('admin@deskatlas.com');
    expect(admin?.password).toBe('BrandNewSecure2026!@#');
    expect(admin?.password).not.toBe('OldPassword123!');

    // 4. Token cannot be reused
    await expect(
      service.completePasswordReset({
        token: req.token!,
        newPassword: 'AnotherPassword2026!@#',
      })
    ).rejects.toThrow(/already used/);
  });
});
