import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl) {
      return NextResponse.json(
        { error: 'Server authentication configuration missing (SUPABASE_URL)' },
        { status: 500 }
      );
    }

    const { searchParams } = new URL(request.url);
    const origin = request.headers.get('origin') || request.headers.get('host') ? `${request.nextUrl.protocol}//${request.headers.get('host')}` : 'http://localhost:3000';
    const redirectTo = searchParams.get('redirect_to') || `${origin}/manage/auth/callback`;

    const cleanBase = supabaseUrl.replace(/\/$/, '');
    const authUrl = `${cleanBase}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectTo)}`;

    if (searchParams.get('format') === 'json') {
      return NextResponse.json({ url: authUrl });
    }

    return NextResponse.redirect(authUrl);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to initiate Google OAuth';
    return NextResponse.json(
      { error: msg },
      { status: 500 }
    );
  }
}
