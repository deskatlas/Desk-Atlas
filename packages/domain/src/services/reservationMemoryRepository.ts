import {
  AdminReservationCandidateSummary,
  AdminReservationDetail,
  AdminReservationPaymentAttemptSummary,
  AdminReservationSummary,
  BookingAccessState,
  CounterPaymentRecord,
  CreateReservationRequest,
  OperationalActivityRecord,
  OccupancyRecord,
  PaymentMethod,
  PaymentProofSubmissionResult,
  PaymentReviewDecisionResult,
  PaymentReviewDetail,
  PaymentReviewQueueItem,
  ReservationOperationalActionResult,
  RefundStatus,
  PaymentSessionRecord,
  ReservationCandidate,
  ReservationResponseDTO,
  StaffOperationalReservation,
} from "../models/reservation";
import { AdminReservationRepository, RescheduleSlotAvailability } from "./adminReservationRepository";
import {
  formatAmountWithCurrency,
  formatDuration,
  formatInitials,
  formatSchedule,
  formatTimelineDate,
  getCandidateColor,
  getCandidateTier,
  mapStatusPresentation,
} from "./adminReservationService";
import { ReservationRepository } from "./reservationRepository";
import { BookingAccessRecord, BookingAccessRepository } from "./bookingAccessRepository";
import { CounterPaymentRepository } from "./counterPaymentRepository";
import {
  ReportPaymentAttemptRecord,
  ReportReservationRecord,
} from "../models/reports";
import {
  GuestReservationTrackingRecord,
  GuestReservationTrackingRepository,
} from "./guestReservationTrackingRepository";
import { BookingSurveyRepository, EndedReservationForSurvey } from "./bookingSurveyService";
import { zonedDateTimeToUtc } from "./availabilityService";
import { ReservationPaymentRepository, CreateWebPaymentSessionInput } from "./paymentSessionRepository";
import { PaymentReviewRepository } from "./paymentReviewRepository";
import { ReportsRepository } from "./reportsRepository";
import { StaffOperationsRepository } from "./staffOperationsRepository";
import { StaffOperationsConflictError } from "./staffOperationsService";
import { randomUUID } from "crypto";

interface StoredPaymentAttempt {
  id: string;
  reservationId: string;
  channel: "WEB" | "KIOSK";
  tokenHash: string | null;
  expiresAt: string | null;
  status: "PENDING" | "UNDER_REVIEW" | "APPROVED" | "REJECTED" | "EXPIRED";
  proofSubmittedAt: string | null;
  proofStoragePath: string | null;
  paymentMethodId: string | null;
  attemptNumber: number;
  createdAt: string;
  processedByUserId: string | null;
  processedAt: string | null;
  rejectionReason: string | null;
  refundStatus: RefundStatus;
}

export class ReservationMemoryRepository
  implements
  ReservationRepository,
  ReservationPaymentRepository,
  PaymentReviewRepository,
  BookingAccessRepository,
  CounterPaymentRepository,
  StaffOperationsRepository,
  GuestReservationTrackingRepository,
  ReportsRepository,
  AdminReservationRepository,
  BookingSurveyRepository {
  private reservations: ReservationResponseDTO[] = [];
  private paymentAttempts = new Map<string, StoredPaymentAttempt>();
  private bookingScanEvents: Array<{
    reservationId: string;
    scannedAt: string;
    accessState: BookingAccessState;
  }> = [];
  private operationalAuditEvents: OperationalActivityRecord[] = [];
  private surveyDispatchedReservationIds = new Set<string>();
  private operationQueue = Promise.resolve();
  private nextApprovalFailureMessage: string | null = null;
  private businessName: string = "DeskAtlas";
  constructor(private readonly nowProvider: () => Date = () => new Date()) { }

  getStoredReservation(id: string): ReservationResponseDTO | undefined {
    return this.reservations.find((r) => r.id === id);
  }

  getStoredPaymentAttempts(): StoredPaymentAttempt[] {
    return Array.from(this.paymentAttempts.values());
  }

  setBusinessName(name: string): void {
    this.businessName = name;
  }

  async getBusinessName(): Promise<string> {
    return this.businessName;
  }

  private paymentMethods: PaymentMethod[] = [
    {
      id: "pm-gcash",
      methodType: "GCASH",
      displayName: "GCash",
      accountName: "DeskAtlas Coworking",
      accountNumber: "09171234567",
      instructions: "Send the exact amount and upload the receipt screenshot.",
      qrImagePath: "payment-methods/gcash.png",
      allowWeb: true,
      allowKiosk: true,
      isActive: true,
      displayOrder: 1,
    },
    {
      id: "pm-bank",
      methodType: "BANK",
      displayName: "BDO Bank Transfer",
      accountName: "DeskAtlas Coworking",
      accountNumber: "1234567890",
      instructions: "Include your reservation reference in the transfer notes.",
      qrImagePath: "payment-methods/bank.png",
      allowWeb: true,
      allowKiosk: false,
      isActive: true,
      displayOrder: 2,
    },
    {
      id: "pm-cash",
      methodType: "CASH",
      displayName: "Cash",
      accountName: null,
      accountNumber: null,
      instructions: "Proceed to the counter and pay the exact amount in cash.",
      qrImagePath: null,
      allowWeb: false,
      allowKiosk: true,
      isActive: true,
      displayOrder: 3,
    },
  ];

  setPaymentMethods(methods: PaymentMethod[]): void {
    this.paymentMethods = [...methods];
  }

  async createReservation(
    request: CreateReservationRequest,
    rateSnapshot: number,
    amountDue: number,
    paymentSession?: CreateWebPaymentSessionInput
  ): Promise<ReservationResponseDTO> {
    const currentNow = this.nowProvider();
    const reservationId = randomUUID();
    const referenceCode = `DA-${currentNow.getFullYear()}-${randomUUID().split("-")[0].toUpperCase()}`;
    const now = currentNow.toISOString();

    const candidates: ReservationCandidate[] = request.candidates.map((c) => ({
      id: randomUUID(),
      reservationId,
      rank: c.rank,
      workspaceInstanceId: c.workspaceInstanceId,
      startAt: c.startAt,
      endAt: c.endAt,
      isAssigned: false,
    }));

    const reservation: ReservationResponseDTO = {
      id: reservationId,
      referenceCode,
      source: request.source,
      customerFirstName: request.customerFirstName,
      customerLastName: request.customerLastName,
      customerEmail: request.customerEmail,
      status: request.source === "WEB" ? "PENDING_PAYMENT" : "PENDING_COUNTER_CONFIRMATION",
      rateSnapshot,
      amountDue,
      currency: "PHP",
      createdAt: now,
      updatedAt: now,
      confirmedAt: null,
      bookingTokenHash: null,
      bookingToken: null,
      qrIssuedAt: null,
      qrRevokedAt: null,
      checkedInAt: null,
      checkedOutAt: null,
      candidates,
    };

    this.reservations.push(reservation);

    if (request.source === "WEB" && paymentSession) {
      this.paymentAttempts.set(paymentSession.tokenHash, {
        id: randomUUID(),
        reservationId,
        channel: "WEB",
        tokenHash: paymentSession.tokenHash,
        expiresAt: paymentSession.expiresAt,
        status: "PENDING",
        proofSubmittedAt: null,
        proofStoragePath: null,
        paymentMethodId: null,
        attemptNumber: 1,
        createdAt: now,
        processedByUserId: null,
        processedAt: null,
        rejectionReason: null,
        refundStatus: "NONE",
      });
    }

    if (request.source === "KIOSK") {
      let methodId: string | null = null;
      if (request.paymentMethodId) {
        const method = this.paymentMethods.find(
          (entry) =>
            (entry.id === request.paymentMethodId ||
              entry.methodType.toUpperCase() === String(request.paymentMethodId).toUpperCase()) &&
            entry.isActive &&
            entry.allowKiosk
        );
        if (!method) {
          throw new Error("Invalid kiosk payment method.");
        }
        methodId = method.id;
      } else {
        const activeMethod = this.paymentMethods.find((entry) => entry.isActive && entry.allowKiosk);
        methodId = activeMethod ? activeMethod.id : null;
      }

      const paymentAttemptId = randomUUID();
      this.paymentAttempts.set(`kiosk:${paymentAttemptId}`, {
        id: paymentAttemptId,
        reservationId,
        channel: "KIOSK",
        tokenHash: null,
        expiresAt: null,
        status: "PENDING",
        proofSubmittedAt: null,
        proofStoragePath: null,
        paymentMethodId: methodId,
        attemptNumber: 1,
        createdAt: now,
        processedByUserId: null,
        processedAt: null,
        rejectionReason: null,
        refundStatus: "NONE",
      });
      reservation.counterPaymentAttemptId = paymentAttemptId;
    }

    return reservation;
  }

  async getPaymentExpiryMinutes(): Promise<number> {
    return 60;
  }

  async listActiveWebPaymentMethods(): Promise<PaymentMethod[]> {
    return this.paymentMethods.filter((method) => method.isActive && method.allowWeb);
  }

  async listActiveKioskPaymentMethods(): Promise<PaymentMethod[]> {
    return this.paymentMethods.filter((method) => method.isActive && method.allowKiosk);
  }

  async findPaymentSessionByTokenHash(tokenHash: string): Promise<PaymentSessionRecord | null> {
    const attempt = this.paymentAttempts.get(tokenHash);
    if (!attempt || attempt.channel !== "WEB" || !attempt.expiresAt) {
      return null;
    }

    const reservation = this.reservations.find((entry) => entry.id === attempt.reservationId);
    if (!reservation) {
      return null;
    }

    return {
      paymentAttemptId: attempt.id,
      reservationId: reservation.id,
      reservationReferenceCode: reservation.referenceCode,
      reservationStatus: reservation.status,
      paymentStatus: attempt.status,
      customerEmail: reservation.customerEmail,
      customerFirstName: reservation.customerFirstName,
      customerLastName: reservation.customerLastName,
      amountDue: reservation.amountDue,
      currency: reservation.currency,
      expiresAt: attempt.expiresAt,
      proofSubmittedAt: attempt.proofSubmittedAt,
      paymentMethodId: attempt.paymentMethodId,
      businessName: this.businessName,
    };
  }

  async getCounterPaymentRecord(paymentAttemptId: string): Promise<CounterPaymentRecord | null> {
    const attempt = Array.from(this.paymentAttempts.values()).find((entry) => entry.id === paymentAttemptId);
    if (!attempt || attempt.channel !== "KIOSK" || !attempt.paymentMethodId) {
      return null;
    }

    const reservation = this.reservations.find((entry) => entry.id === attempt.reservationId);
    if (!reservation) {
      return null;
    }

    const method = this.paymentMethods.find((m) => m.id === attempt.paymentMethodId);

    return {
      paymentAttemptId: attempt.id,
      reservationId: reservation.id,
      reservationReferenceCode: reservation.referenceCode,
      reservationStatus: reservation.status,
      paymentStatus: attempt.status,
      customerEmail: reservation.customerEmail,
      customerFirstName: reservation.customerFirstName,
      customerLastName: reservation.customerLastName,
      amountDue: reservation.amountDue,
      currency: reservation.currency,
      paymentMethodId: attempt.paymentMethodId,
      paymentMethodType: method?.methodType ?? null,
      paymentMethodDisplayName: method?.displayName ?? null,
      submittedCandidates: structuredClone(reservation.candidates ?? []),
      processedAt: attempt.processedAt,
      processedByUserId: attempt.processedByUserId,
    };
  }

  async getCounterPaymentRecordByCode(code: string): Promise<CounterPaymentRecord | null> {
    const trimmed = code.trim().toUpperCase();
    const reservation = this.reservations.find(
      (entry) =>
        entry.source === "KIOSK" &&
        (entry.referenceCode.trim().toUpperCase() === trimmed || entry.id === code.trim())
    );

    let attempt: StoredPaymentAttempt | undefined;
    if (reservation) {
      attempt = Array.from(this.paymentAttempts.values()).find(
        (entry) => entry.reservationId === reservation.id && entry.channel === "KIOSK"
      );
    } else {
      attempt = Array.from(this.paymentAttempts.values()).find(
        (entry) => entry.id === code.trim() && entry.channel === "KIOSK"
      );
    }

    if (!attempt || attempt.channel !== "KIOSK" || !attempt.paymentMethodId) {
      return null;
    }

    const matchedReservation =
      reservation ?? this.reservations.find((entry) => entry.id === attempt!.reservationId);
    if (!matchedReservation) {
      return null;
    }

    const method = this.paymentMethods.find((m) => m.id === attempt.paymentMethodId);

    return {
      paymentAttemptId: attempt.id,
      reservationId: matchedReservation.id,
      reservationReferenceCode: matchedReservation.referenceCode,
      reservationStatus: matchedReservation.status,
      paymentStatus: attempt.status,
      customerEmail: matchedReservation.customerEmail,
      customerFirstName: matchedReservation.customerFirstName,
      customerLastName: matchedReservation.customerLastName,
      amountDue: matchedReservation.amountDue,
      currency: matchedReservation.currency,
      paymentMethodId: attempt.paymentMethodId,
      paymentMethodType: method?.methodType ?? null,
      paymentMethodDisplayName: method?.displayName ?? null,
      submittedCandidates: structuredClone(matchedReservation.candidates ?? []),
      processedAt: attempt.processedAt,
      processedByUserId: attempt.processedByUserId,
    };
  }

  async expirePaymentSession(tokenHash: string, expiredAt: string): Promise<boolean> {
    const attempt = this.paymentAttempts.get(tokenHash);
    if (
      !attempt ||
      attempt.channel !== "WEB" ||
      attempt.status !== "PENDING" ||
      attempt.proofSubmittedAt !== null ||
      !attempt.expiresAt
    ) {
      return false;
    }

    if (expiredAt < attempt.expiresAt) {
      return false;
    }

    attempt.status = "EXPIRED";
    const reservation = this.reservations.find((entry) => entry.id === attempt.reservationId);
    if (reservation && reservation.status === "PENDING_PAYMENT") {
      reservation.status = "EXPIRED";
      reservation.updatedAt = expiredAt;
    }

    return true;
  }

  async submitPaymentProof(input: {
    tokenHash: string;
    paymentMethodId: string;
    proofStoragePath: string;
    proofSubmittedAt: string;
  }): Promise<PaymentProofSubmissionResult> {
    const attempt = this.paymentAttempts.get(input.tokenHash);
    if (!attempt || attempt.channel !== "WEB") {
      throw new Error("Payment session not found.");
    }

    const method = this.paymentMethods.find(
      (entry) => entry.id === input.paymentMethodId && entry.allowWeb && entry.isActive
    );
    if (!method) {
      throw new Error("Invalid payment method.");
    }

    attempt.paymentMethodId = input.paymentMethodId;
    attempt.proofStoragePath = input.proofStoragePath;
    attempt.proofSubmittedAt = input.proofSubmittedAt;
    attempt.status = "UNDER_REVIEW";

    const reservation = this.reservations.find((entry) => entry.id === attempt.reservationId);
    if (!reservation) {
      throw new Error("Reservation not found.");
    }

    reservation.status = "PAYMENT_UNDER_REVIEW";
    reservation.updatedAt = input.proofSubmittedAt;

    return {
      paymentAttemptId: attempt.id,
      reservationId: reservation.id,
      reservationStatus: reservation.status,
      paymentStatus: attempt.status,
      proofSubmittedAt: input.proofSubmittedAt,
    };
  }

  async listPaymentReviewQueue(): Promise<PaymentReviewQueueItem[]> {
    return Array.from(this.paymentAttempts.values())
      .filter((attempt) => attempt.channel === "WEB" && attempt.status === "UNDER_REVIEW")
      .map((attempt) => this.buildPaymentReviewDetail(attempt))
      .filter((detail): detail is PaymentReviewDetail => detail !== null)
      .map(({ proofStoragePath: _proofStoragePath, rejectionReason: _rejectionReason, refundStatus: _refundStatus, processedAt: _processedAt, processedByUserId: _processedByUserId, ...queueItem }) => queueItem)
      .sort((a, b) => {
        const aTime = a.proofSubmittedAt ? new Date(a.proofSubmittedAt).getTime() : Number.POSITIVE_INFINITY;
        const bTime = b.proofSubmittedAt ? new Date(b.proofSubmittedAt).getTime() : Number.POSITIVE_INFINITY;
        if (aTime !== bTime) {
          return aTime - bTime;
        }
        return a.paymentAttemptId.localeCompare(b.paymentAttemptId);
      });
  }

  async getPaymentReviewDetail(paymentAttemptId: string): Promise<PaymentReviewDetail | null> {
    const attempt = Array.from(this.paymentAttempts.values()).find((entry) => entry.id === paymentAttemptId);
    return attempt ? this.buildPaymentReviewDetail(attempt) : null;
  }

  async approvePaymentAndAllocate(input: {
    paymentAttemptId: string;
    actorUserId: string;
    processedAt: string;
  }): Promise<PaymentReviewDecisionResult> {
    return this.withLock(async () => {
      const snapshot = this.snapshotState();

      try {
        const attempt = this.requirePaymentAttemptById(input.paymentAttemptId);

        if (attempt.status === "APPROVED") {
          return this.buildDecisionResult(attempt, input.actorUserId);
        }

        if (attempt.status !== "UNDER_REVIEW") {
          throw new Error("Payment attempt is not in an approvable review state.");
        }

        const reservation = this.requireReservation(attempt.reservationId);
        const candidates = [...(reservation.candidates ?? [])].sort((a, b) => a.rank - b.rank);
        let assignedCandidate: ReservationCandidate | null = null;

        for (const candidate of candidates) {
          if (!this.hasBlockingAssignment(candidate, reservation.id)) {
            candidate.isAssigned = true;
            assignedCandidate = candidate;
            break;
          }
        }

        attempt.status = "APPROVED";
        attempt.processedByUserId = input.actorUserId;
        attempt.processedAt = input.processedAt;
        attempt.rejectionReason = null;

        if (assignedCandidate) {
          reservation.status = "CONFIRMED";
          reservation.confirmedAt = reservation.confirmedAt ?? input.processedAt;
        } else {
          reservation.status = "NEEDS_MANUAL_RESOLUTION";
        }
        reservation.updatedAt = input.processedAt;

        if (this.nextApprovalFailureMessage) {
          const failureMessage = this.nextApprovalFailureMessage;
          this.nextApprovalFailureMessage = null;
          throw new Error(failureMessage);
        }

        return this.buildDecisionResult(attempt, input.actorUserId);
      } catch (error) {
        this.restoreState(snapshot);
        throw error;
      }
    });
  }

  async rejectPaymentAttempt(input: {
    paymentAttemptId: string;
    actorUserId: string;
    processedAt: string;
    rejectionReason: string;
  }): Promise<PaymentReviewDecisionResult> {
    return this.withLock(async () => {
      const attempt = this.requirePaymentAttemptById(input.paymentAttemptId);

      if (attempt.status === "REJECTED") {
        return this.buildDecisionResult(attempt, input.actorUserId);
      }

      if (attempt.status !== "UNDER_REVIEW") {
        throw new Error("Payment attempt is not in a rejectable review state.");
      }

      const reservation = this.requireReservation(attempt.reservationId);
      attempt.status = "REJECTED";
      attempt.processedByUserId = input.actorUserId;
      attempt.processedAt = input.processedAt;
      attempt.rejectionReason = input.rejectionReason;
      reservation.updatedAt = input.processedAt;

      return this.buildDecisionResult(attempt, input.actorUserId);
    });
  }

  async confirmCounterPaymentAndAllocate(input: {
    paymentAttemptId?: string;
    code?: string;
    actorUserId: string;
    processedAt: string;
  }): Promise<PaymentReviewDecisionResult> {
    return this.withLock(async () => {
      const snapshot = this.snapshotState();

      try {
        let attempt: StoredPaymentAttempt | undefined;
        if (input.paymentAttemptId) {
          attempt = this.requirePaymentAttemptById(input.paymentAttemptId);
        } else if (input.code) {
          const trimmed = input.code.trim().toUpperCase();
          const reservation = this.reservations.find(
            (entry) =>
              entry.source === "KIOSK" &&
              (entry.referenceCode.trim().toUpperCase() === trimmed || entry.id === input.code!.trim())
          );
          if (reservation) {
            attempt = Array.from(this.paymentAttempts.values()).find(
              (entry) => entry.reservationId === reservation.id && entry.channel === "KIOSK"
            );
          } else {
            attempt = Array.from(this.paymentAttempts.values()).find(
              (entry) => entry.id === input.code!.trim() && entry.channel === "KIOSK"
            );
          }
        }

        if (!attempt || attempt.channel !== "KIOSK") {
          throw new Error("Counter payment attempt was not found.");
        }

        if (attempt.status === "APPROVED") {
          return this.buildDecisionResult(attempt, input.actorUserId);
        }

        if (attempt.status !== "PENDING") {
          throw new Error("Counter payment attempt is not in a confirmable state.");
        }

        const reservation = this.requireReservation(attempt.reservationId);
        if (reservation.status !== "PENDING_COUNTER_CONFIRMATION") {
          throw new Error("Counter payment attempt is not in a confirmable state.");
        }

        const candidates = [...(reservation.candidates ?? [])].sort((a, b) => a.rank - b.rank);
        let assignedCandidate: ReservationCandidate | null = null;

        for (const candidate of candidates) {
          if (!this.hasBlockingAssignment(candidate, reservation.id)) {
            candidate.isAssigned = true;
            assignedCandidate = candidate;
            break;
          }
        }

        attempt.status = "APPROVED";
        attempt.processedByUserId = input.actorUserId;
        attempt.processedAt = input.processedAt;
        attempt.rejectionReason = null;

        if (assignedCandidate) {
          reservation.status = "CHECKED_IN";
          reservation.confirmedAt = reservation.confirmedAt ?? input.processedAt;
          reservation.checkedInAt = reservation.checkedInAt ?? input.processedAt;

          this.recordOperationalAudit({
            reservation,
            action: "CHECK_IN",
            actedAt: input.processedAt,
            actorRole: "STAFF",
            actorUserId: input.actorUserId,
            reentry: false,
          });
        } else {
          reservation.status = "NEEDS_MANUAL_RESOLUTION";
        }

        reservation.updatedAt = input.processedAt;
        return this.buildDecisionResult(attempt, input.actorUserId);
      } catch (error) {
        this.restoreState(snapshot);
        throw error;
      }
    });
  }

  // Helper method for tests
  getReservations(): ReservationResponseDTO[] {
    return this.reservations;
  }

  setNextApprovalFailure(message: string) {
    this.nextApprovalFailureMessage = message;
  }

  getBookingScanEvents() {
    return structuredClone(this.bookingScanEvents);
  }

  getOperationalAuditEvents() {
    return structuredClone(this.operationalAuditEvents);
  }

  async issueBookingAccessToken(input: {
    reservationId: string;
    tokenHash: string;
    token?: string;
    issuedAt: string;
  }): Promise<boolean> {
    const reservation = this.requireReservation(input.reservationId);
    const assignedCandidate = (reservation.candidates ?? []).find((candidate) => candidate.isAssigned);

    if (!assignedCandidate || (reservation.status !== "CONFIRMED" && reservation.status !== "CHECKED_IN")) {
      throw new Error("Booking access can only be issued for confirmed reservations.");
    }

    if (reservation.bookingTokenHash) {
      return false;
    }

    reservation.bookingTokenHash = input.tokenHash;
    reservation.bookingToken = input.token ?? null;
    reservation.qrIssuedAt = input.issuedAt;
    reservation.updatedAt = input.issuedAt;
    return true;
  }

  async findBookingAccessByTokenHash(tokenHash: string): Promise<BookingAccessRecord | null> {
    const reservation = this.reservations.find((entry) => entry.bookingTokenHash === tokenHash);
    if (!reservation) {
      return null;
    }

    const assignedCandidate = (reservation.candidates ?? []).find((candidate) => candidate.isAssigned);
    if (!assignedCandidate || !reservation.qrIssuedAt || !reservation.bookingTokenHash) {
      return null;
    }

    return {
      reservationId: reservation.id,
      referenceCode: reservation.referenceCode,
      reservationStatus: reservation.status,
      customerFirstName: reservation.customerFirstName,
      customerLastName: reservation.customerLastName,
      customerEmail: reservation.customerEmail,
      bookingTokenHash: reservation.bookingTokenHash,
      bookingToken: reservation.bookingToken ?? null,
      qrIssuedAt: reservation.qrIssuedAt,
      qrRevokedAt: reservation.qrRevokedAt ?? null,
      checkedInAt: reservation.checkedInAt ?? null,
      checkedOutAt: reservation.checkedOutAt ?? null,
      assignedWorkspaceInstanceId: assignedCandidate.workspaceInstanceId,
      assignedWorkspaceDisplayName: assignedCandidate.workspaceInstanceId,
      assignedWorkspaceInstanceCode: assignedCandidate.workspaceInstanceId,
      assignedWorkspaceTemplateName: "Workspace",
      assignedFloorName: "Unknown Floor",
      assignedStartAt: assignedCandidate.startAt,
      assignedEndAt: assignedCandidate.endAt,
    };
  }

  async recordBookingScan(input: {
    reservationId: string;
    scannedAt: string;
    accessState: BookingAccessState;
    actorUserId?: string | null;
    actorRole?: "ADMIN" | "STAFF" | "SYSTEM" | null;
    reentry?: boolean;
    checkIn?: boolean;
  }): Promise<void> {
    this.bookingScanEvents.push({
      reservationId: input.reservationId,
      scannedAt: input.scannedAt,
      accessState: input.accessState,
    });

    const reservation = this.reservations.find((r) => r.id === input.reservationId);
    if (reservation) {
      if (input.checkIn) {
        reservation.status = "CHECKED_IN";
        reservation.checkedInAt = reservation.checkedInAt ?? input.scannedAt;
        reservation.updatedAt = input.scannedAt;
        this.recordOperationalAudit({
          reservation,
          action: "CHECK_IN",
          actedAt: input.scannedAt,
          actorRole: (input.actorRole === "ADMIN" || input.actorRole === "STAFF") ? input.actorRole : "STAFF",
          actorUserId: input.actorUserId ?? "scanner",
          reentry: false,
        });
      } else if (input.reentry) {
        this.recordOperationalAudit({
          reservation,
          action: "CHECK_IN",
          actedAt: input.scannedAt,
          actorRole: (input.actorRole === "ADMIN" || input.actorRole === "STAFF") ? input.actorRole : "STAFF",
          actorUserId: input.actorUserId ?? "staff-scanner",
          reentry: true,
        });
      }
    }
  }

  async listOperationalReservations(_nowIso: string): Promise<StaffOperationalReservation[]> {
    return this.reservations
      .filter((reservation) => ["CONFIRMED", "CHECKED_IN", "COMPLETED", "PENDING_COUNTER_CONFIRMATION"].includes(reservation.status))
      .map((reservation) => this.buildOperationalReservation(reservation))
      .sort(compareOperationalReservations);
  }

  async getOperationalReservation(
    idOrReferenceCode: string
  ): Promise<StaffOperationalReservation | null> {
    const reservation = this.reservations.find(
      (r) => r.id === idOrReferenceCode || r.referenceCode === idOrReferenceCode
    );

    if (!reservation || !["CONFIRMED", "CHECKED_IN", "COMPLETED", "PENDING_COUNTER_CONFIRMATION"].includes(reservation.status)) {
      return null;
    }

    return this.buildOperationalReservation(reservation);
  }

  async listOccupancy(nowIso: string): Promise<OccupancyRecord[]> {
    return this.reservations
      .filter((reservation) => reservation.status === "CONFIRMED" || reservation.status === "CHECKED_IN")
      .map((reservation) => this.buildOperationalReservation(reservation))
      .filter(
        (reservation) =>
          reservation.bookingStartAt !== null &&
          reservation.bookingEndAt !== null &&
          (reservation.reservationStatus === "CHECKED_IN" ||
            (reservation.bookingStartAt <= nowIso && nowIso <= reservation.bookingEndAt)) &&
          nowIso <= reservation.bookingEndAt
      )
      .map(
        (reservation) =>
          ({
            ...reservation,
            occupancyState:
              reservation.reservationStatus === "CHECKED_IN" ? "OCCUPIED" : "RESERVED",
          }) satisfies OccupancyRecord
      )
      .sort(compareOperationalReservations);
  }

  async listOperationalActivity(limit: number): Promise<OperationalActivityRecord[]> {
    return [...this.operationalAuditEvents]
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
      .slice(0, limit)
      .map((event) => ({ ...event }));
  }

  addOperationalActivity(event: OperationalActivityRecord): void {
    this.operationalAuditEvents.unshift(event);
  }

  async listReportReservations(): Promise<ReportReservationRecord[]> {
    return this.reservations
      .map((reservation) => {
        const assignedCandidate =
          (reservation.candidates ?? []).find((candidate) => candidate.isAssigned) ??
          [...(reservation.candidates ?? [])].sort((left, right) => left.rank - right.rank)[0] ??
          null;

        return {
          reservationId: reservation.id,
          referenceCode: reservation.referenceCode,
          source: reservation.source,
          customerFirstName: reservation.customerFirstName,
          customerLastName: reservation.customerLastName,
          customerEmail: reservation.customerEmail,
          reservationStatus: reservation.status,
          amountDue: reservation.amountDue,
          currency: reservation.currency,
          createdAt: reservation.createdAt,
          confirmedAt: reservation.confirmedAt ?? null,
          checkedInAt: reservation.checkedInAt ?? null,
          checkedOutAt: reservation.checkedOutAt ?? null,
          bookingStartAt: assignedCandidate?.startAt ?? null,
          bookingEndAt: assignedCandidate?.endAt ?? null,
          assignedCandidateRank: assignedCandidate?.isAssigned ? assignedCandidate.rank : null,
          workspaceDisplayName: assignedCandidate?.workspaceInstanceId ?? null,
          workspaceInstanceCode: assignedCandidate?.workspaceInstanceId ?? null,
          workspaceTemplateName: assignedCandidate ? "Workspace" : null,
          floorName: assignedCandidate ? "Unknown Floor" : null,
        } satisfies ReportReservationRecord;
      })
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async listReportPaymentAttempts(): Promise<ReportPaymentAttemptRecord[]> {
    return Array.from(this.paymentAttempts.values())
      .map((attempt) => {
        const reservation = this.requireReservation(attempt.reservationId);
        const paymentMethod =
          this.paymentMethods.find((method) => method.id === attempt.paymentMethodId) ?? null;

        return {
          paymentAttemptId: attempt.id,
          reservationId: reservation.id,
          reservationReferenceCode: reservation.referenceCode,
          channel: attempt.channel,
          paymentStatus: attempt.status,
          refundStatus: attempt.refundStatus,
          amount: reservation.amountDue,
          currency: reservation.currency,
          paymentMethodId: attempt.paymentMethodId,
          paymentMethodType: paymentMethod?.methodType ?? null,
          paymentMethodDisplayName: paymentMethod?.displayName ?? null,
          createdAt: attempt.createdAt,
          proofSubmittedAt: attempt.proofSubmittedAt,
          processedAt: attempt.processedAt,
        } satisfies ReportPaymentAttemptRecord;
      })
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async findGuestReservationTrackingRecord(input: {
    referenceCode: string;
    customerEmail?: string;
  }): Promise<GuestReservationTrackingRecord | null> {
    const targetRef = input.referenceCode.trim().toUpperCase();
    const targetEmail = input.customerEmail?.trim().toLowerCase();
    const reservation = this.reservations.find(
      (entry) =>
        entry.referenceCode.toUpperCase() === targetRef &&
        (!targetEmail || entry.customerEmail.trim().toLowerCase() === targetEmail)
    );

    if (!reservation) {
      return null;
    }

    const assignedCandidate = (reservation.candidates ?? []).find((candidate) => candidate.isAssigned);

    return {
      reservationId: reservation.id,
      referenceCode: reservation.referenceCode,
      customerEmail: reservation.customerEmail,
      reservationStatus: reservation.status,
      amountDue: reservation.amountDue,
      currency: reservation.currency,
      confirmedAt: reservation.confirmedAt ?? null,
      checkedOutAt: reservation.checkedOutAt ?? null,
      finalAssignment: assignedCandidate
        ? {
          workspaceInstanceId: assignedCandidate.workspaceInstanceId,
          workspaceDisplayName: assignedCandidate.workspaceInstanceId,
          workspaceInstanceCode: assignedCandidate.workspaceInstanceId,
          workspaceTemplateName: "Workspace",
          floorName: "Unknown Floor",
          bookingStartAt: assignedCandidate.startAt,
          bookingEndAt: assignedCandidate.endAt,
        }
        : null,
    };
  }

  async checkInReservation(input: {
    reservationId: string;
    actorUserId: string;
    actorRole: "ADMIN" | "STAFF";
    actedAt: string;
  }): Promise<ReservationOperationalActionResult> {
    return this.withLock(async () => {
      const reservation = this.requireReservation(input.reservationId);
      const summary = this.buildOperationalReservation(reservation);

      if (!summary.bookingStartAt || !summary.bookingEndAt) {
        throw new Error("Reservation has no assigned workspace to check in.");
      }

      if (reservation.status === "CHECKED_IN") {
        this.recordOperationalAudit({
          reservation,
          action: "CHECK_IN",
          actedAt: input.actedAt,
          actorRole: input.actorRole,
          actorUserId: input.actorUserId,
          reentry: true,
        });

        return {
          ...this.buildOperationalReservation(reservation),
          action: "CHECK_IN",
          actedAt: input.actedAt,
          actorUserId: input.actorUserId,
          actorRole: input.actorRole,
          reentry: true,
        };
      }

      if (reservation.status !== "CONFIRMED") {
        throw new Error("Reservation is not in a check-in state.");
      }

      if (input.actedAt < summary.bookingStartAt || input.actedAt > summary.bookingEndAt) {
        throw new Error("Reservation is not currently active for check-in.");
      }

      reservation.status = "CHECKED_IN";
      reservation.checkedInAt = reservation.checkedInAt ?? input.actedAt;
      reservation.updatedAt = input.actedAt;

      this.recordOperationalAudit({
        reservation,
        action: "CHECK_IN",
        actedAt: input.actedAt,
        actorRole: input.actorRole,
        actorUserId: input.actorUserId,
        reentry: false,
      });

      return {
        ...this.buildOperationalReservation(reservation),
        action: "CHECK_IN",
        actedAt: input.actedAt,
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
        reentry: false,
      };
    });
  }

  async checkOutReservation(input: {
    reservationId: string;
    actorUserId: string;
    actorRole: "ADMIN" | "STAFF";
    actedAt: string;
  }): Promise<ReservationOperationalActionResult> {
    return this.withLock(async () => {
      const reservation = this.requireReservation(input.reservationId);

      if (reservation.status === "COMPLETED") {
        return {
          ...this.buildOperationalReservation(reservation),
          action: "CHECK_OUT",
          actedAt: input.actedAt,
          actorUserId: input.actorUserId,
          actorRole: input.actorRole,
          reentry: false,
        };
      }

      if (reservation.status !== "CHECKED_IN") {
        throw new StaffOperationsConflictError("Reservation is not currently checked in.");
      }

      reservation.status = "COMPLETED";
      reservation.checkedOutAt = reservation.checkedOutAt ?? input.actedAt;
      reservation.updatedAt = input.actedAt;

      // On early checkout, release the physical workspace by shortening the assigned candidate's endAt
      const assigned = (reservation.candidates ?? []).find((c) => c.isAssigned);
      if (assigned) {
        const actedTime = new Date(input.actedAt).getTime();
        const endTime = new Date(assigned.endAt).getTime();
        const startTime = new Date(assigned.startAt).getTime();
        if (actedTime < endTime && actedTime > startTime) {
          assigned.endAt = input.actedAt;
        }
      }

      this.recordOperationalAudit({
        reservation,
        action: "CHECK_OUT",
        actedAt: input.actedAt,
        actorRole: input.actorRole,
        actorUserId: input.actorUserId,
        reentry: false,
      });

      return {
        ...this.buildOperationalReservation(reservation),
        action: "CHECK_OUT",
        actedAt: input.actedAt,
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
        reentry: false,
      };
    });
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.operationQueue;
    let release!: () => void;
    this.operationQueue = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;

    try {
      return await operation();
    } finally {
      release();
    }
  }

  private snapshotState() {
    return {
      reservations: structuredClone(this.reservations),
      paymentAttempts: structuredClone(Array.from(this.paymentAttempts.entries())),
      nextApprovalFailureMessage: this.nextApprovalFailureMessage,
    };
  }

  private restoreState(snapshot: {
    reservations: ReservationResponseDTO[];
    paymentAttempts: Array<[string, StoredPaymentAttempt]>;
    nextApprovalFailureMessage: string | null;
  }) {
    this.reservations = snapshot.reservations;
    this.paymentAttempts = new Map(snapshot.paymentAttempts);
    this.nextApprovalFailureMessage = snapshot.nextApprovalFailureMessage;
  }

  private requirePaymentAttemptById(paymentAttemptId: string): StoredPaymentAttempt {
    const attempt = Array.from(this.paymentAttempts.values()).find((entry) => entry.id === paymentAttemptId);
    if (!attempt) {
      throw new Error("Payment attempt was not found.");
    }
    return attempt;
  }

  private requireReservation(reservationId: string): ReservationResponseDTO {
    const reservation = this.reservations.find((entry) => entry.id === reservationId);
    if (!reservation) {
      throw new Error("Reservation was not found.");
    }
    return reservation;
  }

  private hasBlockingAssignment(candidate: ReservationCandidate, reservationId: string) {
    return this.reservations.some((reservation) => {
      if (reservation.id === reservationId) {
        return false;
      }

      if (reservation.status !== "CONFIRMED" && reservation.status !== "CHECKED_IN") {
        return false;
      }

      return (reservation.candidates ?? []).some((existingCandidate) => {
        if (!existingCandidate.isAssigned) {
          return false;
        }

        if (existingCandidate.workspaceInstanceId !== candidate.workspaceInstanceId) {
          return false;
        }

        return existingCandidate.startAt < candidate.endAt && candidate.startAt < existingCandidate.endAt;
      });
    });
  }

  private buildPaymentReviewDetail(attempt: StoredPaymentAttempt): PaymentReviewDetail | null {
    if (attempt.channel !== "WEB") {
      return null;
    }

    const reservation = this.reservations.find((entry) => entry.id === attempt.reservationId);
    if (!reservation) {
      return null;
    }

    return {
      paymentAttemptId: attempt.id,
      reservationId: reservation.id,
      reservationReferenceCode: reservation.referenceCode,
      reservationStatus: reservation.status,
      paymentStatus: attempt.status,
      customerFirstName: reservation.customerFirstName,
      customerLastName: reservation.customerLastName,
      customerEmail: reservation.customerEmail,
      amountDue: reservation.amountDue,
      currency: reservation.currency,
      paymentMethodId: attempt.paymentMethodId,
      proofSubmittedAt: attempt.proofSubmittedAt,
      submittedCandidates: structuredClone(reservation.candidates ?? []),
      proofStoragePath: attempt.proofStoragePath,
      rejectionReason: attempt.rejectionReason,
      refundStatus: attempt.refundStatus,
      processedAt: attempt.processedAt,
      processedByUserId: attempt.processedByUserId,
    };
  }

  private buildDecisionResult(
    attempt: StoredPaymentAttempt,
    actorUserId: string
  ): PaymentReviewDecisionResult {
    const reservation = this.requireReservation(attempt.reservationId);
    const assignedCandidate = structuredClone(
      (reservation.candidates ?? []).find((candidate) => candidate.isAssigned) ?? null
    );

    return {
      paymentAttemptId: attempt.id,
      reservationId: reservation.id,
      reservationReferenceCode: reservation.referenceCode,
      reservationStatus: reservation.status,
      paymentStatus: attempt.status,
      refundStatus: attempt.refundStatus,
      assignedCandidate,
      assignedCandidateRank: assignedCandidate?.rank ?? null,
      rejectionReason: attempt.rejectionReason,
      processedAt: attempt.processedAt ?? new Date().toISOString(),
      processedByUserId: attempt.processedByUserId ?? actorUserId,
    };
  }

  private buildOperationalReservation(
    reservation: ReservationResponseDTO
  ): StaffOperationalReservation {
    const candidate =
      (reservation.candidates ?? []).find((entry) => entry.isAssigned) ??
      [...(reservation.candidates ?? [])].sort((a, b) => a.rank - b.rank)[0] ??
      null;

    const attempt = Array.from(this.paymentAttempts.values()).find((a) => a.reservationId === reservation.id);
    const method = attempt?.paymentMethodId ? this.paymentMethods.find((m) => m.id === attempt.paymentMethodId) : null;

    return {
      reservationId: reservation.id,
      referenceCode: reservation.referenceCode,
      source: reservation.source,
      customerFirstName: reservation.customerFirstName,
      customerLastName: reservation.customerLastName,
      customerEmail: reservation.customerEmail,
      reservationStatus: reservation.status,
      checkInState: getCheckInState(reservation.checkedInAt ?? null, reservation.checkedOutAt ?? null),
      workspaceInstanceId: candidate?.workspaceInstanceId ?? null,
      workspaceDisplayName: candidate?.workspaceInstanceId ?? null,
      workspaceInstanceCode: candidate?.workspaceInstanceId ?? null,
      workspaceTemplateName: candidate ? "Workspace" : null,
      floorName: candidate ? "Unknown Floor" : null,
      bookingStartAt: candidate?.startAt ?? null,
      bookingEndAt: candidate?.endAt ?? null,
      confirmedAt: reservation.confirmedAt ?? null,
      checkedInAt: reservation.checkedInAt ?? null,
      checkedOutAt: reservation.checkedOutAt ?? null,
      qrIssuedAt: reservation.qrIssuedAt ?? null,
      paymentMethodId: attempt?.paymentMethodId ?? null,
      paymentMethodType: method?.methodType ?? null,
      paymentMethodDisplayName: method?.displayName ?? null,
    };
  }

  private recordOperationalAudit(input: {
    reservation: ReservationResponseDTO;
    action: "CHECK_IN" | "CHECK_OUT";
    actedAt: string;
    actorRole: "ADMIN" | "STAFF";
    actorUserId: string;
    reentry: boolean;
    actorName?: string | null;
  }) {
    const summary = this.buildOperationalReservation(input.reservation);
    this.operationalAuditEvents.unshift({
      reservationId: input.reservation.id,
      referenceCode: input.reservation.referenceCode,
      customerName: `${input.reservation.customerFirstName} ${input.reservation.customerLastName}`.trim(),
      workspaceDisplayName: summary.workspaceDisplayName,
      workspaceInstanceCode: summary.workspaceInstanceCode,
      activityType:
        input.action === "CHECK_OUT"
          ? "CHECK_OUT"
          : input.reentry
            ? "REENTRY"
            : "CHECK_IN",
      occurredAt: input.actedAt,
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      actorName: input.actorName ?? input.actorUserId,
    });
  }

  async listAdminReservations(): Promise<AdminReservationSummary[]> {
    const list = [...this.reservations].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return list.map((r) => {
      const candidates = r.candidates ?? [];
      const assignedCandidate = candidates.find((c) => c.isAssigned) ?? null;
      const mainCandidate = candidates.find((c) => c.rank === 0) ?? candidates[0] ?? null;
      const targetCandidate = assignedCandidate ?? mainCandidate;

      const pres = mapStatusPresentation(r.status);
      const customerName = `${r.customerFirstName} ${r.customerLastName}`.trim();
      const customerInitials = formatInitials(r.customerFirstName, r.customerLastName);
      const schedule = formatSchedule(targetCandidate?.startAt, targetCandidate?.endAt);

      const workspaceDisplayName = assignedCandidate
        ? assignedCandidate.workspaceInstanceId
        : candidates.length > 1
          ? "Multiple Candidates"
          : mainCandidate?.workspaceInstanceId ?? "Unassigned";

      const attempts = Array.from(this.paymentAttempts.values())
        .filter((a) => a.reservationId === r.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const latestAttempt = attempts[0] ?? null;
      const paymentExpiresAt = latestAttempt?.expiresAt ?? null;

      const method = latestAttempt?.paymentMethodId
        ? this.paymentMethods.find((m) => m.id === latestAttempt.paymentMethodId)
        : null;

      return {
        id: r.id,
        referenceCode: r.referenceCode,
        source: r.source,
        customerFirstName: r.customerFirstName,
        customerLastName: r.customerLastName,
        customerName,
        customerInitials,
        customerEmail: r.customerEmail,
        workspaceDisplayName,
        workspaceInstanceCode: targetCandidate?.workspaceInstanceId ?? null,
        workspaceTemplateName: null,
        floorName: null,
        schedule,
        startAt: targetCandidate?.startAt ?? null,
        endAt: targetCandidate?.endAt ?? null,
        paymentStatus: pres.payment,
        paymentColor: pres.paymentColor,
        reservationStatus: r.status,
        status: pres.label,
        statusStyle: pres.style,
        mark: pres.mark,
        amountDue: r.amountDue,
        currency: r.currency,
        createdAt: r.createdAt,
        confirmedAt: r.confirmedAt,
        checkedInAt: r.checkedInAt,
        checkedOutAt: r.checkedOutAt,
        paymentExpiresAt,
        paymentMethodId: latestAttempt?.paymentMethodId ?? null,
        paymentMethodType: method?.methodType ?? null,
        paymentMethodDisplayName: method?.displayName ?? null,
      };
    });
  }

  async getAdminReservationDetail(idOrReferenceCode: string): Promise<AdminReservationDetail | null> {
    const r = this.reservations.find(
      (entry) =>
        entry.id === idOrReferenceCode ||
        entry.referenceCode.toLowerCase() === idOrReferenceCode.toLowerCase()
    );

    if (!r) {
      return null;
    }

    const candidateList = [...(r.candidates ?? [])].sort((a, b) => a.rank - b.rank);
    const assigned = candidateList.find((c) => c.isAssigned) ?? null;
    const main = candidateList.find((c) => c.rank === 0) ?? candidateList[0] ?? null;
    const effective = assigned ?? main;

    const pres = mapStatusPresentation(r.status);
    const customerName = `${r.customerFirstName} ${r.customerLastName}`.trim();
    const customerInitials = formatInitials(r.customerFirstName, r.customerLastName);
    const schedule = formatSchedule(effective?.startAt, effective?.endAt);
    const duration = formatDuration(effective?.startAt, effective?.endAt);

    const candidates: AdminReservationCandidateSummary[] = candidateList.map((c) => ({
      id: c.id,
      rank: c.rank,
      tier: getCandidateTier(c.rank),
      workspaceInstanceId: c.workspaceInstanceId,
      workspaceDisplayName: c.workspaceInstanceId,
      workspaceInstanceCode: c.workspaceInstanceId,
      workspaceTemplateName: "Workspace",
      floorName: "Floor 1",
      startAt: c.startAt,
      endAt: c.endAt,
      schedule: formatSchedule(c.startAt, c.endAt),
      isAssigned: c.isAssigned,
      color: getCandidateColor(c.rank),
    }));

    const assignedCandidate: AdminReservationCandidateSummary | null = assigned
      ? {
        id: assigned.id,
        rank: assigned.rank,
        tier: getCandidateTier(assigned.rank),
        workspaceInstanceId: assigned.workspaceInstanceId,
        workspaceDisplayName: assigned.workspaceInstanceId,
        workspaceInstanceCode: assigned.workspaceInstanceId,
        workspaceTemplateName: "Workspace",
        floorName: "Floor 1",
        startAt: assigned.startAt,
        endAt: assigned.endAt,
        schedule: formatSchedule(assigned.startAt, assigned.endAt),
        isAssigned: true,
        color: getCandidateColor(assigned.rank),
      }
      : null;

    // Timeline building
    const timeline: string[] = [];
    timeline.push(
      `${formatTimelineDate(r.createdAt)} - Reservation requested (${r.source === "KIOSK" ? "Kiosk" : "Web"})`
    );

    // Check payment attempts for proof and history
    const attempts = Array.from(this.paymentAttempts.values())
      .filter((a) => a.reservationId === r.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const latestAttempt = attempts[0] ?? null;
    const proofAttempt = attempts.find((a) => a.proofSubmittedAt !== null) ?? null;
    const paymentExpiresAt = latestAttempt?.expiresAt ?? null;
    const proofSubmittedAt = proofAttempt?.proofSubmittedAt ?? null;

    const paymentAttemptsSummary: AdminReservationPaymentAttemptSummary[] = attempts.map((a) => {
      const aMethod = a.paymentMethodId
        ? this.paymentMethods.find((m) => m.id === a.paymentMethodId)
        : null;
      return {
        id: a.id,
        status: a.status,
        amount: r.amountDue,
        currency: r.currency,
        channel: a.channel,
        createdAt: a.createdAt,
        expiresAt: a.expiresAt,
        proofSubmittedAt: a.proofSubmittedAt,
        proofStoragePath: a.proofStoragePath,
        rejectionReason: a.rejectionReason,
        paymentMethodId: a.paymentMethodId ?? null,
        paymentMethodType: aMethod?.methodType ?? null,
        paymentMethodDisplayName: aMethod?.displayName ?? null,
      };
    });

    let expiryReason: string | null = null;
    if (r.status === "EXPIRED") {
      if (latestAttempt?.rejectionReason) {
        expiryReason = latestAttempt.rejectionReason;
      } else if (proofSubmittedAt) {
        expiryReason = "Proof submitted after payment window expired";
      } else {
        expiryReason = "1-hour payment window expired without payment proof submission";
      }
    }

    if (proofAttempt?.proofSubmittedAt) {
      timeline.push(`${formatTimelineDate(proofAttempt.proofSubmittedAt)} - Payment proof uploaded`);
    }

    if (r.confirmedAt) {
      timeline.push(
        `${formatTimelineDate(r.confirmedAt)} - Payment approved & Allocated to ${assignedCandidate?.workspaceDisplayName ?? "spot"}`
      );
    }

    if (r.checkedInAt) {
      timeline.push(`${formatTimelineDate(r.checkedInAt)} - Customer checked in`);
    }

    const reentries = this.operationalAuditEvents
      .filter((e) => e.reservationId === r.id && e.activityType === "REENTRY")
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

    for (const re of reentries) {
      timeline.push(`${formatTimelineDate(re.occurredAt)} - Customer re-entered (Re-entry)`);
    }

    if (r.checkedOutAt) {
      timeline.push(`${formatTimelineDate(r.checkedOutAt)} - Customer checked out`);
    }

    if (r.status === "CANCELLED") {
      const cancelReasonStr = (r as any).cancellationReason ? ` (${(r as any).cancellationReason})` : "";
      timeline.push(`${formatTimelineDate((r as any).cancelledAt || r.updatedAt)} - Reservation cancelled${cancelReasonStr}`);
    } else if (r.status === "EXPIRED") {
      timeline.push(`${formatTimelineDate(r.updatedAt)} - Payment session expired (${expiryReason ?? "Window elapsed"})`);
    } else if (r.status === "NEEDS_MANUAL_RESOLUTION") {
      timeline.push(`${formatTimelineDate(r.updatedAt)} - Needs manual resolution`);
    }

    if ((r as any).rescheduledAt) {
      timeline.push(
        `${formatTimelineDate((r as any).rescheduledAt)} - Rescheduled by Admin to ${schedule}`
      );
    }

    const formattedPaymentStatus = `${pres.payment} (${formatAmountWithCurrency(r.amountDue, r.currency)})`;

    const detailMethod = latestAttempt?.paymentMethodId
      ? this.paymentMethods.find((m) => m.id === latestAttempt.paymentMethodId)
      : null;

    return {
      id: r.id,
      referenceCode: r.referenceCode,
      source: r.source,
      customerFirstName: r.customerFirstName,
      customerLastName: r.customerLastName,
      customerName,
      customerInitials,
      customerEmail: r.customerEmail,
      reservationStatus: r.status,
      status: pres.label,
      statusStyle: pres.style,
      mark: pres.mark,
      schedule,
      duration,
      paymentStatus: formattedPaymentStatus,
      paymentColor: pres.paymentColor,
      amountDue: r.amountDue,
      currency: r.currency,
      rateSnapshot: r.rateSnapshot,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      confirmedAt: r.confirmedAt,
      checkedInAt: r.checkedInAt,
      checkedOutAt: r.checkedOutAt,
      qrIssuedAt: r.qrIssuedAt,
      qrRevokedAt: r.qrRevokedAt,
      hasBookingQr: Boolean(r.qrIssuedAt && !r.qrRevokedAt),
      bookingToken: r.bookingToken ?? null,
      bookingAccessUrl: r.bookingToken ? `https://deskatlas.test/booking/${encodeURIComponent(r.bookingToken)}` : null,
      assignedCandidate,
      candidates,
      timeline,
      paymentExpiresAt,
      paymentAttemptStatus: latestAttempt?.status ?? null,
      paymentMethodId: latestAttempt?.paymentMethodId ?? null,
      paymentMethodType: detailMethod?.methodType ?? null,
      paymentMethodDisplayName: detailMethod?.displayName ?? null,
      proofSubmittedAt,
      expiryReason,
      cancellationReason: (r as any).cancellationReason ?? null,
      cancelledAt: (r as any).cancelledAt ?? null,
      paymentAttempts: paymentAttemptsSummary,
    };
  }

  async cancelReservation(input: {
    reservationId: string;
    reason: string;
    notes?: string;
    actorUserId?: string;
    actorRole?: string;
  }): Promise<{ success: boolean; reservation: AdminReservationDetail; message?: string }> {
    const r = this.reservations.find(
      (entry) => entry.id === input.reservationId || entry.referenceCode.toLowerCase() === input.reservationId.toLowerCase()
    );

    if (!r) {
      throw new Error(`Reservation not found: ${input.reservationId}`);
    }

    const nowIso = this.nowProvider().toISOString();
    const fullReason = input.notes ? `${input.reason} - ${input.notes}` : input.reason;

    r.status = "CANCELLED";
    r.updatedAt = nowIso;
    r.qrRevokedAt = nowIso;
    (r as any).cancelledAt = nowIso;
    (r as any).cancellationReason = fullReason;
    (r as any).cancelledByUserId = input.actorUserId ?? null;

    if (r.candidates) {
      for (const c of r.candidates) {
        c.isAssigned = false;
      }
    }

    const detail = await this.getAdminReservationDetail(r.id);
    if (!detail) {
      throw new Error("Failed to retrieve updated reservation detail");
    }

    return {
      success: true,
      reservation: detail,
      message: "Reservation cancelled successfully",
    };
  }

  async rescheduleReservation(input: {
    reservationId: string;
    startAt: string;
    endAt: string;
    workspaceInstanceId?: string;
    actorUserId?: string;
    actorRole?: string;
  }): Promise<{ success: boolean; reservation: AdminReservationDetail; message?: string; oldSchedule?: string }> {
    const r = this.reservations.find(
      (entry) => entry.id === input.reservationId || entry.referenceCode.toLowerCase() === input.reservationId.toLowerCase()
    );

    if (!r) {
      throw new Error(`Reservation not found: ${input.reservationId}`);
    }

    if (r.status === "CANCELLED" || r.status === "EXPIRED") {
      throw new Error(`Cannot reschedule a ${r.status.toLowerCase()} reservation`);
    }

    const candidates = r.candidates ?? [];
    const assigned = candidates.find((c) => c.isAssigned) ?? candidates[0];
    const targetInstanceId = input.workspaceInstanceId || assigned?.workspaceInstanceId;

    if (!targetInstanceId) {
      throw new Error("Target workspace instance not specified");
    }

    const newStartMs = new Date(input.startAt).getTime();
    const newEndMs = new Date(input.endAt).getTime();
    const nowMs = this.nowProvider().getTime();

    if (newStartMs < nowMs) {
      throw new Error("Cannot reschedule to a past date or time.");
    }

    // Check conflict with other reservations
    for (const other of this.reservations) {
      if (other.id === r.id || other.status === "CANCELLED" || other.status === "EXPIRED") {
        continue;
      }
      for (const otherCand of other.candidates ?? []) {
        if (!otherCand.isAssigned || otherCand.workspaceInstanceId !== targetInstanceId) {
          continue;
        }
        const otherStartMs = new Date(otherCand.startAt).getTime();
        const otherEndMs = new Date(otherCand.endAt).getTime();
        if (newStartMs < otherEndMs && newEndMs > otherStartMs) {
          throw new Error("Selected workspace slot is already booked for this time window");
        }
      }
    }

    const oldSchedule = formatSchedule(assigned?.startAt, assigned?.endAt);
    const nowIso = this.nowProvider().toISOString();

    if (assigned) {
      assigned.startAt = input.startAt;
      assigned.endAt = input.endAt;
      assigned.workspaceInstanceId = targetInstanceId;
      assigned.isAssigned = true;
    }

    r.updatedAt = nowIso;
    (r as any).rescheduledAt = nowIso;

    const detail = await this.getAdminReservationDetail(r.id);
    if (!detail) {
      throw new Error("Failed to retrieve updated reservation detail");
    }

    return {
      success: true,
      reservation: detail,
      oldSchedule,
      message: "Reservation rescheduled successfully",
    };
  }

  async checkRescheduleAvailability(input: {
    reservationId: string;
    startAt?: string;
    endAt?: string;
    date?: string;
    durationHours?: number;
    workspaceInstanceId?: string;
  }): Promise<{
    available: boolean;
    reason?: string;
    workspaceInstanceId?: string;
    workspaceDisplayName?: string;
    slots?: RescheduleSlotAvailability[];
  }> {
    const r = this.reservations.find(
      (entry) => entry.id === input.reservationId || entry.referenceCode.toLowerCase() === input.reservationId.toLowerCase()
    );

    const targetInstanceId =
      input.workspaceInstanceId ||
      r?.candidates?.find((c) => c.isAssigned)?.workspaceInstanceId ||
      r?.candidates?.[0]?.workspaceInstanceId ||
      "spot-1";

    let available = true;
    let reason: string | undefined;
    const nowMs = this.nowProvider().getTime();

    if (input.startAt && input.endAt) {
      const newStartMs = new Date(input.startAt).getTime();
      const newEndMs = new Date(input.endAt).getTime();

      if (newStartMs < nowMs) {
        available = false;
        reason = "Cannot reschedule to a past date or time";
      } else {
        for (const other of this.reservations) {
          if (other.id === r?.id || other.status === "CANCELLED" || other.status === "EXPIRED") {
            continue;
          }
          for (const otherCand of other.candidates ?? []) {
            if (!otherCand.isAssigned || otherCand.workspaceInstanceId !== targetInstanceId) {
              continue;
            }
            const otherStartMs = new Date(otherCand.startAt).getTime();
            const otherEndMs = new Date(otherCand.endAt).getTime();
            if (newStartMs < otherEndMs && newEndMs > otherStartMs) {
              available = false;
              reason = "Spot is occupied during this time window";
              break;
            }
          }
          if (!available) break;
        }
      }
    }

    // Compute slots for date
    let slots: RescheduleSlotAvailability[] | undefined;
    const targetDate = input.date || (input.startAt ? input.startAt.split("T")[0] : undefined);
    const duration = input.durationHours || 2;

    if (targetDate) {
      const timeOptions = [
        '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00',
        '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00'
      ];

      slots = timeOptions.map((time) => {
        const [h, m] = time.split(":").map(Number);
        const slotStart = zonedDateTimeToUtc(targetDate, time, "Asia/Manila");
        const slotEnd = new Date(slotStart.getTime() + duration * 60 * 60 * 1000);
        const startMs = slotStart.getTime();
        const endMs = slotEnd.getTime();

        const endHour = h + duration;
        const endTime = `${String(endHour).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

        let slotAvailable = true;
        let slotReason: string | undefined;

        if (startMs < nowMs) {
          slotAvailable = false;
          slotReason = "Past";
        } else {
          for (const other of this.reservations) {
            if (other.id === r?.id || other.status === "CANCELLED" || other.status === "EXPIRED") {
              continue;
            }
            for (const otherCand of other.candidates ?? []) {
              if (!otherCand.isAssigned || otherCand.workspaceInstanceId !== targetInstanceId) {
                continue;
              }
              const otherStartMs = new Date(otherCand.startAt).getTime();
              const otherEndMs = new Date(otherCand.endAt).getTime();
              if (startMs < otherEndMs && endMs > otherStartMs) {
                slotAvailable = false;
                slotReason = "Booked";
                break;
              }
            }
            if (!slotAvailable) break;
          }
        }

        return {
          startTime: time,
          endTime,
          startAt: slotStart.toISOString(),
          endAt: slotEnd.toISOString(),
          isAvailable: slotAvailable,
          reason: slotReason,
        };
      });
    }

    return {
      available,
      reason,
      workspaceInstanceId: targetInstanceId,
      workspaceDisplayName: targetInstanceId,
      slots,
    };
  }

  async listEndedReservationsForSurvey(nowIso: string): Promise<EndedReservationForSurvey[]> {
    const results: EndedReservationForSurvey[] = [];
    const nowMs = new Date(nowIso).getTime();

    for (const r of this.reservations) {
      if (!["CONFIRMED", "CHECKED_IN", "COMPLETED"].includes(r.status)) {
        continue;
      }

      const assignedCandidate =
        r.candidates?.find((c) => c.isAssigned) ||
        r.candidates?.[0];

      const endMs = assignedCandidate?.endAt ? new Date(assignedCandidate.endAt).getTime() : 0;
      const isEnded = r.status === "COMPLETED" || (endMs > 0 && endMs <= nowMs);

      if (isEnded) {
        results.push({
          id: r.id,
          referenceCode: r.referenceCode,
          customerEmail: r.customerEmail,
          customerFirstName: r.customerFirstName,
          customerLastName: r.customerLastName,
          status: r.status,
          workspaceDisplayName: assignedCandidate?.workspaceDisplayName || "Workspace",
          workspaceTemplateName: assignedCandidate?.workspaceTemplateName || "Desk",
          floorName: assignedCandidate?.floorName || "Main Floor",
          bookingStartAt: assignedCandidate?.startAt,
          bookingEndAt: assignedCandidate?.endAt,
        });
      }
    }

    return results;
  }

  async hasSurveyEmailBeenDispatched(reservationId: string): Promise<boolean> {
    return this.surveyDispatchedReservationIds.has(reservationId);
  }

  async recordSurveyEmailDispatched(reservationId: string, metadata?: Record<string, any>): Promise<void> {
    this.surveyDispatchedReservationIds.add(reservationId);
  }

  async markReservationCompleted(reservationId: string, completedAt: string): Promise<void> {
    const res = this.reservations.find((r) => r.id === reservationId);
    if (res) {
      res.status = "COMPLETED";
      res.checkedOutAt = completedAt;
      res.updatedAt = completedAt;
    }
  }
}

function getCheckInState(checkedInAt: string | null, checkedOutAt: string | null) {
  if (checkedOutAt) {
    return "CHECKED_OUT" as const;
  }

  if (checkedInAt) {
    return "CHECKED_IN" as const;
  }

  return "NOT_CHECKED_IN" as const;
}

function compareOperationalReservations(
  left: StaffOperationalReservation,
  right: StaffOperationalReservation
) {
  return (left.bookingStartAt ?? "").localeCompare(right.bookingStartAt ?? "");
}
