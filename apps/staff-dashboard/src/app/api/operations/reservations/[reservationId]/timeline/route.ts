import { NextRequest, NextResponse } from "next/server";
import {
  createStaffOperationsService,
  ReservationSupabaseRepository,
  StaffOperationsError,
} from "@deskatlas/domain";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  context: {
    params: Promise<{
      reservationId: string;
    }>;
  }
) {
  try {
    const { reservationId } = await context.params;
    if (!reservationId || reservationId.trim() === "") {
      return NextResponse.json({ error: "Reservation ID is required." }, { status: 400 });
    }

    const service = createStaffOperationsService(new ReservationSupabaseRepository());
    const timeline = await service.getReservationTimeline(reservationId.trim(), "STAFF");

    return NextResponse.json({ timeline });
  } catch (error) {
    if (error instanceof StaffOperationsError) {
      const status = error.message.toLowerCase().includes("not found") ? 404 : 400;
      return NextResponse.json({ error: error.message }, { status });
    }

    const message =
      error instanceof Error ? error.message : "Unable to load reservation timeline.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
