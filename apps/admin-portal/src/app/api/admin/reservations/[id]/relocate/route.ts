import { NextRequest, NextResponse } from "next/server";
import { getAdminReservationService } from "../../_lib/reservationService";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
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

    const body = await request.json().catch(() => ({}));
    const targetWorkspaceInstanceId =
      typeof body.targetWorkspaceInstanceId === "string" ? body.targetWorkspaceInstanceId.trim() : "";
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    const notes = typeof body.notes === "string" ? body.notes.trim() : undefined;

    if (!targetWorkspaceInstanceId) {
      return NextResponse.json(
        { error: "targetWorkspaceInstanceId is required." },
        { status: 400 }
      );
    }

    if (!reason) {
      return NextResponse.json(
        { error: "Relocation reason is required." },
        { status: 400 }
      );
    }

    const actorRole = typeof body.actorRole === "string" ? body.actorRole.trim() : "ADMIN";
    const actorUserId =
      typeof body.actorUserId === "string" && body.actorUserId.trim()
        ? body.actorUserId.trim()
        : request.headers.get("x-user-id") ?? undefined;

    const service = getAdminReservationService();
    const result = await service.relocateReservation({
      reservationId: id,
      targetWorkspaceInstanceId,
      reason,
      notes,
      actorUserId,
      actorRole,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to relocate reservation.";
    const status = message.includes("not found")
      ? 404
      : message.includes("already booked") || message.includes("occupied")
      ? 409
      : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
