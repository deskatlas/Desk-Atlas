import { createHmac, timingSafeEqual } from 'node:crypto';
// SPEC-4 SDD-C20: password RPC staff logins need a signed feature credential.
const prefix = 'da_staff_v1';
const duration = 60 * 60 * 1000;
export function issueStaffAssistantSession(sub: string, secret: string, now = Date.now()): string {
  if (!secret || !sub) throw new Error('Session configuration missing');
  const payload = Buffer.from(JSON.stringify({ sub, iat: now, exp: now + duration })).toString('base64url');
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
    if (typeof c !== 'object' || !c || !('sub' in c) || !('iat' in c) || !('exp' in c)) return null;
    if (typeof c.sub !== 'string' || typeof c.iat !== 'number' || typeof c.exp !== 'number') return null;
    return c.sub && Number.isSafeInteger(c.iat) && Number.isSafeInteger(c.exp) && c.iat <= now && c.exp > now && c.exp - c.iat === duration ? c.sub : null;
  } catch { return null; }
}
