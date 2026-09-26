import { NextResponse } from 'next/server';
import {
  DEFAULT_WORKSPACE_STATUS_COLORS,
  SupabaseSettingsRepository,
  createAdminSettingsService,
} from '@deskatlas/domain';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json({
        customerSessionTimeoutMinutes: 20,
        customerRescheduleCutoffHours: 12,
        rescheduleMaxAdvanceValue: 30,
        rescheduleMaxAdvanceUnit: 'DAYS',
        rescheduleMaxAdvanceHours: 720,
        maxAdvanceBookingDays: 90,
        bookingIntervalMinutes: 30,
        paymentExpiryMinutes: 60,
        kioskAllowanceMinutes: 5,
        statusColors: DEFAULT_WORKSPACE_STATUS_COLORS,
        cancellationPolicyPdfUrl: null,
        cancellationPolicyPdfFilename: null,
        cancellationPolicyUpdatedAt: null,
      });
    }

    const service = createAdminSettingsService(
      new SupabaseSettingsRepository({ supabaseUrl, serviceRoleKey })
    );
    const settings = await service.getPublicBusinessSettings();
    return NextResponse.json(
      settings,
      {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
        },
      }
    );
  } catch (error) {
    console.error('Error fetching public business settings:', error);
    return NextResponse.json({
      customerSessionTimeoutMinutes: 20,
      customerRescheduleCutoffHours: 12,
      rescheduleMaxAdvanceValue: 30,
      rescheduleMaxAdvanceUnit: 'DAYS',
      rescheduleMaxAdvanceHours: 720,
      maxAdvanceBookingDays: 90,
      bookingIntervalMinutes: 30,
      paymentExpiryMinutes: 60,
      kioskAllowanceMinutes: 5,
      statusColors: DEFAULT_WORKSPACE_STATUS_COLORS,
      cancellationPolicyPdfUrl: null,
      cancellationPolicyPdfFilename: null,
      cancellationPolicyUpdatedAt: null,
    });
  }
}
