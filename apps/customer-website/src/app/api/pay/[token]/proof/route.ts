import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  buildReservationTrackingUrl,
  createPaymentSessionService,
  createTransactionalEmailService,
  PaymentSessionError,
  ReservationSupabaseRepository,
  validatePaymentProofFile,
} from "@deskatlas/domain";

export const runtime = "nodejs";

function sanitizeFilename(filename: string): string {
  return filename.replace(/[^A-Za-z0-9._-]/g, "_");
}

export async function POST(
  request: NextRequest,
  context: {
    params: Promise<{
      token: string;
    }>;
  }
) {
  let uploadedPath: string | null = null;

  try {
    const { token } = await context.params;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error("Supabase configuration is missing.");
    }

    const formData = await request.formData();
    const paymentMethodId = String(formData.get("paymentMethodId") ?? "").trim();
    const proofFile = formData.get("proof");

    if (!paymentMethodId) {
      return NextResponse.json({ error: "Payment method is required." }, { status: 400 });
    }

    if (!(proofFile instanceof File)) {
      return NextResponse.json({ error: "Payment proof file is required." }, { status: 400 });
    }

    if (proofFile.size === 0) {
      return NextResponse.json({ error: "Payment proof file is empty." }, { status: 400 });
    }

    const maxSizeBytes = 10 * 1024 * 1024; // 10MB
    if (proofFile.size > maxSizeBytes) {
      return NextResponse.json({ error: "File too large. Maximum allowed size is 10 MB." }, { status: 400 });
    }

    const validation = validatePaymentProofFile({
      name: proofFile.name,
      size: proofFile.size,
      type: proofFile.type,
    });

    if (!validation.valid) {
      const errorMsg =
        validation.error === "File size must not exceed 10 MB."
          ? "File too large. Maximum allowed size is 10 MB."
          : validation.error === "Only PNG, JPG, and WebP images are accepted."
            ? "Invalid file type. Only PNG, JPG, and WebP are accepted."
            : validation.error ?? "Invalid payment proof file.";
      return NextResponse.json({ error: errorMsg }, { status: 400 });
    }

    const repository = new ReservationSupabaseRepository({ supabaseUrl, serviceRoleKey: supabaseKey });
    const service = createPaymentSessionService(repository);
    const session = await service.getPaymentSession(token);

    if (
      session.reservationStatus === "EXPIRED" ||
      session.paymentStatus === "EXPIRED" ||
      (session.expiresAt && new Date().toISOString() >= session.expiresAt && !session.proofSubmittedAt)
    ) {
      return NextResponse.json(
        { error: "Reservation has expired. Payment proof cannot be submitted." },
        { status: 410 }
      );
    }

    if (
      session.reservationStatus === "CANCELLED" ||
      session.paymentStatus === "CANCELLED" ||
      session.paymentStatus === "REJECTED"
    ) {
      return NextResponse.json(
        { error: "Reservation has been cancelled. Payment proof cannot be submitted." },
        { status: 410 }
      );
    }

    if (
      session.reservationStatus === "CONFIRMED" ||
      session.reservationStatus === "COMPLETED" ||
      session.reservationStatus === "CHECKED_IN" ||
      session.paymentStatus === "APPROVED"
    ) {
      return NextResponse.json(
        { error: "Reservation has already been confirmed." },
        { status: 409 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const bucketName = process.env.PRIVATE_PAYMENT_PROOF_BUCKET ?? "payment-proofs";
    const fileExt = proofFile.name.includes(".") ? proofFile.name.split(".").pop() : "bin";
    const fileName = `${Date.now()}-${sanitizeFilename(session.reservationReferenceCode)}.${fileExt}`;
    uploadedPath = `${session.reservationId}/${fileName}`;

    const uploadResult = await supabase.storage
      .from(bucketName)
      .upload(uploadedPath, proofFile, {
        contentType: proofFile.type || "application/octet-stream",
        upsert: false,
      });

    if (uploadResult.error) {
      throw new Error(uploadResult.error.message);
    }

    const submission = await service.submitPaymentProof({
      token,
      paymentMethodId,
      proofStoragePath: uploadedPath,
    });

    try {
      const trackingBaseUrl =
        process.env.TRACKING_BASE_URL ??
        process.env.DESKATLAS_PUBLIC_APP_URL ??
        request.nextUrl.origin.replace(/\/$/, "");
      const trackingUrl = buildReservationTrackingUrl(trackingBaseUrl, session.reservationReferenceCode);
      const emailService = createTransactionalEmailService();

      if (session.customerEmail) {
        await emailService.sendPaymentProofReceivedEmail({
          to: session.customerEmail,
          customerFirstName: session.customerFirstName,
          customerLastName: session.customerLastName,
          referenceCode: session.reservationReferenceCode,
          trackingUrl,
        });
      }
    } catch (emailErr) {
      console.warn("[ProofSubmission] Failed to dispatch proof received email:", emailErr);
    }

    return NextResponse.json(submission, { status: 201 });
  } catch (error) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const bucketName = process.env.PRIVATE_PAYMENT_PROOF_BUCKET ?? "payment-proofs";

    if (uploadedPath && supabaseUrl && supabaseKey) {
      const cleanupClient = createClient(supabaseUrl, supabaseKey);
      await cleanupClient.storage.from(bucketName).remove([uploadedPath]);
    }

    if (error instanceof PaymentSessionError) {
      const isExpired = error.message.toLowerCase().includes("expired");
      const isInvalid = error.message.includes("Invalid payment token");
      const status = isInvalid ? 404 : isExpired ? 410 : 409;
      return NextResponse.json({ error: error.message }, { status });
    }

    const message = error instanceof Error ? error.message : "Unable to submit payment proof";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
