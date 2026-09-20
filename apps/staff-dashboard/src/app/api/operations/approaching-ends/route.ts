import { NextResponse } from 'next/server';
import {
  ReservationSupabaseRepository,
  SupabaseSettingsRepository,
  InMemorySettingsRepository,
  createAdminSettingsService,
  createStaffOperationsService,
  evaluateApproachingBookingEnds,
  getBookingEndAlertMinutes,
} from '@deskatlas/domain';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    // 1. Fetch configured alert minutes threshold from business settings
    let alertMinutes = 5;
    try {
      const settingsRepo =
        supabaseUrl && serviceRoleKey
          ? new SupabaseSettingsRepository({ supabaseUrl, serviceRoleKey })
          : new InMemorySettingsRepository();
      const settingsService = createAdminSettingsService(settingsRepo);
      const overview = await settingsService.getSettingsOverview();
      alertMinutes = getBookingEndAlertMinutes(overview?.businessSettings?.bookingEndAlertMinutes);
    } catch {
      alertMinutes = 5;
    }

    // 2. Query active operational reservations
    const staffOpsRepo = new ReservationSupabaseRepository();
    const opsService = createStaffOperationsService(staffOpsRepo);
    const reservations = await opsService.listOperationalReservations();

    // 3. Evaluate approaching ends
    const alerts = evaluateApproachingBookingEnds(reservations, alertMinutes, new Date());

    return NextResponse.json(
      {
        alerts,
        alertMinutes,
        approachingEnds: alerts,
      },
      {
        headers: {
          'Cache-Control': 'no-store, max-age=0',
        },
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch approaching booking ends';
    return NextResponse.json({ error: message, alerts: [], alertMinutes: 5 }, { status: 500 });
  }
}
