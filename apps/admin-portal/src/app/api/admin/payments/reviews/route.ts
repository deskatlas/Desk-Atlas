import { NextRequest, NextResponse } from "next/server";
import { getAdminPaymentReviewService } from "../_lib/paymentReviewService";
import { paymentReviewErrorResponse } from "../_lib/errors";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status")?.toUpperCase();

    if (status === "REJECTED") {
      const rejected = await getAdminPaymentReviewService().listRejectedPayments();
      return NextResponse.json({ queue: rejected, rejected });
    }

    const queue = await getAdminPaymentReviewService().listPaymentReviewQueue();
    return NextResponse.json({ queue });
  } catch (error) {
    return paymentReviewErrorResponse(error);
  }
}
