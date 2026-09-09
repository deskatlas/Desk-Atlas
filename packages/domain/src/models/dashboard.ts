export type AdminDashboardRange = "today" | "7d" | "30d";

export interface AdminDashboardMetric {
  label: string;
  value: number;
  formattedValue: string;
  changeText: string;
  subText: string;
}

export interface AdminDashboardCheckedInMetric {
  label: string;
  value: number;
  formattedValue: string;
  capacityPercentage: number;
  totalCapacity: number;
  subText: string;
}

export interface AdminDashboardActivityItem {
  id: string;
  time: string;
  initials: string;
  name: string;
  workspace: string;
  mark: string;
  status: string;
  style: {
    background: string;
    color: string;
  };
  occurredAt: string;
  actorUserId?: string | null;
  actorRole?: string | null;
  actorName?: string | null;
}

export interface AdminDashboardOccupancyItem {
  label: string;
  value: string;
  rawValue: number;
  swatch: {
    background: string;
  };
}

export interface AdminDashboardSnapshot {
  range: AdminDashboardRange;
  rangeLabel: string;
  metrics: {
    reservations: AdminDashboardMetric;
    checkedIn: AdminDashboardCheckedInMetric;
    pendingPayments: AdminDashboardMetric;
    rescheduled: AdminDashboardMetric;
    cancelled: AdminDashboardMetric;
  };
  activity: AdminDashboardActivityItem[];
  workspaceOverview: {
    floorLabel: string;
    totalWorkspaces: number;
    occupancyBar: {
      availablePct: number;
      inUsePct: number;
      reservedPct: number;
      maintenancePct: number;
    };
    breakdown: AdminDashboardOccupancyItem[];
  };
  generatedAt: string;
}

export interface StaffDashboardSnapshot {
  range: "today";
  rangeLabel: string;
  metrics: {
    reservations: AdminDashboardMetric;
    checkedIn: AdminDashboardCheckedInMetric;
  };
  activity: AdminDashboardActivityItem[];
  workspaceOverview: {
    floorLabel: string;
    totalWorkspaces: number;
    occupancyBar: {
      availablePct: number;
      inUsePct: number;
      reservedPct: number;
      maintenancePct: number;
    };
    breakdown: AdminDashboardOccupancyItem[];
  };
  generatedAt: string;
}

