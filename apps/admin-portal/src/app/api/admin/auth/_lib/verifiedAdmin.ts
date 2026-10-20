import { createClient } from '@supabase/supabase-js';
import { verifyAdminSession } from './adminSession';

// MS-47 / SDD-C12: shared heartbeat and Knowledge Base verification boundary.
export type AdminAccessCode = 'AUTH_REQUIRED' | 'AUTH_UNAVAILABLE' | 'ACCOUNT_INACTIVE' | 'ACCESS_REVOKED';
export class AdminAccessError extends Error {
  constructor(public code: AdminAccessCode, public status: number) { super(code); }
}
export function adminClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new AdminAccessError('AUTH_UNAVAILABLE', 503);
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.any([
      ...(init?.signal ? [init.signal] : []), AbortSignal.timeout(10000),
    ]) }) },
  });
}
export async function verifyAdministrator(request: Request) {
  const token = request.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
  if (!token || token.length > 4096) throw new AdminAccessError('AUTH_REQUIRED', 401);
  try {
    const client = adminClient();
    let id: string | null = null;
    let expiresAt: number | null = null;
    if (token.startsWith('da_admin_v1.')) {
      id = verifyAdminSession(token, process.env.SUPABASE_SERVICE_ROLE_KEY ?? '');
      // Only read claims after full signature and lifetime validation.
      if (id) {
        const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()) as { exp?: number; persistent?: boolean };
        expiresAt = claims.persistent === true ? null : (typeof claims.exp === 'number' ? claims.exp : null);
      }
    } else if (!token.startsWith('da_')) {
      const { data, error } = await client.auth.getUser(token);
      if (error) {
        if (error.status === 400 || error.status === 401 || error.status === 403 || error.status === 422)
          throw new AdminAccessError('AUTH_REQUIRED', 401);
        throw new AdminAccessError('AUTH_UNAVAILABLE', 503);
      }
      id = data.user?.id ?? null;
    }
    if (!id) throw new AdminAccessError('AUTH_REQUIRED', 401);
    const { data, error } = await client.from('staff_profiles')
      .select('role,is_active,display_name,is_super_admin,created_by_admin_id').eq('user_id', id).maybeSingle();
    if (error) throw new AdminAccessError('AUTH_UNAVAILABLE', 503);
    if (!data || data.role !== 'ADMIN') throw new AdminAccessError('ACCESS_REVOKED', 403);
    if (data.is_active !== true) throw new AdminAccessError('ACCOUNT_INACTIVE', 403);
    return { client, actor: id, expiresAt, user: {
      id, role: 'admin' as const, name: data.display_name as string | undefined,
      isSuperAdmin: Boolean(data.is_super_admin ?? (data.created_by_admin_id === null)),
    } };
  } catch (error) {
    if (error instanceof AdminAccessError) throw error;
    throw new AdminAccessError('AUTH_UNAVAILABLE', 503);
  }
}
