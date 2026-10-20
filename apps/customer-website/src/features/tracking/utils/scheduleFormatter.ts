/**
 * Schedule Formatter Utility
 * Traceability: PRD-F5, PRD-F14, SDD-C4, DSD-UI11, MS-73
 */

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
