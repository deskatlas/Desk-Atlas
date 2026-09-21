import { createHash, randomBytes } from "crypto";
import {
  PaymentProofSubmissionResult,
  PaymentSessionStatusView,
  PaymentSessionView,
  ReservationPaymentSession,
} from "../models/reservation";
import { ReservationPaymentRepository } from "./paymentSessionRepository";

export class PaymentSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentSessionError";
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function createPaymentToken(): string {
  return randomBytes(32).toString("base64url");
}

export class PaymentSessionService {
  constructor(
    private readonly paymentRepository: ReservationPaymentRepository,
    private readonly nowProvider: () => Date = () => new Date()
  ) {}

  async createReservationPaymentSession(
    paymentAttemptId: string,
    paymentLinkBaseUrl: string
  ): Promise<ReservationPaymentSession & { tokenHash: string }> {
    const expiryMinutes = await this.paymentRepository.getPaymentExpiryMinutes();
    const token = createPaymentToken();
    const tokenHash = hashToken(token);
    const expiresAt = new Date(this.nowProvider().getTime() + expiryMinutes * 60 * 1000).toISOString();
    const paymentUrl = `${paymentLinkBaseUrl.replace(/\/$/, "")}/${encodeURIComponent(token)}`;

    return {
      paymentAttemptId,
      token,
      tokenHash,
      expiresAt,
      paymentUrl,
      expiryMinutes,
    };
  }

  async getPaymentSession(token: string): Promise<PaymentSessionView> {
    const tokenHash = hashToken(token);
    const session = await this.paymentRepository.findPaymentSessionByTokenHash(tokenHash);

    if (!session) {
      throw new PaymentSessionError("Invalid payment token.");
    }

    const businessName = this.paymentRepository.getBusinessName
      ? await this.paymentRepository.getBusinessName()
      : session.businessName ?? "DeskAtlas";

    const nowIso = this.nowProvider().toISOString();
    if (
      session.paymentStatus === "PENDING" &&
      session.proofSubmittedAt === null &&
      nowIso >= session.expiresAt
    ) {
      await this.paymentRepository.expirePaymentSession(tokenHash, nowIso);
      const expiredSession = await this.paymentRepository.findPaymentSessionByTokenHash(tokenHash);
      if (!expiredSession) {
        throw new PaymentSessionError("Invalid payment token.");
      }
      return {
        ...expiredSession,
        businessName: businessName ?? expiredSession.businessName ?? "DeskAtlas",
        paymentMethods: await this.paymentRepository.listActiveWebPaymentMethods(),
      };
    }

    return {
      ...session,
      businessName: businessName ?? session.businessName ?? "DeskAtlas",
      paymentMethods: await this.paymentRepository.listActiveWebPaymentMethods(),
    };
  }

  async getPaymentSessionStatus(token: string): Promise<PaymentSessionStatusView> {
    const session = await this.getPaymentSession(token);
    const nowIso = this.nowProvider().toISOString();
    const isTimeExpired = !!session.expiresAt && nowIso >= session.expiresAt && !session.proofSubmittedAt;
    const isStatusExpired = session.paymentStatus === "EXPIRED" || session.reservationStatus === "EXPIRED";
    const isExpired = isStatusExpired || isTimeExpired;
    const isPreConfirmation =
      session.reservationStatus === "PENDING_PAYMENT" &&
      session.paymentStatus === "PENDING" &&
      session.proofSubmittedAt === null;
    const isValid = isPreConfirmation && !isExpired;

    return {
      reservationId: session.reservationId,
      reservationReferenceCode: session.reservationReferenceCode,
      reservationStatus: session.reservationStatus,
      paymentStatus: session.paymentStatus,
      isValid,
      isExpired,
      expiresAt: session.expiresAt,
    };
  }

  async submitPaymentProof(input: {
    token: string;
    paymentMethodId: string;
    proofStoragePath: string;
  }): Promise<PaymentProofSubmissionResult> {
    const tokenHash = hashToken(input.token);
    const session = await this.paymentRepository.findPaymentSessionByTokenHash(tokenHash);

    if (!session) {
      throw new PaymentSessionError("Invalid payment token.");
    }

    if (session.reservationStatus === "EXPIRED" || session.paymentStatus === "EXPIRED") {
      throw new PaymentSessionError("Reservation has expired. Payment proof cannot be submitted.");
    }

    if (
      session.reservationStatus === "CANCELLED" ||
      session.paymentStatus === "CANCELLED" ||
      session.paymentStatus === "REJECTED"
    ) {
      throw new PaymentSessionError("Reservation has been cancelled. Payment proof cannot be submitted.");
    }

    if (
      session.reservationStatus === "CONFIRMED" ||
      session.reservationStatus === "COMPLETED" ||
      session.reservationStatus === "CHECKED_IN" ||
      session.paymentStatus === "APPROVED"
    ) {
      throw new PaymentSessionError("Reservation has already been confirmed.");
    }

    if (session.proofSubmittedAt !== null || session.paymentStatus !== "PENDING") {
      throw new PaymentSessionError("Payment proof has already been submitted for this session.");
    }

    const proofSubmittedAt = this.nowProvider().toISOString();
    if (proofSubmittedAt >= session.expiresAt) {
      await this.paymentRepository.expirePaymentSession(tokenHash, proofSubmittedAt);
      throw new PaymentSessionError("Reservation has expired. Payment proof cannot be submitted.");
    }

    return this.paymentRepository.submitPaymentProof({
      tokenHash,
      paymentMethodId: input.paymentMethodId,
      proofStoragePath: input.proofStoragePath,
      proofSubmittedAt,
    });
  }
}

export function createPaymentSessionService(
  paymentRepository: ReservationPaymentRepository,
  nowProvider?: () => Date
): PaymentSessionService {
  return new PaymentSessionService(paymentRepository, nowProvider);
}
