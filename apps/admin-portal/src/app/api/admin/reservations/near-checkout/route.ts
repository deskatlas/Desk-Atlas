import { NextResponse } from 'next/server';
import {
  ReservationSupabaseRepository,
  SupabaseSettingsRepository,
  InMemorySettingsRepository,
  createAdminSettingsService,
  createStaffOperationsService,
  evaluateApproachingBookingEnds,
  getNearCheckoutThresholdMinutes,
} from '@deskatlas/domain';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    let thresholdMinutes = 15;
    try {
      const settingsRepo =
        supabaseUrl && serviceRoleKey
          ? new SupabaseSettingsRepository({ supabaseUrl, serviceRoleKey })
          : new InMemorySettingsRepository();
      const settingsService = createAdminSettingsService(settingsRepo);
      const overview = await settingsService.getSettingsOverview();
      thresholdMinutes = getNearCheckoutThresholdMinutes(
        overview?.businessSettings?.nearCheckoutThresholdMinutes ??
          overview?.businessSettings?.bookingEndAlertMinutes
      );
    } catch {
      thresholdMinutes = 15;
    }

    const staffOpsRepo = new ReservationSupabaseRepository();
    const opsService = createStaffOperationsService(staffOpsRepo);
    const reservations = await opsService.listOperationalReservations();
    const alerts = evaluateApproachingBookingEnds(reservations, thresholdMinutes, new Date());

    return NextResponse.json(
      {
        thresholdMinutes,
        nearCheckoutCount: alerts.length,
        reservations: alerts,
        alerts,
      },
      {
        headers: {
          'Cache-Control': 'no-store, max-age=0',
        },
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch near-checkout reservations';
    return NextResponse.json(
      {
        error: message,
        thresholdMinutes: 15,
        nearCheckoutCount: 0,
        reservations: [],
        alerts: [],
      },
      { status: 500 }
    );
  }
}
