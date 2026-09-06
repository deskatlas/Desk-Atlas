import { NextResponse } from 'next/server';
import {
  SupabaseSettingsRepository,
  createAdminSettingsService,
} from '@deskatlas/domain';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json({ photos: [] });
    }

    const service = createAdminSettingsService(
      new SupabaseSettingsRepository({ supabaseUrl, serviceRoleKey })
    );
    const photos = await service.getPublicLandingPreviewPhotos();
    return NextResponse.json(
      { photos },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=1200',
        },
      }
    );
  } catch (error) {
    console.error('Error fetching landing preview photos:', error);
    return NextResponse.json({ photos: [] });
  }
}
