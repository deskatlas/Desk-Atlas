import { NextRequest, NextResponse } from "next/server";
import {
  buildReservationTrackingUrl,
  CounterPaymentConflictError,
  CounterPaymentError,
  createBookingAccessService,
  createCounterPaymentService,
  createTransactionalEmailService,
  formatEmailBookingDate,
  formatEmailBookingTimeRange,
  handleConfirmedReservationCampaignQualification,
  hashBookingToken,
  redeemReservationVoucher,
  ReservationSupabaseRepository,
  SupabaseSettingsRepository,
  VoucherSupabaseRepository,
} from "@deskatlas/domain";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: {
    params: Promise<{
      paymentAttemptId: string;
    }>;
  }
) {
  try {
    const { paymentAttemptId } = await context.params;
    const body = await request.json();
    const reservationRepository = new ReservationSupabaseRepository();
    const counterPaymentService = createCounterPaymentService(reservationRepository);
    const counterPaymentRecord = await counterPaymentService.getCounterPaymentRecord(paymentAttemptId);
    let actorUserId = String(
      body.actorUserId ??
      body.actor?.userId ??
      request.headers.get("x-actor-user-id") ??
      request.headers.get("x-user-id") ??
      ""
    ).trim();

    let actorRole = String(
      body.actorRole ??
      body.actor?.role ??
      request.headers.get("x-actor-role") ??
      request.headers.get("x-user-role") ??
      ""
    ).trim().toUpperCase();

    const isValidUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actorUserId);

    if (!actorUserId || !isValidUuid) {
      return NextResponse.json(
        { error: "Actor user ID is required to confirm counter payment." },
        { status: 401 }
      );
    }

    const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (supabaseUrl && serviceRoleKey && isValidUuid) {
      try {
        const res = await fetch(
          `${supabaseUrl.replace(/\/$/, "")}/rest/v1/staff_profiles?user_id=eq.${actorUserId}&select=user_id,role&limit=1`,
          {
            headers: {
              apikey: serviceRoleKey,
              Authorization: `Bearer ${serviceRoleKey}`,
            },
            cache: "no-store",
          }
        );
        if (res.ok) {
          const profiles = await res.json();
          if (Array.isArray(profiles) && profiles[0]?.role) {
            actorRole = profiles[0].role;
          }
        }
      } catch {
        // fallback
      }
    }
    const resolvedRole: "ADMIN" | "STAFF" = actorRole === "ADMIN" ? "ADMIN" : "STAFF";

    const result = await counterPaymentService.confirmPayment({
      paymentAttemptId,
      actor: {
        userId: actorUserId,
        role: resolvedRole,
      },
    });

    if (result.assignedCandidate) {
      result.reservationStatus = "CHECKED_IN";
    }

    if (
      (result.reservationStatus === "CONFIRMED" || result.reservationStatus === "CHECKED_IN") &&
      result.assignedCandidate
    ) {
      const bookingAccessService = createBookingAccessService(reservationRepository);
      const defaultCustomerOrigin = request.nextUrl.origin.replace(/:3002$/, ":3001").replace(/\/$/, "");
      const bookingAccessBaseUrl =
        process.env.BOOKING_ACCESS_BASE_URL ??
        `${defaultCustomerOrigin}/api/booking`;
      const trackingBaseUrl =
        process.env.TRACKING_BASE_URL ??
        process.env.DESKATLAS_PUBLIC_APP_URL ??
        defaultCustomerOrigin;
      const trackingUrl = buildReservationTrackingUrl(trackingBaseUrl, result.reservationReferenceCode);
      const bookingAccess = await bookingAccessService.issueBookingAccess(
        result.reservationId,
        result.reservationReferenceCode,
        bookingAccessBaseUrl
      );

      if (bookingAccess) {
        const bookingAccessRecord = await reservationRepository.findBookingAccessByTokenHash(
          hashBookingToken(bookingAccess.token)
        );

        if (bookingAccessRecord) {
          const emailService = createTransactionalEmailService();
          await emailService.sendBookingConfirmationEmail({
            to: counterPaymentRecord.customerEmail,
            customerFirstName: counterPaymentRecord.customerFirstName,
            customerLastName: counterPaymentRecord.customerLastName,
            referenceCode: result.reservationReferenceCode,
            workspaceDisplayName: bookingAccessRecord.assignedWorkspaceDisplayName,
            workspaceTemplateName: bookingAccessRecord.assignedWorkspaceTemplateName,
            floorName: bookingAccessRecord.assignedFloorName,
            bookingStartAt: bookingAccessRecord.assignedStartAt,
            bookingEndAt: bookingAccessRecord.assignedEndAt,
            bookingAccessUrl: bookingAccess.accessUrl,
            bookingToken: bookingAccess.token,
            qrIssuedAt: bookingAccess.issuedAt,
            trackingUrl,
            digitalPassUrl: `${defaultCustomerOrigin}/pass/${bookingAccess.token}`,
            termsUrl: `${defaultCustomerOrigin}/terms`,
          });
        }
      }

      // MS-36: Trigger automated campaign qualification pipeline and instant milestone evaluation
      try {
        await handleConfirmedReservationCampaignQualification({
          reservationId: result.reservationId,
          source: "KIOSK",
        });
      } catch (campaignErr: unknown) {
        console.error(
          "[KioskPaymentConfirm] Campaign qualification hook error:",
          campaignErr
        );
      }

      // MS-39: Single-use voucher redemption hook
      try {
        const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
        const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        const voucherRepo = supabaseUrl && serviceRoleKey
          ? new VoucherSupabaseRepository({ supabaseUrl, serviceRoleKey })
          : undefined;
        await redeemReservationVoucher({
          reservationId: result.reservationId,
          voucherRepository: voucherRepo,
        });
      } catch (voucherRedemptionErr: unknown) {
        console.error(
          "[KioskPaymentConfirm] Voucher redemption hook error:",
          voucherRedemptionErr
        );
      }
    } else if (result.reservationStatus === "NEEDS_MANUAL_RESOLUTION") {
      // MS83: committed database event owns delivery, deduplication and retry.

    }

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof CounterPaymentError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (error instanceof CounterPaymentConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }

    const message =
      error instanceof Error ? error.message : "Unable to confirm kiosk counter payment";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
