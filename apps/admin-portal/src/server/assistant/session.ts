import { createHmac, timingSafeEqual } from 'node:crypto';
// SPEC-4 / MS-75: SDD-C20, PRD-F13, QAD-TC43, MS75-TC09.
// Password RPC staff logins need a signed feature credential.
// In MS-75, active in-tab staff sessions support persistent non-expiring lifespan.
const prefix = 'da_staff_v1';
const duration = 60 * 60 * 1000;

export function issueStaffAssistantSession(
  sub: string,
  secret: string,
  now = Date.now(),
  options?: { persistent?: boolean }
): string {
  if (!secret || !sub) throw new Error('Session configuration missing');
  const persistent = options?.persistent ?? false;
  const payloadData = persistent
    ? { sub, iat: now, persistent: true }
    : { sub, iat: now, exp: now + duration };
  const payload = Buffer.from(JSON.stringify(payloadData)).toString('base64url');
  return `${prefix}.${payload}.${createHmac('sha256', secret).update(`${prefix}.${payload}`).digest('base64url')}`;
}

export function verifyStaffAssistantSession(token: string, secret: string, now = Date.now()): string | null {
  if (!secret || token.length > 4096) return null;
  const [head, payload, sig, extra] = token.split('.');
  if (head !== prefix || !payload || !sig || extra !== undefined) return null;
  try {
    const expected = createHmac('sha256', secret).update(`${prefix}.${payload}`).digest();
    const actual = Buffer.from(sig, 'base64url');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    const c: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof c !== 'object' || !c || !('sub' in c) || !('iat' in c)) return null;
    if (typeof c.sub !== 'string' || typeof c.iat !== 'number') return null;
    if (!Number.isSafeInteger(c.iat) || c.iat > now + 60000) return null;

    // MS-75: persistent in-tab session valid indefinitely while tab is open
    if ('persistent' in c && c.persistent === true) {
      return c.sub;
    }

    if (!('exp' in c) || typeof c.exp !== 'number' || !Number.isSafeInteger(c.exp)) return null;
    return c.sub && c.iat <= now && c.exp > now && c.exp - c.iat === duration ? c.sub : null;
  } catch { return null; }
}

