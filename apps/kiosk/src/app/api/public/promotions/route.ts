import { NextResponse } from 'next/server';
import {
  createPromotionalService,
  InMemoryPromotionalRepository,
  SupabasePromotionalRepository,
} from '@deskatlas/domain';

export const runtime = 'nodejs';

function getPromotionalService() {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (supabaseUrl && serviceRoleKey) {
    return createPromotionalService(new SupabasePromotionalRepository());
  }
  return createPromotionalService(new InMemoryPromotionalRepository());
}

export async function GET() {
  try {
    const service = getPromotionalService();
    const promotions = await service.listPromotions({ onlyActive: true });
    return NextResponse.json({ data: promotions });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch active promotions';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
