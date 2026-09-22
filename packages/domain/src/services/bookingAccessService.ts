import { createHash, randomBytes } from "crypto";
import {
  BookingAccessIssueResult,
  BookingAccessState,
  BookingCheckInState,
  BookingScanResult,
} from "../models/reservation";
import { BookingAccessRepository } from "./bookingAccessRepository";

export class BookingAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BookingAccessError";
  }
}

export class BookingAccessService {
  constructor(
    private readonly bookingAccessRepository: BookingAccessRepository,
    private readonly nowProvider: () => Date = () => new Date()
  ) {}

  async issueBookingAccess(
    reservationId: string,
    referenceCode: string,
    accessUrlBase: string
  ): Promise<BookingAccessIssueResult | null> {
    if (!reservationId || reservationId.trim() === "") {
      throw new BookingAccessError("Reservation ID is required.");
    }

    if (!referenceCode || referenceCode.trim() === "") {
      throw new BookingAccessError("Reservation reference code is required.");
    }

    if (!accessUrlBase || accessUrlBase.trim() === "") {
      throw new BookingAccessError("Booking access URL base is required.");
    }

    const issuedAt = this.nowProvider().toISOString();
    const token = createOpaqueBookingToken();
    const tokenHash = hashBookingToken(token);
    const created = await this.bookingAccessRepository.issueBookingAccessToken({
      reservationId,
      tokenHash,
      token,
      issuedAt,
    });

    if (!created) {
      return null;
    }

    const normalizedBaseUrl = accessUrlBase.replace(/\/$/, "");
    return {
      reservationId,
      referenceCode,
      token,
      accessUrl: `${normalizedBaseUrl}/${encodeURIComponent(token)}`,
      issuedAt,
    };
  }

  async getBookingAccess(token: string): Promise<BookingScanResult> {
    const normalizedToken = token.trim();
    if (!normalizedToken) {
      throw new BookingAccessError("Booking token or reference code is required.");
    }

    const now = this.nowProvider();
    const tokenHash = hashBookingToken(normalizedToken);
    let record = await this.bookingAccessRepository.findBookingAccessByTokenHash(tokenHash);

    if (!record && this.bookingAccessRepository.findBookingAccessByReferenceOrId) {
      record = await this.bookingAccessRepository.findBookingAccessByReferenceOrId(normalizedToken);
    }

    if (!record) {
      throw new BookingAccessError("Invalid booking token or reference code.");
    }

    const accessState = getBookingAccessState(record, now);
    const checkInState = getBookingCheckInState(record.checkedInAt, record.checkedOutAt);
    const endAt = new Date(record.assignedEndAt);
    const timeRemainingSeconds =
      accessState === "ACTIVE"
        ? Math.max(0, Math.floor((endAt.getTime() - now.getTime()) / 1000))
        : 0;

    const isReentry = accessState === "ACTIVE" && checkInState === "CHECKED_IN";

    return {
      reservationId: record.reservationId,
      referenceCode: record.referenceCode,
      reservationStatus: record.reservationStatus,
      accessState,
      checkInState,
      customerName: `${record.customerFirstName} ${record.customerLastName}`.trim(),
      customerEmail: record.customerEmail,
      workspaceInstanceId: record.assignedWorkspaceInstanceId,
      workspaceDisplayName: record.assignedWorkspaceDisplayName,
      workspaceInstanceCode: record.assignedWorkspaceInstanceCode,
      workspaceTemplateName: record.assignedWorkspaceTemplateName,
      floorName: record.assignedFloorName,
      bookingStartAt: record.assignedStartAt,
      bookingEndAt: record.assignedEndAt,
      checkedInAt: record.checkedInAt,
      checkedOutAt: record.checkedOutAt,
      qrIssuedAt: record.qrIssuedAt,
      timeRemainingSeconds,
      reentry: isReentry,
    };
  }

  async resolveBookingAccess(
    token: string,
    actor?: {
      userId?: string | null;
      role?: "ADMIN" | "STAFF" | "SYSTEM" | null;
    },
    options?: {
      autoCheckIn?: boolean;
      recordScan?: boolean;
    }
  ): Promise<BookingScanResult> {
    const normalizedToken = token.trim();
    if (!normalizedToken) {
      throw new BookingAccessError("Booking token or reference code is required.");
    }

    const now = this.nowProvider();
    const nowIso = now.toISOString();
    const tokenHash = hashBookingToken(normalizedToken);
    let record = await this.bookingAccessRepository.findBookingAccessByTokenHash(tokenHash);

    if (!record && this.bookingAccessRepository.findBookingAccessByReferenceOrId) {
      record = await this.bookingAccessRepository.findBookingAccessByReferenceOrId(normalizedToken);
    }

    if (!record) {
      throw new BookingAccessError("Invalid booking token or reference code.");
    }

    const accessState = getBookingAccessState(record, now);
    const initialCheckInState = getBookingCheckInState(record.checkedInAt, record.checkedOutAt);
    const endAt = new Date(record.assignedEndAt);
    const timeRemainingSeconds =
      accessState === "ACTIVE"
        ? Math.max(0, Math.floor((endAt.getTime() - now.getTime()) / 1000))
        : 0;

    const autoCheckIn = options?.autoCheckIn ?? true;
    const shouldRecordScan = options?.recordScan ?? true;

    // MF-80: If the QR is not checked in yet but is on time within their scheduled time,
    // the first scan should check them in, not re-enter.
    const isInitialCheckIn =
      autoCheckIn &&
      accessState === "ACTIVE" &&
      !record.checkedInAt &&
      record.reservationStatus === "CONFIRMED";

    // MF-178: Kiosk walk-in reservations are auto-checked in during counter payment confirmation.
    // Initial token issuance, verification, or first physical scan after counter confirmation
    // must NOT produce a spurious REENTRY (re-checkin) audit log.
    const isAutoCheckedInKiosk =
      record.source === "KIOSK" ||
      Boolean(
        record.confirmedAt &&
        record.checkedInAt &&
        Math.abs(new Date(record.checkedInAt).getTime() - new Date(record.confirmedAt).getTime()) <= 5000
      );

    const isInitialKioskAccess = isAutoCheckedInKiosk && !record.hasPreviousScan;

    const isReentry =
      accessState === "ACTIVE" &&
      Boolean(record.checkedInAt || record.reservationStatus === "CHECKED_IN") &&
      !isInitialCheckIn &&
      !isInitialKioskAccess;

    if (shouldRecordScan) {
      await this.bookingAccessRepository.recordBookingScan({
        reservationId: record.reservationId,
        scannedAt: nowIso,
        accessState,
        actorUserId: actor?.userId ?? null,
        actorRole: actor?.role ?? null,
        reentry: isReentry,
        checkIn: isInitialCheckIn,
      });
    }

    const finalReservationStatus = isInitialCheckIn ? "CHECKED_IN" : record.reservationStatus;
    const finalCheckedInAt = isInitialCheckIn ? nowIso : record.checkedInAt;
    const finalCheckInState = getBookingCheckInState(finalCheckedInAt, record.checkedOutAt);

    return {
      reservationId: record.reservationId,
      referenceCode: record.referenceCode,
      reservationStatus: finalReservationStatus,
      accessState,
      checkInState: finalCheckInState,
      customerName: `${record.customerFirstName} ${record.customerLastName}`.trim(),
      customerEmail: record.customerEmail,
      workspaceInstanceId: record.assignedWorkspaceInstanceId,
      workspaceDisplayName: record.assignedWorkspaceDisplayName,
      workspaceInstanceCode: record.assignedWorkspaceInstanceCode,
      workspaceTemplateName: record.assignedWorkspaceTemplateName,
      floorName: record.assignedFloorName,
      bookingStartAt: record.assignedStartAt,
      bookingEndAt: record.assignedEndAt,
      checkedInAt: finalCheckedInAt,
      checkedOutAt: record.checkedOutAt,
      qrIssuedAt: record.qrIssuedAt,
      timeRemainingSeconds,
      reentry: isReentry,
    };
  }
}

function getBookingAccessState(
  record: {
    reservationStatus: string;
    qrRevokedAt: string | null;
    assignedStartAt: string;
    assignedEndAt: string;
    checkedInAt?: string | null;
  },
  now: Date
): BookingAccessState {
  if (
    record.qrRevokedAt ||
    record.reservationStatus === "CANCELLED" ||
    record.reservationStatus === "REJECTED"
  ) {
    return "INVALID";
  }

  const startAt = new Date(record.assignedStartAt);
  const endAt = new Date(record.assignedEndAt);

  if (now > endAt || record.reservationStatus === "COMPLETED") {
    return "EXPIRED";
  }

  // If already checked in (e.g. automatic kiosk check-in), access is ACTIVE immediately
  if (record.reservationStatus === "CHECKED_IN" || Boolean(record.checkedInAt)) {
    return "ACTIVE";
  }

  if (record.reservationStatus !== "CONFIRMED") {
    return "INVALID";
  }

  if (now < startAt) {
    return "NOT_ACTIVE";
  }

  return "ACTIVE";
}

function getBookingCheckInState(
  checkedInAt: string | null,
  checkedOutAt: string | null
): BookingCheckInState {
  if (checkedOutAt) {
    return "CHECKED_OUT";
  }

  if (checkedInAt) {
    return "CHECKED_IN";
  }

  return "NOT_CHECKED_IN";
}

export function createOpaqueBookingToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashBookingToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function extractBookingToken(input: string): string {
  const trimmed = (input || "").trim();
  if (!trimmed) return "";

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.token) return extractBookingToken(String(parsed.token));
      if (parsed.accessUrl) return extractBookingToken(String(parsed.accessUrl));
      if (parsed.url) return extractBookingToken(String(parsed.url));
      if (parsed.bookingToken) return extractBookingToken(String(parsed.bookingToken));
      if (parsed.referenceCode) return extractBookingToken(String(parsed.referenceCode));
      if (parsed.code) return extractBookingToken(String(parsed.code));
      if (parsed.id) return extractBookingToken(String(parsed.id));
    } catch {
      // ignore
    }
  }

  try {
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      const url = new URL(trimmed);
      const queryParam =
        url.searchParams.get("code") ||
        url.searchParams.get("reference") ||
        url.searchParams.get("referenceCode") ||
        url.searchParams.get("id");
      if (queryParam) {
        return queryParam.trim();
      }
      const segments = url.pathname.split("/").filter(Boolean);
      return segments[segments.length - 1] || "";
    }
  } catch {
    // Fall back to path split if URL parsing fails
  }

  const segments = trimmed.split("/").filter(Boolean);
  return segments[segments.length - 1] || trimmed;
}

export function createBookingAccessService(
  bookingAccessRepository: BookingAccessRepository,
  nowProvider?: () => Date
) {
  return new BookingAccessService(bookingAccessRepository, nowProvider);
}

