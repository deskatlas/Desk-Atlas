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

    if (
      record.reservationStatus === "CONFIRMED" &&
      rescheduleCount === 0 &&
      record.finalAssignment?.bookingStartAt
    ) {
      const startMs = new Date(record.finalAssignment.bookingStartAt).getTime();
      const cutoffMs = cutoffHours * 60 * 60 * 1000;
      if (nowMs <= startMs - cutoffMs) {
        canReschedule = true;
      }
    }

    return {
      reservationId: record.reservationId,
      referenceCode: record.referenceCode,
      status: mapGuestTrackingStatus(record),
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
    };
  }
}

function mapGuestTrackingStatus(
  record: GuestReservationTrackingRecord
): GuestReservationTrackingStatus {
  if (record.paymentStatus === "REJECTED" || record.reservationStatus === "REJECTED") {
    return "REJECTED";
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
