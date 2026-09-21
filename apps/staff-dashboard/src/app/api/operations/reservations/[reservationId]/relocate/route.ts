import { NextRequest, NextResponse } from "next/server";
import {
  createStaffOperationsService,
  ReservationSupabaseRepository,
  StaffOperationsError,
} from "@deskatlas/domain";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
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

    const body = await request.json().catch(() => ({}));
    const targetWorkspaceInstanceId =
      typeof body.targetWorkspaceInstanceId === "string" ? body.targetWorkspaceInstanceId.trim() : "";
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    const notes = typeof body.notes === "string" ? body.notes.trim() : undefined;
    const actorRole = typeof body.actorRole === "string" ? body.actorRole.trim() : "STAFF";
    const actorUserId =
      typeof body.actorUserId === "string" && body.actorUserId.trim()
        ? body.actorUserId.trim()
        : request.headers.get("x-user-id") ?? undefined;

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

    const service = createStaffOperationsService(new ReservationSupabaseRepository());
    const result = await service.relocateReservation({
      reservationId: reservationId.trim(),
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
    const isConflictOrStatusError =
      message.includes("already booked") ||
      message.includes("occupied") ||
      message.includes("conflict") ||
      message.includes("Relocation not allowed") ||
      message.includes("not permitted") ||
      message.includes("completed") ||
      message.includes("expired") ||
      message.includes("terminal") ||
      message.includes("status");

    const status = message.includes("not found")
      ? 404
      : isConflictOrStatusError
      ? 409
      : 400;

    return NextResponse.json({ error: message }, { status });
  }
}
