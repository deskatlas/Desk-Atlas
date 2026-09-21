import {
  AdminReservationDetail,
  AdminReservationPaymentAttemptSummary,
  OperationalActivityRecord,
  OperationalActivityType,
  OccupancyRecord,
  ReservationOperationalActionRequest,
  ReservationOperationalActionResult,
  StaffOperationalReservation,
} from "../models/reservation";
import { StaffOperationsRepository } from "./staffOperationsRepository";
import { filterReservationsBySearch } from "./reservationSearch";
import {
  TransactionalEmailService,
  createTransactionalEmailService,
  buildReservationTrackingUrl,
  formatDurationFromDates,
} from "./transactionalEmailService";

export class StaffOperationsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StaffOperationsError";
  }
}

export class StaffOperationsConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StaffOperationsConflictError";
  }
}

export class StaffOperationsService {
  private readonly emailService: TransactionalEmailService;

  constructor(
    private readonly staffOperationsRepository: StaffOperationsRepository,
    private readonly nowProvider: () => Date = () => new Date(),
    emailService?: TransactionalEmailService
  ) {
    this.emailService = emailService ?? createTransactionalEmailService();
  }

  async listOperationalReservations(search?: string): Promise<StaffOperationalReservation[]> {
    const nowMs = this.nowProvider().getTime();
    const list = await this.staffOperationsRepository.listOperationalReservations(
      this.nowProvider().toISOString()
    );
    const mapped = list.map((res) => applyStaffOperationalDerivation(res, nowMs));
    if (search && search.trim() !== "") {
      return filterReservationsBySearch(mapped, search);
    }
    return mapped;
  }

  async getOperationalReservation(
    idOrReferenceCode: string
  ): Promise<StaffOperationalReservation | null> {
    if (!idOrReferenceCode || idOrReferenceCode.trim() === "") {
      throw new StaffOperationsError("Reservation ID is required.");
    }

    const res = await this.staffOperationsRepository.getOperationalReservation(
      idOrReferenceCode.trim()
    );
    if (!res) {
      return null;
    }
    return applyStaffOperationalDerivation(res, this.nowProvider().getTime());
  }

  async getReservationDetail(
    idOrReferenceCode: string,
    _actorRole: string = "STAFF"
  ): Promise<AdminReservationDetail | null> {
    if (!idOrReferenceCode || idOrReferenceCode.trim() === "") {
      throw new StaffOperationsError("Reservation ID is required.");
    }
    if (this.staffOperationsRepository.getAdminReservationDetail) {
      return this.staffOperationsRepository.getAdminReservationDetail(idOrReferenceCode.trim());
    }
    return null;
  }

  async getReservationTimeline(
    reservationId: string,
    actorRole: string = "STAFF"
  ): Promise<string[]> {
    if (!reservationId || reservationId.trim() === "") {
      throw new StaffOperationsError("Reservation ID is required.");
    }
    const detail = await this.getReservationDetail(reservationId, actorRole);
    if (!detail) {
      throw new StaffOperationsError("Reservation not found.");
    }
    return detail.timeline || [];
  }

  async getPaymentHistory(
    reservationId: string,
    actorRole: string = "STAFF"
  ): Promise<AdminReservationPaymentAttemptSummary[]> {
    if (!reservationId || reservationId.trim() === "") {
      throw new StaffOperationsError("Reservation ID is required.");
    }
    const detail = await this.getReservationDetail(reservationId, actorRole);
    if (!detail) {
      throw new StaffOperationsError("Reservation not found.");
    }
    return detail.paymentAttempts || [];
  }

  async getBookingQrToken(
    reservationId: string,
    actorRole: string = "STAFF"
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
    if (!reservationId || reservationId.trim() === "") {
      throw new StaffOperationsError("Reservation ID is required.");
    }
    const detail = await this.getReservationDetail(reservationId, actorRole);
    if (!detail) {
      throw new StaffOperationsError("Reservation not found.");
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

  async listOccupancy(): Promise<OccupancyRecord[]> {
    return this.staffOperationsRepository.listOccupancy(this.nowProvider().toISOString());
  }

  async listOperationalActivity(
    limit = 20,
    filter?: { activityType?: OperationalActivityType }
  ): Promise<OperationalActivityRecord[]> {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new StaffOperationsError("Activity limit must be a positive integer.");
    }

    const records = await this.staffOperationsRepository.listOperationalActivity(limit);
    if (filter?.activityType) {
      return records.filter((r) => r.activityType === filter.activityType);
    }
    return records;
  }

  async checkInReservation(
    request: ReservationOperationalActionRequest
  ): Promise<ReservationOperationalActionResult> {
    const actor = validateActor(request);
    return this.staffOperationsRepository.checkInReservation({
      reservationId: request.reservationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      actedAt: this.nowProvider().toISOString(),
    });
  }

  async checkOutReservation(
    request: ReservationOperationalActionRequest
  ): Promise<ReservationOperationalActionResult> {
    const actor = validateActor(request);
    return this.staffOperationsRepository.checkOutReservation({
      reservationId: request.reservationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      actedAt: this.nowProvider().toISOString(),
    });
  }

  async checkExtendAvailability(input: {
    reservationId: string;
    extensionMinutes?: number;
  }) {
    if (this.staffOperationsRepository.checkExtendAvailability) {
      return this.staffOperationsRepository.checkExtendAvailability(input);
    }
    throw new StaffOperationsError("Extension check not supported");
  }

  async extendReservation(input: {
    reservationId: string;
    extensionMinutes: number;
    additionalFee?: number;
    paymentMethod?: string;
    actorUserId?: string;
    actorRole?: "ADMIN" | "STAFF" | "SUPERADMIN" | "SUPER_ADMIN" | string;
  }) {
    if (!input.reservationId || input.reservationId.trim() === "") {
      throw new StaffOperationsError("Reservation ID is required.");
    }
    if (!input.extensionMinutes || input.extensionMinutes <= 0) {
      throw new StaffOperationsError("Extension duration in minutes must be greater than 0.");
    }
    if (this.staffOperationsRepository.extendReservation) {
      const result = await this.staffOperationsRepository.extendReservation({
        ...input,
        actorRole: input.actorRole ?? "STAFF",
      });

      if (result?.reservation?.customerEmail) {
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
          console.warn("[StaffOperationsService] Failed to send extended email:", emailErr?.message);
        }
      }

      return result;
    }
    throw new StaffOperationsError("Extension not supported by repository");
  }

  async listAvailableRelocationSpots(reservationId: string) {
    if (!reservationId || reservationId.trim() === "") {
      return [];
    }
    const res = await this.getOperationalReservation(reservationId.trim());
    if (!res) {
      return [];
    }
    if (!["CONFIRMED", "CHECKED_IN"].includes(res.reservationStatus)) {
      return [];
    }
    if (this.staffOperationsRepository.listAvailableRelocationSpots) {
      return this.staffOperationsRepository.listAvailableRelocationSpots({
        reservationId: reservationId.trim(),
      });
    }
    return [];
  }

  async relocateReservation(input: {
    reservationId: string;
    targetWorkspaceInstanceId: string;
    reason: string;
    notes?: string;
    actorUserId?: string;
    actorRole?: "ADMIN" | "STAFF" | "SUPERADMIN" | "SUPER_ADMIN" | string;
  }) {
    if (!input.reservationId || input.reservationId.trim() === "") {
      throw new StaffOperationsError("Reservation ID is required.");
    }
    if (!input.targetWorkspaceInstanceId || input.targetWorkspaceInstanceId.trim() === "") {
      throw new StaffOperationsError("Target workspace instance ID is required.");
    }
    if (!input.reason || input.reason.trim() === "") {
      throw new StaffOperationsError("Relocation reason is required.");
    }

    const res = await this.getOperationalReservation(input.reservationId.trim());
    if (!res) {
      throw new StaffOperationsError(`Reservation not found: ${input.reservationId}`);
    }
    if (!["CONFIRMED", "CHECKED_IN"].includes(res.reservationStatus)) {
      throw new StaffOperationsError(
        `Relocation not allowed: Only confirmed or checked-in reservations can be relocated (reservation is in ${res.reservationStatus} status).`
      );
    }

    if (!this.staffOperationsRepository.relocateReservation) {
      throw new StaffOperationsError("Relocation is not supported by repository");
    }

    const result = await this.staffOperationsRepository.relocateReservation({
      reservationId: input.reservationId.trim(),
      targetWorkspaceInstanceId: input.targetWorkspaceInstanceId.trim(),
      reason: input.reason.trim(),
      notes: input.notes?.trim(),
      actorUserId: input.actorUserId,
      actorRole: input.actorRole ?? "STAFF",
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
        console.warn("[StaffOperationsService] Failed to send relocated email:", emailErr?.message);
      }
    }

    return {
      ...result,
      previousSpotName,
      newSpotName,
    };
  }

  async decideCustomerRelocation(input: {
    reservationId: string;
    decision: "APPROVE" | "DECLINE";
    notes?: string;
    actorUserId?: string;
    actorRole?: "STAFF" | "ADMIN" | "SUPERADMIN";
  }): Promise<any> {
    if (!input.reservationId || input.reservationId.trim() === "") {
      throw new StaffOperationsError("Reservation ID is required.");
    }
    if (!this.staffOperationsRepository.decideCustomerRelocation) {
      throw new StaffOperationsError("Deciding relocation is not supported by repository.");
    }

    const result = await this.staffOperationsRepository.decideCustomerRelocation({
      reservationId: input.reservationId.trim(),
      decision: input.decision,
      notes: input.notes?.trim(),
      actorUserId: input.actorUserId,
      actorRole: input.actorRole ?? "STAFF",
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
        console.warn("[StaffOperationsService] Failed to send relocated email on approval:", emailErr?.message);
      }
    }

    return result;
  }
}


function validateActor(request: ReservationOperationalActionRequest) {
  if (!request.reservationId || request.reservationId.trim() === "") {
    throw new StaffOperationsError("Reservation ID is required.");
  }

  if (!request.actor?.userId || request.actor.userId.trim() === "") {
    throw new StaffOperationsError("Actor user ID is required.");
  }

  const normalizedRole = String(request.actor.role || "").toUpperCase();
  if (
    normalizedRole !== "ADMIN" &&
    normalizedRole !== "STAFF" &&
    normalizedRole !== "SUPERADMIN" &&
    normalizedRole !== "SUPER_ADMIN"
  ) {
    throw new StaffOperationsConflictError(
      "Only SUPERADMIN, ADMIN, or STAFF may perform reservation operational actions."
    );
  }

  return {
    ...request.actor,
    role: normalizedRole as "ADMIN" | "STAFF",
  };
}

export function applyStaffOperationalDerivation(
  res: StaffOperationalReservation,
  nowMs: number
): StaffOperationalReservation {
  const isPaymentRejected =
    res.paymentAttemptStatus === "REJECTED" ||
    res.status === "Rejected" ||
    res.reservationStatus === "REJECTED" ||
    (res.paymentStatus && res.paymentStatus.toLowerCase().includes("rejected")) ||
    (res.paymentAttempts && res.paymentAttempts.some((a) => a.status === "REJECTED")) ||
    (res.reservationStatus === "CANCELLED" && res.paymentAttemptStatus === "REJECTED");

  if (isPaymentRejected) {
    return {
      ...res,
      reservationStatus: "REJECTED",
      status: "Rejected",
    };
  }

  // Check if awaiting proof payment window expired (1 hour window)
  let isAwaitingProofExpired = false;
  if (res.reservationStatus === "PENDING_PAYMENT") {
    if (res.paymentExpiresAt) {
      const expMs = new Date(res.paymentExpiresAt).getTime();
      if (!isNaN(expMs) && expMs <= nowMs) {
        isAwaitingProofExpired = true;
      }
    } else if (res.createdAt) {
      const createdMs = new Date(res.createdAt).getTime();
      if (!isNaN(createdMs) && createdMs + 60 * 60 * 1000 <= nowMs) {
        isAwaitingProofExpired = true;
      }
    }
  }

  if (isAwaitingProofExpired) {
    return {
      ...res,
      reservationStatus: "EXPIRED",
      status: "Expired",
    };
  }

  const endMs = res.bookingEndAt ? new Date(res.bookingEndAt).getTime() : NaN;
  const isTimeEnded = !isNaN(endMs) && endMs <= nowMs;

  if (isTimeEnded && res.reservationStatus !== "CANCELLED" && res.reservationStatus !== "REJECTED") {
    if (res.checkedInAt) {
      return {
        ...res,
        reservationStatus: "COMPLETED",
        checkInState: "CHECKED_OUT",
        checkedOutAt: res.checkedOutAt ?? res.bookingEndAt ?? new Date(nowMs).toISOString(),
      };
    }
    // Any reservation whose booking end time elapsed without check-in is expired (CONFIRMED, NEEDS_MANUAL_RESOLUTION, PENDING_PAYMENT, PAYMENT_UNDER_REVIEW, PENDING_COUNTER_CONFIRMATION)
    if (res.reservationStatus !== "COMPLETED") {
      return {
        ...res,
        reservationStatus: "EXPIRED",
        status: "Expired",
      };
    }
  }

  return res;
}

export function createStaffOperationsService(
  staffOperationsRepository: StaffOperationsRepository,
  nowProvider?: () => Date,
  emailService?: TransactionalEmailService
) {
  return new StaffOperationsService(staffOperationsRepository, nowProvider, emailService);
}
