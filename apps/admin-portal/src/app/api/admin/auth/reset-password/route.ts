import { NextRequest, NextResponse } from 'next/server';
import {
  AdminPasswordResetError,
  createAdminPasswordResetService,
  validatePassword,
} from '@deskatlas/domain';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { token, password } = body;

    if (!token || typeof token !== 'string' || !token.trim()) {
      return NextResponse.json(
        { error: 'Reset token is required.' },
        { status: 400 }
      );
    }

    if (!password || typeof password !== 'string') {
      return NextResponse.json(
        { error: 'New password is required.' },
        { status: 400 }
      );
    }

    const policyValidation = validatePassword(password);
    if (!policyValidation.isValid) {
      return NextResponse.json(
        {
          error: `Password does not meet security requirements: ${policyValidation.errors.join(' ')}`,
        },
        { status: 400 }
      );
    }

    const service = createAdminPasswordResetService();
    const result = await service.completePasswordReset({
      token: token.trim(),
      newPassword: password,
    });

    return NextResponse.json({
      success: true,
      message: result.message || 'Password updated successfully. Please sign in with your new password.',
    });
  } catch (error: any) {
    if (error instanceof AdminPasswordResetError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      );
    }

    console.error('[Reset Password API] Unexpected error:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to update password. Please try again.' },
      { status: 500 }
    );
  }
}
