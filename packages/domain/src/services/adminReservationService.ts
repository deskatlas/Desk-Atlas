import {
  AdminReservationCandidateSummary,
  AdminReservationDetail,
  AdminReservationFilter,
  AdminReservationSummary,
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
} from "./transactionalEmailService";

export class AdminReservationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminReservationError";
  }
}

export class AdminReservationService {
  private readonly emailService: TransactionalEmailService;

  constructor(
    private readonly repository: AdminReservationRepository,
    private readonly nowProvider: () => Date = () => new Date(),
    emailService?: TransactionalEmailService
  ) {
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
    if (!input.reason || input.reason.trim() === "") {
      throw new AdminReservationError("Cancellation reason is required.");
    }

    const result = await this.repository.cancelReservation({
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
  }): Promise<{ success: boolean; reservation: AdminReservationDetail; message?: string }> {
    if (!input.reservationId || input.reservationId.trim() === "") {
      throw new AdminReservationError("Reservation ID is required.");
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
