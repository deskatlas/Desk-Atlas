import {
  GuestReservationTrackingResult,
  GuestReservationTrackingStatus,
} from "../models/reservation";
import {
  GuestReservationTrackingRecord,
  GuestReservationTrackingRepository,
} from "./guestReservationTrackingRepository";
import type { SettingsRepository } from "./settingsRepository";

export class GuestReservationTrackingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuestReservationTrackingError";
  }
}

export class GuestReservationTrackingService {
  constructor(
    private readonly trackingRepository: GuestReservationTrackingRepository,
    private readonly settingsRepository?: SettingsRepository,
    private readonly nowProvider: () => Date = () => new Date()
  ) {}

  async getReservationTracking(input: {
    referenceCode: string;
    customerEmail?: string;
  }): Promise<GuestReservationTrackingResult> {
    const referenceCode = input.referenceCode?.trim().toUpperCase() ?? "";
    const customerEmail = input.customerEmail?.trim().toLowerCase() || undefined;

    if (!referenceCode) {
      throw new GuestReservationTrackingError("Reservation reference code is required.");
    }

    if (customerEmail) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(customerEmail)) {
        throw new GuestReservationTrackingError("Invalid email format.");
      }
    }

    const record = await this.trackingRepository.findGuestReservationTrackingRecord({
      referenceCode,
      customerEmail,
    });

    if (!record) {
      throw new GuestReservationTrackingError(
        "Reservation tracking details were not found."
      );
    }

    let cutoffHours = 12;
    if (this.settingsRepository) {
      try {
        const settings = await this.settingsRepository.getBusinessSettings();
        if (settings.customerRescheduleCutoffHours !== undefined && settings.customerRescheduleCutoffHours !== null) {
          cutoffHours = settings.customerRescheduleCutoffHours;
        }
      } catch {
        cutoffHours = 12;
      }
    }

    const rescheduleCount = record.rescheduleCount ?? 0;
    const nowMs = this.nowProvider().getTime();
    let canReschedule = false;

    const status = mapGuestTrackingStatus(record, nowMs);

    if (
      status === "CONFIRMED" &&
      rescheduleCount === 0 &&
      record.finalAssignment?.bookingStartAt
    ) {
      const startMs = new Date(record.finalAssignment.bookingStartAt).getTime();
      const cutoffMs = cutoffHours * 60 * 60 * 1000;
      if (nowMs <= startMs - cutoffMs) {
        canReschedule = true;
      }
    }

    const bookingStartMs = record.finalAssignment?.bookingStartAt
      ? new Date(record.finalAssignment.bookingStartAt).getTime()
      : 0;
    const bookingEndMs = record.finalAssignment?.bookingEndAt
      ? new Date(record.finalAssignment.bookingEndAt).getTime()
      : 0;

    const isInSession =
      status === "CONFIRMED" &&
      bookingStartMs > 0 &&
      bookingEndMs > 0 &&
      nowMs >= bookingStartMs &&
      nowMs < bookingEndMs;

    const remainingMinutes = isInSession ? Math.max(0, Math.round((bookingEndMs - nowMs) / 60000)) : 0;
    const canRelocate = isInSession;

    return {
      reservationId: record.reservationId,
      referenceCode: record.referenceCode,
      status,
      amountDue: record.amountDue,
      currency: record.currency,
      confirmedAt: record.confirmedAt,
      completedAt: record.checkedOutAt,
      finalAssignment: record.finalAssignment,
      paymentStatus: record.paymentStatus ?? null,
      rejectionReason: record.rejectionReason ?? null,
      rescheduleCount,
      canReschedule,
      rescheduleCutoffHours: cutoffHours,
      isInSession,
      canRelocate,
      remainingMinutes,
      pendingRelocationRequest: record.pendingRelocationRequest ?? null,
    };
  }
}

function mapGuestTrackingStatus(
  record: GuestReservationTrackingRecord,
  nowMs?: number
): GuestReservationTrackingStatus {
  if (record.paymentStatus === "REJECTED" || record.reservationStatus === "REJECTED") {
    return "REJECTED";
  }

  if (record.reservationStatus === "EXPIRED") {
    return "EXPIRED";
  }
  if (record.reservationStatus === "CANCELLED") {
    return "CANCELLED";
  }
  if (record.reservationStatus === "COMPLETED") {
    return "COMPLETED";
  }

  if (nowMs !== undefined && record.finalAssignment?.bookingEndAt) {
    const bookingEndMs = new Date(record.finalAssignment.bookingEndAt).getTime();
    if (!isNaN(bookingEndMs) && bookingEndMs > 0 && nowMs >= bookingEndMs) {
      return "EXPIRED";
    }
  }

  switch (record.reservationStatus) {
    case "PENDING_PAYMENT":
      return "PENDING_PAYMENT";
    case "PAYMENT_UNDER_REVIEW":
    case "PENDING_COUNTER_CONFIRMATION":
      return "PAYMENT_UNDER_REVIEW";
    case "CONFIRMED":
    case "CHECKED_IN":
      return "CONFIRMED";
    case "NEEDS_MANUAL_RESOLUTION":
      return "NEEDS_MANUAL_RESOLUTION";
    case "CANCELLED":
      return "CANCELLED";
    case "EXPIRED":
      return "EXPIRED";
    case "COMPLETED":
      return "COMPLETED";
    case "REJECTED":
      return "REJECTED";
    default:
      throw new GuestReservationTrackingError("Unsupported reservation tracking status.");
  }
}

export function createGuestReservationTrackingService(
  trackingRepository: GuestReservationTrackingRepository,
  settingsRepository?: SettingsRepository,
  nowProvider?: () => Date
) {
  return new GuestReservationTrackingService(trackingRepository, settingsRepository, nowProvider);
}
