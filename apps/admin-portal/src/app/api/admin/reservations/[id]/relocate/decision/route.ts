import { NextRequest, NextResponse } from "next/server";
import { getAdminReservationService } from "../../../_lib/reservationService";

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
    const decision = body.decision;
    if (decision !== "APPROVE" && decision !== "DECLINE") {
      return NextResponse.json(
        { error: "Decision must be either 'APPROVE' or 'DECLINE'." },
        { status: 400 }
      );
    }

    const notes = typeof body.notes === "string" ? body.notes.trim() : undefined;
    const actorRole =
      body.actorRole === "SUPERADMIN" || body.actorRole === "SUPER_ADMIN"
        ? "SUPERADMIN"
        : body.actorRole === "STAFF"
        ? "STAFF"
        : "ADMIN";
    const actorUserId =
      typeof body.actorUserId === "string" && body.actorUserId.trim()
        ? body.actorUserId.trim()
        : request.headers.get("x-user-id") ?? undefined;

    const service = getAdminReservationService();
    const result = await service.decideCustomerRelocation({
      reservationId: id,
      decision,
      notes,
      actorUserId,
      actorRole,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to decide relocation request.";
    const status = message.includes("not found")
      ? 404
      : message.includes("already booked") || message.includes("occupied")
      ? 409
      : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
