import { AdminReservationSummary } from "../models/reservation";

export type DateRangePreset =
  | "all"
  | "today"
  | "tomorrow"
  | "this_week"
  | "this_month"
  | "custom";

export interface AdminReservationAdvancedFilters {
  datePreset?: DateRangePreset;
  startDate?: string | null; // "YYYY-MM-DD"
  endDate?: string | null; // "YYYY-MM-DD"
  workspaceTemplate?: string | null; // template name or "all"
  paymentMethod?: string | null; // "all", "gcash", "bank_transfer", "cash"
  paymentStatus?: string | null; // "all", "paid", "under_review", "pending", "expired", "rejected"
  source?: string | null; // "all", "online" / "web", "kiosk"
}

export function countActiveFilters(
  filters: AdminReservationAdvancedFilters | null | undefined
): number {
  if (!filters) return 0;
  let count = 0;

  if (filters.datePreset && filters.datePreset !== "all") {
    if (filters.datePreset === "custom") {
      if (filters.startDate || filters.endDate) {
        count += 1;
      }
    } else {
      count += 1;
    }
  } else if (filters.startDate || filters.endDate) {
    count += 1;
  }

  if (
    filters.workspaceTemplate &&
    filters.workspaceTemplate.trim() !== "" &&
    filters.workspaceTemplate.toLowerCase() !== "all"
  ) {
    count += 1;
  }

  if (
    filters.paymentMethod &&
    filters.paymentMethod.trim() !== "" &&
    filters.paymentMethod.toLowerCase() !== "all"
  ) {
    count += 1;
  }

  if (
    filters.paymentStatus &&
    filters.paymentStatus.trim() !== "" &&
    filters.paymentStatus.toLowerCase() !== "all"
  ) {
    count += 1;
  }

  if (
    filters.source &&
    filters.source.trim() !== "" &&
    filters.source.toLowerCase() !== "all"
  ) {
    count += 1;
  }

  return count;
}

function extractDateString(isoOrDateStr?: string | null): string | null {
  if (!isoOrDateStr) return null;
  try {
    const d = new Date(isoOrDateStr);
    if (isNaN(d.getTime())) return null;
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  } catch {
    return null;
  }
}

function getStartAndEndOfWeek(date: Date): { start: string; end: string } {
  const d = new Date(date);
  const day = d.getDay(); // 0 is Sunday
  const diffToSunday = day;
  const sunday = new Date(d);
  sunday.setDate(d.getDate() - diffToSunday);
  sunday.setHours(0, 0, 0, 0);

  const saturday = new Date(sunday);
  saturday.setDate(sunday.getDate() + 6);
  saturday.setHours(23, 59, 59, 999);

  return {
    start: extractDateString(sunday.toISOString())!,
    end: extractDateString(saturday.toISOString())!,
  };
}

export function matchesReservationFilters(
  item: AdminReservationSummary,
  filters: AdminReservationAdvancedFilters,
  now: Date = new Date()
): boolean {
  // 1. Date Range Filtering
  const bookingDateStr =
    extractDateString(item.startAt) ?? extractDateString(item.createdAt);

  if (filters.datePreset && filters.datePreset !== "all") {
    if (!bookingDateStr) {
      return false;
    }

    const todayStr = extractDateString(now.toISOString())!;

    if (filters.datePreset === "today") {
      if (bookingDateStr !== todayStr) return false;
    } else if (filters.datePreset === "tomorrow") {
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = extractDateString(tomorrow.toISOString())!;
      if (bookingDateStr !== tomorrowStr) return false;
    } else if (filters.datePreset === "this_week") {
      const { start, end } = getStartAndEndOfWeek(now);
      if (bookingDateStr < start || bookingDateStr > end) return false;
    } else if (filters.datePreset === "this_month") {
      const currentYearMonth = todayStr.substring(0, 7); // "YYYY-MM"
      if (!bookingDateStr.startsWith(currentYearMonth)) return false;
    } else if (filters.datePreset === "custom") {
      if (filters.startDate && bookingDateStr < filters.startDate) return false;
      if (filters.endDate && bookingDateStr > filters.endDate) return false;
    }
  } else {
    // If custom startDate / endDate provided without preset
    if (filters.startDate && (!bookingDateStr || bookingDateStr < filters.startDate)) {
      return false;
    }
    if (filters.endDate && (!bookingDateStr || bookingDateStr > filters.endDate)) {
      return false;
    }
  }

  // 2. Workspace Tier / Template Filtering
  if (
    filters.workspaceTemplate &&
    filters.workspaceTemplate.trim() !== "" &&
    filters.workspaceTemplate.toLowerCase() !== "all"
  ) {
    const target = filters.workspaceTemplate.trim().toLowerCase();
    const templateName = (item.workspaceTemplateName ?? "").toLowerCase();
    const displayName = (item.workspaceDisplayName ?? "").toLowerCase();

    const matchesTemplate =
      templateName === target ||
      displayName.includes(target) ||
      templateName.includes(target);

    if (!matchesTemplate) return false;
  }

  // 3. Payment Method Filtering
  if (
    filters.paymentMethod &&
    filters.paymentMethod.trim() !== "" &&
    filters.paymentMethod.toLowerCase() !== "all"
  ) {
    const targetMethod = filters.paymentMethod.trim().toLowerCase();
    const methodType = (item.paymentMethodType ?? "").toLowerCase();
    const methodDisplay = (item.paymentMethodDisplayName ?? "").toLowerCase();

    let matchesMethod = false;
    if (targetMethod === "gcash") {
      matchesMethod =
        methodType === "gcash" ||
        methodDisplay.includes("gcash") ||
        (item.source === "WEB" && !methodType);
    } else if (
      targetMethod === "bank_transfer" ||
      targetMethod === "bank" ||
      targetMethod === "bank transfer"
    ) {
      matchesMethod =
        methodType === "bank_transfer" ||
        methodType === "bank" ||
        methodDisplay.includes("bank");
    } else if (targetMethod === "cash") {
      matchesMethod =
        methodType === "cash" ||
        (!methodDisplay.includes("gcash") && methodDisplay.includes("cash")) ||
        (item.source === "KIOSK" && !methodType && methodType !== "gcash");
    } else {
      matchesMethod =
        methodType.includes(targetMethod) ||
        methodDisplay.includes(targetMethod) ||
        (item.paymentMethodId ?? "").toLowerCase() === targetMethod;
    }

    if (!matchesMethod) return false;
  }

  // 4. Payment Status Filtering
  if (
    filters.paymentStatus &&
    filters.paymentStatus.trim() !== "" &&
    filters.paymentStatus.toLowerCase() !== "all"
  ) {
    const targetStatus = filters.paymentStatus.trim().toLowerCase();
    const paymentStatus = (item.paymentStatus ?? "").toLowerCase();
    const attemptStatus = (item.paymentAttemptStatus ?? "").toLowerCase();
    const resStatus = item.reservationStatus;

    let matchesPayment = false;
    if (targetStatus === "paid" || targetStatus === "approved") {
      matchesPayment =
        attemptStatus === "approved" ||
        paymentStatus.includes("paid") ||
        ["CONFIRMED", "CHECKED_IN", "COMPLETED"].includes(resStatus);
    } else if (
      targetStatus === "under_review" ||
      targetStatus === "review" ||
      targetStatus === "payment review"
    ) {
      matchesPayment =
        attemptStatus === "under_review" ||
        resStatus === "PAYMENT_UNDER_REVIEW" ||
        paymentStatus.includes("review");
    } else if (
      targetStatus === "pending" ||
      targetStatus === "pending payment" ||
      targetStatus === "awaiting proof"
    ) {
      matchesPayment =
        (attemptStatus === "pending" ||
          resStatus === "PENDING_PAYMENT" ||
          paymentStatus.includes("pending") ||
          paymentStatus.includes("counter")) &&
        resStatus !== "EXPIRED";
    } else if (targetStatus === "expired") {
      matchesPayment =
        resStatus === "EXPIRED" ||
        attemptStatus === "expired" ||
        paymentStatus.includes("expired");
    } else if (targetStatus === "rejected") {
      matchesPayment =
        attemptStatus === "rejected" ||
        paymentStatus.includes("rejected") ||
        item.status.toLowerCase() === "rejected";
    } else if (targetStatus === "refunded" || targetStatus === "cancelled") {
      matchesPayment =
        resStatus === "CANCELLED" ||
        paymentStatus.includes("cancelled") ||
        paymentStatus.includes("refunded");
    } else {
      matchesPayment =
        paymentStatus.includes(targetStatus) ||
        attemptStatus.includes(targetStatus);
    }

    if (!matchesPayment) return false;
  }

  // 5. Source / Channel Filtering
  if (
    filters.source &&
    filters.source.trim() !== "" &&
    filters.source.toLowerCase() !== "all"
  ) {
    const targetSource = filters.source.trim().toUpperCase();
    if (targetSource === "WEB" || targetSource === "ONLINE") {
      if (item.source !== "WEB") return false;
    } else if (targetSource === "KIOSK") {
      if (item.source !== "KIOSK") return false;
    }
  }

  return true;
}

export function filterReservations<T extends AdminReservationSummary>(
  items: T[],
  filters: AdminReservationAdvancedFilters,
  now: Date = new Date()
): T[] {
  if (countActiveFilters(filters) === 0) {
    return items;
  }
  return items.filter((item) => matchesReservationFilters(item, filters, now));
}
