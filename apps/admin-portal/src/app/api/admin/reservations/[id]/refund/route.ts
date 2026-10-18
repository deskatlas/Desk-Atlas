import { NextRequest, NextResponse } from "next/server";
import {
  createTransactionalEmailService,
  SupabaseSettingsRepository,
} from "@deskatlas/domain";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: {
    params: Promise<{
      id: string;
    }>;
  }
) {
  try {
    const { id: reservationIdOrRef } = await context.params;
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

    // 1. Fetch reservation
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reservationIdOrRef);
    const resFilter = isUuid
      ? `id=eq.${encodeURIComponent(reservationIdOrRef)}`
      : `reference_code=eq.${encodeURIComponent(reservationIdOrRef)}`;

    const resQuery = await fetch(
      `${supabaseUrl.replace(/\/$/, "")}/rest/v1/reservations?${resFilter}&limit=1`,
      {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
      }
    );

    if (!resQuery.ok) {
      return NextResponse.json({ error: "Failed to locate reservation." }, { status: 404 });
    }
    const reservations = await resQuery.json();
    if (!Array.isArray(reservations) || reservations.length === 0) {
      return NextResponse.json({ error: "Reservation not found." }, { status: 404 });
    }
    const reservation = reservations[0];
    const targetReservationId = reservation.id;

    // 2. Fetch latest payment attempt for this reservation
    const attemptRes = await fetch(
      `${supabaseUrl.replace(/\/$/, "")}/rest/v1/payment_attempts?reservation_id=eq.${encodeURIComponent(targetReservationId)}&order=created_at.desc&limit=1`,
      {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
      }
    );

    let paymentAttemptId: string | null = null;
    let refundAmount = Number(reservation.amount_due || 0);

    if (attemptRes.ok) {
      const attempts = await attemptRes.json();
      if (Array.isArray(attempts) && attempts.length > 0) {
        paymentAttemptId = attempts[0].id;
        if (attempts[0].amount) {
          refundAmount = Number(attempts[0].amount);
        }
      }
    }

    // 3. Update payment attempt if exists
    if (paymentAttemptId) {
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
            refund_notes: refundNotes || "Administrative customer cancellation refund disbursed.",
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
    }

    // 4. Record audit log
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
        entity_type: "reservation",
        entity_id: targetReservationId,
        metadata: {
          refund_notes: refundNotes,
          payment_attempt_id: paymentAttemptId,
          amount_refunded: refundAmount,
        },
      }),
    }).catch(() => {});

    // 5. Dispatch customer refund confirmation email
    let emailDispatched = false;
    let emailError: string | undefined;

    if (reservation.customer_email) {
      try {
        const emailService = createTransactionalEmailService({
          settingsRepository: new SupabaseSettingsRepository(),
        });
        const emailSend = await emailService.sendPaymentRefundSuccessEmail({
          to: reservation.customer_email,
          customerFirstName: reservation.customer_first_name || "Valued Guest",
          customerLastName: reservation.customer_last_name || "",
          referenceCode: reservation.reference_code,
          amountRefunded: refundAmount,
          refundNotes: refundNotes || undefined,
        });
        emailDispatched = emailSend.success;
        emailError = emailSend.error;
      } catch (err: unknown) {
        emailError = err instanceof Error ? err.message : String(err);
        console.warn("[MS-68] Error sending customer refund confirmation email:", emailError);
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
    const message = error instanceof Error ? error.message : "Failed to process refund.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
