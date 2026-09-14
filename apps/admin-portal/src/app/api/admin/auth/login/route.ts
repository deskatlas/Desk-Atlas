import { NextRequest, NextResponse } from 'next/server';
import { loginRateLimiter } from '@deskatlas/domain';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown-ip';
  const { searchParams } = new URL(request.url);
  const email = searchParams.get('email') || '';
  const status = loginRateLimiter.checkRateLimit('admin', email, ip);
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
    const rateCheck = loginRateLimiter.checkRateLimit('admin', trimmedEmail, ip);

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

    const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      console.error('[Auth Login] Missing Supabase configuration: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
      return NextResponse.json(
        { error: 'Server authentication service is misconfigured (missing Supabase credentials)' },
        { status: 500 }
      );
    }

    const cleanBaseUrl = supabaseUrl.replace(/\/$/, '');

    // 1. Primary verification: Call secure database RPC verify_staff_login
    try {
      const rpcRes = await fetch(`${cleanBaseUrl}/rest/v1/rpc/verify_staff_login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({
          p_email: trimmedEmail,
          p_password: password,
        }),
      });

      if (rpcRes.ok) {
        const result = await rpcRes.json();
        if (result.success && result.user) {
          const userRole = String(result.user.role || '').toUpperCase();
          if (userRole !== 'ADMIN') {
            return NextResponse.json(
              { error: 'Access denied. Only admin accounts can log into the Admin Portal.' },
              { status: 403 }
            );
          }

          loginRateLimiter.recordSuccessfulLogin('admin', trimmedEmail, ip);
          return NextResponse.json({
            user: result.user,
            token: `da_session_${Date.now()}_${result.user.id}`,
          });
        } else {
          const failResult = loginRateLimiter.recordFailedAttempt('admin', trimmedEmail, ip);
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
            {
              error: `Invalid email or password. ${failResult.remainingAttempts} attempt${failResult.remainingAttempts === 1 ? '' : 's'} remaining.`,
              attemptsRemaining: failResult.remainingAttempts,
            },
            { status: 401 }
          );
        }
      } else {
        const rpcErr = await rpcRes.text();
        console.warn('[Auth Login] verify_staff_login RPC failed with response:', rpcErr);
      }
    } catch (rpcCallErr) {
      console.warn('[Auth Login] RPC call error, trying GoTrue fallback:', rpcCallErr);
    }

    // 2. Fallback: Standard GoTrue password auth + staff_profiles query
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || serviceRoleKey;
    const authRes = await fetch(`${cleanBaseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
      },
      body: JSON.stringify({
        email: trimmedEmail,
        password,
      }),
    });

    if (!authRes.ok) {
      const authErr = await authRes.json().catch(() => ({}));
      console.warn('[Auth Login] GoTrue auth error:', authErr);
      const failResult = loginRateLimiter.recordFailedAttempt('admin', trimmedEmail, ip);
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
        {
          error: `Invalid email or password. ${failResult.remainingAttempts} attempt${failResult.remainingAttempts === 1 ? '' : 's'} remaining.`,
          attemptsRemaining: failResult.remainingAttempts,
        },
        { status: 401 }
      );
    }

    const authData = await authRes.json();
    const userId = authData.user?.id;

    if (!userId) {
      return NextResponse.json(
        { error: 'Authentication failed' },
        { status: 401 }
      );
    }

    const staffRes = await fetch(
      `${cleanBaseUrl}/rest/v1/staff_profiles?user_id=eq.${encodeURIComponent(userId)}&select=*&limit=1`,
      {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
      }
    );

    if (!staffRes.ok) {
      return NextResponse.json(
        { error: 'Failed to retrieve profile authorization' },
        { status: 500 }
      );
    }

    const staffProfiles = await staffRes.json();
    const profile = staffProfiles[0];

    if (!profile || !profile.is_active) {
      return NextResponse.json(
        { error: 'Account is not authorized or is deactivated' },
        { status: 403 }
      );
    }

    const profileRole = String(profile.role || '').toUpperCase();
    if (profileRole !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Access denied. Only admin accounts can log into the Admin Portal.' },
        { status: 403 }
      );
    }

    loginRateLimiter.recordSuccessfulLogin('admin', trimmedEmail, ip);

    return NextResponse.json({
      user: {
        id: userId,
        email: trimmedEmail,
        role: profile.role.toLowerCase(),
        displayName: profile.display_name,
        isSuperAdmin: Boolean(profile.is_super_admin ?? (profile.created_by_admin_id === null)),
      },
      token: authData.access_token,
    });
  } catch (error: any) {
    console.error('[Auth Login] Unexpected error:', error);
    return NextResponse.json(
      { error: error?.message || 'Internal server error during login' },
      { status: 500 }
    );
  }
}
