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
  } catch (error: any) {
    const message = error instanceof Error ? error.message : "Failed to load closure alerts.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
