import { NextRequest, NextResponse } from "next/server";
import {
  createStaffOperationsService,
  ReservationSupabaseRepository,
} from "@deskatlas/domain";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ reservationId: string }> }
) {
  try {
    const { reservationId } = await context.params;
    if (!reservationId || reservationId.trim() === "") {
      return NextResponse.json({ error: "Reservation ID is required." }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const actorUserId = body.actorUserId || request.headers.get("x-user-id") || "staff";
    const actorRole = body.actorRole || request.headers.get("x-user-role") || "STAFF";
    const notes = body.notes || "";

    const service = createStaffOperationsService(new ReservationSupabaseRepository());
    const result = await service.flagClosureManualResolution({
      reservationId: reservationId.trim(),
      actorUserId,
      actorRole,
      notes,
    });

    return NextResponse.json({ data: result });
  } catch (error: any) {
    const message = error instanceof Error ? error.message : "Failed to flag reservation for manual resolution.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
