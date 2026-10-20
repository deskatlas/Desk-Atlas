import { createHmac, timingSafeEqual } from 'node:crypto';

// MS-43 / MS-75: SDD-C12/C19, PRD-F13, QAD-TC43, MS75-TC09.
// RPC password authentication needs a server-verifiable application session.
// In MS-75, active in-tab sessions support persistent non-expiring lifespan.
const PREFIX = 'da_admin_v1';
export const ADMIN_SESSION_DURATION_MS = 60 * 60 * 1000;

function signature(payload: string, secret: string): Buffer {
  return createHmac('sha256', secret)
    .update(`${PREFIX}.${payload}`)
    .digest();
}

export function issueAdminSession(
  userId: string,
  secret: string,
  now = Date.now(),
  options?: { persistent?: boolean }
): string {
  if (!userId || !secret) throw new Error('Administrator session configuration is missing');
  const persistent = options?.persistent ?? false;
  const payloadData = persistent
    ? { sub: userId, iat: now, persistent: true }
    : { sub: userId, iat: now, exp: now + ADMIN_SESSION_DURATION_MS };
  const payload = Buffer.from(JSON.stringify(payloadData)).toString('base64url');
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
    if (typeof claims !== 'object' || claims === null || !('sub' in claims) || !('iat' in claims)) return null;
    if (typeof claims.sub !== 'string' || !claims.sub || typeof claims.iat !== 'number') return null;
    if (!Number.isSafeInteger(claims.iat) || claims.iat > now + 60000) return null;

    // MS-75: persistent in-tab session valid indefinitely while tab is open
    if ('persistent' in claims && claims.persistent === true) {
      return claims.sub;
    }

    // Legacy expiring session duration check
    if (!('exp' in claims) || typeof claims.exp !== 'number' || !Number.isSafeInteger(claims.exp)) return null;
    if (claims.iat > now || claims.exp <= now || claims.exp - claims.iat !== ADMIN_SESSION_DURATION_MS) return null;
    return claims.sub;
  } catch {
    return null;
  }
}

