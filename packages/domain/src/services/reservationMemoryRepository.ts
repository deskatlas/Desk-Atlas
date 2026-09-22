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
  CustomerRelocationRequest,
} from "../models/reservation";
import {
  AdminReservationRepository,
  CheckRescheduleAvailabilityInput,
  RescheduleReservationInput,
  RescheduleSlotAvailability,
  RescheduleAvailabilityResult,
  RelocateReservationInput,
  AvailableRelocationSpot,
  ListAvailableRelocationSpotsInput,
  RequestCustomerRelocationInput,
  DecideCustomerRelocationInput,
  ExtendReservationInput,
  CheckExtendAvailabilityInput,
  ExtendAvailabilityResult,
  ExtendReservationResult,
  ExtendAvailabilityNextBooking,
} from "./adminReservationRepository";
import { WorkspaceRepository } from "../models/workspace";
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
import { StaffOperationsError, StaffOperationsConflictError } from "./staffOperationsService";
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
  private operatingHoursMap: Map<number, Array<{ opensAt: string; closesAt: string; isActive?: boolean }>> = new Map();
  private businessScheduleBlocks: Array<{ startAt: string; endAt: string; blockType?: string; scope?: string; reason?: string }> = [];
  private operationQueue = Promise.resolve();
  private nextApprovalFailureMessage: string | null = null;
  private businessName: string = "DeskAtlas";
  private workspaceRepository?: WorkspaceRepository;
  constructor(
    private readonly nowProvider: () => Date = () => new Date(),
    workspaceRepository?: WorkspaceRepository
  ) {
    this.workspaceRepository = workspaceRepository;
  }

  setWorkspaceRepository(repo: WorkspaceRepository): void {
    this.workspaceRepository = repo;
  }

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
      customerContactNumber: request.customerContactNumber ?? null,
      status: request.source === "WEB" ? "PENDING_PAYMENT" : "PENDING_COUNTER_CONFIRMATION",
      rateSnapshot,
      bookedRatePerHour: rateSnapshot,
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
        id: paymentSession.paymentAttemptId || randomUUID(),
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
      customerContactNumber: reservation.customerContactNumber ?? null,
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
      customerContactNumber: reservation.customerContactNumber ?? null,
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
      customerContactNumber: matchedReservation.customerContactNumber ?? null,
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

  async listRejectedPayments(): Promise<PaymentReviewDetail[]> {
    return Array.from(this.paymentAttempts.values())
      .filter((attempt) => attempt.channel === "WEB" && attempt.status === "REJECTED")
      .map((attempt) => this.buildPaymentReviewDetail(attempt))
      .filter((detail): detail is PaymentReviewDetail => detail !== null)
      .sort((a, b) => {
        const aTime = a.processedAt ? new Date(a.processedAt).getTime() : 0;
        const bTime = b.processedAt ? new Date(b.processedAt).getTime() : 0;
        if (aTime !== bTime) {
          return bTime - aTime;
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

        if (attempt.status !== "UNDER_REVIEW" && attempt.status !== "REJECTED") {
          throw new Error("Payment attempt is not in an approvable review state.");
        }

        const reservation = this.requireReservation(attempt.reservationId);
        const candidates = [...(reservation.candidates ?? [])].sort((a, b) => a.rank - b.rank);
        let assignedCandidate: ReservationCandidate | null = null;
        const mapPlacedIds = this.workspaceRepository?.getMapPlacedInstanceIds
          ? await this.workspaceRepository.getMapPlacedInstanceIds()
          : null;

        for (const candidate of candidates) {
          if (mapPlacedIds && !mapPlacedIds.has(candidate.workspaceInstanceId)) {
            continue;
          }
          if (this.workspaceRepository) {
            try {
              const inst = await this.workspaceRepository.getInstance(candidate.workspaceInstanceId);
              if (inst.operationalStatus !== "ACTIVE" || !inst.template.isActive) {
                continue;
              }
            } catch {
              // ignore if instance not found in repository
            }
          }
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

        // Clear cancellation requirements if reservation was previously cancelled
        (reservation as any).cancelledAt = null;
        (reservation as any).cancellationReason = null;
        (reservation as any).cancelledByUserId = null;

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
      reservation.status = "CANCELLED";
      (reservation as any).cancelledAt = input.processedAt;
      (reservation as any).cancellationReason = `Payment proof rejected: ${input.rejectionReason}`;
      (reservation as any).cancelledByUserId = input.actorUserId;
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
        const mapPlacedIds = this.workspaceRepository?.getMapPlacedInstanceIds
          ? await this.workspaceRepository.getMapPlacedInstanceIds()
          : null;

        for (const candidate of candidates) {
          if (mapPlacedIds && !mapPlacedIds.has(candidate.workspaceInstanceId)) {
            continue;
          }
          if (this.workspaceRepository) {
            try {
              const inst = await this.workspaceRepository.getInstance(candidate.workspaceInstanceId);
              if (inst.operationalStatus !== "ACTIVE" || !inst.template.isActive) {
                continue;
              }
            } catch {
              // ignore if instance not found in repository
            }
          }
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
      confirmedAt: reservation.confirmedAt ?? null,
      source: reservation.source ?? null,
      hasPreviousScan: this.bookingScanEvents.some((e) => e.reservationId === reservation.id),
      assignedWorkspaceInstanceId: assignedCandidate.workspaceInstanceId,
      assignedWorkspaceDisplayName: (assignedCandidate as any).workspaceDisplayName || assignedCandidate.workspaceInstanceId,
      assignedWorkspaceInstanceCode: (assignedCandidate as any).workspaceInstanceCode || assignedCandidate.workspaceInstanceId,
      assignedWorkspaceTemplateName: (assignedCandidate as any).workspaceTemplateName || "Workspace",
      assignedFloorName: (assignedCandidate as any).floorName || "Unknown Floor",
      assignedStartAt: assignedCandidate.startAt,
      assignedEndAt: assignedCandidate.endAt,
    };
  }

  async findBookingAccessByReferenceOrId(identifier: string): Promise<BookingAccessRecord | null> {
    const trimmed = identifier.trim();
    const normalizedUpper = trimmed.toUpperCase();
    const reservation = this.reservations.find(
      (entry) =>
        entry.referenceCode.toUpperCase() === normalizedUpper ||
        entry.id.toLowerCase() === trimmed.toLowerCase()
    );
    if (!reservation) {
      return null;
    }

    let assignedCandidate = (reservation.candidates ?? []).find((c) => c.isAssigned);
    if (!assignedCandidate && (reservation.candidates ?? []).length > 0) {
      assignedCandidate = reservation.candidates![0];
    }
    if (!assignedCandidate) {
      return null;
    }

    return {
      reservationId: reservation.id,
      referenceCode: reservation.referenceCode,
      reservationStatus: reservation.status,
      customerFirstName: reservation.customerFirstName,
      customerLastName: reservation.customerLastName,
      customerEmail: reservation.customerEmail,
      bookingTokenHash: reservation.bookingTokenHash ?? "",
      bookingToken: reservation.bookingToken ?? null,
      qrIssuedAt: reservation.qrIssuedAt ?? reservation.createdAt,
      qrRevokedAt: reservation.qrRevokedAt ?? null,
      checkedInAt: reservation.checkedInAt ?? null,
      checkedOutAt: reservation.checkedOutAt ?? null,
      confirmedAt: reservation.confirmedAt ?? null,
      source: reservation.source ?? null,
      hasPreviousScan: this.bookingScanEvents.some((e) => e.reservationId === reservation.id),
      assignedWorkspaceInstanceId: assignedCandidate.workspaceInstanceId,
      assignedWorkspaceDisplayName: (assignedCandidate as any).workspaceDisplayName || assignedCandidate.workspaceInstanceId,
      assignedWorkspaceInstanceCode: (assignedCandidate as any).workspaceInstanceCode || assignedCandidate.workspaceInstanceId,
      assignedWorkspaceTemplateName: (assignedCandidate as any).workspaceTemplateName || "Workspace",
      assignedFloorName: (assignedCandidate as any).floorName || "Unknown Floor",
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
      .map((reservation) => this.buildOperationalReservation(reservation))
      .sort(compareOperationalReservations);
  }

  async getOperationalReservation(
    idOrReferenceCode: string
  ): Promise<StaffOperationalReservation | null> {
    const reservation = this.reservations.find(
      (r) => r.id === idOrReferenceCode || r.referenceCode === idOrReferenceCode
    );

    if (!reservation) {
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
    const latestAttempt = Array.from(this.paymentAttempts.values())
      .reverse()
      .find((entry) => entry.reservationId === reservation.id);

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
      paymentStatus: latestAttempt?.status ?? null,
      rejectionReason: latestAttempt?.rejectionReason ?? null,
      rescheduleCount: (reservation as any).rescheduleCount ?? 0,
      pendingRelocationRequest: (reservation as any).pendingRelocationRequest ?? null,
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
        throw new StaffOperationsConflictError("Reservation is not in a check-in state.");
      }

      if (input.actedAt < summary.bookingStartAt || input.actedAt > summary.bookingEndAt) {
        throw new StaffOperationsError("Reservation is not currently active for check-in.");
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
      customerContactNumber: reservation.customerContactNumber ?? null,
      reservationStatus: reservation.status,
      checkInState: getCheckInState(reservation.checkedInAt ?? null, reservation.checkedOutAt ?? null),
      workspaceInstanceId: candidate?.workspaceInstanceId ?? null,
      workspaceDisplayName: ((candidate as any)?.workspaceDisplayName || candidate?.workspaceInstanceId) ?? null,
      workspaceInstanceCode: ((candidate as any)?.workspaceInstanceCode || candidate?.workspaceInstanceId) ?? null,
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
      pendingRelocationRequest: (reservation as any).pendingRelocationRequest ?? null,
      rateSnapshot: reservation.rateSnapshot,
      bookedRatePerHour: reservation.rateSnapshot,
      amountDue: reservation.amountDue,
      cancellationReason: (reservation as any).cancellationReason ?? (reservation as any).cancellation_reason ?? null,
      cancelledAt: (reservation as any).cancelledAt ?? (reservation as any).cancelled_at ?? null,
      cancelledByUserId: (reservation as any).cancelledByUserId ?? (reservation as any).cancelled_by_user_id ?? null,
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
      const attempts = Array.from(this.paymentAttempts.values())
        .filter((a) => a.reservationId === r.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const latestAttempt = attempts[0] ?? null;
      const paymentExpiresAt = latestAttempt?.expiresAt ?? null;

      const isPaymentRejected =
        latestAttempt?.status === "REJECTED" ||
        (r.status === "CANCELLED" && attempts.some((a) => a.status === "REJECTED"));
      const targetCandidate = assignedCandidate ?? mainCandidate;
      const pres = mapStatusPresentation(r.status, isPaymentRejected ? "REJECTED" : latestAttempt?.status);
      const customerName = `${r.customerFirstName} ${r.customerLastName}`.trim();
      const customerInitials = formatInitials(r.customerFirstName, r.customerLastName);
      const schedule = formatSchedule(targetCandidate?.startAt, targetCandidate?.endAt);

      const workspaceDisplayName = assignedCandidate
        ? assignedCandidate.workspaceInstanceId
        : candidates.length > 1
          ? "Multiple Candidates"
          : mainCandidate?.workspaceInstanceId ?? "Unassigned";

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
        customerContactNumber: r.customerContactNumber ?? null,
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
        rateSnapshot: r.rateSnapshot,
        bookedRatePerHour: r.rateSnapshot,
        createdAt: r.createdAt,
        confirmedAt: r.confirmedAt,
        checkedInAt: r.checkedInAt,
        checkedOutAt: r.checkedOutAt,
        paymentExpiresAt,
        paymentAttemptStatus: latestAttempt?.status ?? null,
        paymentMethodId: latestAttempt?.paymentMethodId ?? null,
        paymentMethodType: method?.methodType ?? null,
        paymentMethodDisplayName: method?.displayName ?? null,
        cancellationReason: (r as any).cancellationReason ?? (r as any).cancellation_reason ?? null,
        cancelledAt: (r as any).cancelledAt ?? (r as any).cancelled_at ?? null,
        cancelledByUserId: (r as any).cancelledByUserId ?? (r as any).cancelled_by_user_id ?? null,
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

    // Check payment attempts for proof and history
    const attempts = Array.from(this.paymentAttempts.values())
      .filter((a) => a.reservationId === r.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const latestAttempt = attempts[0] ?? null;
    const proofAttempt = attempts.find((a) => a.proofSubmittedAt !== null) ?? null;
    const paymentExpiresAt = latestAttempt?.expiresAt ?? null;
    const proofSubmittedAt = proofAttempt?.proofSubmittedAt ?? null;

    const isPaymentRejected =
      latestAttempt?.status === "REJECTED" ||
      (r.status === "CANCELLED" && attempts.some((a) => a.status === "REJECTED"));
    const pres = mapStatusPresentation(r.status, isPaymentRejected ? "REJECTED" : latestAttempt?.status);
    const customerName = `${r.customerFirstName} ${r.customerLastName}`.trim();
    const customerInitials = formatInitials(r.customerFirstName, r.customerLastName);
    const schedule = formatSchedule(effective?.startAt, effective?.endAt);
    const duration = formatDuration(effective?.startAt, effective?.endAt);

    const getWorkspaceMeta = (instanceId: string) => {
      return {
        displayName: instanceId,
        code: instanceId,
        templateName: "Workspace",
        floorName: "Floor 1",
      };
    };

    const candidates: AdminReservationCandidateSummary[] = candidateList.map((c) => {
      const meta = getWorkspaceMeta(c.workspaceInstanceId);
      return {
        id: c.id,
        rank: c.rank,
        tier: getCandidateTier(c.rank),
        workspaceInstanceId: c.workspaceInstanceId,
        workspaceDisplayName: c.workspaceDisplayName || meta.displayName,
        workspaceInstanceCode: c.workspaceInstanceCode || meta.code,
        workspaceTemplateName: c.workspaceTemplateName || meta.templateName,
        floorName: c.floorName || meta.floorName,
        startAt: c.startAt,
        endAt: c.endAt,
        schedule: formatSchedule(c.startAt, c.endAt),
        isAssigned: c.isAssigned,
        color: getCandidateColor(c.rank),
      };
    });

    const assignedCandidate: AdminReservationCandidateSummary | null = assigned
      ? {
        id: assigned.id,
        rank: assigned.rank,
        tier: getCandidateTier(assigned.rank),
        workspaceInstanceId: assigned.workspaceInstanceId,
        workspaceDisplayName: assigned.workspaceDisplayName || getWorkspaceMeta(assigned.workspaceInstanceId).displayName,
        workspaceInstanceCode: assigned.workspaceInstanceCode || getWorkspaceMeta(assigned.workspaceInstanceId).code,
        workspaceTemplateName: assigned.workspaceTemplateName || getWorkspaceMeta(assigned.workspaceInstanceId).templateName,
        floorName: assigned.floorName || getWorkspaceMeta(assigned.workspaceInstanceId).floorName,
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
      const actorLabel = (r as any).rescheduledByRole === "CUSTOMER" ? "Customer" : "Admin";
      timeline.push(
        `${formatTimelineDate((r as any).rescheduledAt)} - Rescheduled by ${actorLabel} to ${schedule}`
      );
    }

    const relocations = (r as any).relocations ?? [];
    for (const rel of relocations) {
      const actorLabel =
        rel.actorRole === "STAFF"
          ? "Staff"
          : rel.actorRole === "CUSTOMER"
          ? "Customer"
          : rel.actorRole === "SUPERADMIN" || rel.actorRole === "SUPER_ADMIN"
          ? "Super Admin"
          : "Admin";

      if (rel.inSession && rel.remainingMinutes) {
        const remainingHours = Math.floor(rel.remainingMinutes / 60);
        const remMins = rel.remainingMinutes % 60;
        const remText =
          remainingHours > 0
            ? `${remainingHours}h${remMins > 0 ? ` ${remMins}m` : ""}`
            : `${remMins}m`;

        timeline.push(
          `${formatTimelineDate(rel.relocatedAt)} - In-session spot relocated from ${rel.oldWorkspaceDisplayName} to ${rel.newWorkspaceDisplayName} by ${actorLabel} for remaining time (${remText} remaining). Reason: ${rel.reason}${rel.notes ? ` (${rel.notes})` : ""}`
        );
      } else {
        timeline.push(
          `${formatTimelineDate(rel.relocatedAt)} - Relocated by ${actorLabel} from ${rel.oldWorkspaceDisplayName} to ${rel.newWorkspaceDisplayName} due to: ${rel.reason}${rel.notes ? ` (${rel.notes})` : ""}`
        );
      }
    }

    if ((r as any).pendingRelocationRequest) {
      const preq = (r as any).pendingRelocationRequest as CustomerRelocationRequest;
      timeline.push(
        `${formatTimelineDate(preq.requestedAt)} - Customer requested spot relocation to ${preq.targetWorkspaceDisplayName}. Reason: ${preq.reason}${preq.notes ? ` (${preq.notes})` : ""}`
      );
    }

    if ((r as any).declinedRelocationRequest) {
      const dreq = (r as any).declinedRelocationRequest as CustomerRelocationRequest;
      const decActor = dreq.decisionRole === "STAFF" ? "Staff" : "Admin";
      timeline.push(
        `${formatTimelineDate(dreq.decisionAt || dreq.requestedAt)} - Customer spot relocation request declined by ${decActor}. Reason: ${dreq.decisionNotes || "Unavailable"}`
      );
    }

    const extEvents = ((r as any).extensionEvents || []) as Array<{
      occurredAt: string;
      actorRole: string;
      addedMinutes: number;
      newEndTime: string;
    }>;
    for (const ext of extEvents) {
      const actor = ext.actorRole === "STAFF" ? "Staff" : "Admin";
      const durationText = ext.addedMinutes
        ? `${ext.addedMinutes >= 60 && ext.addedMinutes % 60 === 0 ? `${ext.addedMinutes / 60} hour${ext.addedMinutes / 60 > 1 ? 's' : ''}` : `${ext.addedMinutes} mins`}`
        : "time";
      timeline.push(
        `${formatTimelineDate(ext.occurredAt)} - Time extended by ${actor} by ${durationText}`
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
      customerContactNumber: r.customerContactNumber ?? null,
      reservationStatus: r.status,
      status: pres.label,
      statusStyle: pres.style,
      mark: pres.mark,
      schedule,
      duration,
      startAt: effective?.startAt ?? null,
      endAt: effective?.endAt ?? null,
      paymentStatus: formattedPaymentStatus,
      paymentColor: pres.paymentColor,
      amountDue: r.amountDue,
      currency: r.currency,
      rateSnapshot: r.rateSnapshot,
      bookedRatePerHour: r.rateSnapshot,
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
      rescheduleCount: (r as any).rescheduleCount ?? 0,
      paymentAttempts: paymentAttemptsSummary,
      pendingRelocationRequest: (r as any).pendingRelocationRequest ?? null,
    };
  }

  async cancelReservation(input: {
    reservationId: string;
    reason: string;
    notes?: string;
    actorUserId?: string;
    actorRole?: string;
  }): Promise<{ success: boolean; reservation: AdminReservationDetail; message?: string }> {
    if (input.actorRole && input.actorRole.toUpperCase() === "STAFF") {
      throw new Error("Staff members are not authorized to cancel reservations.");
    }
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

  async rescheduleReservation(input: RescheduleReservationInput): Promise<{ success: boolean; reservation: AdminReservationDetail; message?: string; oldSchedule?: string }> {
    if (input.actorRole && input.actorRole.toUpperCase() === "STAFF") {
      throw new Error("Staff members are not authorized to reschedule reservations.");
    }
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

    const maxAdvanceValue = input.maxAdvanceValue;
    const maxAdvanceUnit = input.maxAdvanceUnit || (input.maxAdvanceHours && input.maxAdvanceHours % 24 === 0 ? "DAYS" : "HOURS");
    const maxAdvanceHours = input.maxAdvanceHours ?? (maxAdvanceValue !== undefined && maxAdvanceValue !== null ? (maxAdvanceUnit === "HOURS" ? maxAdvanceValue : maxAdvanceValue * 24) : undefined);

    if (maxAdvanceHours !== undefined) {
      const maxAllowedMs = nowMs + maxAdvanceHours * 60 * 60 * 1000;
      if (newStartMs > maxAllowedMs) {
        const val = maxAdvanceValue ?? (maxAdvanceUnit === "DAYS" ? maxAdvanceHours / 24 : maxAdvanceHours);
        const unitStr = (maxAdvanceUnit || "DAYS").toLowerCase();
        throw new Error(`Rescheduling is only allowed up to ${val} ${unitStr} in advance.`);
      }
    }

    const isCustomerActor = input.actorRole === "CUSTOMER";
    const currentRescheduleCount = (r as any).rescheduleCount ?? 0;

    if (isCustomerActor) {
      if (currentRescheduleCount >= 1) {
        throw new Error("Customer can only reschedule a reservation once.");
      }

      if (assigned?.startAt) {
        const origStartMs = new Date(assigned.startAt).getTime();
        const cutoffHours = input.cutoffHours ?? 12;
        const cutoffMs = cutoffHours * 60 * 60 * 1000;
        if (nowMs > origStartMs - cutoffMs) {
          throw new Error(`Reschedule must be requested at least ${cutoffHours} hours before the scheduled start time.`);
        }

        if (assigned.endAt) {
          const origDurationMs = new Date(assigned.endAt).getTime() - origStartMs;
          const newDurationMs = newEndMs - newStartMs;
          if (Math.abs(origDurationMs - newDurationMs) > 60000) {
            throw new Error("Rescheduled reservation must have the exact same duration as the original booking.");
          }
        }
      }
    }

    // Check if target date is closed or outside operating hours
    const timezone = "Asia/Manila";
    let targetDateStr = "";
    try {
      targetDateStr = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(input.startAt));
    } catch {
      targetDateStr = input.startAt.split("T")[0];
    }

    const [year, month, day] = targetDateStr.split("-").map(Number);
    const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();

    const hasConfiguredOperatingHours = this.operatingHoursMap.size > 0;
    const dayIntervals = (this.operatingHoursMap.get(dayOfWeek) ?? [])
      .filter((i) => i.isActive !== false)
      .sort((a, b) => a.opensAt.localeCompare(b.opensAt));

    const targetDayStartMs = new Date(`${targetDateStr}T00:00:00+08:00`).getTime();
    const targetDayEndMs = new Date(`${targetDateStr}T23:59:59.999+08:00`).getTime();

    const hasBusinessClosure = this.businessScheduleBlocks.some((b) => {
      const bStartMs = new Date(b.startAt).getTime();
      const bEndMs = new Date(b.endAt).getTime();
      return bStartMs < targetDayEndMs && bEndMs > targetDayStartMs;
    });

    const isClosed = hasBusinessClosure || (hasConfiguredOperatingHours && dayIntervals.length === 0);
    if (isClosed) {
      throw new Error("The facility is closed on the selected date.");
    }

    const is24Hours = dayIntervals.some(
      (i) =>
        (i.opensAt === "00:00:00" || i.opensAt === "00:00") &&
        (i.closesAt === "24:00:00" ||
          i.closesAt === "24:00" ||
          i.closesAt === "23:59:59" ||
          i.closesAt === "00:00:00" ||
          i.closesAt === "00:00")
    );

    if (!is24Hours && dayIntervals.length > 0) {
      const openTime = dayIntervals[0].opensAt.slice(0, 5);
      const rawClose = dayIntervals[dayIntervals.length - 1].closesAt.slice(0, 5);
      const closeTime = rawClose === "00:00" ? "24:00" : rawClose;

      const startTimeStr = new Intl.DateTimeFormat("en-GB", {
        timeZone: timezone,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(input.startAt));

      const endTimeStr = new Intl.DateTimeFormat("en-GB", {
        timeZone: timezone,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(input.endAt));

      const [sH, sM] = startTimeStr.split(":").map(Number);
      const startMin = (sH || 0) * 60 + (sM || 0);

      const [eH, eM] = endTimeStr.split(":").map(Number);
      const endMin = (eH || 0) * 60 + (eM || 0);

      const [oH, oM] = openTime.split(":").map(Number);
      const openMin = (oH || 0) * 60 + (oM || 0);

      const [cH, cM] = closeTime.split(":").map(Number);
      const closeMin = (cH === 0 || cH === 24 ? 24 : (cH || 0)) * 60 + (cM || 0);

      if (startMin < openMin || endMin > closeMin || startMin >= closeMin) {
        throw new Error(`Cannot reschedule outside business operating hours (${openTime} - ${closeTime}).`);
      }
    } else if (is24Hours && newEndMs > targetDayEndMs) {
      // Overnight check on the following date
      let nextDateStr = "";
      try {
        nextDateStr = new Intl.DateTimeFormat("en-CA", {
          timeZone: timezone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date(input.endAt));
      } catch {
        nextDateStr = input.endAt.split("T")[0];
      }

      const [ny, nm, nd] = nextDateStr.split("-").map(Number);
      const nextDayOfWeek = new Date(Date.UTC(ny, nm - 1, nd)).getUTCDay();

      const nextDayIntervals = (this.operatingHoursMap.get(nextDayOfWeek) ?? [])
        .filter((i) => i.isActive !== false);

      const nextDayStartMs = new Date(`${nextDateStr}T00:00:00+08:00`).getTime();
      const nextDayEndMs = new Date(`${nextDateStr}T23:59:59.999+08:00`).getTime();

      const nextDayBlocked = this.businessScheduleBlocks.some((b) => {
        const bStartMs = new Date(b.startAt).getTime();
        const bEndMs = new Date(b.endAt).getTime();
        return bStartMs < nextDayEndMs && bEndMs > nextDayStartMs && bStartMs < newEndMs;
      });

      const nextDayClosed = nextDayBlocked || (hasConfiguredOperatingHours && nextDayIntervals.length === 0);
      if (nextDayClosed) {
        throw new Error("Cannot reschedule overnight: the facility is closed during overnight hours on the following date.");
      }
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
    (r as any).rescheduledByRole = input.actorRole ?? "ADMIN";
    (r as any).rescheduleCount = currentRescheduleCount + 1;

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

  async checkRescheduleAvailability(
    input: CheckRescheduleAvailabilityInput
  ): Promise<RescheduleAvailabilityResult> {
    const r = this.reservations.find(
      (entry) => entry.id === input.reservationId || entry.referenceCode.toLowerCase() === input.reservationId.toLowerCase()
    );

    const targetInstanceId =
      input.workspaceInstanceId ||
      r?.candidates?.find((c) => c.isAssigned)?.workspaceInstanceId ||
      r?.candidates?.[0]?.workspaceInstanceId ||
      "spot-1";

    const timezone = "Asia/Manila";
    let targetDate = input.date;
    if (!targetDate && input.startAt) {
      try {
        targetDate = new Intl.DateTimeFormat("en-CA", {
          timeZone: timezone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date(input.startAt));
      } catch {
        targetDate = input.startAt.split("T")[0];
      }
    }

    let dayOfWeek = 1;
    if (targetDate) {
      const [year, month, day] = targetDate.split("-").map(Number);
      dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    }

    const hasConfiguredOperatingHours = this.operatingHoursMap.size > 0;
    const dayIntervals = (this.operatingHoursMap.get(dayOfWeek) ?? [])
      .filter((i) => i.isActive !== false)
      .sort((a, b) => a.opensAt.localeCompare(b.opensAt));

    const targetDayStartMs = targetDate ? new Date(`${targetDate}T00:00:00+08:00`).getTime() : 0;
    const targetDayEndMs = targetDate ? new Date(`${targetDate}T23:59:59.999+08:00`).getTime() : 0;

    const hasBusinessClosure = targetDate
      ? this.businessScheduleBlocks.some((b) => {
          const bStartMs = new Date(b.startAt).getTime();
          const bEndMs = new Date(b.endAt).getTime();
          return bStartMs < targetDayEndMs && bEndMs > targetDayStartMs;
        })
      : false;

    const isClosed = hasBusinessClosure || (hasConfiguredOperatingHours && dayIntervals.length === 0);

    const is24Hours =
      !isClosed &&
      dayIntervals.some(
        (i) =>
          (i.opensAt === "00:00:00" || i.opensAt === "00:00") &&
          (i.closesAt === "24:00:00" ||
            i.closesAt === "24:00" ||
            i.closesAt === "23:59:59" ||
            i.closesAt === "00:00:00" ||
            i.closesAt === "00:00")
      );

    let openTime = is24Hours ? "00:00" : "09:00";
    let closeTime = is24Hours ? "24:00" : "18:00";

    if (!isClosed && dayIntervals.length > 0) {
      if (!is24Hours) {
        openTime = dayIntervals[0].opensAt.slice(0, 5);
        const rawClose = dayIntervals[dayIntervals.length - 1].closesAt.slice(0, 5);
        closeTime = rawClose === "00:00" ? "24:00" : rawClose;
      }
    }

    let available = true;
    let reason: string | undefined;
    const nowMs = this.nowProvider().getTime();

    const maxAdvanceValue = input.maxAdvanceValue;
    const maxAdvanceUnit = input.maxAdvanceUnit || (input.maxAdvanceHours && input.maxAdvanceHours % 24 === 0 ? "DAYS" : "HOURS");
    const maxAdvanceHours = input.maxAdvanceHours ?? (maxAdvanceValue !== undefined && maxAdvanceValue !== null ? (maxAdvanceUnit === "HOURS" ? maxAdvanceValue : maxAdvanceValue * 24) : undefined);

    let maxAllowedDate: string | undefined;
    if (maxAdvanceHours !== undefined) {
      const maxAllowedMs = nowMs + maxAdvanceHours * 60 * 60 * 1000;
      try {
        maxAllowedDate = new Intl.DateTimeFormat("en-CA", {
          timeZone: timezone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date(maxAllowedMs));
      } catch {
        maxAllowedDate = new Date(maxAllowedMs).toISOString().split("T")[0];
      }

      if (targetDate && maxAllowedDate && targetDate > maxAllowedDate) {
        available = false;
        const val = maxAdvanceValue ?? (maxAdvanceUnit === "DAYS" ? maxAdvanceHours / 24 : maxAdvanceHours);
        const unitStr = (maxAdvanceUnit || "DAYS").toLowerCase();
        reason = `Rescheduling is only allowed up to ${val} ${unitStr} in advance.`;
      }
    }

    if (input.startAt && input.endAt && available) {
      const newStartMs = new Date(input.startAt).getTime();
      const newEndMs = new Date(input.endAt).getTime();

      if (maxAdvanceHours !== undefined && newStartMs > nowMs + maxAdvanceHours * 60 * 60 * 1000) {
        available = false;
        const val = maxAdvanceValue ?? (maxAdvanceUnit === "DAYS" ? maxAdvanceHours / 24 : maxAdvanceHours);
        const unitStr = (maxAdvanceUnit || "DAYS").toLowerCase();
        reason = `Rescheduling is only allowed up to ${val} ${unitStr} in advance.`;
      } else if (newStartMs < nowMs) {
        available = false;
        reason = "Cannot reschedule to a past date or time";
      } else if (isClosed) {
        available = false;
        reason = "The facility is closed on the selected date.";
      } else {
        if (!is24Hours && dayIntervals.length > 0) {
          const startTimeStr = new Intl.DateTimeFormat("en-GB", {
            timeZone: timezone,
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }).format(new Date(input.startAt));

          const endTimeStr = new Intl.DateTimeFormat("en-GB", {
            timeZone: timezone,
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }).format(new Date(input.endAt));

          const [sH, sM] = startTimeStr.split(":").map(Number);
          const startMin = (sH || 0) * 60 + (sM || 0);

          const [eH, eM] = endTimeStr.split(":").map(Number);
          const endMin = (eH || 0) * 60 + (eM || 0);

          const [oH, oM] = openTime.split(":").map(Number);
          const openMin = (oH || 0) * 60 + (oM || 0);

          const [cH, cM] = closeTime.split(":").map(Number);
          const closeMin = (cH === 0 || cH === 24 ? 24 : (cH || 0)) * 60 + (cM || 0);

          if (startMin < openMin || endMin > closeMin || startMin >= closeMin) {
            available = false;
            reason = `Selected time is outside operating hours (${openTime} - ${closeTime})`;
          }
        } else if (is24Hours && newEndMs > targetDayEndMs) {
          let nextDateStr = "";
          try {
            nextDateStr = new Intl.DateTimeFormat("en-CA", {
              timeZone: timezone,
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
            }).format(new Date(input.endAt));
          } catch {
            nextDateStr = input.endAt.split("T")[0];
          }

          const [ny, nm, nd] = nextDateStr.split("-").map(Number);
          const nextDayOfWeek = new Date(Date.UTC(ny, nm - 1, nd)).getUTCDay();

          const nextDayIntervals = (this.operatingHoursMap.get(nextDayOfWeek) ?? [])
            .filter((i) => i.isActive !== false);

          const nextDayStartMs = new Date(`${nextDateStr}T00:00:00+08:00`).getTime();
          const nextDayEndMs = new Date(`${nextDateStr}T23:59:59.999+08:00`).getTime();

          const nextDayBlocked = this.businessScheduleBlocks.some((b) => {
            const bStartMs = new Date(b.startAt).getTime();
            const bEndMs = new Date(b.endAt).getTime();
            return bStartMs < nextDayEndMs && bEndMs > nextDayStartMs && bStartMs < newEndMs;
          });

          const nextDayClosed = nextDayBlocked || (hasConfiguredOperatingHours && nextDayIntervals.length === 0);
          if (nextDayClosed) {
            available = false;
            reason = "The facility is closed during overnight hours on the following date.";
          }
        }

        if (available) {
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
    }

    // Compute slots for date
    let slots: RescheduleSlotAvailability[] | undefined;
    const duration = input.durationHours || 2;
    const durationMin = Math.round(duration * 60);

    if (targetDate) {
      if (isClosed || (targetDate && maxAllowedDate && targetDate > maxAllowedDate)) {
        slots = [];
      } else {
        const intervalMinutes = 30;
        let startMinute = 0;
        let maxStartMinute = 1440 - intervalMinutes;

        if (!is24Hours && dayIntervals.length > 0) {
          const [oH, oM] = openTime.split(":").map(Number);
          startMinute = (oH || 0) * 60 + (oM || 0);

          const [cH, cM] = closeTime.split(":").map(Number);
          const closeMin = (cH === 0 || cH === 24 ? 24 : (cH || 0)) * 60 + (cM || 0);
          maxStartMinute = closeMin - durationMin;
        }

        const generatedSlots: RescheduleSlotAvailability[] = [];

        for (let m = startMinute; m <= maxStartMinute; m += intervalMinutes) {
          const sH = Math.floor(m / 60);
          const sM = m % 60;
          const time = `${String(sH).padStart(2, "0")}:${String(sM).padStart(2, "0")}`;

          const slotStart = zonedDateTimeToUtc(targetDate, time, timezone);
          const slotEnd = new Date(slotStart.getTime() + durationMin * 60 * 1000);
          const startMs = slotStart.getTime();
          const endMs = slotEnd.getTime();

          const endMTotal = m + durationMin;
          const endH = Math.floor(endMTotal / 60);
          const endM = endMTotal % 60;
          const endTime = `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;

          let slotAvailable = true;
          let slotReason: string | undefined;

          if (startMs < nowMs) {
            slotAvailable = false;
            slotReason = "Past";
          } else if (maxAdvanceHours !== undefined && startMs > nowMs + maxAdvanceHours * 60 * 60 * 1000) {
            slotAvailable = false;
            const val = maxAdvanceValue ?? (maxAdvanceUnit === "DAYS" ? maxAdvanceHours / 24 : maxAdvanceHours);
            const unitStr = (maxAdvanceUnit || "DAYS").toLowerCase();
            slotReason = `Rescheduling is only allowed up to ${val} ${unitStr} in advance.`;
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

          generatedSlots.push({
            startTime: time,
            endTime,
            startAt: slotStart.toISOString(),
            endAt: slotEnd.toISOString(),
            isAvailable: slotAvailable,
            reason: slotReason,
          });
        }

        slots = generatedSlots;
      }
    }

    return {
      available: isClosed ? false : available,
      reason: isClosed ? (reason || "The facility is closed on the selected date.") : reason,
      workspaceInstanceId: targetInstanceId,
      workspaceDisplayName: targetInstanceId,
      slots,
      openTime: isClosed ? undefined : openTime,
      closeTime: isClosed ? undefined : closeTime,
      is24Hours,
      isClosed,
      maxAdvanceValue,
      maxAdvanceUnit,
      maxAdvanceHours,
      maxAllowedDate,
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

  seedOperatingHours(dayOfWeek: number, intervals: Array<{ opensAt: string; closesAt: string; isActive?: boolean }>) {
    this.operatingHoursMap.set(dayOfWeek, intervals);
  }

  seedBusinessScheduleBlocks(blocks: Array<{ startAt: string; endAt: string; blockType?: string; scope?: string; reason?: string }>) {
    this.businessScheduleBlocks = blocks;
  }

  async checkExtendAvailability(input: {
    reservationId: string;
    extensionMinutes?: number;
  }): Promise<ExtendAvailabilityResult> {
    const r = this.reservations.find(
      (entry) => entry.id === input.reservationId || entry.referenceCode.toLowerCase() === input.reservationId.toLowerCase()
    );

    if (!r) {
      throw new Error(`Reservation not found: ${input.reservationId}`);
    }

    if (r.status === "CANCELLED" || r.status === "EXPIRED" || (r.status as string) === "REJECTED") {
      return {
        canExtend: false,
        reservationId: r.id,
        referenceCode: r.referenceCode,
        currentEndAt: r.updatedAt,
        maxExtensionMinutes: 0,
        hourlyRate: 0,
        additionalFee: 0,
        reason: `Cannot extend a ${r.status.toLowerCase()} reservation`,
      };
    }

    const assigned = r.candidates?.find((c) => c.isAssigned) ?? r.candidates?.[0];
    if (!assigned || !assigned.workspaceInstanceId) {
      return {
        canExtend: false,
        reservationId: r.id,
        referenceCode: r.referenceCode,
        currentEndAt: this.nowProvider().toISOString(),
        maxExtensionMinutes: 0,
        hourlyRate: 0,
        additionalFee: 0,
        reason: "No assigned workspace spot found for this reservation",
      };
    }

    const targetInstanceId = assigned.workspaceInstanceId;
    const currentEndIso = assigned.endAt;
    const currentEndMs = new Date(currentEndIso).getTime();
    const hourlyRate = Number(r.rateSnapshot || 150);
    const workspaceDisplayName = assigned.workspaceDisplayName || assigned.workspaceInstanceCode || "Workspace Spot";
    const templateName = assigned.workspaceTemplateName || undefined;

    const upcomingCandidates: Array<{
      reservationId: string;
      referenceCode: string;
      customerName: string;
      startAt: string;
      endAt: string;
    }> = [];

    for (const other of this.reservations) {
      if (other.id === r.id || other.status === "CANCELLED" || other.status === "EXPIRED" || (other.status as string) === "REJECTED") {
        continue;
      }
      for (const otherCand of other.candidates ?? []) {
        if (!otherCand.isAssigned || otherCand.workspaceInstanceId !== targetInstanceId) {
          continue;
        }
        const candEndMs = new Date(otherCand.endAt).getTime();
        if (candEndMs > currentEndMs) {
          upcomingCandidates.push({
            reservationId: other.id,
            referenceCode: other.referenceCode,
            customerName: `${other.customerFirstName} ${other.customerLastName}`.trim(),
            startAt: otherCand.startAt,
            endAt: otherCand.endAt,
          });
        }
      }
    }

    upcomingCandidates.sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
    const nextCand = upcomingCandidates[0] ?? null;
    let minutesUntilNextBooking: number | null = null;
    let nextBooking: ExtendAvailabilityNextBooking | null = null;

    const formatTimeInTz = (iso: string) => {
      try {
        return new Intl.DateTimeFormat("en-US", {
          timeZone: "Asia/Manila",
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        }).format(new Date(iso));
      } catch {
        return iso;
      }
    };

    if (nextCand) {
      const nextStartMs = new Date(nextCand.startAt).getTime();
      minutesUntilNextBooking = Math.max(0, Math.floor((nextStartMs - currentEndMs) / (60 * 1000)));
      nextBooking = {
        reservationId: nextCand.reservationId,
        referenceCode: nextCand.referenceCode,
        customerName: nextCand.customerName,
        startAt: nextCand.startAt,
        startTimeFormatted: formatTimeInTz(nextCand.startAt),
      };
    }

    const timezone = "Asia/Manila";
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(currentEndIso));
    const v = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    const dateStr = `${v.year}-${v.month}-${v.day}`;
    const dayOfWeek = new Date(currentEndIso).getDay();

    const dayIntervals = (this.operatingHoursMap.get(dayOfWeek) ?? [])
      .filter((i) => i.isActive !== false)
      .sort((a, b) => a.opensAt.localeCompare(b.opensAt));

    let operatingHoursCloseAt: string | null = null;
    let minutesUntilClosing: number | null = null;

    if (dayIntervals.length > 0) {
      const lastInterval = dayIntervals[dayIntervals.length - 1];
      const closeUtc = zonedDateTimeToUtc(dateStr, lastInterval.closesAt, timezone);
      operatingHoursCloseAt = closeUtc.toISOString();
      const diffCloseMs = closeUtc.getTime() - currentEndMs;
      minutesUntilClosing = Math.max(0, Math.floor(diffCloseMs / (60 * 1000)));
    }

    let maxExtensionMinutes = 24 * 60;
    if (minutesUntilClosing !== null) {
      maxExtensionMinutes = Math.min(maxExtensionMinutes, minutesUntilClosing);
    }
    if (minutesUntilNextBooking !== null) {
      maxExtensionMinutes = Math.min(maxExtensionMinutes, minutesUntilNextBooking);
    }
    maxExtensionMinutes = Math.max(0, maxExtensionMinutes);

    const extensionMinutes = input.extensionMinutes ?? 60;
    const additionalFee = Math.round(((extensionMinutes / 60) * hourlyRate) * 100) / 100;
    const proposedEndMs = currentEndMs + extensionMinutes * 60 * 1000;
    const proposedEndAt = new Date(proposedEndMs).toISOString();

    let canExtend = true;
    let reason: string | undefined;

    if (maxExtensionMinutes <= 0) {
      canExtend = false;
      if (nextBooking) {
        reason = `Spot is reserved starting at ${nextBooking.startTimeFormatted || nextBooking.startAt}. No further extension is possible.`;
      } else if (minutesUntilClosing !== null && minutesUntilClosing <= 0) {
        reason = "Venue is at or past operating closing time.";
      } else {
        reason = "No extension available for this slot.";
      }
    } else if (input.extensionMinutes !== undefined && input.extensionMinutes > maxExtensionMinutes) {
      canExtend = false;
      const extStr = extensionMinutes >= 60 ? `${extensionMinutes / 60} hour(s)` : `${extensionMinutes} mins`;
      if (minutesUntilNextBooking !== null && maxExtensionMinutes === minutesUntilNextBooking) {
        const who = nextBooking?.customerName || nextBooking?.referenceCode || "another booking";
        reason = `Cannot extend by ${extStr}: Desk is reserved by ${who} starting at ${nextBooking?.startTimeFormatted || nextBooking?.startAt}. Maximum extension possible: ${maxExtensionMinutes} minutes.`;
      } else if (minutesUntilClosing !== null && maxExtensionMinutes === minutesUntilClosing) {
        const closeFormatted = operatingHoursCloseAt ? formatTimeInTz(operatingHoursCloseAt) : "closing time";
        reason = `Cannot extend by ${extStr}: Venue closes at ${closeFormatted}. Maximum extension possible: ${maxExtensionMinutes} minutes.`;
      } else {
        reason = `Cannot extend by ${extStr}. Maximum extension possible: ${maxExtensionMinutes} minutes.`;
      }
    }

    return {
      canExtend,
      reservationId: r.id,
      referenceCode: r.referenceCode,
      currentEndAt: currentEndIso,
      proposedEndAt,
      extensionMinutes,
      maxExtensionMinutes,
      hourlyRate,
      additionalFee,
      nextBooking,
      closingTime: operatingHoursCloseAt,
      reason,
      workspaceDisplayName,
      templateName,
    };
  }

  async extendReservation(input: ExtendReservationInput): Promise<ExtendReservationResult> {
    const availability = await this.checkExtendAvailability({
      reservationId: input.reservationId,
      extensionMinutes: input.extensionMinutes,
    });

    if (!availability.canExtend) {
      throw new Error(availability.reason || `Cannot extend reservation by ${input.extensionMinutes} minutes`);
    }

    const r = this.reservations.find(
      (entry) => entry.id === input.reservationId || entry.referenceCode.toLowerCase() === input.reservationId.toLowerCase()
    );
    if (!r) {
      throw new Error(`Reservation not found: ${input.reservationId}`);
    }

    const assigned = r.candidates?.find((c) => c.isAssigned) ?? r.candidates?.[0];
    if (!assigned) {
      throw new Error("Assigned reservation candidate not found");
    }

    const previousEndAt = assigned.endAt;
    const newEndAt = availability.proposedEndAt!;
    const nowIso = this.nowProvider().toISOString();
    const additionalFee = input.additionalFee ?? availability.additionalFee;
    const paymentMethod = input.paymentMethod ?? "CASH";

    assigned.endAt = newEndAt;
    r.amountDue = Number(r.amountDue || 0) + additionalFee;
    r.updatedAt = nowIso;

    if (!(r as any).extensionEvents) {
      (r as any).extensionEvents = [];
    }
    (r as any).extensionEvents.push({
      occurredAt: nowIso,
      actorRole: input.actorRole ?? "ADMIN",
      addedMinutes: input.extensionMinutes,
      newEndTime: newEndAt,
      fee: additionalFee,
    });

    this.operationalAuditEvents.push({
      reservationId: r.id,
      referenceCode: r.referenceCode,
      customerName: `${r.customerFirstName} ${r.customerLastName}`.trim(),
      workspaceDisplayName: assigned.workspaceDisplayName || null,
      workspaceInstanceCode: assigned.workspaceInstanceCode || null,
      activityType: "CHECK_IN",
      occurredAt: nowIso,
      actorUserId: input.actorUserId ?? null,
      actorRole: (input.actorRole ?? "ADMIN") as any,
    });

    const detail = await this.getAdminReservationDetail(r.id);
    if (!detail) {
      throw new Error("Failed to retrieve updated reservation detail");
    }

    return {
      success: true,
      reservation: detail,
      previousEndAt,
      newEndAt,
      addedDurationMinutes: input.extensionMinutes,
      additionalFee,
      paymentMethod,
      message: "Reservation time extended successfully",
    };
  }

  async listAvailableRelocationSpots(input: ListAvailableRelocationSpotsInput): Promise<AvailableRelocationSpot[]> {
    const r = this.reservations.find(
      (entry) => entry.id === input.reservationId || entry.referenceCode.toLowerCase() === input.reservationId.toLowerCase()
    );
    if (!r) {
      return [];
    }

    if (r.status !== "CONFIRMED" && r.status !== "CHECKED_IN") {
      return [];
    }

    const assigned = (r.candidates ?? []).find((c) => c.isAssigned) ?? (r.candidates ?? [])[0];
    if (!assigned) {
      return [];
    }

    const nowMs = input.evaluationTime
      ? new Date(input.evaluationTime).getTime()
      : this.nowProvider().getTime();
    const startMs = new Date(assigned.startAt).getTime();
    const endMs = new Date(assigned.endAt).getTime();

    if (!isNaN(endMs) && endMs <= nowMs) {
      return [];
    }

    const isInSession =
      (r.status === "CONFIRMED" || r.status === "CHECKED_IN") &&
      nowMs >= startMs &&
      nowMs < endMs;
    const effectiveStartMs = isInSession ? Math.max(nowMs, startMs) : startMs;

    if (!this.workspaceRepository) {
      return [];
    }

    const catalog = await this.workspaceRepository.listCatalog();
    const currentInstance = catalog.instances.find((i) => i.id === assigned.workspaceInstanceId);
    if (!currentInstance) {
      return [];
    }

    const targetTemplateId = currentInstance.templateId;
    const template = catalog.templates.find((t) => t.id === targetTemplateId);
    const mapPlacedIds = this.workspaceRepository?.getMapPlacedInstanceIds
      ? await this.workspaceRepository.getMapPlacedInstanceIds()
      : null;

    const siblingInstances = catalog.instances.filter(
      (i) =>
        i.templateId === targetTemplateId &&
        i.id !== currentInstance.id &&
        !(i as any).isArchived &&
        (mapPlacedIds ? mapPlacedIds.has(i.id) : true)
    );

    const spots: AvailableRelocationSpot[] = [];

    for (const inst of siblingInstances) {
      const floor = catalog.floors.find((f) => f.id === inst.floorId);
      let isAvailable = true;
      let reason: string | undefined;

      const opStatus = (inst.operationalStatus || (inst as any).status || "ACTIVE").toUpperCase();
      if (opStatus === "MAINTENANCE") {
        isAvailable = false;
        reason = "Under Maintenance";
      } else if (opStatus === "INACTIVE") {
        isAvailable = false;
        reason = "Inactive";
      } else {
        // Check overlapping active reservations
        for (const other of this.reservations) {
          if (other.id === r.id || other.status === "CANCELLED" || other.status === "EXPIRED" || (other.status as string) === "REJECTED") {
            continue;
          }
          if (other.status !== "CONFIRMED" && other.status !== "CHECKED_IN") {
            continue;
          }
          for (const otherCand of other.candidates ?? []) {
            if (!otherCand.isAssigned || otherCand.workspaceInstanceId !== inst.id) {
              continue;
            }
            const otherStartMs = new Date(otherCand.startAt).getTime();
            const otherEndMs = new Date(otherCand.endAt).getTime();
            if (effectiveStartMs < otherEndMs && endMs > otherStartMs) {
              isAvailable = false;
              reason = "Already booked for this time window";
              break;
            }
          }
          if (!isAvailable) break;
        }
      }

      if (isAvailable) {
        spots.push({
          id: inst.id,
          instanceCode: inst.instanceCode || inst.displayName,
          displayName: inst.displayName,
          templateId: inst.templateId,
          templateName: template?.name || "Workspace",
          floorId: inst.floorId,
          floorName: floor?.name || "Floor",
          isAvailable: true,
        });
      }
    }

    return spots;
  }

  async relocateReservation(input: RelocateReservationInput): Promise<{
    success: boolean;
    reservation: AdminReservationDetail;
    message?: string;
    oldWorkspaceDisplayName?: string;
    newWorkspaceDisplayName?: string;
    previousSpotName?: string;
    newSpotName?: string;
  }> {
    const r = this.reservations.find(
      (entry) => entry.id === input.reservationId || entry.referenceCode.toLowerCase() === input.reservationId.toLowerCase()
    );

    if (!r) {
      throw new Error(`Reservation not found: ${input.reservationId}`);
    }

    if (r.status !== "CONFIRMED" && r.status !== "CHECKED_IN") {
      throw new Error(`Only confirmed or checked-in reservations can be relocated (current status: ${r.status})`);
    }

    const assigned = (r.candidates ?? []).find((c) => c.isAssigned) ?? (r.candidates ?? [])[0];
    if (!assigned) {
      throw new Error("No assigned workspace spot found for this reservation");
    }

    const nowMs = input.evaluationTime
      ? new Date(input.evaluationTime).getTime()
      : this.nowProvider().getTime();
    const startMs = new Date(assigned.startAt).getTime();
    const endMs = new Date(assigned.endAt).getTime();

    if (!isNaN(endMs) && endMs <= nowMs) {
      throw new Error(`Relocation not allowed: reservation has already ended or expired (current status: ${r.status === "CHECKED_IN" ? "COMPLETED" : "EXPIRED"})`);
    }

    const oldInstanceId = assigned.workspaceInstanceId;
    if (oldInstanceId === input.targetWorkspaceInstanceId) {
      throw new Error("Target spot must be different from current spot");
    }

    let oldWorkspaceDisplayName = oldInstanceId;
    let newWorkspaceDisplayName = input.targetWorkspaceInstanceId;

    if (this.workspaceRepository) {
      const catalog = await this.workspaceRepository.listCatalog();
      const currentInst = catalog.instances.find((i) => i.id === oldInstanceId);
      const targetInst = catalog.instances.find((i) => i.id === input.targetWorkspaceInstanceId);

      if (!targetInst) {
        throw new Error("Target workspace spot not found");
      }

      if (currentInst) {
        oldWorkspaceDisplayName = currentInst.displayName;
        if (targetInst.templateId !== currentInst.templateId) {
          throw new Error("Relocation is only allowed to spots of the exact same workspace template (tier)");
        }
      }
      newWorkspaceDisplayName = targetInst.displayName;

      const opStatus = (targetInst.operationalStatus || (targetInst as any).status || "ACTIVE").toUpperCase();
      if (opStatus === "MAINTENANCE" || opStatus === "INACTIVE") {
        throw new Error(`Cannot relocate to a spot that is ${opStatus.toLowerCase()}`);
      }

      if (this.workspaceRepository.getMapPlacedInstanceIds) {
        const mapPlacedIds = await this.workspaceRepository.getMapPlacedInstanceIds();
        if (mapPlacedIds && !mapPlacedIds.has(targetInst.id)) {
          throw new Error("Cannot relocate to a workspace spot that is not on the published map");
        }
      }
    }

    const isInSession =
      (r.status === "CONFIRMED" || r.status === "CHECKED_IN") &&
      nowMs >= startMs &&
      nowMs < endMs;
    const effectiveStartMs = isInSession ? Math.max(nowMs, startMs) : startMs;

    // Overlap conflict check
    for (const other of this.reservations) {
      if (other.id === r.id || other.status === "CANCELLED" || other.status === "EXPIRED" || (other.status as string) === "REJECTED") {
        continue;
      }
      if (other.status !== "CONFIRMED" && other.status !== "CHECKED_IN") {
        continue;
      }
      for (const otherCand of other.candidates ?? []) {
        if (!otherCand.isAssigned || otherCand.workspaceInstanceId !== input.targetWorkspaceInstanceId) {
          continue;
        }
        const otherStartMs = new Date(otherCand.startAt).getTime();
        const otherEndMs = new Date(otherCand.endAt).getTime();
        if (effectiveStartMs < otherEndMs && endMs > otherStartMs) {
          throw new Error("Target workspace spot is already booked for this time window");
        }
      }
    }

    const remainingMinutes = isInSession
      ? Math.max(0, Math.round((endMs - effectiveStartMs) / 60000))
      : undefined;

    const nowIso = this.nowProvider().toISOString();
    assigned.workspaceInstanceId = input.targetWorkspaceInstanceId;
    assigned.workspaceDisplayName = newWorkspaceDisplayName;
    assigned.isAssigned = true;
    r.updatedAt = nowIso;

    if (!(r as any).relocations) {
      (r as any).relocations = [];
    }
    (r as any).relocations.push({
      oldWorkspaceInstanceId: oldInstanceId,
      newWorkspaceInstanceId: input.targetWorkspaceInstanceId,
      oldWorkspaceDisplayName,
      newWorkspaceDisplayName,
      reason: input.reason,
      notes: input.notes,
      relocatedAt: nowIso,
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      inSession: isInSession,
      remainingMinutes,
    });

    const normalizedActorRole =
      input.actorRole === "STAFF"
        ? "STAFF"
        : input.actorRole === "CUSTOMER"
        ? "CUSTOMER"
        : input.actorRole === "SUPERADMIN" || input.actorRole === "SUPER_ADMIN"
        ? "SUPERADMIN"
        : "ADMIN";

    this.recordOperationalAudit({
      reservation: r,
      action: "RESERVATION_RELOCATED" as any,
      actedAt: nowIso,
      actorRole: normalizedActorRole as any,
      actorUserId: input.actorUserId ?? (input.actorRole === "CUSTOMER" ? "customer" : "admin"),
      reentry: false,
    });

    const detail = await this.getAdminReservationDetail(r.id);
    if (!detail) {
      throw new Error("Failed to retrieve updated reservation detail");
    }

    return {
      success: true,
      reservation: detail,
      oldWorkspaceDisplayName,
      newWorkspaceDisplayName,
      previousSpotName: oldWorkspaceDisplayName,
      newSpotName: newWorkspaceDisplayName,
      message: "Reservation relocated successfully",
    };
  }

  async requestCustomerRelocation(input: RequestCustomerRelocationInput): Promise<CustomerRelocationRequest> {
    const r = this.reservations.find(
      (entry) => entry.id === input.reservationId || entry.referenceCode.toLowerCase() === input.reservationId.toLowerCase()
    );
    if (!r) {
      throw new Error(`Reservation not found: ${input.reservationId}`);
    }
    if (r.status !== "CONFIRMED" && r.status !== "CHECKED_IN") {
      throw new Error(`Only confirmed or checked-in reservations can request relocation (current status: ${r.status})`);
    }
    const assigned = (r.candidates ?? []).find((c) => c.isAssigned) ?? (r.candidates ?? [])[0];
    if (!assigned) {
      throw new Error("No assigned workspace spot found for this reservation");
    }
    const endMs = assigned.endAt ? new Date(assigned.endAt).getTime() : NaN;
    const nowMs = this.nowProvider().getTime();
    if (!isNaN(endMs) && endMs <= nowMs) {
      throw new Error("Cannot request relocation: reservation has already ended or expired.");
    }
    if (assigned.workspaceInstanceId === input.targetWorkspaceInstanceId) {
      throw new Error("Target spot must be different from current spot");
    }

    let targetWorkspaceDisplayName = input.targetWorkspaceInstanceId;
    if (this.workspaceRepository) {
      const catalog = await this.workspaceRepository.listCatalog();
      const currentInst = catalog.instances.find((i) => i.id === assigned.workspaceInstanceId);
      const targetInst = catalog.instances.find((i) => i.id === input.targetWorkspaceInstanceId);
      if (!targetInst) {
        throw new Error("Target workspace spot not found");
      }
      if (currentInst && targetInst.templateId !== currentInst.templateId) {
        throw new Error("Relocation is only allowed to spots of the exact same workspace template (tier)");
      }
      targetWorkspaceDisplayName = targetInst.displayName;
    }

    const req: CustomerRelocationRequest = {
      requestId: `req-${Date.now()}`,
      targetWorkspaceInstanceId: input.targetWorkspaceInstanceId,
      targetWorkspaceDisplayName,
      reason: input.reason,
      notes: input.notes ?? null,
      requestedAt: this.nowProvider().toISOString(),
      status: "PENDING",
    };

    (r as any).pendingRelocationRequest = req;
    return req;
  }

  async decideCustomerRelocation(input: DecideCustomerRelocationInput): Promise<{
    success: boolean;
    decision: "APPROVE" | "DECLINE";
    reservation: AdminReservationDetail;
    message?: string;
  }> {
    const r = this.reservations.find(
      (entry) => entry.id === input.reservationId || entry.referenceCode.toLowerCase() === input.reservationId.toLowerCase()
    );
    if (!r) {
      throw new Error(`Reservation not found: ${input.reservationId}`);
    }
    const pending = (r as any).pendingRelocationRequest as CustomerRelocationRequest | undefined;
    if (!pending || pending.status !== "PENDING") {
      throw new Error("No pending relocation request found for this reservation");
    }

    const nowIso = this.nowProvider().toISOString();
    if (input.decision === "APPROVE") {
      pending.status = "APPROVED";
      pending.decisionNotes = input.notes ?? null;
      pending.decisionBy = input.actorUserId ?? null;
      pending.decisionRole = input.actorRole;
      pending.decisionAt = nowIso;

      const relocRes = await this.relocateReservation({
        reservationId: r.id,
        targetWorkspaceInstanceId: pending.targetWorkspaceInstanceId,
        reason: pending.reason,
        notes: pending.notes ?? undefined,
        actorUserId: input.actorUserId ?? undefined,
        actorRole: input.actorRole,
      });

      (r as any).pendingRelocationRequest = null;
      return {
        success: true,
        decision: "APPROVE",
        reservation: relocRes.reservation,
        message: "Customer relocation request approved and completed successfully",
      };
    } else {
      pending.status = "DECLINED";
      pending.decisionNotes = input.notes ?? null;
      pending.decisionBy = input.actorUserId ?? null;
      pending.decisionRole = input.actorRole;
      pending.decisionAt = nowIso;

      (r as any).pendingRelocationRequest = null;
      (r as any).declinedRelocationRequest = pending;

      const detail = await this.getAdminReservationDetail(r.id);
      if (!detail) {
        throw new Error("Failed to load reservation detail");
      }
      return {
        success: true,
        decision: "DECLINE",
        reservation: detail,
        message: "Customer relocation request was declined",
      };
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
