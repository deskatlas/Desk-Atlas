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

  async resolveBookingAccess(
    token: string,
    actor?: {
      userId?: string | null;
      role?: "ADMIN" | "STAFF" | "SYSTEM" | null;
    }
  ): Promise<BookingScanResult> {
    const normalizedToken = token.trim();
    if (!normalizedToken) {
      throw new BookingAccessError("Booking token is required.");
    }

    const now = this.nowProvider();
    const nowIso = now.toISOString();
    const tokenHash = hashBookingToken(normalizedToken);
    const record = await this.bookingAccessRepository.findBookingAccessByTokenHash(tokenHash);

    if (!record) {
      throw new BookingAccessError("Invalid booking token.");
    }

    const accessState = getBookingAccessState(record, now);
    const checkInState = getBookingCheckInState(record.checkedInAt, record.checkedOutAt);
    const endAt = new Date(record.assignedEndAt);
    const timeRemainingSeconds =
      accessState === "ACTIVE"
        ? Math.max(0, Math.floor((endAt.getTime() - now.getTime()) / 1000))
        : 0;

    const isReentry = accessState === "ACTIVE" && checkInState === "CHECKED_IN";

    await this.bookingAccessRepository.recordBookingScan({
      reservationId: record.reservationId,
      scannedAt: nowIso,
      accessState,
      actorUserId: actor?.userId ?? null,
      actorRole: actor?.role ?? null,
      reentry: isReentry,
    });

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
    };
  }
}

function getBookingAccessState(
  record: {
    reservationStatus: string;
    qrRevokedAt: string | null;
    assignedStartAt: string;
    assignedEndAt: string;
  },
  now: Date
): BookingAccessState {
  if (record.qrRevokedAt || record.reservationStatus === "CANCELLED") {
    return "INVALID";
  }

  const startAt = new Date(record.assignedStartAt);
  const endAt = new Date(record.assignedEndAt);

  if (now < startAt) {
    return "NOT_ACTIVE";
  }

  if (now > endAt) {
    return "EXPIRED";
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
    } catch {
      // ignore
    }
  }

  try {
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      const url = new URL(trimmed);
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

