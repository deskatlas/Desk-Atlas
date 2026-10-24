import { NextResponse } from 'next/server';
import { adminBadgeCountsSchema } from '@deskatlas/validation';
import { AdminAccessError, verifyAdministrator } from '../auth/_lib/verifiedAdmin';

export const runtime = 'nodejs';

// MS-35 / PRD-F6/F9 / SDD-C5/C12: aggregate in PostgreSQL, never hydrate queues.
export async function GET(request: Request) {
  const headers = { 'Cache-Control': 'private, no-store' };
  try {
    const { client, actor } = await verifyAdministrator(request);
    const { data, error } = await client.rpc('admin_badge_counts', { p_actor: actor });
    if (error) throw new Error('Badge counts are temporarily unavailable.');
    return NextResponse.json(adminBadgeCountsSchema.parse(data), { headers });
  } catch (error) {
    const status = error instanceof AdminAccessError ? error.status : 503;
    const message = error instanceof AdminAccessError ? error.code : 'Badge counts are temporarily unavailable.';
    return NextResponse.json({ error: message }, { status, headers });
  }
}
