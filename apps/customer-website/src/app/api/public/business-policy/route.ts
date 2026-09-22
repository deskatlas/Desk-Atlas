import { NextResponse } from 'next/server';
import {
  SupabaseSettingsRepository,
  createAdminSettingsService,
  InMemorySettingsRepository,
} from '@deskatlas/domain';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    let repository: any;
    if (supabaseUrl && serviceRoleKey) {
      repository = new SupabaseSettingsRepository({ supabaseUrl, serviceRoleKey });
    } else {
      repository = new InMemorySettingsRepository();
    }

    const service = createAdminSettingsService(repository);
    const settings = await service.getPublicBusinessSettings();

    return NextResponse.json({
      policyPdfUrl: settings.cancellationPolicyPdfUrl ?? null,
      filename: settings.cancellationPolicyPdfFilename ?? null,
      updatedAt: settings.cancellationPolicyUpdatedAt ?? null,
      rescheduleCutoffHours: settings.customerRescheduleCutoffHours ?? 12,
      rescheduleMaxAdvanceValue: settings.rescheduleMaxAdvanceValue ?? 30,
      rescheduleMaxAdvanceUnit: settings.rescheduleMaxAdvanceUnit ?? 'DAYS',
      rescheduleMaxAdvanceHours: settings.rescheduleMaxAdvanceHours ?? 720,
      businessName: settings.businessName || 'DeskAtlas Coworking',
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    });
  } catch (error: any) {
    return NextResponse.json({
      policyPdfUrl: null,
      filename: null,
      updatedAt: null,
      rescheduleCutoffHours: 12,
      rescheduleMaxAdvanceValue: 30,
      rescheduleMaxAdvanceUnit: 'DAYS',
      rescheduleMaxAdvanceHours: 720,
      businessName: 'DeskAtlas Coworking',
    });
  }
}
