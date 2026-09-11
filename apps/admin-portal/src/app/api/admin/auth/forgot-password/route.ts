import { NextRequest, NextResponse } from 'next/server';
import { createAdminPasswordResetService } from '@deskatlas/domain';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { email } = body;

    const origin = request.nextUrl.origin;
    const service = createAdminPasswordResetService();

    const result = await service.requestPasswordReset({
      email: typeof email === 'string' ? email.trim() : '',
      resetBaseUrl: origin,
    });

    return NextResponse.json({
      success: true,
      message: result.message,
    });
  } catch (error: any) {
    console.error('[Forgot Password API] Unexpected error:', error);
    // Generic response to avoid disclosing error states / account presence
    return NextResponse.json({
      success: true,
      message: 'If an admin account is associated with this email address, you will receive password reset instructions shortly.',
    });
  }
}
