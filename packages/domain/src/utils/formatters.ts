import type { BookingAccessState, BookingCheckInState } from "../models/reservation";

/**
 * Converts a BookingAccessState enum into a clean, human-readable Title Case string.
 * Strips underscores and normalizes casing.
 */
export function formatBookingAccessState(state: BookingAccessState | string | null | undefined): string {
  if (!state) return "Unknown";
  const normalized = state.toUpperCase().trim();
  switch (normalized) {
    case "ACTIVE":
      return "Active";
    case "NOT_ACTIVE":
      return "Not Active";
    case "EXPIRED":
      return "Expired";
    case "INVALID":
      return "Invalid";
    default:
      return normalized
        .toLowerCase()
        .split("_")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
  }
}

/**
 * Converts a BookingCheckInState enum into a clean, human-readable Title Case string.
 * Strips underscores and normalizes casing.
 */
export function formatBookingCheckInState(state: BookingCheckInState | string | null | undefined): string {
  if (!state) return "Not Checked In";
  const normalized = state.toUpperCase().trim();
  switch (normalized) {
    case "CHECKED_IN":
      return "Checked In";
    case "CHECKED_OUT":
      return "Checked Out";
    case "NOT_CHECKED_IN":
      return "Not Checked In";
    default:
      return normalized
        .toLowerCase()
        .split("_")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
  }
}

/**
 * Formats a duration in seconds into mm:ss clock notation.
 */
export function formatLockoutTime(seconds: number): string {
  const m = Math.floor(Math.max(0, seconds) / 60);
  const s = Math.max(0, seconds) % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Formats start and end ISO timestamps into a clean, human-readable schedule range.
 * Example (Same Day): "October 23, 10:30am - 11:30am"
 * Example (Different Day): "October 23, 10:30am - October 24, 11:30am"
 */
export function formatCleanScheduleRange(
  startIso: string,
  endIso: string,
  timezone: string = "Asia/Manila",
  referenceNow?: Date
): string {
  try {
    const startDate = new Date(startIso);
    const endDate = new Date(endIso);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return `${startIso} - ${endIso}`;
    }

    // Format individual components in target timezone
    const monthFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      month: "long",
      day: "numeric",
    });

    const yearFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
    });

    const timeFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });

    const startDateStr = monthFormatter.format(startDate);
    const endDateStr = monthFormatter.format(endDate);
    const startYear = yearFormatter.format(startDate);
    const endYear = yearFormatter.format(endDate);

    // Format time without space before am/pm (e.g. "10:30am")
    const formatTimeClean = (d: Date): string => {
      const rawTime = timeFormatter.format(d);
      return rawTime.replace(/[\s\u202F\u00A0]*(AM|PM)/i, (_match, p1) => p1.toLowerCase());
    };

    const startTimeClean = formatTimeClean(startDate);
    const endTimeClean = formatTimeClean(endDate);

    const currentYear = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
    }).format(referenceNow ?? new Date());

    const includeYear = startYear !== currentYear || endYear !== currentYear;

    // Case 1: Same calendar day
    if (startDateStr === endDateStr && startYear === endYear) {
      const datePart = includeYear ? `${startDateStr}, ${startYear}` : startDateStr;
      return `${datePart}, ${startTimeClean} - ${endTimeClean}`;
    }

    // Case 2: Multi-day booking
    const startPart = includeYear ? `${startDateStr}, ${startYear}` : startDateStr;
    const endPart = includeYear ? `${endDateStr}, ${endYear}` : endDateStr;
    return `${startPart}, ${startTimeClean} - ${endPart}, ${endTimeClean}`;
  } catch {
    return `${startIso} - ${endIso}`;
  }
}

