import { NextRequest, NextResponse } from "next/server";
import { getAdminPaymentReviewService } from "../_lib/paymentReviewService";
import { paymentReviewErrorResponse } from "../_lib/errors";
import {
  evaluateAndSegregatePaymentReviews,
  createTransactionalEmailService,
  notifyCustomerOfOverdueReviewIdempotent,
  SupabaseSettingsRepository,
} from "@deskatlas/domain";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status")?.toUpperCase();

    if (status === "REJECTED") {
      const rejected = await getAdminPaymentReviewService().listRejectedPayments();
      return NextResponse.json({ queue: rejected, rejected });
    }

    if (status === "REFUNDED") {
      const refunded = await getAdminPaymentReviewService().listRefundedPayments();
      return NextResponse.json({ queue: refunded, refunded });
    }

    const rawQueue = await getAdminPaymentReviewService().listPaymentReviewQueue();
    const now = new Date();
    const { activeQueue, overdueQueue, refundedQueue } = evaluateAndSegregatePaymentReviews(rawQueue, now);

    // Auto-notify unnotified overdue reviews asynchronously
    if (overdueQueue.length > 0) {
      const unnotifiedOverdue = overdueQueue.filter((item) => !item.overdueNotifiedAt);
      if (unnotifiedOverdue.length > 0) {
        const emailService = createTransactionalEmailService({
          settingsRepository: new SupabaseSettingsRepository(),
        });
        const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
        const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        Promise.allSettled(
          unnotifiedOverdue.map(async (item) => {
            await notifyCustomerOfOverdueReviewIdempotent({
              item,
              emailService,
              now,
              onNotificationRecorded: async (paymentAttemptId, notifiedAt) => {
                if (supabaseUrl && serviceRoleKey) {
                  try {
                    await fetch(
                      `${supabaseUrl.replace(/\/$/, "")}/rest/v1/payment_attempts?id=eq.${encodeURIComponent(paymentAttemptId)}`,
                      {
                        method: "PATCH",
                        headers: {
                          apikey: serviceRoleKey,
                          Authorization: `Bearer ${serviceRoleKey}`,
                          "Content-Type": "application/json",
                          Prefer: "return=minimal",
                        },
                        body: JSON.stringify({
                          overdue_notified_at: notifiedAt,
                          refund_status: "REQUIRED",
                        }),
                      }
                    );
                  } catch (e) {
                    console.warn("[MS-67] Failed to persist overdue notification timestamp:", e);
                  }
                }
              },
            });
          })
        ).catch(() => {});
      }
    }

    if (status === "OVERDUE") {
      return NextResponse.json({
        queue: overdueQueue,
        overdue: overdueQueue,
        active: activeQueue,
        refunded: refundedQueue,
      });
    }

    return NextResponse.json({
      queue: activeQueue,
      active: activeQueue,
      overdue: overdueQueue,
      refunded: refundedQueue,
      all: rawQueue,
    });
  } catch (error) {
    return paymentReviewErrorResponse(error);
  }
}

