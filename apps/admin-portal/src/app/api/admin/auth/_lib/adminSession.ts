import { createHmac, timingSafeEqual } from 'node:crypto';

// MS-43: SDD-C12/C19, QAD-TC43.2. RPC password authentication needs a
// server-verifiable application session because it does not issue a Supabase JWT.
const PREFIX = 'da_admin_v1';
export const ADMIN_SESSION_DURATION_MS = 60 * 60 * 1000;

function signature(payload: string, secret: string): Buffer {
  return createHmac('sha256', secret)
    .update(`${PREFIX}.${payload}`)
    .digest();
}

export function issueAdminSession(userId: string, secret: string, now = Date.now()): string {
  if (!userId || !secret) throw new Error('Administrator session configuration is missing');
  const payload = Buffer.from(JSON.stringify({ sub: userId, iat: now, exp: now + ADMIN_SESSION_DURATION_MS })).toString('base64url');
  return `${PREFIX}.${payload}.${signature(payload, secret).toString('base64url')}`;
}

export function verifyAdminSession(token: string, secret: string, now = Date.now()): string | null {
  if (!secret || token.length > 4096) return null;
  const [prefix, payload, encodedSignature, extra] = token.split('.');
  if (prefix !== PREFIX || !payload || !encodedSignature || extra !== undefined) return null;
  try {
    const actual = Buffer.from(encodedSignature, 'base64url');
    const expected = signature(payload, secret);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const claims: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof claims !== 'object' || claims === null || !('sub' in claims) || !('iat' in claims) || !('exp' in claims)) return null;
    if (typeof claims.sub !== 'string' || !claims.sub || typeof claims.iat !== 'number' || typeof claims.exp !== 'number') return null;
    if (!Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp) || claims.iat > now || claims.exp <= now || claims.exp - claims.iat !== ADMIN_SESSION_DURATION_MS) return null;
    return claims.sub;
  } catch {
    return null;
  }
}
