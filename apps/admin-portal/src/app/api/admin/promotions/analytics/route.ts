import { isPromoAnalyticsRange } from '@deskatlas/domain';
import { NextRequest, NextResponse } from 'next/server';
import {
  authorizePromoAnalytics,
  promoAnalyticsForbidden,
  promoAnalyticsFailure,
} from './_lib/analytics';

export const runtime = 'nodejs';

// MS-74: SDD-C7, SDD-C11, SDD-C19, PRD-F15, PRD-F25, QAD-TC43.
export async function GET(request: NextRequest) {
  try {
    const service = await authorizePromoAnalytics(request);
    if (!service) return promoAnalyticsForbidden();
    const range = request.nextUrl.searchParams.get('range') ?? '30d';
    if (!isPromoAnalyticsRange(range)) {
      return NextResponse.json({ error: 'Invalid range.' }, { status: 400 });
    }
    const snapshot = await service.getSnapshot(range);
    return NextResponse.json(snapshot, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return promoAnalyticsFailure();
  }
}
