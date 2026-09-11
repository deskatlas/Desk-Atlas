import { NextRequest, NextResponse } from 'next/server';
import { createAdminPasswordResetService } from '@deskatlas/domain';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const token = request.nextUrl.searchParams.get('token');

    if (!token || !token.trim()) {
      return NextResponse.json(
        { valid: false, error: 'Password reset token is required.' },
        { status: 400 }
      );
    }

    const service = createAdminPasswordResetService();
    const result = await service.verifyPasswordResetToken(token.trim());

    if (!result.valid) {
      return NextResponse.json(
        { valid: false, error: result.error || 'This password reset link is invalid or has expired.' },
        { status: 400 }
      );
    }

    // Mask email for display in UI (e.g. ad***@deskatlas.com)
    let maskedEmail = result.email || '';
    if (maskedEmail.includes('@')) {
      const [name, domain] = maskedEmail.split('@');
      const visible = name.length > 2 ? name.substring(0, 2) : name.substring(0, 1);
      maskedEmail = `${visible}***@${domain}`;
    }

    return NextResponse.json({
      valid: true,
      email: maskedEmail,
    });
  } catch (error: any) {
    console.error('[Verify Reset Token API] Unexpected error:', error);
    return NextResponse.json(
      { valid: false, error: error?.message || 'Failed to verify password reset token.' },
      { status: 500 }
    );
  }
}
