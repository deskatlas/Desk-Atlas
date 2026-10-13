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
