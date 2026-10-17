import { AssistantError } from '@deskatlas/domain';
import { authorizeAssistant } from '../../../../../../admin-portal/src/server/assistant/gateway';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'no-store, private', Vary: 'Authorization' };

// PRD-F13/F26 / QAD-TC23/44: staff identity and assistant share credential validation.
export async function GET(request: Request) {
  try {
    const { actor } = await authorizeAssistant(request);
    const token = request.headers.get('authorization')?.replace(/^Bearer /i, '') ?? '';
    let expiresAt: number | null = null;
    try {
      const claims: unknown = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
      if (claims && typeof claims === 'object' && 'exp' in claims && typeof claims.exp === 'number') {
        const expiry = token.startsWith('da_') ? claims.exp : claims.exp * 1000;
        if (Number.isSafeInteger(expiry)) expiresAt = expiry;
      }
    } catch { /* Authorization above remains authoritative. */ }
    return Response.json({ active: true, deactivated: false, expiresAt,
      user: { id: actor.id, role: actor.role.toLowerCase() } }, { headers });
  } catch (error: unknown) {
    const status = error instanceof AssistantError ? error.status : 503;
    const code = status === 401 ? 'AUTH_REQUIRED' : status === 403 ? 'ACCOUNT_INACTIVE' : 'AUTH_UNAVAILABLE';
    return Response.json({ active: false, deactivated: status === 403, error: { code } }, { status, headers });
  }
}
