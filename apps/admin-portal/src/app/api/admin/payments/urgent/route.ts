import { NextResponse } from "next/server";
import { evaluateUrgentPendingPayments } from "@deskatlas/domain";
import { getAdminPaymentReviewService } from "../_lib/paymentReviewService";
import { paymentReviewErrorResponse } from "../_lib/errors";

export const runtime = "nodejs";

export async function GET() {
  try {
    const queue = await getAdminPaymentReviewService().listPaymentReviewQueue();
    const urgentAlerts = evaluateUrgentPendingPayments(queue, new Date());
    return NextResponse.json({ urgentAlerts, total: urgentAlerts.length });
  } catch (error) {
    return paymentReviewErrorResponse(error);
  }
}
