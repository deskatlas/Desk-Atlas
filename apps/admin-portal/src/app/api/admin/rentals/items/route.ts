import { NextResponse } from 'next/server';
import {
  SupabaseAdditionalServiceRepository,
  InMemoryAdditionalServiceRepository,
  createAdditionalServiceService,
} from '@deskatlas/domain';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    const repo =
      supabaseUrl && serviceRoleKey
        ? new SupabaseAdditionalServiceRepository({ supabaseUrl, serviceRoleKey })
        : new InMemoryAdditionalServiceRepository();
    const service = createAdditionalServiceService(repo);

    const items = await service.listServices({
      isActive: true,
      serviceType: 'rental',
    });

    return NextResponse.json(
      { items },
      {
        headers: {
          'Cache-Control': 'no-store, max-age=0',
        },
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch rental items';
    return NextResponse.json({ error: message, items: [] }, { status: 500 });
  }
}

