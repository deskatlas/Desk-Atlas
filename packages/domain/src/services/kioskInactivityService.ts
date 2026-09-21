/**
 * Kiosk Inactivity Warning & Auto-Reset Service & Constants
 *
 * Implements inactivity timing rules for kiosk sessions (MF-166).
 * - Total inactivity timeout: 60 seconds (default)
 * - Warning period: 15 seconds before reset (default)
 */

export const DEFAULT_KIOSK_INACTIVITY_TOTAL_TIMEOUT_MS = 60000; // 60 seconds
export const DEFAULT_KIOSK_INACTIVITY_WARNING_TIMEOUT_MS = 15000; // 15 seconds

/**
 * Calculates the time in milliseconds to wait before showing the inactivity warning.
 */
export function calculateKioskWarningStartTime(
  totalTimeoutMs: number = DEFAULT_KIOSK_INACTIVITY_TOTAL_TIMEOUT_MS,
  warningTimeoutMs: number = DEFAULT_KIOSK_INACTIVITY_WARNING_TIMEOUT_MS
): number {
  return Math.max(0, totalTimeoutMs - warningTimeoutMs);
}

/**
 * Calculates remaining warning seconds from a target reset timestamp.
 */
export function calculateKioskRemainingWarningSeconds(
  resetDeadlineMs: number,
  nowMs: number = Date.now()
): number {
  const diffMs = resetDeadlineMs - nowMs;
  return Math.max(0, Math.ceil(diffMs / 1000));
}

/**
 * Returns true if elapsed inactivity time falls within the warning window.
 */
export function isKioskInactivityWarningActive(
  elapsedMs: number,
  totalTimeoutMs: number = DEFAULT_KIOSK_INACTIVITY_TOTAL_TIMEOUT_MS,
  warningTimeoutMs: number = DEFAULT_KIOSK_INACTIVITY_WARNING_TIMEOUT_MS
): boolean {
  const warningStartMs = calculateKioskWarningStartTime(totalTimeoutMs, warningTimeoutMs);
  return elapsedMs >= warningStartMs && elapsedMs < totalTimeoutMs;
}

/**
 * Returns true if elapsed inactivity has reached or exceeded the total timeout.
 */
export function isKioskInactivityExpired(
  elapsedMs: number,
  totalTimeoutMs: number = DEFAULT_KIOSK_INACTIVITY_TOTAL_TIMEOUT_MS
): boolean {
  return elapsedMs >= totalTimeoutMs;
}
