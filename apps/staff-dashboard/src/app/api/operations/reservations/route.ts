import { NextRequest, NextResponse } from "next/server";
import {
  createStaffOperationsService,
  ReservationSupabaseRepository,
  StaffOperationsConflictError,
  StaffOperationsError,
} from "@deskatlas/domain";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const searchParam = request.nextUrl.searchParams.get("search") ?? undefined;
    const service = createStaffOperationsService(new ReservationSupabaseRepository());
    const reservations = await service.listOperationalReservations(searchParam);
    return NextResponse.json({ reservations });
  } catch (error) {
    if (error instanceof StaffOperationsError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (error instanceof StaffOperationsConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }

    const message =
      error instanceof Error ? error.message : "Unable to load operational reservations.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
