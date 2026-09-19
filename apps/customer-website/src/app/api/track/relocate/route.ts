import { NextRequest, NextResponse } from "next/server";
import {
  ReservationSupabaseRepository,
} from "@deskatlas/domain";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error("Supabase configuration is missing.");
    }

    const body = await request.json().catch(() => ({}));
    const referenceCode = typeof body.referenceCode === "string" ? body.referenceCode.trim().toUpperCase() : "";
    const customerEmail = typeof body.customerEmail === "string" ? body.customerEmail.trim().toLowerCase() : undefined;
    const targetWorkspaceInstanceId = typeof body.targetWorkspaceInstanceId === "string" ? body.targetWorkspaceInstanceId.trim() : "";
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    const notes = typeof body.notes === "string" ? body.notes.trim() : undefined;

    if (!referenceCode) {
      return NextResponse.json({ error: "Reference code is required." }, { status: 400 });
    }

    if (!targetWorkspaceInstanceId) {
      return NextResponse.json({ error: "Target workspace spot is required." }, { status: 400 });
    }

    if (!reason) {
      return NextResponse.json({ error: "Relocation reason is required." }, { status: 400 });
    }

    const reservationRepo = new ReservationSupabaseRepository({
      supabaseUrl,
      serviceRoleKey: supabaseKey,
    });

    const trackingRecord = await reservationRepo.findGuestReservationTrackingRecord({
      referenceCode,
      customerEmail,
    });

    if (!trackingRecord) {
      return NextResponse.json({ error: "Reservation tracking details not found." }, { status: 404 });
    }

    if (customerEmail && trackingRecord.customerEmail.toLowerCase() !== customerEmail) {
      return NextResponse.json({ error: "Email address does not match this reservation." }, { status: 403 });
    }

    if (trackingRecord.reservationStatus !== "CONFIRMED" && trackingRecord.reservationStatus !== "CHECKED_IN") {
      return NextResponse.json(
        { error: `Only confirmed or checked-in reservations can be relocated.` },
        { status: 400 }
      );
    }

    const bookingStartMs = trackingRecord.finalAssignment?.bookingStartAt
      ? new Date(trackingRecord.finalAssignment.bookingStartAt).getTime()
      : 0;
    const bookingEndMs = trackingRecord.finalAssignment?.bookingEndAt
      ? new Date(trackingRecord.finalAssignment.bookingEndAt).getTime()
      : 0;
    const nowMs = Date.now();

    if (bookingStartMs && nowMs < bookingStartMs) {
      return NextResponse.json(
        { error: "Session has not started yet. In-session spot relocation is available once your session starts." },
        { status: 400 }
      );
    }

    if (bookingEndMs && nowMs >= bookingEndMs) {
      return NextResponse.json(
        { error: "Reservation has already ended. Relocation is not available." },
        { status: 400 }
      );
    }

    if (trackingRecord.pendingRelocationRequest?.status === "PENDING") {
      return NextResponse.json(
        { error: "A relocation request is already pending approval by staff." },
        { status: 409 }
      );
    }

    const pendingRequest = await reservationRepo.requestCustomerRelocation({
      reservationId: trackingRecord.reservationId,
      targetWorkspaceInstanceId,
      reason,
      notes,
    });

    return NextResponse.json({
      success: true,
      pendingRequest,
      message: "Relocation request submitted for staff approval.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to relocate reservation.";
    const status = message.includes("not found")
      ? 404
      : message.includes("already booked") || message.includes("occupied")
      ? 409
      : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
