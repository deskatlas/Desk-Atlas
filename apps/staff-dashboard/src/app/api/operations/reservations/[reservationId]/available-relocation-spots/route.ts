import { NextRequest, NextResponse } from "next/server";
import {
  createStaffOperationsService,
  ReservationSupabaseRepository,
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
    const spots = await service.listAvailableRelocationSpots(reservationId.trim());

    return NextResponse.json({ spots });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load available relocation spots.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
