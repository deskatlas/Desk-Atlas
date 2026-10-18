import { NextRequest, NextResponse } from "next/server";
import { paymentReviewErrorResponse } from "../../../_lib/errors";
import {
  createTransactionalEmailService,
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
    const body = await request.json().catch(() => ({}));

    let actorUserId = String(body.actorUserId ?? "").trim();
    const refundNotes = String(body.refundNotes ?? "").trim();

    const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        { error: "Database configuration missing." },
        { status: 500 }
      );
    }

    if (!actorUserId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actorUserId)) {
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
        // fallback continues
      }
    }

    const nowIso = new Date().toISOString();

    // 1. Fetch current attempt
    const attemptRes = await fetch(
      `${supabaseUrl.replace(/\/$/, "")}/rest/v1/payment_attempts?id=eq.${encodeURIComponent(paymentAttemptId)}&limit=1`,
      {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
      }
    );

    if (!attemptRes.ok) {
      return NextResponse.json({ error: "Failed to locate payment attempt." }, { status: 404 });
    }
    const attempts = await attemptRes.json();
    if (!Array.isArray(attempts) || attempts.length === 0) {
      return NextResponse.json({ error: "Payment attempt not found." }, { status: 404 });
    }
    const attempt = attempts[0];

    // 2. Update payment_attempts to REFUNDED
    const patchAttemptRes = await fetch(
      `${supabaseUrl.replace(/\/$/, "")}/rest/v1/payment_attempts?id=eq.${encodeURIComponent(paymentAttemptId)}`,
      {
        method: "PATCH",
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({
          refund_status: "REFUNDED",
          refunded_at: nowIso,
          refund_recorded_by_user_id: actorUserId || null,
          refund_notes: refundNotes || "Administrative overdue review refund disbursed.",
        }),
      }
    );

    if (!patchAttemptRes.ok) {
      const errBody = await patchAttemptRes.text();
      return NextResponse.json(
        { error: `Failed to update refund status: ${errBody}` },
        { status: patchAttemptRes.status }
      );
    }

    // 3. Update reservation status to CANCELLED if still in review or pending
    if (attempt.reservation_id) {
      await fetch(
        `${supabaseUrl.replace(/\/$/, "")}/rest/v1/reservations?id=eq.${encodeURIComponent(attempt.reservation_id)}&status=in.(PAYMENT_UNDER_REVIEW,PENDING,AWAITING_PAYMENT_PROOF)`,
        {
          method: "PATCH",
          headers: {
            apikey: serviceRoleKey,
            Authorization: `Bearer ${serviceRoleKey}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify({
            status: "CANCELLED",
            cancellation_reason: "OVERDUE_REVIEW_REFUND",
            cancelled_at: nowIso,
          }),
        }
      ).catch(() => {});
    }

    // 4. Log in audit_logs
    await fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/audit_logs`, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        actor_id: actorUserId || null,
        actor_role: "ADMIN",
        action: "PAYMENT_REFUNDED",
        entity_type: "payment_attempt",
        entity_id: paymentAttemptId,
        metadata: {
          refund_notes: refundNotes,
          reservation_id: attempt.reservation_id,
        },
      }),
    }).catch(() => {});

    // 5. Dispatch refund success confirmation email to customer
    let emailDispatched = false;
    let emailError: string | undefined;

    if (attempt.reservation_id) {
      try {
        const resQuery = await fetch(
          `${supabaseUrl.replace(/\/$/, "")}/rest/v1/reservations?id=eq.${encodeURIComponent(attempt.reservation_id)}&select=customer_email,customer_first_name,customer_last_name,reference_code,amount_due&limit=1`,
          {
            headers: {
              apikey: serviceRoleKey,
              Authorization: `Bearer ${serviceRoleKey}`,
            },
          }
        );
        if (resQuery.ok) {
          const resRows = await resQuery.json();
          if (Array.isArray(resRows) && resRows.length > 0) {
            const r = resRows[0];
            if (r.customer_email) {
              const emailService = createTransactionalEmailService({
                settingsRepository: new SupabaseSettingsRepository(),
              });
              const emailSend = await emailService.sendPaymentRefundSuccessEmail({
                to: r.customer_email,
                customerFirstName: r.customer_first_name || "Valued Guest",
                customerLastName: r.customer_last_name || "",
                referenceCode: r.reference_code || attempt.reservation_id.slice(0, 8),
                amountRefunded: Number(attempt.amount || r.amount_due || 0),
                refundNotes: refundNotes || undefined,
              });
              emailDispatched = emailSend.success;
              emailError = emailSend.error;
            }
          }
        }
      } catch (err: unknown) {
        emailError = err instanceof Error ? err.message : String(err);
        console.warn("[MS-67] Error sending refund success email:", emailError);
      }
    }

    return NextResponse.json({
      success: true,
      refundStatus: "REFUNDED",
      refundedAt: nowIso,
      refundNotes,
      emailDispatched,
      emailError,
    });
  } catch (error) {
    return paymentReviewErrorResponse(error);
  }
}
