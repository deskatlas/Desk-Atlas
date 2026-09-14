import {
  GuestReservationTrackingResult,
  GuestReservationTrackingStatus,
} from "../models/reservation";
import {
  GuestReservationTrackingRecord,
  GuestReservationTrackingRepository,
} from "./guestReservationTrackingRepository";

export class GuestReservationTrackingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuestReservationTrackingError";
  }
}

export class GuestReservationTrackingService {
  constructor(
    private readonly trackingRepository: GuestReservationTrackingRepository
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
  trackingRepository: GuestReservationTrackingRepository
) {
  return new GuestReservationTrackingService(trackingRepository);
}
