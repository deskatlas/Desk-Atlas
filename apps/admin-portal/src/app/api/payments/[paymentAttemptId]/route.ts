import { NextRequest, NextResponse } from "next/server";
import {
  CounterPaymentError,
  createCounterPaymentService,
  ReservationSupabaseRepository,
} from "@deskatlas/domain";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  context: {
    params: Promise<{
      paymentAttemptId: string;
    }>;
  }
) {
  try {
    const { paymentAttemptId } = await context.params;
    const service = createCounterPaymentService(new ReservationSupabaseRepository());
    const record = await service.getCounterPaymentRecordByCode(paymentAttemptId);

    return NextResponse.json(record);
  } catch (error) {
    if (error instanceof CounterPaymentError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    const message =
      error instanceof Error ? error.message : "Unable to look up counter payment record.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
