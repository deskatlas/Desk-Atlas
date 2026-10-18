import { NextRequest, NextResponse } from "next/server";
import {
  ReservationSupabaseRepository,
  SupabaseSettingsRepository,
  createTransactionalEmailService,
  evaluateCustomerCancellationEligibility,
} from "@deskatlas/domain";

export const runtime = "nodejs";

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX_ATTEMPTS = 10;
const requestLog = new Map<string, number[]>();

function getClientKey(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || "unknown";
  return `track-cancel:${ip}`;
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
      { error: "Too many cancellation attempts. Please try again later." },
      { status: 429 }
    );
  }

  try {
    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error("Supabase configuration is missing.");
    }

    const body = await request.json().catch(() => ({}));
    const referenceCode = typeof body.referenceCode === "string" ? body.referenceCode.trim().toUpperCase() : "";
    const customerEmail = typeof body.customerEmail === "string" ? body.customerEmail.trim().toLowerCase() : "";
    const cancellationReason = typeof body.reason === "string" ? body.reason.trim() : "Cancelled by customer on tracking portal";

    if (!referenceCode) {
      return NextResponse.json({ error: "Reference code is required." }, { status: 400 });
    }

    if (!customerEmail) {
      return NextResponse.json({ error: "Customer email is required." }, { status: 400 });
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

    if (trackingRecord.customerEmail.toLowerCase() !== customerEmail) {
      return NextResponse.json({ error: "Email address does not match this reservation." }, { status: 403 });
    }

    const evalResult = evaluateCustomerCancellationEligibility(trackingRecord, businessSettings, new Date(nowMs));
    if (!evalResult.canCancel) {
      return NextResponse.json(
        { error: evalResult.reason || "This reservation is not eligible for cancellation." },
        { status: 400 }
      );
    }

    // Cancel reservation and release candidate spots
    const nowIso = new Date(nowMs).toISOString();
    await reservationRepo.cancelReservation({
      reservationId: trackingRecord.reservationId,
      reason: cancellationReason,
      actorRole: "CUSTOMER",
    });

    // Check payment attempt for refund eligibility and email dispatch
    try {
      const paymentAttempts = await reservationRepo["request"]<any[]>(
        `/payment_attempts?select=*&reservation_id=eq.${encodeURIComponent(trackingRecord.reservationId)}&order=created_at.desc&limit=1`
      ).catch(() => []);

      const latestAttempt = paymentAttempts?.[0];
      if (latestAttempt && !latestAttempt.cancellation_refund_notified_at) {
        const emailService = createTransactionalEmailService();
        const cutoffValue = businessSettings?.customerCancellationCutoffValue ?? 12;
        const cutoffUnit = businessSettings?.customerCancellationCutoffUnit ?? "HOURS";
        const cutoffNotice =
          cutoffUnit === "DAYS"
            ? `${cutoffValue} ${cutoffValue === 1 ? "day" : "days"}`
            : `${cutoffValue} ${cutoffValue === 1 ? "hour" : "hours"}`;

        const sendResult = await emailService.sendCustomerCancellationRefundEligibleEmail({
          to: trackingRecord.customerEmail,
          customerFirstName: trackingRecord.customerFirstName || "Valued Guest",
          customerLastName: trackingRecord.customerLastName,
          referenceCode: trackingRecord.referenceCode,
          workspaceName: trackingRecord.finalAssignment?.workspaceDisplayName,
          scheduledVisit:
            trackingRecord.finalAssignment?.bookingStartAt && trackingRecord.finalAssignment?.bookingEndAt
              ? `${trackingRecord.finalAssignment.bookingStartAt} - ${trackingRecord.finalAssignment.bookingEndAt}`
              : undefined,
          amountDue: trackingRecord.amountDue ?? 0,
          cutoffNotice,
        });

        if (sendResult.success) {
          await reservationRepo["request"](
            `/payment_attempts?id=eq.${encodeURIComponent(latestAttempt.id)}`,
            {
              method: "PATCH",
              body: JSON.stringify({
                cancellation_refund_notified_at: nowIso,
                refund_status: "REQUIRED",
                updated_at: nowIso,
              }),
            }
          ).catch((err) => {
            console.warn("[TrackCancelRoute] Failed to record cancellation_refund_notified_at:", err);
          });
        }
      }
    } catch (emailErr: any) {
      console.warn("[TrackCancelRoute] Error during refund email notification dispatch:", emailErr?.message);
    }

    return NextResponse.json({
      success: true,
      message: "Reservation cancelled successfully.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to cancel reservation.";
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
