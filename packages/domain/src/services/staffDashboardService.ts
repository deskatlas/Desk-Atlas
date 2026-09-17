import {
  AdminDashboardActivityItem,
  AdminDashboardOccupancyItem,
  StaffDashboardSnapshot,
} from "../models/dashboard";
import { ReportPaymentAttemptRecord, ReportReservationRecord } from "../models/reports";
import { OccupancyRecord, OperationalActivityRecord } from "../models/reservation";
import { WorkspaceCatalog, WorkspaceRepository } from "../models/workspace";
import { ReportsRepository } from "./reportsRepository";
import { StaffOperationsRepository } from "./staffOperationsRepository";

const DEFAULT_TIMEZONE = "Asia/Manila";

export class StaffDashboardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StaffDashboardError";
  }
}

export class StaffDashboardService {
  constructor(
    private readonly reportsRepo: ReportsRepository,
    private readonly staffOpsRepo: StaffOperationsRepository,
    private readonly workspaceRepo: WorkspaceRepository,
    private readonly nowProvider: () => Date = () => new Date(),
    private readonly timezone: string = DEFAULT_TIMEZONE
  ) {}

  async getDashboardSnapshot(range: string = "today"): Promise<StaffDashboardSnapshot> {
    if (range !== "today") {
      throw new StaffDashboardError("Staff dashboard only supports today range.");
    }

    const now = this.nowProvider();
    const nowIso = now.toISOString();

    const [reservations, payments, catalog, occupancyList, auditActivity] = await Promise.all([
      this.reportsRepo.listReportReservations(),
      this.reportsRepo.listReportPaymentAttempts(),
      this.workspaceRepo.listCatalog(),
      this.staffOpsRepo.listOccupancy(nowIso),
      this.staffOpsRepo.listOperationalActivity(20),
    ]);

    const rangeBounds = calculateTodayRangeBounds(now, this.timezone);

    // 1. Metric: Today's Reservations
    const currentReservations = reservations.filter(
      (r) =>
        ["CONFIRMED", "CHECKED_IN", "COMPLETED"].includes(r.reservationStatus) &&
        r.bookingStartAt !== null &&
        isWithinRange(r.bookingStartAt, rangeBounds.currentStart, rangeBounds.currentEnd)
    );
    const prevReservations = reservations.filter(
      (r) =>
        ["CONFIRMED", "CHECKED_IN", "COMPLETED"].includes(r.reservationStatus) &&
        r.bookingStartAt !== null &&
        isWithinRange(r.bookingStartAt, rangeBounds.prevStart, rangeBounds.prevEnd)
    );
    const reservationsMetric = {
      label: "Today's Reservations",
      value: currentReservations.length,
      formattedValue: String(currentReservations.length),
      changeText: formatComparisonTrend(currentReservations.length, prevReservations.length),
      subText: "vs yesterday",
    };

    // 2. Metric: Currently Checked In
    const currentlyCheckedInCount = reservations.filter(
      (r) => r.checkedInAt !== null && r.checkedOutAt === null
    ).length;
    const totalCapacity = catalog.instances.length;
    const capacityPct = totalCapacity > 0 ? Math.round((currentlyCheckedInCount / totalCapacity) * 100) : 0;
    const checkedInMetric = {
      label: "Currently Checked In",
      value: currentlyCheckedInCount,
      formattedValue: String(currentlyCheckedInCount),
      capacityPercentage: capacityPct,
      totalCapacity,
      subText: `${capacityPct}% capacity of ${totalCapacity}`,
    };

    // 3. Activity Stream for Today
    const activity = buildStaffActivityStream(
      reservations,
      payments,
      auditActivity,
      rangeBounds.currentStart,
      rangeBounds.currentEnd,
      this.timezone
    );

    // 4. Workspace Overview
    const workspaceOverview = buildWorkspaceOverview(catalog, occupancyList, reservations, nowIso);

    return {
      range: "today",
      rangeLabel: "Today",
      metrics: {
        reservations: reservationsMetric,
        checkedIn: checkedInMetric,
      },
      activity,
      workspaceOverview,
      generatedAt: nowIso,
    };
  }
}

export function createStaffDashboardService(
  reportsRepo: ReportsRepository,
  staffOpsRepo: StaffOperationsRepository,
  workspaceRepo: WorkspaceRepository,
  nowProvider?: () => Date,
  timezone?: string
) {
  return new StaffDashboardService(reportsRepo, staffOpsRepo, workspaceRepo, nowProvider, timezone);
}

// Helpers

interface TodayRangeBounds {
  currentStart: Date;
  currentEnd: Date;
  prevStart: Date;
  prevEnd: Date;
}

function calculateTodayRangeBounds(now: Date, timezone: string): TodayRangeBounds {
  const localDateParts = getLocalDateParts(now, timezone);
  const todayStart = zonedDateTimeToUtc(
    `${localDateParts.year}-${pad2(localDateParts.month)}-${pad2(localDateParts.day)}`,
    "00:00:00",
    timezone
  );
  const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
  const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
  const yesterdayEnd = todayStart;

  return {
    currentStart: todayStart,
    currentEnd: todayEnd,
    prevStart: yesterdayStart,
    prevEnd: yesterdayEnd,
  };
}

function formatComparisonTrend(current: number, prev: number): string {
  if (prev === 0) {
    if (current === 0) {
      return "0%";
    }
    return `↑ ${current}`;
  }

  const diffPct = Math.round(((current - prev) / prev) * 100);
  if (diffPct > 0) {
    return `↑ ${diffPct}%`;
  }
  if (diffPct < 0) {
    return `↓ ${Math.abs(diffPct)}%`;
  }
  return "0%";
}

function buildStaffActivityStream(
  reservations: ReportReservationRecord[],
  payments: ReportPaymentAttemptRecord[],
  auditActivity: OperationalActivityRecord[],
  start: Date,
  end: Date,
  timezone: string
): AdminDashboardActivityItem[] {
  const items: AdminDashboardActivityItem[] = [];
  const seenEvents = new Set<string>();

  // 1. Audit log activities (Check-ins, Check-outs, Re-entries)
  for (const event of auditActivity) {
    if (isWithinRange(event.occurredAt, start, end)) {
      const eventKey = `${event.reservationId}-${event.activityType}-${event.occurredAt}`;
      if (!seenEvents.has(eventKey)) {
        seenEvents.add(eventKey);
        const isReentry = event.activityType === "REENTRY";
        const isCheckIn = event.activityType === "CHECK_IN";
        const actorDisplay =
          event.actorName ||
          (event.actorRole === "ADMIN" ? "Admin" : event.actorRole === "STAFF" ? "Staff" : null);
        items.push({
          id: eventKey,
          time: formatTimeInTimezone(event.occurredAt, timezone),
          initials: getInitials(event.customerName),
          name: event.customerName,
          workspace: event.workspaceDisplayName ?? event.workspaceInstanceCode ?? "Workspace",
          mark: isReentry ? "↺" : (isCheckIn ? "✓" : "→"),
          status: isReentry ? "Re-entered" : (isCheckIn ? "Checked In" : "Checked Out"),
          style: isReentry
            ? { background: "#E0F2FE", color: "#0369A1" }
            : isCheckIn
              ? { background: "var(--da-info)", color: "var(--da-brand-dark)" }
              : { background: "var(--da-canvas)", color: "var(--da-text-secondary)" },
          occurredAt: event.occurredAt,
          actorUserId: event.actorUserId ?? null,
          actorRole: event.actorRole ?? null,
          actorName: actorDisplay,
        });
      }
    }
  }

  // 2. Reservation state milestones for Today (without disclosing payment proof urls/token hashes)
  for (const reservation of reservations) {
    const fullName = `${reservation.customerFirstName} ${reservation.customerLastName}`.trim();
    const initials = getInitials(fullName);
    const workspaceName =
      reservation.workspaceDisplayName ?? reservation.workspaceInstanceCode ?? "Workspace";

    // Confirmed booking (kiosk counter confirmation or online approval)
    if (reservation.confirmedAt && isWithinRange(reservation.confirmedAt, start, end)) {
      const eventKey = `${reservation.reservationId}-confirmed-${reservation.confirmedAt}`;
      if (!seenEvents.has(eventKey)) {
        seenEvents.add(eventKey);
        items.push({
          id: eventKey,
          time: formatTimeInTimezone(reservation.confirmedAt, timezone),
          initials,
          name: fullName,
          workspace: workspaceName,
          mark: "✓",
          status: "Confirmed",
          style: { background: "var(--da-info)", color: "var(--da-brand-dark)" },
          occurredAt: reservation.confirmedAt,
        });
      }
    }

    // Pending Counter Confirmation (Kiosk counter payment awaiting staff confirmation)
    if (
      reservation.reservationStatus === "PENDING_COUNTER_CONFIRMATION" &&
      isWithinRange(reservation.createdAt, start, end)
    ) {
      const eventKey = `${reservation.reservationId}-counter-${reservation.createdAt}`;
      if (!seenEvents.has(eventKey)) {
        seenEvents.add(eventKey);
        items.push({
          id: eventKey,
          time: formatTimeInTimezone(reservation.createdAt, timezone),
          initials,
          name: fullName,
          workspace: workspaceName,
          mark: "!",
          status: "Counter Queue",
          style: { background: "var(--da-soft)", color: "var(--da-brand-dark)" },
          occurredAt: reservation.createdAt,
        });
      }
    }
  }

  // Sort by occurredAt descending and cap at 10 items
  return items
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .slice(0, 10);
}

function buildWorkspaceOverview(
  catalog: WorkspaceCatalog,
  occupancyList: OccupancyRecord[],
  reservations: ReportReservationRecord[],
  nowIso: string
) {
  const totalWorkspaces = catalog.instances.length;
  const floorName = catalog.floors[0]?.name ?? "Ground Floor";

  const maintenanceCount = catalog.instances.filter(
    (inst) => inst.operationalStatus === "MAINTENANCE" || inst.operationalStatus === "INACTIVE"
  ).length;

  const inUseCount = reservations.filter(
    (r) => r.checkedInAt !== null && r.checkedOutAt === null
  ).length;

  const reservedCount = occupancyList.filter(
    (occ) => occ.occupancyState === "RESERVED"
  ).length;

  const availableCount = Math.max(0, totalWorkspaces - inUseCount - reservedCount - maintenanceCount);

  const availablePct = totalWorkspaces > 0 ? (availableCount / totalWorkspaces) * 100 : 0;
  const inUsePct = totalWorkspaces > 0 ? (inUseCount / totalWorkspaces) * 100 : 0;
  const reservedPct = totalWorkspaces > 0 ? (reservedCount / totalWorkspaces) * 100 : 0;
  const maintenancePct = totalWorkspaces > 0 ? (maintenanceCount / totalWorkspaces) * 100 : 0;

  const breakdown: AdminDashboardOccupancyItem[] = [
    {
      label: "Available",
      value: String(availableCount),
      rawValue: availableCount,
      swatch: { background: "var(--da-brand-accent)" },
    },
    {
      label: "In Use",
      value: String(inUseCount),
      rawValue: inUseCount,
      swatch: { background: "var(--da-text-secondary)" },
    },
    {
      label: "Reserved",
      value: String(reservedCount),
      rawValue: reservedCount,
      swatch: { background: "var(--da-soft)" },
    },
    {
      label: "Maintenance",
      value: String(maintenanceCount),
      rawValue: maintenanceCount,
      swatch: { background: "var(--da-brand-dark)" },
    },
  ];

  return {
    floorLabel: `${floorName} · ${totalWorkspaces} workspaces`,
    totalWorkspaces,
    occupancyBar: {
      availablePct: Math.round(availablePct * 10) / 10,
      inUsePct: Math.round(inUsePct * 10) / 10,
      reservedPct: Math.round(reservedPct * 10) / 10,
      maintenancePct: Math.round(maintenancePct * 10) / 10,
    },
    breakdown,
  };
}

function isWithinRange(valueIso: string, start: Date, end: Date): boolean {
  const valueTime = new Date(valueIso).getTime();
  return valueTime >= start.getTime() && valueTime < end.getTime();
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || parts[0] === "") {
    return "??";
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function formatTimeInTimezone(isoString: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(isoString));
  } catch {
    const d = new Date(isoString);
    return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
  }
}

function getLocalDateParts(
  date: Date,
  timezone: string
): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts.filter((p) => p.type !== "literal").map((p) => [p.type, Number(p.value)])
  );

  return {
    year: values.year,
    month: values.month,
    day: values.day,
  };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function zonedDateTimeToUtc(date: string, time: string, timezone: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hours, minutes, seconds] = time.split(":").map(Number);
  let utcTimestamp = Date.UTC(year, month - 1, day, hours, minutes, seconds || 0);

  for (let iteration = 0; iteration < 2; iteration += 1) {
    const offsetMinutes = getTimezoneOffsetMinutes(new Date(utcTimestamp), timezone);
    utcTimestamp = Date.UTC(year, month - 1, day, hours, minutes, seconds || 0) - offsetMinutes * 60_000;
  }

  return new Date(utcTimestamp);
}

function getTimezoneOffsetMinutes(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)])
  ) as Record<"year" | "month" | "day" | "hour" | "minute" | "second", number>;

  const zonedAsUtc = Date.UTC(
    values.year,
    values.month - 1,
    values.day,
    values.hour,
    values.minute,
    values.second
  );

  return Math.round((zonedAsUtc - date.getTime()) / 60_000);
}
