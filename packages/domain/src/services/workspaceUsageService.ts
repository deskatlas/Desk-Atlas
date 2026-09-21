export interface WorkspaceUsageRecord {
  instanceId: string;
  instanceName: string;
  templateName: string;
  templateTier: string;
  totalBookings: number;
  totalHoursBooked: number;
  lastBookedAt: string | null;
}

export interface WorkspaceUsageDateRange {
  from?: string;
  to?: string;
}

export type WorkspaceUsageRangePreset = 'today' | '7d' | '30d';

export interface WorkspaceUsageQueryOptions {
  limit?: number | 'all';
  dateRange?: WorkspaceUsageDateRange;
  rangePreset?: WorkspaceUsageRangePreset;
}

export interface WorkspaceUsageRepository {
  getWorkspaceUsageRecords(dateRange?: WorkspaceUsageDateRange): Promise<WorkspaceUsageRecord[]>;
}

export type WorkspaceUsageSortField = 'bookings' | 'hours' | 'lastBooked' | 'name';
export type WorkspaceUsageSortDirection = 'asc' | 'desc';

export function getDateRangeForPreset(preset: WorkspaceUsageRangePreset, now: Date = new Date()): WorkspaceUsageDateRange {
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  if (preset === 'today') {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return {
      from: start.toISOString(),
      to: end.toISOString(),
    };
  }

  if (preset === '7d') {
    const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    start.setHours(0, 0, 0, 0);
    return {
      from: start.toISOString(),
      to: end.toISOString(),
    };
  }

  // 30d
  const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  start.setHours(0, 0, 0, 0);
  return {
    from: start.toISOString(),
    to: end.toISOString(),
  };
}

export function sortWorkspaceUsageRecords(
  records: WorkspaceUsageRecord[],
  sortBy: WorkspaceUsageSortField = 'bookings',
  direction: WorkspaceUsageSortDirection = 'desc'
): WorkspaceUsageRecord[] {
  const factor = direction === 'asc' ? 1 : -1;

  return [...records].sort((a, b) => {
    if (sortBy === 'bookings') {
      if (a.totalBookings !== b.totalBookings) {
        return (a.totalBookings - b.totalBookings) * factor;
      }
      return (a.totalHoursBooked - b.totalHoursBooked) * factor;
    }

    if (sortBy === 'hours') {
      if (a.totalHoursBooked !== b.totalHoursBooked) {
        return (a.totalHoursBooked - b.totalHoursBooked) * factor;
      }
      return (a.totalBookings - b.totalBookings) * factor;
    }

    if (sortBy === 'lastBooked') {
      const aTime = a.lastBookedAt ? new Date(a.lastBookedAt).getTime() : 0;
      const bTime = b.lastBookedAt ? new Date(b.lastBookedAt).getTime() : 0;
      if (aTime !== bTime) {
        return (aTime - bTime) * factor;
      }
      return (a.totalBookings - b.totalBookings) * factor;
    }

    if (sortBy === 'name') {
      return a.instanceName.localeCompare(b.instanceName) * factor;
    }

    return 0;
  });
}

export class WorkspaceUsageService {
  constructor(private readonly repository: WorkspaceUsageRepository) {}

  async getWorkspaceUsageRanking(options?: WorkspaceUsageQueryOptions): Promise<WorkspaceUsageRecord[]> {
    let dateRange = options?.dateRange;
    if (!dateRange && options?.rangePreset) {
      dateRange = getDateRangeForPreset(options.rangePreset);
    }

    const records = await this.repository.getWorkspaceUsageRecords(dateRange);

    const sorted = sortWorkspaceUsageRecords(records, 'bookings', 'desc');

    if (options?.limit && options.limit !== 'all') {
      const num = typeof options.limit === 'number' ? options.limit : parseInt(String(options.limit), 10);
      if (!isNaN(num) && num > 0) {
        return sorted.slice(0, num);
      }
    }

    return sorted;
  }
}
