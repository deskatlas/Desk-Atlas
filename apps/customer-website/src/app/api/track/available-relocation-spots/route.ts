import { NextRequest, NextResponse } from "next/server";
import { ReservationSupabaseRepository } from "@deskatlas/domain";

export const runtime = "nodejs";

async function handleGetAvailableSpots(referenceCode: string, customerEmail?: string) {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Supabase configuration is missing.");
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

  if (customerEmail && trackingRecord.customerEmail.toLowerCase() !== customerEmail.toLowerCase()) {
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

  const spots = await reservationRepo.listAvailableRelocationSpots({
    reservationId: trackingRecord.reservationId,
  });

  const remainingMinutes = bookingEndMs > nowMs ? Math.max(0, Math.round((bookingEndMs - nowMs) / 60000)) : 0;

  return NextResponse.json({
    spots,
    referenceCode: trackingRecord.referenceCode,
    currentSpotName: trackingRecord.finalAssignment?.workspaceDisplayName,
    workspaceTemplateName: trackingRecord.finalAssignment?.workspaceTemplateName,
    remainingMinutes,
    bookingEndAt: trackingRecord.finalAssignment?.bookingEndAt,
  });
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const referenceCode = searchParams.get("referenceCode")?.trim().toUpperCase() || "";
    const customerEmail = searchParams.get("customerEmail")?.trim().toLowerCase() || undefined;

    if (!referenceCode) {
      return NextResponse.json({ error: "Reference code is required." }, { status: 400 });
    }

    return await handleGetAvailableSpots(referenceCode, customerEmail);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load available spots.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const referenceCode = typeof body.referenceCode === "string" ? body.referenceCode.trim().toUpperCase() : "";
    const customerEmail = typeof body.customerEmail === "string" ? body.customerEmail.trim().toLowerCase() : undefined;

    if (!referenceCode) {
      return NextResponse.json({ error: "Reference code is required." }, { status: 400 });
    }

    return await handleGetAvailableSpots(referenceCode, customerEmail);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load available spots.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
