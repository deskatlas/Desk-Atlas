import { isCampaignAnalyticsRange } from '@deskatlas/domain';
import { NextRequest, NextResponse } from 'next/server';
import { authorizeCampaignAnalytics, analyticsForbidden, analyticsFailure } from './_lib/analytics';

export const runtime = 'nodejs';
export async function GET(request: NextRequest) {
  try {
    const service = await authorizeCampaignAnalytics(request);
    if (!service) return analyticsForbidden();
    const range = request.nextUrl.searchParams.get('range') ?? '30d';
    if (!isCampaignAnalyticsRange(range)) return NextResponse.json({ error: 'Invalid range.' }, { status: 400 });
    const snapshot = await service.getSnapshot(range);
    return NextResponse.json({ ...snapshot, recentRedemptions: snapshot.recentRedemptions.slice(0, 20) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return analyticsFailure(); }
}
