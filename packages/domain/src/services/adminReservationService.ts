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
import { AdminReservationRepository } from "./adminReservationRepository";
import { filterReservationsBySearch } from "./reservationSearch";

export class AdminReservationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminReservationError";
  }
}

export class AdminReservationService {
  constructor(
    private readonly repository: AdminReservationRepository,
    private readonly nowProvider: () => Date = () => new Date()
  ) {}

  async listReservations(
    filter: AdminReservationFilter = "active",
    search?: string
  ): Promise<{ reservations: AdminReservationSummary[]; total: number }> {
    const list = await this.repository.listAdminReservations();
    const now = this.nowProvider();
    const nowMs = now.getTime();

    const isAwaitingProofExpired = (r: AdminReservationSummary): boolean => {
      if (r.reservationStatus === "EXPIRED") {
        return true;
      }
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
      if (isAwaitingProofExpired(r)) {
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
      filtered = filtered.filter((r) => r.reservationStatus !== "EXPIRED" && r.reservationStatus !== "CANCELLED");
    } else if (filter === "expired") {
      filtered = filtered.filter((r) => r.reservationStatus === "EXPIRED");
    } else if (filter === "checked_in") {
      filtered = filtered.filter(
        (r) => r.reservationStatus === "CHECKED_IN" || (r.checkedInAt !== null && r.checkedOutAt === null)
      );
    } else if (filter === "upcoming") {
      filtered = filtered.filter((r) => {
        if (r.reservationStatus === "EXPIRED" || r.reservationStatus === "CANCELLED") {
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
      filtered = filtered.filter((r) =>
        ["PENDING_PAYMENT", "PAYMENT_UNDER_REVIEW", "PENDING_COUNTER_CONFIRMATION"].includes(
          r.reservationStatus
        ) && r.reservationStatus !== "EXPIRED"
      );
    }
    // "all": retains all items in mappedList (both active and expired)

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

    if (detail.reservationStatus === "PENDING_PAYMENT") {
      let isExpired = false;
      let expIso = detail.updatedAt;
      if (detail.paymentExpiresAt) {
        const expMs = new Date(detail.paymentExpiresAt).getTime();
        if (!isNaN(expMs) && expMs <= nowMs) {
          isExpired = true;
          expIso = detail.paymentExpiresAt;
        }
      } else if (detail.createdAt) {
        const createdMs = new Date(detail.createdAt).getTime();
        if (!isNaN(createdMs) && createdMs + 60 * 60 * 1000 <= nowMs) {
          isExpired = true;
          expIso = new Date(createdMs + 60 * 60 * 1000).toISOString();
        }
      }

      if (isExpired) {
        const pres = mapStatusPresentation("EXPIRED");
        const timeline = [...detail.timeline];
        if (!timeline.some((t) => t.toLowerCase().includes("expired"))) {
          timeline.push(`${formatTimelineDate(expIso)} - Payment session expired`);
        }
        return {
          ...detail,
          reservationStatus: "EXPIRED",
          status: pres.label,
          statusStyle: pres.style,
          mark: pres.mark,
          paymentStatus: `${pres.payment} (${formatAmountWithCurrency(detail.amountDue, detail.currency)})`,
          paymentColor: pres.paymentColor,
          expiryReason: detail.expiryReason ?? "1-hour payment window expired without payment proof submission",
          timeline,
        };
      }
    }

    return detail;
  }
}

export function createAdminReservationService(
  repository: AdminReservationRepository,
  nowProvider?: () => Date
): AdminReservationService {
  return new AdminReservationService(repository, nowProvider);
}

// Utility formatting helpers for repository implementations
export function mapStatusPresentation(status: ReservationStatus) {
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

export function formatSchedule(startAt?: string | null, endAt?: string | null): string {
  if (!startAt || !endAt) {
    return "Schedule not set";
  }

  try {
    const startDate = new Date(startAt);
    const endDate = new Date(endAt);

    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const month = monthNames[startDate.getUTCMonth()];
    const day = startDate.getUTCDate();

    const startH = String(startDate.getUTCHours()).padStart(2, "0");
    const startM = String(startDate.getUTCMinutes()).padStart(2, "0");
    const endH = String(endDate.getUTCHours()).padStart(2, "0");
    const endM = String(endDate.getUTCMinutes()).padStart(2, "0");

    return `${month} ${day}, ${startH}:${startM} - ${endH}:${endM}`;
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

export function formatTimelineDate(isoString: string): string {
  try {
    const d = new Date(isoString);
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const month = monthNames[d.getUTCMonth()];
    const day = d.getUTCDate();
    const h = String(d.getUTCHours()).padStart(2, "0");
    const m = String(d.getUTCMinutes()).padStart(2, "0");
    return `${month} ${day}, ${h}:${m}`;
  } catch {
    return isoString;
  }
}
