import { NextRequest, NextResponse } from 'next/server';
import {
  AuthError,
  SupabaseAuthRepository,
  createAuthService,
  loginRateLimiter,
} from '@deskatlas/domain';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown-ip';
  const { searchParams } = new URL(request.url);
  const email = searchParams.get('email') || '';
  const status = loginRateLimiter.checkRateLimit('staff', email, ip);
  return NextResponse.json({
    locked: !status.allowed,
    remainingAttempts: status.remainingAttempts,
    retryAfterSeconds: status.retryAfterSeconds,
    lockedUntil: status.lockedUntil,
  });
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown-ip';
  let trimmedEmail = '';

  try {
    const body = await request.json().catch(() => ({}));
    const { email, password } = body;

    if (!email || typeof email !== 'string' || !password || typeof password !== 'string') {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    trimmedEmail = email.trim().toLowerCase();
    const rateCheck = loginRateLimiter.checkRateLimit('staff', trimmedEmail, ip);

    if (!rateCheck.allowed) {
      return NextResponse.json(
        {
          error: `Too many failed login attempts. Please try again in ${rateCheck.retryAfterSeconds} seconds.`,
          retryAfterSeconds: rateCheck.retryAfterSeconds,
          lockedUntil: rateCheck.lockedUntil,
          attemptsRemaining: 0,
        },
        {
          status: 429,
          headers: { 'Retry-After': String(rateCheck.retryAfterSeconds) },
        }
      );
    }

    const authRepo = new SupabaseAuthRepository();
    const authService = createAuthService(authRepo);

    const session = await authService.loginStaff(trimmedEmail, password);

    // Verify role is STAFF or ADMIN
    if (session.actor.role !== 'STAFF' && session.actor.role !== 'ADMIN') {
      const failResult = loginRateLimiter.recordFailedAttempt('staff', trimmedEmail, ip);
      if (failResult.locked) {
        return NextResponse.json(
          {
            error: `Too many failed login attempts. Please try again in ${failResult.retryAfterSeconds} seconds.`,
            retryAfterSeconds: failResult.retryAfterSeconds,
            lockedUntil: failResult.lockedUntil,
            attemptsRemaining: 0,
          },
          {
            status: 429,
            headers: { 'Retry-After': String(failResult.retryAfterSeconds) },
          }
        );
      }
      return NextResponse.json(
        { error: 'Account is not authorized for staff access' },
        { status: 403 }
      );
    }

    loginRateLimiter.recordSuccessfulLogin('staff', trimmedEmail, ip);

    return NextResponse.json({
      user: {
        id: session.actor.id,
        email: session.actor.email,
        role: session.actor.role.toLowerCase(),
        displayName: session.actor.displayName || 'Staff Member',
      },
      token: session.token,
    });
  } catch (error: any) {
    if (trimmedEmail) {
      const failResult = loginRateLimiter.recordFailedAttempt('staff', trimmedEmail, ip);
      if (failResult.locked) {
        return NextResponse.json(
          {
            error: `Too many failed login attempts. Please try again in ${failResult.retryAfterSeconds} seconds.`,
            retryAfterSeconds: failResult.retryAfterSeconds,
            lockedUntil: failResult.lockedUntil,
            attemptsRemaining: 0,
          },
          {
            status: 429,
            headers: { 'Retry-After': String(failResult.retryAfterSeconds) },
          }
        );
      }
      const rawMessage = error instanceof Error ? error.message : 'Invalid credentials';
      return NextResponse.json(
        {
          error: `${rawMessage}. ${failResult.remainingAttempts} attempt${failResult.remainingAttempts === 1 ? '' : 's'} remaining.`,
          attemptsRemaining: failResult.remainingAttempts,
        },
        { status: error instanceof AuthError ? error.statusCode : 401 }
      );
    }

    const message = error instanceof Error ? error.message : 'Login failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
