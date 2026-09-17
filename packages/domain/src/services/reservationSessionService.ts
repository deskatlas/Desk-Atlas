/**
 * Customer Reservation Session Timeout Service & Helpers
 *
 * Implements the 20-minute client-side session timeout for /reserve.
 * Invariant Note: Does NOT reserve or lock inventory (No-Hold Rule).
 */

export const CUSTOMER_RESERVATION_SESSION_TIMEOUT_SECONDS = 1200; // 20 minutes
export const CUSTOMER_RESERVATION_SESSION_WARNING_SECONDS = 120; // 2 minutes
export const CUSTOMER_RESERVATION_SESSION_STORAGE_KEY = "deskatlas_reserve_session_expiry";

/**
 * Formats a duration in seconds into MM:SS string representation.
 */
export function formatSessionCountdown(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Calculates the number of remaining seconds until expiry.
 */
export function calculateRemainingSessionSeconds(
  expiryTimestampMs: number,
  currentTimestampMs: number = Date.now()
): number {
  const diffMs = expiryTimestampMs - currentTimestampMs;
  return Math.max(0, Math.floor(diffMs / 1000));
}

/**
 * Returns true if the session is within the warning threshold (< 2 minutes remaining and not expired).
 */
export function isSessionWarning(remainingSeconds: number): boolean {
  return (
    remainingSeconds <= CUSTOMER_RESERVATION_SESSION_WARNING_SECONDS &&
    remainingSeconds > 0
  );
}

/**
 * Returns true if the session has expired (0 or negative seconds remaining).
 */
export function isSessionExpired(remainingSeconds: number): boolean {
  return remainingSeconds <= 0;
}

/**
 * Returns the session timeout in seconds given an optional configured duration in minutes.
 * Falls back to 20 minutes (1200 seconds) if not configured or invalid.
 */
export function getCustomerSessionTimeoutSeconds(configuredMinutes?: number | null): number {
  if (
    configuredMinutes !== undefined &&
    configuredMinutes !== null &&
    !isNaN(configuredMinutes) &&
    configuredMinutes > 0
  ) {
    return Math.round(configuredMinutes * 60);
  }
  return CUSTOMER_RESERVATION_SESSION_TIMEOUT_SECONDS;
}

/**
 * Retrieves the existing session expiry timestamp from storage, or creates a new expiry timestamp.
 */
export function getOrCreateSessionExpiry(
  storage?: { getItem: (key: string) => string | null; setItem: (key: string, val: string) => void },
  nowMs: number = Date.now(),
  timeoutSeconds: number = CUSTOMER_RESERVATION_SESSION_TIMEOUT_SECONDS
): number {
  if (storage) {
    try {
      const stored = storage.getItem(CUSTOMER_RESERVATION_SESSION_STORAGE_KEY);
      if (stored) {
        const parsed = parseInt(stored, 10);
        const maxValidExpiry = nowMs + (timeoutSeconds + 10) * 1000;
        if (!isNaN(parsed) && parsed > nowMs && parsed <= maxValidExpiry) {
          return parsed;
        }
      }
    } catch {
      // Ignore storage errors in restricted browser contexts
    }
  }

  const newExpiry = nowMs + timeoutSeconds * 1000;
  if (storage) {
    try {
      storage.setItem(CUSTOMER_RESERVATION_SESSION_STORAGE_KEY, String(newExpiry));
    } catch {
      // Ignore storage errors
    }
  }
  return newExpiry;
}

/**
 * Removes the session expiry timestamp from storage.
 */
export function clearSessionExpiry(
  storage?: { removeItem: (key: string) => void }
): void {
  if (storage) {
    try {
      storage.removeItem(CUSTOMER_RESERVATION_SESSION_STORAGE_KEY);
    } catch {
      // Ignore storage errors
    }
  }
}
