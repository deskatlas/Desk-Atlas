import { NextResponse } from "next/server";
import {
  createStaffOperationsService,
  ReservationSupabaseRepository,
} from "@deskatlas/domain";

export const runtime = "nodejs";

export async function GET() {
  try {
    const service = createStaffOperationsService(new ReservationSupabaseRepository());
    const result = await service.getClosureAlerts();
    return NextResponse.json(result);
  } catch (error: unknown) {
    const structuredCode = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
    const sqlstate = typeof structuredCode === 'string' && /^[A-Z0-9]{5}$/.test(structuredCode)
      ? structuredCode
      : error instanceof Error ? /"code"\s*:\s*"([A-Z0-9]{5})"/.exec(error.message)?.[1] : undefined;
    console.error('CLOSURE_ALERTS_READ_FAILED', { sqlstate: sqlstate ?? 'UNAVAILABLE' });
    const message = "Closure alerts are unavailable. Please try again.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
