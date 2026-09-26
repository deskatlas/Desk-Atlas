import { NextResponse } from 'next/server';
import {
  DEFAULT_WORKSPACE_STATUS_COLORS,
  SupabaseSettingsRepository,
  createAdminSettingsService,
  InMemorySettingsRepository,
} from '@deskatlas/domain';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    const repo =
      supabaseUrl && serviceRoleKey
        ? new SupabaseSettingsRepository({ supabaseUrl, serviceRoleKey })
        : new InMemorySettingsRepository();

    const service = createAdminSettingsService(repo);
    const settings = await service.getPublicBusinessSettings();

    return NextResponse.json(settings, {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  } catch (error) {
    return NextResponse.json({
      statusColors: DEFAULT_WORKSPACE_STATUS_COLORS,
      kioskAllowanceMinutes: 5,
      maxAdvanceBookingDays: 90,
    });
  }
}
