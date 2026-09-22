import { NextRequest, NextResponse } from "next/server";
import {
  ReservationSupabaseRepository,
  SupabaseSettingsRepository,
  createTransactionalEmailService,
  formatSchedule,
  buildReservationTrackingUrl,
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
    const startAt = typeof body.startAt === "string" ? body.startAt.trim() : "";
    const endAt = typeof body.endAt === "string" ? body.endAt.trim() : "";
    const workspaceInstanceId = typeof body.workspaceInstanceId === "string" ? body.workspaceInstanceId.trim() : undefined;

    if (!referenceCode) {
      return NextResponse.json({ error: "Reference code is required." }, { status: 400 });
    }

    if (!startAt || !endAt) {
      return NextResponse.json({ error: "startAt and endAt are required." }, { status: 400 });
    }

    const startMs = new Date(startAt).getTime();
    const endMs = new Date(endAt).getTime();
    if (isNaN(startMs) || isNaN(endMs) || endMs <= startMs) {
      return NextResponse.json({ error: "End time must be strictly after start time." }, { status: 400 });
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

    if (customerEmail && trackingRecord.customerEmail.toLowerCase() !== customerEmail) {
      return NextResponse.json({ error: "Email address does not match this reservation." }, { status: 403 });
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
    const maxAdvanceMs = maxAdvanceHours * 3600 * 1000;

    const origStartMs = trackingRecord.finalAssignment?.bookingStartAt
      ? new Date(trackingRecord.finalAssignment.bookingStartAt).getTime()
      : 0;
    const nowMs = Date.now();

    if (origStartMs && nowMs > origStartMs - cutoffHours * 3600 * 1000) {
      return NextResponse.json(
        {
          error: `Reschedule must be requested at least ${cutoffHours} hours before the scheduled start time.`,
        },
        { status: 400 }
      );
    }

    if (startMs > nowMs + maxAdvanceMs) {
      return NextResponse.json(
        {
          error: `Rescheduling is only allowed up to ${maxAdvanceValue} ${maxAdvanceUnit.toLowerCase()} in advance.`,
        },
        { status: 400 }
      );
    }

    const result = await reservationRepo.rescheduleReservation({
      reservationId: trackingRecord.reservationId,
      startAt,
      endAt,
      workspaceInstanceId,
      actorRole: "CUSTOMER",
      cutoffHours,
      maxAdvanceValue,
      maxAdvanceUnit,
      maxAdvanceHours,
    });

    // Dispatch confirmation email
    try {
      const emailService = createTransactionalEmailService();
      const trackingBaseUrl =
        process.env.TRACKING_BASE_URL ??
        process.env.DESKATLAS_PUBLIC_APP_URL ??
        request.nextUrl.origin.replace(/\/$/, "");
      const trackingUrl = buildReservationTrackingUrl(trackingBaseUrl, result.reservation.referenceCode);
      const assigned = result.reservation.assignedCandidate || result.reservation.candidates?.[0];

      await emailService.sendReservationRescheduledEmail({
        to: result.reservation.customerEmail,
        customerFirstName: result.reservation.customerFirstName,
        customerLastName: result.reservation.customerLastName,
        referenceCode: result.reservation.referenceCode,
        oldSchedule: (result as any).oldSchedule || result.reservation.schedule,
        newSchedule: formatSchedule(startAt, endAt),
        workspaceDisplayName: assigned?.workspaceDisplayName || "Assigned Workspace",
        workspaceTemplateName: assigned?.workspaceTemplateName || undefined,
        floorName: assigned?.floorName || undefined,
        bookingAccessUrl: result.reservation.bookingAccessUrl || undefined,
        bookingToken: result.reservation.bookingToken || undefined,
        trackingUrl,
        actorRole: "CUSTOMER",
      });
    } catch (emailErr: any) {
      console.warn("[TrackRescheduleRoute] Failed to dispatch rescheduled email:", emailErr?.message);
    }

    return NextResponse.json({
      success: true,
      reservation: result.reservation,
      message: "Reservation rescheduled successfully.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to reschedule reservation.";
    const status = message.includes("not found")
      ? 404
      : message.includes("already booked") || message.includes("occupied")
      ? 409
      : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
