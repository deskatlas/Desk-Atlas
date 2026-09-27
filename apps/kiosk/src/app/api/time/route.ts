import { NextResponse } from 'next/server';
import {
  getPhtNow,
  getPhtDateString,
  getPhtTimeString,
  MANILA_TIMEZONE,
} from '@deskatlas/domain';

export const runtime = 'nodejs';

export async function GET() {
  const now = new Date();
  const serverTimestamp = now.getTime();
  const phtDate = getPhtDateString(now);
  const phtTime = getPhtTimeString(now);
  const phtIso = getPhtNow().toISOString();

  return NextResponse.json(
    {
      serverTimestamp,
      phtDate,
      phtTime,
      phtIso,
      timezone: MANILA_TIMEZONE,
    },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        Pragma: 'no-cache',
      },
    }
  );
}
