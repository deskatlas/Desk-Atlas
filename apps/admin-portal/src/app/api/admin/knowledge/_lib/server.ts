import { createClient } from '@supabase/supabase-js';
import { createHash, timingSafeEqual } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { NextResponse } from 'next/server';
import { verifyAdminSession } from '../../auth/_lib/adminSession';

// SPEC-5: only server-verified identities reach privileged KB persistence.
export class KnowledgeError extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}
export function knowledgeClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new KnowledgeError('NOT_CONFIGURED', 503);
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
export function knowledgeScope() {
  if (process.env.KB_ENABLED !== 'true') throw new KnowledgeError('KB_DISABLED', 503);
  const scope = process.env.KB_SCOPE_ID;
  if (!scope) throw new KnowledgeError('NOT_CONFIGURED', 503);
  return scope;
}
export async function authorizeKnowledge(request: Request) {
  if (request.method !== 'GET') {
    const url = new URL(request.url);
    // PRD-F27 / SDD-C24: Next.js may use its bind address in request.url.
    // Compare against the incoming Host while retaining protocol and port checks.
    const host = request.headers.get('host') ?? url.host;
    if (request.headers.get('origin') !== `${url.protocol}//${host}` || request.headers.get('sec-fetch-site') === 'cross-site')
      throw new KnowledgeError('ORIGIN_DENIED', 403);
  }
  const token = request.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
  if (!token) throw new KnowledgeError('FORBIDDEN', 403);
  const client = knowledgeClient();
  const id = token.startsWith('da_admin_v1.') ? verifyAdminSession(token, process.env.SUPABASE_SERVICE_ROLE_KEY ?? '')
    : (await client.auth.getUser(token)).data.user?.id;
  if (!id) throw new KnowledgeError('FORBIDDEN', 403);
  const profile = await client.from('staff_profiles').select('role,is_active').eq('user_id', id).maybeSingle();
  if (profile.error) throw new KnowledgeError('AUTH_UNAVAILABLE', 503);
  if (!profile.data?.is_active || profile.data.role !== 'ADMIN') throw new KnowledgeError('FORBIDDEN', 403);
  return { client, actor: id, scope: knowledgeScope() };
}
export function authorizeKnowledgeWorker(request: Request) {
  const expected = process.env.KB_WORKER_TOKEN;
  const actual = request.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1] ?? '';
  if (!expected || Buffer.byteLength(actual) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(actual), Buffer.from(expected)))
    throw new KnowledgeError('FORBIDDEN', 403);
  return { client: knowledgeClient(), scope: knowledgeScope() };
}
export function knowledgeResponse(data: unknown, status = 200) {
  return NextResponse.json({ data }, { status, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}
export function knowledgeFailure(error: unknown) {
  const code = error instanceof KnowledgeError ? error.code : 'INTERNAL_ERROR';
  const status = error instanceof KnowledgeError ? error.status : 500;
  return NextResponse.json({ error: { code, message: code === 'VERSION_CONFLICT' ? 'This document changed. Refresh before continuing.'
    : code === 'FORBIDDEN' ? 'Active administrator access required.' : code === 'NOT_CONFIGURED' ? 'Knowledge Base is not configured yet.' : code.replaceAll('_', ' ').toLowerCase() } }, { status, headers: { 'Cache-Control': 'no-store' } });
}
export function checkDatabase(error: { message: string } | null) {
  if (!error) return;
  const allowed = ['FORBIDDEN', 'NOT_FOUND', 'VERSION_CONFLICT', 'REVIEW_REQUIRED', 'FINGERPRINT_MISMATCH', 'MANIFEST_INVALID', 'ACTIVE_VERSION', 'INVALID_STATE', 'LEASE_LOST'];
  const code = allowed.find(value => error.message === value);
  throw new KnowledgeError(code ?? 'DATABASE_UNAVAILABLE', code === 'FORBIDDEN' ? 403 : code === 'NOT_FOUND' ? 404 : code ? 409 : 503);
}
export const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
export function detectKnowledgeType(bytes: Uint8Array, declared: string): string {
  if ((bytes[0] === 0x4d && bytes[1] === 0x5a) || (bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46)) throw new KnowledgeError('UNSAFE_FILE');
  const head = Buffer.from(bytes.subarray(0, 8));
  const detected = head.subarray(0, 5).toString() === '%PDF-' ? 'PDF'
    : head.equals(Buffer.from('d0cf11e0a1b11ae1', 'hex')) ? 'DOC'
    : head.subarray(0, 4).equals(Buffer.from('504b0304', 'hex')) ? 'DOCX' : 'MD';
  if (detected !== declared) throw new KnowledgeError('TYPE_MISMATCH');
  if (detected === 'DOCX') validateDocxContainer(Buffer.from(bytes));
  if (detected === 'MD') {
    try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new KnowledgeError('TYPE_MISMATCH'); }
    if (bytes.includes(0) || !bytes.length) throw new KnowledgeError('TYPE_MISMATCH');
  }
  return detected;
}

function validateDocxContainer(bytes: Buffer) {
  // Inspect the ZIP central directory without extracting user paths. Bounded
  // expansion and XML parsing also run inside the isolated worker before READY.
  try {
    let end = bytes.length - 22;
    for (; end >= Math.max(0, bytes.length - 65557); end--) if (bytes.readUInt32LE(end) === 0x06054b50) break;
    if (end < 0 || bytes.readUInt32LE(end) !== 0x06054b50) throw new Error();
    if (bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6)) throw new Error();
    const count = bytes.readUInt16LE(end + 10);
    let offset = bytes.readUInt32LE(end + 16);
    const names = new Set<string>();
    let contentTypes = '';
    for (let i = 0; i < count; i++) {
      if (bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error();
      const flags = bytes.readUInt16LE(offset + 8), method = bytes.readUInt16LE(offset + 10);
      if (flags & 1) throw new KnowledgeError('ENCRYPTED_FILE');
      const compressed = bytes.readUInt32LE(offset + 20), expanded = bytes.readUInt32LE(offset + 24);
      const length = bytes.readUInt16LE(offset + 28), extra = bytes.readUInt16LE(offset + 30), comment = bytes.readUInt16LE(offset + 32);
      const name = bytes.subarray(offset + 46, offset + 46 + length).toString('utf8');
      if (names.has(name) || name.split('/').includes('..') || name.startsWith('/') || /vbaproject|\.(exe|dll|js|vbs|ps1)$/i.test(name)) throw new KnowledgeError('UNSAFE_FILE');
      names.add(name);
      if (name === '[Content_Types].xml') {
        if (expanded > 4 * 1024 * 1024) throw new KnowledgeError('RESOURCE_LIMIT');
        const local = bytes.readUInt32LE(offset + 42);
        if (bytes.readUInt32LE(local) !== 0x04034b50) throw new Error();
        const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
        const data = bytes.subarray(start, start + compressed);
        contentTypes = (method === 0 ? data : method === 8 ? inflateRawSync(data, { maxOutputLength: 4 * 1024 * 1024 }) : Buffer.alloc(0)).toString('utf8');
      }
      offset += 46 + length + extra + comment;
    }
    if (!names.has('word/document.xml') || !contentTypes.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml')) throw new KnowledgeError('TYPE_MISMATCH');
    if (/macroEnabled|<!DOCTYPE|<!ENTITY/i.test(contentTypes)) throw new KnowledgeError('UNSAFE_FILE');
  } catch (error) { throw error instanceof KnowledgeError ? error : new KnowledgeError('MALFORMED_FILE'); }
}
