import { NextRequest, NextResponse } from "next/server";
import { getAdminReservationService } from "../../_lib/reservationService";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    if (!id) {
      return NextResponse.json(
        { error: "Reservation ID is required." },
        { status: 400 }
      );
    }

    const service = getAdminReservationService();
    const spots = await service.listAvailableRelocationSpots(id);

    return NextResponse.json({ spots });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load available relocation spots.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
