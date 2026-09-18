import { NextResponse } from "next/server";
import {
  createStaffOperationsService,
  ReservationSupabaseRepository,
  StaffOperationsConflictError,
  StaffOperationsError,
} from "@deskatlas/domain";

export const runtime = "nodejs";

export async function GET() {
  try {
    const service = createStaffOperationsService(new ReservationSupabaseRepository());
    const occupancy = await service.listOccupancy();
    return NextResponse.json({ occupancy });
  } catch (error) {
    if (error instanceof StaffOperationsError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (error instanceof StaffOperationsConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }

    const message =
      error instanceof Error ? error.message : "Unable to load occupancy.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
