import { NextRequest, NextResponse } from 'next/server';
import { createStaffService } from '@deskatlas/domain';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId') || undefined;

    const staffService = createStaffService();
    const status = await staffService.getSetupStatus(userId);

    return NextResponse.json(status, {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  } catch (error: unknown) {
    console.error('[Admin Setup Status] Error checking admin status:', error);
    const msg = error instanceof Error ? error.message : 'Failed to check setup status';
    return NextResponse.json(
      { error: msg },
      { status: 500 }
    );
  }
}
