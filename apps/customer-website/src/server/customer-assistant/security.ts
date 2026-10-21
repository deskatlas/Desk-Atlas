import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

// MS77-TC11/13/15: never trust arbitrary forwarded headers or browser identities.
export class CustomerAssistantError extends Error {
  constructor(public code: string, public status = 503, public retryAfter = 5) { super(code); }
}
export function assistantConfig(name: string): string {
  const value = process.env[name]; if (!value) throw new CustomerAssistantError('ASSISTANT_UNAVAILABLE'); return value;
}
export function trustedClientIp(request: Request): string {
  const header = process.env.CUSTOMER_ASSISTANT_TRUSTED_IP_HEADER;
  if (!header) {
    if (process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1', '[::1]', '0.0.0.0', '[::]'].includes(new URL(request.url).hostname)) return '127.0.0.1';
    throw new CustomerAssistantError('ASSISTANT_UNAVAILABLE');
  }
  if (!['x-vercel-forwarded-for', 'cf-connecting-ip', 'x-real-ip'].includes(header)) throw new CustomerAssistantError('ASSISTANT_UNAVAILABLE');
  // Operator must configure an ingress that overwrites this header and blocks bypass.
  const ip = request.headers.get(header)?.trim();
  if (!ip || !isIP(ip)) throw new CustomerAssistantError('ASSISTANT_UNAVAILABLE');
  return ip;
}
export function keyedDigest(purpose: string, value: string): string {
  const key = assistantConfig('RAG_CAPABILITY_SECRET');
  if (key.length < 32) throw new CustomerAssistantError('ASSISTANT_UNAVAILABLE');
  return createHmac('sha256', key).update(`${purpose}:${value}`).digest('hex');
}
const cookieName = 'da_assistant_visitor';
export function publicVisitor(request: Request, required = false) {
  const value = request.headers.get('cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  if (value) {
    const parts = value.split('.');
    if (parts.length === 3 && /^[a-f0-9-]{36}$/.test(parts[0]) && /^\d{10}$/.test(parts[1])) {
      const expected = keyedDigest('visitor', `${parts[0]}.${parts[1]}`);
      const actual = Buffer.from(parts[2]); const signature = Buffer.from(expected);
      if (actual.length === signature.length && timingSafeEqual(actual, signature)) {
        const remaining = Number(parts[1]) - Date.now() / 1000;
        if (remaining > 0 && remaining <= 3600) return { id: parts[0], cookie: undefined };
        // MS77-TC01/15: only bootstrap may rotate an authentic expired guest identity.
        if (remaining <= 0 && !required) return newPublicVisitor();
      }
    }
    throw new CustomerAssistantError('INVALID_VISITOR', 401);
  }
  if (required) throw new CustomerAssistantError('INVALID_VISITOR', 401);
  return newPublicVisitor();
}
function newPublicVisitor() {
  const id = randomUUID(), expires = Math.floor(Date.now() / 1000) + 3600;
  const payload = `${id}.${expires}`;
  return { id, cookie: `${cookieName}=${payload}.${keyedDigest('visitor', payload)}; Path=/api/customer-assistant; HttpOnly; SameSite=Strict; Max-Age=3600${process.env.NODE_ENV === 'production' ? '; Secure' : ''}` };
}
export async function customerRequestBody(request: Request): Promise<unknown> {
  const origins = assistantConfig('CUSTOMER_ASSISTANT_ALLOWED_ORIGINS').split(',').map(v => v.trim());
  const origin = request.headers.get('origin');
  const url = new URL(request.url);
  const host = request.headers.get('host');
  // MS77-TC01/15: Next.js can expose its bind address in Request.url.
  // Host must still exactly match a configured customer origin; forwarded headers grant no trust.
  const requestOrigin = host ? origins.find(value => {
    const allowed = new URL(value);
    return allowed.host === host && allowed.protocol === url.protocol;
  }) : url.origin;
  if (!requestOrigin || !origins.includes(requestOrigin) || origin && !origins.includes(origin)) throw new CustomerAssistantError('FORBIDDEN', 403);
  if (request.headers.get('sec-fetch-site') === 'cross-site') throw new CustomerAssistantError('FORBIDDEN', 403);
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') throw new CustomerAssistantError('JSON_REQUIRED', 415);
  if (Number(request.headers.get('content-length') ?? 0) > 32768) throw new CustomerAssistantError('REQUEST_TOO_LARGE', 413);
  const reader = request.body?.getReader(); if (!reader) throw new CustomerAssistantError('INVALID_REQUEST', 400);
  const chunks: Uint8Array[] = []; let size = 0;
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10000)]);
  let onAbort: () => void = () => {};
  const stopped = new Promise<never>((_, reject) => {
    onAbort = () => { reject(new CustomerAssistantError('REQUEST_TIMEOUT', 408)); void reader.cancel().catch(() => {}); };
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    if (signal.aborted) throw new CustomerAssistantError('REQUEST_TIMEOUT', 408);
    for (;;) { const { value, done } = await Promise.race([reader.read(), stopped]); if (done) break;
      size += value.length; if (size > 32768) { await reader.cancel(); throw new CustomerAssistantError('REQUEST_TOO_LARGE', 413); } chunks.push(value); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch (error) { if (error instanceof CustomerAssistantError) throw error; throw new CustomerAssistantError('INVALID_REQUEST', 400); }
  finally { signal.removeEventListener('abort', onAbort); reader.releaseLock(); }
}
