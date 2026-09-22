import { NextRequest, NextResponse } from "next/server";
import {
  ReservationSupabaseRepository,
  SupabaseSettingsRepository,
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
    const targetDate = typeof body.date === "string" ? body.date.trim() : undefined;
    const startAt = typeof body.startAt === "string" ? body.startAt.trim() : undefined;
    const endAt = typeof body.endAt === "string" ? body.endAt.trim() : undefined;
    const workspaceInstanceId = typeof body.workspaceInstanceId === "string" ? body.workspaceInstanceId.trim() : undefined;

    if (!referenceCode) {
      return NextResponse.json({ error: "Reference code is required." }, { status: 400 });
    }

    const reservationRepo = new ReservationSupabaseRepository({
      supabaseUrl,
      serviceRoleKey: supabaseKey,
    });
    const settingsRepo = new SupabaseSettingsRepository({
      supabaseUrl,
      serviceRoleKey: supabaseKey,
    });

    const [trackingRecord, businessSettings] = await Promise.all([
      reservationRepo.findGuestReservationTrackingRecord({
        referenceCode,
        customerEmail,
      }),
      settingsRepo.getBusinessSettings().catch(() => null),
    ]);

    if (!trackingRecord) {
      return NextResponse.json({ error: "Reservation tracking details not found." }, { status: 404 });
    }

    if (trackingRecord.reservationStatus !== "CONFIRMED") {
      return NextResponse.json(
        { error: `Cannot reschedule a ${trackingRecord.reservationStatus.toLowerCase()} reservation.` },
        { status: 400 }
      );
    }

    const rescheduleCount = trackingRecord.rescheduleCount ?? 0;
    if (rescheduleCount >= 1) {
      return NextResponse.json(
        { error: "Customer can only reschedule a reservation once." },
        { status: 400 }
      );
    }

    const cutoffHours = businessSettings?.customerRescheduleCutoffHours ?? 12;
    const maxAdvanceValue = businessSettings?.rescheduleMaxAdvanceValue ?? 30;
    const maxAdvanceUnit = businessSettings?.rescheduleMaxAdvanceUnit ?? "DAYS";
    const maxAdvanceHours = maxAdvanceUnit === "HOURS" ? maxAdvanceValue : maxAdvanceValue * 24;

    const origStartMs = trackingRecord.finalAssignment?.bookingStartAt
      ? new Date(trackingRecord.finalAssignment.bookingStartAt).getTime()
      : 0;
    const nowMs = Date.now();

    if (origStartMs && nowMs > origStartMs - cutoffHours * 3600 * 1000) {
      return NextResponse.json(
        {
          error: `Reschedule must be requested at least ${cutoffHours} hours before the original scheduled start time.`,
        },
        { status: 400 }
      );
    }

    const origEndMs = trackingRecord.finalAssignment?.bookingEndAt
      ? new Date(trackingRecord.finalAssignment.bookingEndAt).getTime()
      : 0;
    const durationHours =
      origStartMs && origEndMs
        ? Math.round(((origEndMs - origStartMs) / (1000 * 60 * 60)) * 10) / 10
        : (body.durationHours ?? 2);

    const result = await reservationRepo.checkRescheduleAvailability({
      reservationId: trackingRecord.reservationId,
      date: targetDate,
      startAt,
      endAt,
      durationHours,
      workspaceInstanceId: workspaceInstanceId || trackingRecord.finalAssignment?.workspaceInstanceId,
      maxAdvanceValue,
      maxAdvanceUnit,
      maxAdvanceHours,
    });

    return NextResponse.json({
      ...result,
      durationHours,
      cutoffHours,
      maxAdvanceValue,
      maxAdvanceUnit,
      maxAdvanceHours,
      assignedWorkspaceDisplayName: trackingRecord.finalAssignment?.workspaceDisplayName,
      assignedWorkspaceTemplateName: trackingRecord.finalAssignment?.workspaceTemplateName,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to check reschedule availability.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
