import { NextRequest, NextResponse } from "next/server";
import { getAdminPaymentReviewService } from "../../../_lib/paymentReviewService";
import { paymentReviewErrorResponse } from "../../../_lib/errors";
import {
  buildReservationTrackingUrl,
  createBookingAccessService,
  createTransactionalEmailService,
  hashBookingToken,
  ReservationSupabaseRepository,
  SupabaseSettingsRepository,
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
    const paymentReviewService = getAdminPaymentReviewService();
    const reviewDetail =
      body.decision === "APPROVE"
        ? await paymentReviewService.getPaymentReviewDetail(paymentAttemptId)
        : null;
    let actorUserId = String(body.actorUserId ?? "").trim();
    if (!actorUserId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actorUserId)) {
      const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
      const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (supabaseUrl && serviceRoleKey) {
        try {
          const res = await fetch(
            `${supabaseUrl.replace(/\/$/, "")}/rest/v1/staff_profiles?select=user_id&role=eq.ADMIN&is_active=eq.true&limit=1`,
            {
              headers: {
                apikey: serviceRoleKey,
                Authorization: `Bearer ${serviceRoleKey}`,
              },
              cache: "no-store",
            }
          );
          if (res.ok) {
            const adminProfiles = await res.json();
            if (Array.isArray(adminProfiles) && adminProfiles[0]?.user_id) {
              actorUserId = adminProfiles[0].user_id;
            }
          }
        } catch {
          // fallback to actorUserId as-is
        }
      }
    }

    const result = await paymentReviewService.reviewPayment({
      paymentAttemptId,
      actor: {
        userId: actorUserId,
        role: body.actorRole ?? "ADMIN",
      },
      decision: body.decision,
      rejectionReason: body.rejectionReason,
    });

    if (result.reservationStatus === "CONFIRMED" && result.assignedCandidate && reviewDetail) {
      const reservationRepository = new ReservationSupabaseRepository();
      const bookingAccessService = createBookingAccessService(reservationRepository);
      const defaultCustomerOrigin = request.nextUrl.origin.replace(/:3000$/, ":3001").replace(/\/$/, "");
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
            to: reviewDetail.customerEmail,
            customerFirstName: reviewDetail.customerFirstName,
            customerLastName: reviewDetail.customerLastName,
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
          });
        }
      }
    } else if (result.reservationStatus === "NEEDS_MANUAL_RESOLUTION" && reviewDetail) {
      const defaultCustomerOrigin = request.nextUrl.origin.replace(/:3000$/, ":3001").replace(/\/$/, "");
      const trackingBaseUrl =
        process.env.TRACKING_BASE_URL ??
        process.env.DESKATLAS_PUBLIC_APP_URL ??
        defaultCustomerOrigin;
      const trackingUrl = buildReservationTrackingUrl(trackingBaseUrl, result.reservationReferenceCode);

      let businessEmail = process.env.BUSINESS_CONTACT_EMAIL || "support@deskatlas.com";
      let businessName = "DeskAtlas";
      let businessPhone: string | undefined;

      try {
        const settingsRepo = new SupabaseSettingsRepository();
        const settings = await settingsRepo.getBusinessSettings();
        if (settings.contactEmail) {
          businessEmail = settings.contactEmail;
        }
        if (settings.businessName) {
          businessName = settings.businessName;
        }
        if (settings.contactPhone) {
          businessPhone = settings.contactPhone;
        }
      } catch {
        // fallback to default/env values
      }

      const emailService = createTransactionalEmailService();
      await emailService.sendManualResolutionEmail({
        to: reviewDetail.customerEmail,
        customerFirstName: reviewDetail.customerFirstName,
        customerLastName: reviewDetail.customerLastName,
        referenceCode: result.reservationReferenceCode,
        businessName,
        businessEmail,
        businessPhone,
        trackingUrl,
      });
    }

    return NextResponse.json(result);
  } catch (error) {
    return paymentReviewErrorResponse(error);
  }
}
