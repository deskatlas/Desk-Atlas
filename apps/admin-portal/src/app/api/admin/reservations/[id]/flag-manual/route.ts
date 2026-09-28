import { NextRequest, NextResponse } from "next/server";
import { getAdminReservationService } from "../../_lib/reservationService";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const service = getAdminReservationService();

    const actorUserId = body.actorUserId || request.headers.get("x-user-id") || undefined;
    const actorRole = body.actorRole || request.headers.get("x-user-role") || "ADMIN";
    const actorName = body.actorName || body.staffName || undefined;
    const notes = body.notes || "";

    const result = await service.flagClosureManualResolution({
      reservationId: id,
      actorUserId,
      actorRole,
      actorName,
      notes,
    });

    return NextResponse.json({ data: result });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to flag reservation for manual resolution.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
