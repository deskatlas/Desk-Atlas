import { NextResponse } from 'next/server';
import { AdminAccessError, verifyAdministrator } from '../_lib/verifiedAdmin';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };

// MS-47 / PRD-F13: account lookup never establishes or renews a session.
export async function GET(request: Request) {
  try {
    const { user, expiresAt } = await verifyAdministrator(request);
    return NextResponse.json({ active: true, deactivated: false, user, expiresAt }, { headers });
  } catch (error) {
    const failure = error instanceof AdminAccessError ? error : new AdminAccessError('AUTH_UNAVAILABLE', 503);
    return NextResponse.json({ active: false, deactivated: failure.code === 'ACCOUNT_INACTIVE',
      error: { code: failure.code, message: failure.code === 'AUTH_REQUIRED' ? 'Your session ended. Sign in again.'
        : failure.code === 'AUTH_UNAVAILABLE' ? 'Unable to verify your session. Please retry.' : 'Administrator access denied.' },
    }, { status: failure.status, headers });
  }
}
