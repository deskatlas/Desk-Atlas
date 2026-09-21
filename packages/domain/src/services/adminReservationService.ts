import {
  AdminReservationCandidateSummary,
  AdminReservationDetail,
  AdminReservationFilter,
  AdminReservationSummary,
  CustomerRelocationRequest,
  CandidateRank,
  ReservationCandidate,
  ReservationResponseDTO,
  ReservationStatus,
} from "../models/reservation";
import {
  AdminReservationRepository,
  CancelReservationInput,
  RescheduleReservationInput,
  CheckRescheduleAvailabilityInput,
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
} from "./adminReservationRepository";
import { filterReservationsBySearch } from "./reservationSearch";
import {
  AdminReservationAdvancedFilters,
  filterReservations,
} from "./reservationFilters";
import {
  TransactionalEmailService,
  createTransactionalEmailService,
  buildReservationTrackingUrl,
  formatDurationFromDates,
} from "./transactionalEmailService";

export class AdminReservationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminReservationError";
  }
}

export class AdminReservationService {
  private readonly emailService: TransactionalEmailService;
  private readonly nowProvider: () => Date;

  constructor(
    private readonly repository: AdminReservationRepository,
    nowProvider?: () => Date,
    emailService?: TransactionalEmailService
  ) {
    this.nowProvider =
      nowProvider ??
      (typeof (repository as any)?.nowProvider === "function"
        ? () => (repository as any).nowProvider()
        : () => new Date());
    this.emailService = emailService ?? createTransactionalEmailService();
  }

  async listReservations(
    filter: AdminReservationFilter = "active",
    search?: string,
    advancedFilters?: AdminReservationAdvancedFilters
  ): Promise<{ reservations: AdminReservationSummary[]; total: number }> {

    const list = await this.repository.listAdminReservations();
    const now = this.nowProvider();
    const nowMs = now.getTime();

    const isReservationExpired = (r: AdminReservationSummary): boolean => {
      if (r.reservationStatus === "EXPIRED") {
        return true;
      }
      if (
        r.reservationStatus === "CANCELLED" ||
        r.paymentAttemptStatus === "REJECTED" ||
        r.status.toLowerCase() === "rejected"
      ) {
        return false;
      }

      // Check if booking end time has elapsed (e.g. autocheckout upon end time)
      if (r.endAt) {
        const endMs = new Date(r.endAt).getTime();
        if (!isNaN(endMs) && endMs <= nowMs) {
          return true;
        }
      }

      // Check if awaiting proof payment window expired
      if (r.reservationStatus === "PENDING_PAYMENT") {
        if (r.paymentExpiresAt) {
          const expMs = new Date(r.paymentExpiresAt).getTime();
          if (!isNaN(expMs) && expMs <= nowMs) {
            return true;
          }
        } else if (r.createdAt) {
          const createdMs = new Date(r.createdAt).getTime();
          if (!isNaN(createdMs) && createdMs + 60 * 60 * 1000 <= nowMs) {
            return true;
          }
        }
      }
      return false;
    };

    const mappedList = list.map((r) => {
      if (
        r.paymentAttemptStatus === "REJECTED" ||
        (r.reservationStatus === "CANCELLED" && r.paymentAttemptStatus === "REJECTED")
      ) {
        const pres = mapStatusPresentation(r.reservationStatus, "REJECTED");
        return {
          ...r,
          status: pres.label,
          statusStyle: pres.style,
          mark: pres.mark,
          paymentStatus: pres.payment,
          paymentColor: pres.paymentColor,
        };
      }
      if (isReservationExpired(r)) {
        const pres = mapStatusPresentation("EXPIRED");
        return {
          ...r,
          reservationStatus: "EXPIRED" as ReservationStatus,
          status: pres.label,
          statusStyle: pres.style,
          mark: pres.mark,
          paymentStatus: pres.payment,
          paymentColor: pres.paymentColor,
        };
      }
      return r;
    });

    let filtered = mappedList;

    if (filter === "active") {
      filtered = filtered.filter(
        (r) =>
          r.reservationStatus !== "EXPIRED" &&
          r.reservationStatus !== "CANCELLED" &&
          r.reservationStatus !== "COMPLETED" &&
          r.status.toLowerCase() !== "rejected"
      );
    } else if (filter === "expired") {
      filtered = filtered.filter((r) => r.reservationStatus === "EXPIRED");
    } else if (filter === "checked_in") {
      filtered = filtered.filter(
        (r) =>
          r.reservationStatus !== "EXPIRED" &&
          (r.reservationStatus === "CHECKED_IN" || (r.checkedInAt !== null && r.checkedOutAt === null))
      );
    } else if (filter === "upcoming") {
      filtered = filtered.filter((r) => {
        if (
          r.reservationStatus === "EXPIRED" ||
          r.reservationStatus === "CANCELLED" ||
          r.status.toLowerCase() === "rejected"
        ) {
          return false;
        }
        if (r.reservationStatus === "CONFIRMED" || r.reservationStatus === "CHECKED_IN") {
          return true;
        }
        if (r.startAt && new Date(r.startAt).getTime() >= nowMs) {
          return true;
        }
        return false;
      });
    } else if (filter === "awaiting_proof") {
      filtered = filtered.filter(
        (r) =>
          ["PENDING_PAYMENT", "PAYMENT_UNDER_REVIEW", "PENDING_COUNTER_CONFIRMATION"].includes(
            r.reservationStatus
          ) &&
          r.reservationStatus !== "EXPIRED" &&
          r.status.toLowerCase() !== "rejected"
      );
    } else if (filter === "rejected") {
      filtered = filtered.filter(
        (r) =>
          r.status.toLowerCase() === "rejected" ||
          r.paymentStatus.toLowerCase().includes("rejected") ||
          (r.paymentAttemptStatus ?? "").toLowerCase() === "rejected"
      );
    } else if (filter === "counter_queue") {
      filtered = filtered.filter(
        (r) =>
          r.reservationStatus === "PENDING_COUNTER_CONFIRMATION" &&
          r.status.toLowerCase() !== "rejected"
      );
    }
    // "all": retains all items in mappedList (both active and expired)

    if (advancedFilters) {
      filtered = filterReservations(filtered, advancedFilters, now);
    }

    if (search && search.trim() !== "") {
      filtered = filterReservationsBySearch(filtered, search);
    }

    return {
      reservations: filtered,
      total: filtered.length,
    };
  }

  async getReservationDetail(idOrReferenceCode: string): Promise<AdminReservationDetail | null> {
    if (!idOrReferenceCode || idOrReferenceCode.trim() === "") {
      return null;
    }
    const detail = await this.repository.getAdminReservationDetail(idOrReferenceCode.trim());
    if (!detail) {
      return null;
    }

    const now = this.nowProvider();
    const nowMs = now.getTime();

    const isPaymentRejected =
      detail.paymentAttemptStatus === "REJECTED" ||
      detail.status === "Rejected" ||
      (detail.reservationStatus === "CANCELLED" &&
        (detail.paymentAttempts?.some((a) => a.status === "REJECTED") ||
          detail.paymentAttemptStatus === "REJECTED"));

    if (isPaymentRejected) {
      const pres = mapStatusPresentation(detail.reservationStatus, "REJECTED");
      return {
        ...detail,
        status: pres.label,
        statusStyle: pres.style,
        mark: pres.mark,
        paymentStatus: `${pres.payment} (${formatAmountWithCurrency(detail.amountDue, detail.currency)})`,
        paymentColor: pres.paymentColor,
      };
    }

    const effectiveEndAt =
      detail.endAt ??
      detail.assignedCandidate?.endAt ??
      detail.candidates?.find((c) => c.isAssigned)?.endAt ??
      detail.candidates?.find((c) => c.rank === 0)?.endAt ??
      detail.candidates?.[0]?.endAt ??
      null;

    const isEndTimeExpired = Boolean(
      effectiveEndAt &&
      !isNaN(new Date(effectiveEndAt).getTime()) &&
      new Date(effectiveEndAt).getTime() <= nowMs &&
      detail.reservationStatus !== "CANCELLED"
    );

    let isAwaitingProofExpired = false;
    let expIso = detail.updatedAt;
    if (detail.reservationStatus === "PENDING_PAYMENT") {
      if (detail.paymentExpiresAt) {
        const expMs = new Date(detail.paymentExpiresAt).getTime();
        if (!isNaN(expMs) && expMs <= nowMs) {
          isAwaitingProofExpired = true;
          expIso = detail.paymentExpiresAt;
        }
      } else if (detail.createdAt) {
        const createdMs = new Date(detail.createdAt).getTime();
        if (!isNaN(createdMs) && createdMs + 60 * 60 * 1000 <= nowMs) {
          isAwaitingProofExpired = true;
          expIso = new Date(createdMs + 60 * 60 * 1000).toISOString();
        }
      }
    }

    if (isEndTimeExpired || isAwaitingProofExpired) {
      const pres = mapStatusPresentation("EXPIRED");
      const timeline = [...detail.timeline];
      const expiryReason = isEndTimeExpired
        ? (detail.expiryReason ?? "Booking period ended")
        : (detail.expiryReason ?? "1-hour payment window expired without payment proof submission");

      const timelineMsg = isEndTimeExpired
        ? `${formatTimelineDate(effectiveEndAt!)} - Booking period ended (Expired)`
        : `${formatTimelineDate(expIso)} - Payment session expired`;

      if (!timeline.some((t) => t.toLowerCase().includes("expired") || t.toLowerCase().includes("booking period ended"))) {
        timeline.push(timelineMsg);
      }

      return {
        ...detail,
        reservationStatus: "EXPIRED",
        status: pres.label,
        statusStyle: pres.style,
        mark: pres.mark,
        paymentStatus: `${pres.payment} (${formatAmountWithCurrency(detail.amountDue, detail.currency)})`,
        paymentColor: pres.paymentColor,
        expiryReason,
        timeline,
      };
    }

    return detail;
  }

  async getReservationTimeline(idOrReferenceCode: string, _actorRole?: string): Promise<string[]> {
    const detail = await this.getReservationDetail(idOrReferenceCode);
    if (!detail) {
      throw new AdminReservationError("Reservation not found.");
    }
    return detail.timeline || [];
  }

  async getPaymentHistory(
    idOrReferenceCode: string,
    _actorRole?: string
  ): Promise<AdminReservationCandidateSummary[] | any[]> {
    const detail = await this.getReservationDetail(idOrReferenceCode);
    if (!detail) {
      throw new AdminReservationError("Reservation not found.");
    }
    return detail.paymentAttempts || [];
  }

  async getBookingQrToken(
    idOrReferenceCode: string,
    _actorRole?: string
  ): Promise<{
    bookingToken: string | null;
    bookingAccessUrl: string | null;
    hasBookingQr: boolean;
    qrIssuedAt: string | null;
    qrRevokedAt: string | null;
    referenceCode: string;
    customerName: string;
    schedule: string;
    duration: string;
    reservationStatus: string;
  }> {
    const detail = await this.getReservationDetail(idOrReferenceCode);
    if (!detail) {
      throw new AdminReservationError("Reservation not found.");
    }
    return {
      bookingToken: detail.bookingToken,
      bookingAccessUrl: detail.bookingAccessUrl,
      hasBookingQr: detail.hasBookingQr,
      qrIssuedAt: detail.qrIssuedAt,
      qrRevokedAt: detail.qrRevokedAt,
      referenceCode: detail.referenceCode,
      customerName: detail.customerName,
      schedule: detail.schedule,
      duration: detail.duration,
      reservationStatus: detail.reservationStatus,
    };
  }

  async cancelReservation(input: {
    reservationId: string;
    reason: string;
    notes?: string;
    actorUserId?: string;
    actorRole?: string;
  }): Promise<{ success: boolean; reservation: AdminReservationDetail; message?: string }> {
    if (!input.reservationId || input.reservationId.trim() === "") {
      throw new AdminReservationError("Reservation ID is required.");
    }
    if (input.actorRole && input.actorRole.toUpperCase() === "STAFF") {
      throw new AdminReservationError("Staff members are not authorized to cancel reservations.");
    }
    if (!input.reason || input.reason.trim() === "") {
      throw new AdminReservationError("Cancellation reason is required.");
    }

    const result = await this.repository.cancelReservation!({
      reservationId: input.reservationId.trim(),
      reason: input.reason.trim(),
      notes: input.notes?.trim(),
      actorUserId: input.actorUserId,
      actorRole: input.actorRole ?? "ADMIN",
    });

    if (result.reservation && result.reservation.customerEmail) {
      try {
        const trackingUrl = buildReservationTrackingUrl(
          process.env.DESKATLAS_PUBLIC_APP_URL || "https://deskatlas.test",
          result.reservation.referenceCode
        );
        const effectiveCandidate = result.reservation.assignedCandidate || result.reservation.candidates[0];
        await this.emailService.sendReservationCancelledEmail({
          to: result.reservation.customerEmail,
          customerFirstName: result.reservation.customerFirstName,
          customerLastName: result.reservation.customerLastName,
          referenceCode: result.reservation.referenceCode,
          cancellationReason: input.reason.trim(),
          cancellationNotes: input.notes?.trim(),
          schedule: result.reservation.schedule,
          workspaceDisplayName: effectiveCandidate?.workspaceDisplayName || "Workspace Spot",
          trackingUrl,
        });
      } catch (emailErr: any) {
        console.warn("[AdminReservationService] Failed to send cancellation email:", emailErr?.message);
      }
    }

    return result;
  }

  async rescheduleReservation(input: {
    reservationId: string;
    startAt: string;
    endAt: string;
    workspaceInstanceId?: string;
    actorUserId?: string;
    actorRole?: string;
    cutoffHours?: number;
  }): Promise<{ success: boolean; reservation: AdminReservationDetail; message?: string }> {
    if (!input.reservationId || input.reservationId.trim() === "") {
      throw new AdminReservationError("Reservation ID is required.");
    }
    if (input.actorRole && input.actorRole.toUpperCase() === "STAFF") {
      throw new AdminReservationError("Staff members are not authorized to reschedule reservations.");
    }
    if (!input.startAt || !input.endAt) {
      throw new AdminReservationError("Start time and end time are required.");
    }
    const startMs = new Date(input.startAt).getTime();
    const endMs = new Date(input.endAt).getTime();
    if (isNaN(startMs) || isNaN(endMs) || endMs <= startMs) {
      throw new AdminReservationError("End time must be strictly after start time.");
    }

    const result = await this.repository.rescheduleReservation({
      reservationId: input.reservationId.trim(),
      startAt: input.startAt,
      endAt: input.endAt,
      workspaceInstanceId: input.workspaceInstanceId,
      actorUserId: input.actorUserId,
      actorRole: input.actorRole ?? "ADMIN",
      cutoffHours: input.cutoffHours,
    });

    if (result.reservation && result.reservation.customerEmail) {
      try {
        const trackingUrl = buildReservationTrackingUrl(
          process.env.DESKATLAS_PUBLIC_APP_URL || "https://deskatlas.test",
          result.reservation.referenceCode
        );
        const assigned = result.reservation.assignedCandidate || result.reservation.candidates[0];
        await this.emailService.sendReservationRescheduledEmail({
          to: result.reservation.customerEmail,
          customerFirstName: result.reservation.customerFirstName,
          customerLastName: result.reservation.customerLastName,
          referenceCode: result.reservation.referenceCode,
          oldSchedule: (result as any).oldSchedule || result.reservation.schedule,
          newSchedule: formatSchedule(input.startAt, input.endAt),
          workspaceDisplayName: assigned?.workspaceDisplayName || "Assigned Workspace",
          workspaceTemplateName: assigned?.workspaceTemplateName || undefined,
          floorName: assigned?.floorName || undefined,
          bookingAccessUrl: result.reservation.bookingAccessUrl || undefined,
          bookingToken: result.reservation.bookingToken || undefined,
          trackingUrl,
          actorRole: input.actorRole ?? "ADMIN",
        });
      } catch (emailErr: any) {
        console.warn("[AdminReservationService] Failed to send rescheduled email:", emailErr?.message);
      }
    }

    return result;
  }

  async checkRescheduleAvailability(
    input: CheckRescheduleAvailabilityInput
  ): Promise<RescheduleAvailabilityResult> {
    if (!this.repository.checkRescheduleAvailability) {
      return { available: true };
    }
    return this.repository.checkRescheduleAvailability(input);
  }

  async listAvailableRelocationSpots(
    reservationId: string
  ): Promise<AvailableRelocationSpot[]> {
    if (!reservationId || reservationId.trim() === "") {
      return [];
    }
    const reservation = await this.getReservationDetail(reservationId.trim());
    if (!reservation) {
      return [];
    }
    if (!["CONFIRMED", "CHECKED_IN"].includes(reservation.reservationStatus)) {
      return [];
    }
    if (!this.repository.listAvailableRelocationSpots) {
      return [];
    }
    return this.repository.listAvailableRelocationSpots({ reservationId: reservationId.trim() });
  }

  async relocateReservation(input: RelocateReservationInput): Promise<{
    success: boolean;
    reservation: AdminReservationDetail;
    message?: string;
    previousSpotName?: string;
    newSpotName?: string;
    oldWorkspaceDisplayName?: string;
    newWorkspaceDisplayName?: string;
  }> {
    if (!input.reservationId || input.reservationId.trim() === "") {
      throw new AdminReservationError("Reservation ID is required.");
    }
    if (!input.targetWorkspaceInstanceId || input.targetWorkspaceInstanceId.trim() === "") {
      throw new AdminReservationError("Target workspace instance ID is required.");
    }
    if (!input.reason || input.reason.trim() === "") {
      throw new AdminReservationError("Relocation reason is required.");
    }

    const currentReservation = await this.getReservationDetail(input.reservationId.trim());
    if (!currentReservation) {
      throw new AdminReservationError(`Reservation not found: ${input.reservationId}`);
    }
    if (!["CONFIRMED", "CHECKED_IN"].includes(currentReservation.reservationStatus)) {
      throw new AdminReservationError(
        `Relocation not allowed: Only confirmed or checked-in reservations can be relocated (reservation is in ${currentReservation.reservationStatus} status).`
      );
    }

    if (!this.repository.relocateReservation) {
      throw new AdminReservationError("Relocation is not supported by the repository.");
    }

    const result = await this.repository.relocateReservation({
      reservationId: input.reservationId.trim(),
      targetWorkspaceInstanceId: input.targetWorkspaceInstanceId.trim(),
      reason: input.reason.trim(),
      notes: input.notes?.trim(),
      actorUserId: input.actorUserId,
      actorRole: input.actorRole ?? "ADMIN",
    });

    const previousSpotName = result.previousSpotName || result.oldWorkspaceDisplayName || "Previous Spot";
    const newSpotName = result.newSpotName || result.newWorkspaceDisplayName || "New Spot";

    if (result.reservation && result.reservation.customerEmail) {
      try {
        const trackingUrl = buildReservationTrackingUrl(
          process.env.DESKATLAS_PUBLIC_APP_URL || "https://deskatlas.test",
          result.reservation.referenceCode
        );
        const assigned = result.reservation.assignedCandidate || result.reservation.candidates?.[0];
        const duration =
          (result.reservation as any).duration ||
          (assigned?.startAt && assigned?.endAt
            ? formatDurationFromDates(assigned.startAt, assigned.endAt)
            : undefined);

        await this.emailService.sendReservationRelocatedEmail({
          to: result.reservation.customerEmail,
          customerFirstName: result.reservation.customerFirstName,
          customerLastName: result.reservation.customerLastName,
          referenceCode: result.reservation.referenceCode,
          schedule: result.reservation.schedule,
          duration,
          oldWorkspaceDisplayName: previousSpotName,
          newWorkspaceDisplayName: newSpotName || assigned?.workspaceDisplayName || "New Spot",
          workspaceTemplateName: assigned?.workspaceTemplateName || undefined,
          floorName: assigned?.floorName || undefined,
          relocationReason: input.reason.trim(),
          relocationNotes: input.notes?.trim(),
          bookingAccessUrl: result.reservation.bookingAccessUrl || undefined,
          bookingToken: result.reservation.bookingToken || undefined,
          trackingUrl,
        });
      } catch (emailErr: any) {
        console.warn("[AdminReservationService] Failed to send relocated email:", emailErr?.message);
      }
    }

    return {
      ...result,
      previousSpotName,
      newSpotName,
    };
  }

  async requestCustomerRelocation(input: RequestCustomerRelocationInput): Promise<CustomerRelocationRequest> {
    if (!input.reservationId || input.reservationId.trim() === "") {
      throw new AdminReservationError("Reservation ID is required.");
    }
    if (!input.targetWorkspaceInstanceId || input.targetWorkspaceInstanceId.trim() === "") {
      throw new AdminReservationError("Target workspace instance ID is required.");
    }
    if (!input.reason || input.reason.trim() === "") {
      throw new AdminReservationError("Relocation reason is required.");
    }
    if (!this.repository.requestCustomerRelocation) {
      throw new AdminReservationError("Requesting relocation is not supported by the repository.");
    }
    return this.repository.requestCustomerRelocation({
      reservationId: input.reservationId.trim(),
      targetWorkspaceInstanceId: input.targetWorkspaceInstanceId.trim(),
      reason: input.reason.trim(),
      notes: input.notes?.trim(),
    });
  }

  async decideCustomerRelocation(input: DecideCustomerRelocationInput): Promise<{
    success: boolean;
    decision: "APPROVE" | "DECLINE";
    reservation: AdminReservationDetail;
    message?: string;
  }> {
    if (!input.reservationId || input.reservationId.trim() === "") {
      throw new AdminReservationError("Reservation ID is required.");
    }
    if (!this.repository.decideCustomerRelocation) {
      throw new AdminReservationError("Deciding relocation is not supported by the repository.");
    }

    const result = await this.repository.decideCustomerRelocation({
      reservationId: input.reservationId.trim(),
      decision: input.decision,
      notes: input.notes?.trim(),
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
    });

    if (result.decision === "APPROVE" && result.reservation && result.reservation.customerEmail) {
      try {
        const trackingUrl = buildReservationTrackingUrl(
          process.env.DESKATLAS_PUBLIC_APP_URL || "https://deskatlas.test",
          result.reservation.referenceCode
        );
        const assigned = result.reservation.assignedCandidate || result.reservation.candidates?.[0];
        const duration =
          (result.reservation as any).duration ||
          (assigned?.startAt && assigned?.endAt
            ? formatDurationFromDates(assigned.startAt, assigned.endAt)
            : undefined);

        await this.emailService.sendReservationRelocatedEmail({
          to: result.reservation.customerEmail,
          customerFirstName: result.reservation.customerFirstName,
          customerLastName: result.reservation.customerLastName,
          referenceCode: result.reservation.referenceCode,
          schedule: result.reservation.schedule,
          duration,
          oldWorkspaceDisplayName: "Previous Spot",
          newWorkspaceDisplayName: assigned?.workspaceDisplayName || "New Spot",
          workspaceTemplateName: assigned?.workspaceTemplateName || undefined,
          floorName: assigned?.floorName || undefined,
          relocationReason: "Relocation Request Approved",
          relocationNotes: input.notes?.trim(),
          bookingAccessUrl: result.reservation.bookingAccessUrl || undefined,
          bookingToken: result.reservation.bookingToken || undefined,
          trackingUrl,
        });
      } catch (emailErr: any) {
        console.warn("[AdminReservationService] Failed to send relocated email on approval:", emailErr?.message);
      }
    }

    return result;
  }

  async checkExtendAvailability(
    input: CheckExtendAvailabilityInput
  ): Promise<ExtendAvailabilityResult> {
    if (!this.repository.checkExtendAvailability) {
      return {
        canExtend: false,
        reservationId: input.reservationId,
        referenceCode: input.reservationId,
        currentEndAt: this.nowProvider().toISOString(),
        maxExtensionMinutes: 0,
        hourlyRate: 0,
        additionalFee: 0,
        reason: "Extension availability check is not supported by repository",
      };
    }
    return this.repository.checkExtendAvailability(input);
  }

  async extendReservation(input: ExtendReservationInput): Promise<ExtendReservationResult> {
    if (!input.reservationId || input.reservationId.trim() === "") {
      throw new AdminReservationError("Reservation ID is required.");
    }
    if (!input.extensionMinutes || input.extensionMinutes <= 0) {
      throw new AdminReservationError("Extension duration in minutes must be greater than 0.");
    }
    const ALLOWED_ACTOR_ROLES = ["SUPERADMIN", "SUPER_ADMIN", "ADMIN", "STAFF"];
    if (input.actorRole && !ALLOWED_ACTOR_ROLES.includes(input.actorRole.toUpperCase())) {
      throw new AdminReservationError(`Actor role '${input.actorRole}' is not authorized to extend reservations.`);
    }

    if (!this.repository.extendReservation) {
      throw new AdminReservationError("Extension is not supported by repository.");
    }

    const result = await this.repository.extendReservation({
      reservationId: input.reservationId.trim(),
      extensionMinutes: input.extensionMinutes,
      additionalFee: input.additionalFee,
      paymentMethod: input.paymentMethod,
      actorUserId: input.actorUserId,
      actorRole: input.actorRole ?? "ADMIN",
    });

    if (result.reservation && result.reservation.customerEmail) {
      try {
        const trackingUrl = buildReservationTrackingUrl(
          process.env.DESKATLAS_PUBLIC_APP_URL || "https://deskatlas.test",
          result.reservation.referenceCode
        );
        const assigned = result.reservation.assignedCandidate || result.reservation.candidates?.[0];
        await this.emailService.sendReservationExtendedEmail({
          to: result.reservation.customerEmail,
          customerFirstName: result.reservation.customerFirstName,
          customerLastName: result.reservation.customerLastName,
          referenceCode: result.reservation.referenceCode,
          previousEndAt: result.previousEndAt,
          newEndAt: result.newEndAt,
          addedDurationMinutes: result.addedDurationMinutes,
          additionalFee: result.additionalFee,
          paymentMethod: result.paymentMethod,
          workspaceDisplayName: assigned?.workspaceDisplayName || "Workspace Spot",
          workspaceTemplateName: assigned?.workspaceTemplateName || undefined,
          floorName: assigned?.floorName || undefined,
          bookingAccessUrl: result.reservation.bookingAccessUrl || undefined,
          bookingToken: result.reservation.bookingToken || undefined,
          trackingUrl,
        });
      } catch (emailErr: any) {
        console.warn("[AdminReservationService] Failed to send extended email:", emailErr?.message);
      }
    }

    return result;
  }
}

export function createAdminReservationService(
  repository: AdminReservationRepository,
  nowProvider?: () => Date,
  emailService?: TransactionalEmailService
): AdminReservationService {
  return new AdminReservationService(repository, nowProvider, emailService);
}

// Utility formatting helpers for repository implementations
export function mapStatusPresentation(
  status: ReservationStatus,
  paymentAttemptStatus?: string | null
) {
  if (
    paymentAttemptStatus === "REJECTED" ||
    (status === "CANCELLED" && paymentAttemptStatus === "REJECTED")
  ) {
    return {
      label: "Rejected",
      mark: "✕",
      style: { background: "#FEE2E2", color: "#991B1B" },
      payment: "Rejected",
      paymentColor: "var(--da-danger)",
    };
  }

  switch (status) {
    case "CHECKED_IN":
      return {
        label: "Checked In",
        mark: "✓",
        style: { background: "var(--da-info)", color: "var(--da-brand-dark)" },
        payment: "Paid",
        paymentColor: "var(--da-success)",
      };
    case "CONFIRMED":
      return {
        label: "Confirmed",
        mark: "✓",
        style: { background: "var(--da-info)", color: "var(--da-brand-dark)" },
        payment: "Paid",
        paymentColor: "var(--da-success)",
      };
    case "PAYMENT_UNDER_REVIEW":
      return {
        label: "Payment Review",
        mark: "⧖",
        style: { background: "#FFF8E8", color: "var(--da-brand-dark)" },
        payment: "Review",
        paymentColor: "var(--da-attention)",
      };
    case "PENDING_PAYMENT":
      return {
        label: "Awaiting Proof",
        mark: "!",
        style: { background: "var(--da-soft)", color: "var(--da-brand-dark)" },
        payment: "Pending",
        paymentColor: "var(--da-text-secondary)",
      };
    case "PENDING_COUNTER_CONFIRMATION":
      return {
        label: "Counter Confirmation",
        mark: "!",
        style: { background: "#FFF8E8", color: "var(--da-brand-dark)" },
        payment: "Counter",
        paymentColor: "var(--da-attention)",
      };
    case "COMPLETED":
      return {
        label: "Completed",
        mark: "✓",
        style: { background: "#E2E8F0", color: "#334155" },
        payment: "Paid",
        paymentColor: "var(--da-success)",
      };
    case "CANCELLED":
      return {
        label: "Cancelled",
        mark: "✕",
        style: { background: "#FEE2E2", color: "#991B1B" },
        payment: "Cancelled",
        paymentColor: "var(--da-danger)",
      };
    case "EXPIRED":
      return {
        label: "Expired",
        mark: "✕",
        style: { background: "#F1F5F9", color: "#64748B" },
        payment: "Expired",
        paymentColor: "var(--da-text-secondary)",
      };
    case "NEEDS_MANUAL_RESOLUTION":
      return {
        label: "Needs Manual Resolution",
        mark: "!",
        style: { background: "#FEF2F2", color: "var(--da-danger)" },
        payment: "Review",
        paymentColor: "var(--da-danger)",
      };
    default:
      return {
        label: status,
        mark: "•",
        style: { background: "var(--da-canvas)", color: "var(--da-text-primary)" },
        payment: "Pending",
        paymentColor: "var(--da-text-secondary)",
      };
  }
}

export function formatInitials(first: string, last: string): string {
  const f = (first || "").trim()[0] || "";
  const l = (last || "").trim()[0] || "";
  return `${f}${l}`.toUpperCase() || "DA";
}

export function formatSchedule(
  startAt?: string | null,
  endAt?: string | null,
  timezone: string = "Asia/Manila"
): string {
  if (!startAt || !endAt) {
    return "Schedule not set";
  }

  try {
    const startDate = new Date(startAt);
    const endDate = new Date(endAt);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return `${startAt} - ${endAt}`;
    }

    const dateStr = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      month: "short",
      day: "numeric",
    }).format(startDate);

    const startTimeStr = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(startDate);

    const endTimeStr = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(endDate);

    return `${dateStr}, ${startTimeStr} - ${endTimeStr}`;
  } catch {
    return `${startAt} - ${endAt}`;
  }
}

export function formatDuration(startAt?: string | null, endAt?: string | null): string {
  if (!startAt || !endAt) {
    return "N/A";
  }
  try {
    const start = new Date(startAt).getTime();
    const end = new Date(endAt).getTime();
    const hours = (end - start) / (1000 * 60 * 60);
    if (hours === 1) return "1 hour";
    return `${Number(hours.toFixed(1))} hours`;
  } catch {
    return "N/A";
  }
}

export function formatAmountWithCurrency(amount: number, currency: string = "PHP"): string {
  try {
    return new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `₱${amount.toLocaleString()}`;
  }
}

export function getCandidateTier(rank: CandidateRank): string {
  if (rank === 0) return "MAIN";
  if (rank === 1) return "ALTERNATIVE 1";
  return "ALTERNATIVE 2";
}

export function getCandidateColor(rank: CandidateRank): string {
  if (rank === 0) return "var(--da-brand-dark)";
  return "var(--da-text-secondary)";
}

export function formatTimelineDate(isoString: string, timezone: string = "Asia/Manila"): string {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) {
      return isoString;
    }

    const dateStr = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      month: "short",
      day: "numeric",
    }).format(d);

    const timeStr = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(d);

    return `${dateStr}, ${timeStr}`;
  } catch {
    return isoString;
  }
}
