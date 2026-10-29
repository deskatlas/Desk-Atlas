import { NextResponse } from 'next/server';
import {
  SupabaseSettingsRepository,
  InMemorySettingsRepository,
  createAdminSettingsService,
} from '@deskatlas/domain';
import { getStaffRentalService } from '../_lib/rentalService';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    // 1. Fetch configured rental alert minutes threshold from business settings
    let alertMinutes = 5;
    try {
      const settingsRepo =
        supabaseUrl && serviceRoleKey
          ? new SupabaseSettingsRepository({ supabaseUrl, serviceRoleKey })
          : new InMemorySettingsRepository();
      const settingsService = createAdminSettingsService(settingsRepo);
      const overview = await settingsService.getSettingsOverview();
      const rawThreshold = overview?.businessSettings?.rentalAlertMinutes;
      alertMinutes =
        typeof rawThreshold === 'number' && rawThreshold >= 1 && rawThreshold <= 60
          ? rawThreshold
          : 5;
    } catch {
      alertMinutes = 5;
    }

    // 2. Fetch rental alerts
    const rentalService = getStaffRentalService();
    const alerts = await rentalService.getRentalAlerts(alertMinutes);

    // 3. Process customer ending alert emails at the same configured staff alert threshold
    try {
      await rentalService.processRentalEndAlertEmails(alertMinutes);
    } catch (emailErr) {
      console.warn('[StaffRentalsAlerts] Error processing rental ending emails:', emailErr);
    }

    return NextResponse.json(
      {
        alerts,
        thresholdMinutes: alertMinutes,
        rentalAlertCount: alerts.length,
      },
      {
        headers: {
          'Cache-Control': 'no-store, max-age=0',
        },
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch rental alerts';
    return NextResponse.json(
      { error: message, alerts: [], thresholdMinutes: 5, rentalAlertCount: 0 },
      { status: 500 }
    );
  }
}

