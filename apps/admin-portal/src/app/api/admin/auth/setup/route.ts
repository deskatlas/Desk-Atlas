import { NextRequest, NextResponse } from 'next/server';
import { AdminAlreadyExistsError, createStaffService } from '@deskatlas/domain';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    let { userId, email, displayName, token, code } = body;

    const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

    // If an authorization code was received (PKCE flow), exchange it with Supabase for the session
    if (code && supabaseUrl && anonKey && !token) {
      try {
        const cleanBase = supabaseUrl.replace(/\/$/, '');
        const exchangeRes = await fetch(`${cleanBase}/auth/v1/token?grant_type=pkce`, {
          method: 'POST',
          headers: {
            apikey: anonKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ auth_code: code }),
        });

        if (exchangeRes.ok) {
          const sessionData = await exchangeRes.json();
          if (sessionData.access_token) {
            token = sessionData.access_token;
            if (sessionData.user) {
              userId = sessionData.user.id;
              email = sessionData.user.email || email;
              const metaName = sessionData.user.user_metadata?.full_name || sessionData.user.user_metadata?.name || sessionData.user.user_metadata?.display_name;
              if (metaName && !displayName) {
                displayName = metaName;
              }
            }
          }
        }
      } catch (exchangeErr) {
        console.warn('[Admin Setup] Code exchange fallback error:', exchangeErr);
      }
    }

    // If an OAuth access token is provided, verify it directly with Supabase Auth to confirm Google identity
    if (token && supabaseUrl && anonKey) {
      try {
        const cleanBase = supabaseUrl.replace(/\/$/, '');
        const verifyRes = await fetch(`${cleanBase}/auth/v1/user`, {
          headers: {
            apikey: anonKey,
            Authorization: `Bearer ${token}`,
          },
          cache: 'no-store',
        });

        if (verifyRes.ok) {
          const authUser = await verifyRes.json();
          if (authUser?.id) {
            userId = authUser.id;
            email = authUser.email || email;
            const metaName = authUser.user_metadata?.full_name || authUser.user_metadata?.name || authUser.user_metadata?.display_name;
            if (metaName && !displayName) {
              displayName = metaName;
            }
          }
        }
      } catch (authErr) {
        console.warn('[Admin Setup] Token verification fallback error:', authErr);
      }
    }

    if (!userId || typeof userId !== 'string') {
      return NextResponse.json(
        { error: 'Valid user ID from authenticated Google session is required' },
        { status: 400 }
      );
    }

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return NextResponse.json(
        { error: 'Valid email address from authenticated Google session is required' },
        { status: 400 }
      );
    }

    const staffService = createStaffService();

    // Check single-use guard
    const exists = await staffService.checkAdminExists();
    if (exists) {
      return NextResponse.json(
        { error: 'Administrator account already exists. Setup is sealed.' },
        { status: 403 }
      );
    }

    const profile = await staffService.setupInitialAdmin({
      userId,
      email,
      displayName,
      provider: 'google',
    });

    const sessionToken = token || `da_session_${Date.now()}_${profile.userId}`;

    return NextResponse.json({
      success: true,
      user: {
        id: profile.userId,
        email: profile.email,
        role: 'admin',
        displayName: profile.displayName,
        isSuperAdmin: true,
      },
      token: sessionToken,
    });
  } catch (error: any) {
    if (error instanceof AdminAlreadyExistsError) {
      return NextResponse.json(
        { error: error.message },
        { status: 403 }
      );
    }

    console.error('[Admin Setup] Unexpected error during initial setup:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to complete initial admin setup' },
      { status: error?.statusCode || 500 }
    );
  }
}
