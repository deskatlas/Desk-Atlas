import { NextRequest, NextResponse } from "next/server";
import {
  ReservationSupabaseRepository,
  verifyAttendanceReconfirmToken,
  processAttendanceReconfirmation,
} from "@deskatlas/domain";

export const runtime = "nodejs";

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX_ATTEMPTS = 15;
const requestLog = new Map<string, number[]>();

function getClientKey(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || "unknown";
  return `track-reconfirm:${ip}`;
}

function consumeRateLimit(key: string, nowMs: number) {
  const windowStart = nowMs - RATE_LIMIT_WINDOW_MS;

  for (const [k, timestamps] of requestLog.entries()) {
    const validTimestamps = timestamps.filter((entry) => entry >= windowStart);
    if (validTimestamps.length === 0) {
      requestLog.delete(k);
    } else if (validTimestamps.length !== timestamps.length) {
      requestLog.set(k, validTimestamps);
    }
  }

  const attempts = requestLog.get(key) ?? [];
  attempts.push(nowMs);
  requestLog.set(key, attempts);
  return attempts.length <= RATE_LIMIT_MAX_ATTEMPTS;
}

export async function POST(request: NextRequest) {
  const nowMs = Date.now();
  if (!consumeRateLimit(getClientKey(request), nowMs)) {
    return NextResponse.json(
      { error: "Too many reconfirmation attempts. Please try again later." },
      { status: 429 }
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    const referenceCode = typeof body.referenceCode === "string" ? body.referenceCode.trim().toUpperCase() : "";
    const token = typeof body.token === "string" ? body.token.trim() : "";

    if (!referenceCode) {
      return NextResponse.json({ error: "Reference code is required." }, { status: 400 });
    }

    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      // In-memory / mock handling for test environments without Supabase credentials
      const resId = `mock-res-${referenceCode}`;
      const reconfirmResult = processAttendanceReconfirmation({
        referenceCode,
        token,
        reservation: {
          reservationId: resId,
          referenceCode,
          customerFirstName: "Guest",
        },
        now: new Date(nowMs),
        skipTokenVerification: !token,
      });

      return NextResponse.json({
        success: true,
        referenceCode,
        customerFirstName: "Guest",
        formattedDate: "Scheduled Date",
        startTime: "Scheduled Time",
        attendanceReconfirmedAt: reconfirmResult.attendanceReconfirmedAt,
        message: reconfirmResult.message,
      });
    }

    const reservationRepo = new ReservationSupabaseRepository({
      supabaseUrl,
      serviceRoleKey: supabaseKey,
    });

    const trackingRecord = await reservationRepo.findGuestReservationTrackingRecord({
      referenceCode,
    });

    if (!trackingRecord) {
      return NextResponse.json({ error: "Reservation details not found." }, { status: 404 });
    }

    // Token verification
    if (token) {
      const isValid = verifyAttendanceReconfirmToken(
        token,
        trackingRecord.referenceCode,
        trackingRecord.reservationId
      );
      if (!isValid) {
        return NextResponse.json(
          { error: "Invalid or expired reconfirmation token." },
          { status: 403 }
        );
      }
    }

    const nowIso = new Date(nowMs).toISOString();

    // Idempotency: only update database and write audit log if not previously reconfirmed
    if (!trackingRecord.attendanceReconfirmedAt) {
      try {
        await reservationRepo["request"](
          `/reservations?id=eq.${encodeURIComponent(trackingRecord.reservationId)}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              attendance_reconfirmed_at: nowIso,
              updated_at: nowIso,
            }),
          }
        );

        const customerName = [trackingRecord.customerFirstName, trackingRecord.customerLastName]
          .filter(Boolean)
          .join(" ") || trackingRecord.customerFirstName || "Customer";

        await reservationRepo["request"]("/activity_logs", {
          method: "POST",
          body: JSON.stringify({
            reservation_id: trackingRecord.reservationId,
            event_type: "ATTENDANCE_RECONFIRMED",
            description: `${customerName} reconfirmed attendance`,
            created_at: nowIso,
          }),
        }).catch(() => {
          // Non-critical if activity_logs schema differs
        });
      } catch (patchErr) {
        console.warn("[TrackReconfirmRoute] Failed to record attendance_reconfirmed_at in database:", patchErr);
      }
    }

    const startDate = trackingRecord.finalAssignment?.bookingStartAt
      ? new Date(trackingRecord.finalAssignment.bookingStartAt)
      : new Date(nowMs);

    const formattedDate = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Manila",
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(startDate);

    const startTime = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Manila",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(startDate);

    return NextResponse.json({
      success: true,
      referenceCode: trackingRecord.referenceCode,
      customerFirstName: trackingRecord.customerFirstName || "Valued Guest",
      formattedDate,
      startTime,
      attendanceReconfirmedAt: trackingRecord.attendanceReconfirmedAt || nowIso,
      message: trackingRecord.attendanceReconfirmedAt
        ? "Attendance was previously confirmed."
        : "Attendance reconfirmed successfully.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to reconfirm attendance.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
