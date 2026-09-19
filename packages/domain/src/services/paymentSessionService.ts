import { createHash, randomBytes } from "crypto";
import {
  PaymentProofSubmissionResult,
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

    if (session.proofSubmittedAt !== null || session.paymentStatus !== "PENDING") {
      throw new PaymentSessionError("Payment proof has already been submitted for this session.");
    }

    const proofSubmittedAt = this.nowProvider().toISOString();
    if (proofSubmittedAt >= session.expiresAt) {
      await this.paymentRepository.expirePaymentSession(tokenHash, proofSubmittedAt);
      throw new PaymentSessionError("Payment session has expired.");
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
