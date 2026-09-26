import { NextResponse } from "next/server";
import { getAdminReservationService } from "../reservations/_lib/reservationService";
import { getAdminPaymentReviewService } from "../payments/_lib/paymentReviewService";

export const runtime = "nodejs";

export async function GET() {
  try {
    const reservationService = getAdminReservationService();
    const paymentReviewService = getAdminPaymentReviewService();

    const [allReservationsResult, reviewQueue] = await Promise.all([
      reservationService.listReservations("all"),
      paymentReviewService.listPaymentReviewQueue().catch(() => []),
    ]);

    const all = allReservationsResult.reservations;

    // Awaiting proof count: PENDING_PAYMENT, PAYMENT_UNDER_REVIEW, PENDING_COUNTER_CONFIRMATION
    const reservationsCount = all.filter(
      (r) =>
        ["PENDING_PAYMENT", "PAYMENT_UNDER_REVIEW", "PENDING_COUNTER_CONFIRMATION"].includes(
          r.reservationStatus
        ) &&
        r.reservationStatus !== "EXPIRED" &&
        r.status.toLowerCase() !== "rejected"
    ).length;

    // Counter queue count: PENDING_COUNTER_CONFIRMATION
    const kioskCount = all.filter(
      (r) =>
        r.reservationStatus === "PENDING_COUNTER_CONFIRMATION" &&
        r.status.toLowerCase() !== "rejected"
    ).length;

    const paymentsCount = Array.isArray(reviewQueue) ? reviewQueue.length : 0;

    return NextResponse.json(
      {
        reservationsCount,
        paymentsCount,
        kioskCount,
        awaitingProof: reservationsCount,
        paymentReviews: paymentsCount,
        counterQueue: kioskCount,
      },
      {
        headers: {
          "Cache-Control": "private, s-maxage=10, stale-while-revalidate=20",
        },
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load badge counts";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
