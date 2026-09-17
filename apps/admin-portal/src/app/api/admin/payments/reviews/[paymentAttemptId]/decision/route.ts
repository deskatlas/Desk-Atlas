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
    const reviewDetail = await paymentReviewService
      .getPaymentReviewDetail(paymentAttemptId)
      .catch(() => null);
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

    let customerEmail = reviewDetail?.customerEmail;
    let customerFirstName = reviewDetail?.customerFirstName;
    let customerLastName = reviewDetail?.customerLastName;
    let referenceCode = result.reservationReferenceCode || reviewDetail?.reservationReferenceCode;

    if (!customerEmail || !customerFirstName || !referenceCode) {
      const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
      const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (supabaseUrl && serviceRoleKey && result.reservationId) {
        try {
          const res = await fetch(
            `${supabaseUrl.replace(/\/$/, "")}/rest/v1/reservations?id=eq.${encodeURIComponent(result.reservationId)}&select=customer_email,customer_first_name,customer_last_name,reference_code&limit=1`,
            {
              headers: {
                apikey: serviceRoleKey,
                Authorization: `Bearer ${serviceRoleKey}`,
              },
              cache: "no-store",
            }
          );
          if (res.ok) {
            const rows = await res.json();
            if (Array.isArray(rows) && rows[0]) {
              customerEmail = customerEmail || rows[0].customer_email;
              customerFirstName = customerFirstName || rows[0].customer_first_name;
              customerLastName = customerLastName || rows[0].customer_last_name;
              referenceCode = referenceCode || rows[0].reference_code;
            }
          }
        } catch {
          // fallback continues
        }
      }
    }

    let emailDispatched: boolean | undefined;
    let emailError: string | undefined;

    if (result.reservationStatus === "CONFIRMED" && result.assignedCandidate) {
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
      const trackingUrl = buildReservationTrackingUrl(trackingBaseUrl, referenceCode || result.reservationReferenceCode);
      const bookingAccess = await bookingAccessService.issueBookingAccess(
        result.reservationId,
        referenceCode || result.reservationReferenceCode,
        bookingAccessBaseUrl
      );

      if (bookingAccess && customerEmail && customerFirstName) {
        const bookingAccessRecord = await reservationRepository.findBookingAccessByTokenHash(
          hashBookingToken(bookingAccess.token)
        );

        if (bookingAccessRecord) {
          const emailService = createTransactionalEmailService();
          const emailResult = await emailService.sendBookingConfirmationEmail({
            to: customerEmail,
            customerFirstName,
            customerLastName: customerLastName || "",
            referenceCode: referenceCode || result.reservationReferenceCode,
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

          emailDispatched = emailResult.success;
          if (!emailResult.success) {
            emailError = emailResult.error;
            console.error(
              `[AdminPaymentApproval] Failed to dispatch booking confirmation email to ${customerEmail}:`,
              emailResult.error
            );
          }
        }
      }
    } else if (result.reservationStatus === "NEEDS_MANUAL_RESOLUTION") {
      const defaultCustomerOrigin = request.nextUrl.origin.replace(/:3000$/, ":3001").replace(/\/$/, "");
      const trackingBaseUrl =
        process.env.TRACKING_BASE_URL ??
        process.env.DESKATLAS_PUBLIC_APP_URL ??
        defaultCustomerOrigin;
      const trackingUrl = buildReservationTrackingUrl(trackingBaseUrl, referenceCode || result.reservationReferenceCode);

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

      if (customerEmail && customerFirstName) {
        const emailService = createTransactionalEmailService();
        const emailResult = await emailService.sendManualResolutionEmail({
          to: customerEmail,
          customerFirstName,
          customerLastName: customerLastName || "",
          referenceCode: referenceCode || result.reservationReferenceCode,
          businessName,
          businessEmail,
          businessPhone,
          trackingUrl,
        });

        emailDispatched = emailResult.success;
        if (!emailResult.success) {
          emailError = emailResult.error;
          console.error(
            `[AdminPaymentManualResolution] Failed to dispatch manual resolution email to ${customerEmail}:`,
            emailResult.error
          );
        }
      }
    } else if (body.decision === "REJECT" || result.paymentStatus === "REJECTED") {
      const defaultCustomerOrigin = request.nextUrl.origin.replace(/:3000$/, ":3001").replace(/\/$/, "");
      const trackingBaseUrl =
        process.env.TRACKING_BASE_URL ??
        process.env.DESKATLAS_PUBLIC_APP_URL ??
        defaultCustomerOrigin;
      const trackingUrl = buildReservationTrackingUrl(trackingBaseUrl, referenceCode || result.reservationReferenceCode);

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

      if (customerEmail && customerFirstName) {
        const emailService = createTransactionalEmailService();
        const emailResult = await emailService.sendPaymentProofRejectedEmail({
          to: customerEmail,
          customerFirstName,
          customerLastName: customerLastName || "",
          referenceCode: referenceCode || result.reservationReferenceCode,
          rejectionReason: String(body.rejectionReason ?? result.rejectionReason ?? "").trim() || undefined,
          businessName,
          businessEmail,
          businessPhone,
          trackingUrl,
        });

        emailDispatched = emailResult.success;
        if (!emailResult.success) {
          emailError = emailResult.error;
          console.error(
            `[AdminPaymentRejection] Failed to dispatch rejection email to ${customerEmail}:`,
            emailResult.error
          );
        }
      } else {
        console.warn(
          `[AdminPaymentRejection] Skipping rejection email: customer details missing (email: ${customerEmail}, name: ${customerFirstName})`
        );
      }
    }

    return NextResponse.json({
      ...result,
      ...(emailDispatched !== undefined ? { emailDispatched } : {}),
      ...(emailError ? { emailError } : {}),
    });
  } catch (error) {
    return paymentReviewErrorResponse(error);
  }
}
