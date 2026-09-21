import type {
  WorkspaceUsageDateRange,
  WorkspaceUsageRecord,
  WorkspaceUsageRepository,
} from "./workspaceUsageService";

export interface MemoryWorkspaceTemplate {
  id: string;
  name: string;
  rateAmount: number;
  pricingUnit?: string;
  tier?: string;
}

export interface MemoryWorkspaceInstance {
  id: string;
  templateId: string;
  displayName: string;
  instanceCode?: string;
}

export interface MemoryReservationCandidate {
  reservationId: string;
  workspaceInstanceId: string;
  startAt: string;
  endAt: string;
  isAssigned: boolean;
}

export interface MemoryReservation {
  id: string;
  status:
    | "PENDING_PAYMENT"
    | "PAYMENT_UNDER_REVIEW"
    | "PENDING_COUNTER_CONFIRMATION"
    | "CONFIRMED"
    | "NEEDS_MANUAL_RESOLUTION"
    | "CHECKED_IN"
    | "COMPLETED"
    | "CHECKED_OUT"
    | "CANCELLED"
    | "EXPIRED";
  createdAt: string;
  allocatedWorkspaceInstanceId?: string | null;
  candidates?: MemoryReservationCandidate[];
}

const VALID_STATUSES = new Set([
  "CONFIRMED",
  "CHECKED_IN",
  "COMPLETED",
  "CHECKED_OUT",
]);

export class WorkspaceUsageMemoryRepository implements WorkspaceUsageRepository {
  private templates: Map<string, MemoryWorkspaceTemplate> = new Map();
  private instances: Map<string, MemoryWorkspaceInstance> = new Map();
  private reservations: MemoryReservation[] = [];
  private candidates: MemoryReservationCandidate[] = [];

  constructor(seed?: {
    templates?: MemoryWorkspaceTemplate[];
    instances?: MemoryWorkspaceInstance[];
    reservations?: MemoryReservation[];
    candidates?: MemoryReservationCandidate[];
  }) {
    if (seed?.templates) {
      for (const t of seed.templates) {
        this.templates.set(t.id, t);
      }
    }
    if (seed?.instances) {
      for (const i of seed.instances) {
        this.instances.set(i.id, i);
      }
    }
    if (seed?.reservations) {
      this.reservations = [...seed.reservations];
    }
    if (seed?.candidates) {
      this.candidates = [...seed.candidates];
    }
  }

  setTemplates(templates: MemoryWorkspaceTemplate[]) {
    this.templates.clear();
    for (const t of templates) {
      this.templates.set(t.id, t);
    }
  }

  setInstances(instances: MemoryWorkspaceInstance[]) {
    this.instances.clear();
    for (const i of instances) {
      this.instances.set(i.id, i);
    }
  }

  setReservations(reservations: MemoryReservation[]) {
    this.reservations = [...reservations];
  }

  setCandidates(candidates: MemoryReservationCandidate[]) {
    this.candidates = [...candidates];
  }

  async getWorkspaceUsageRecords(
    dateRange?: WorkspaceUsageDateRange
  ): Promise<WorkspaceUsageRecord[]> {
    const fromTime = dateRange?.from ? new Date(dateRange.from).getTime() : null;
    const toTime = dateRange?.to ? new Date(dateRange.to).getTime() : null;

    // Build map of candidates by reservation
    const candidatesByRes = new Map<string, MemoryReservationCandidate[]>();
    for (const c of this.candidates) {
      const list = candidatesByRes.get(c.reservationId) ?? [];
      list.push(c);
      candidatesByRes.set(c.reservationId, list);
    }

    // Filter valid reservations
    const validReservations = this.reservations.filter((r) =>
      VALID_STATUSES.has(r.status)
    );

    // Group usage by workspace instance
    const statsByInstance = new Map<
      string,
      {
        bookingCount: number;
        totalHours: number;
        latestBookedAt: string | null;
      }
    >();

    // Initialize stats for all known instances
    for (const instId of this.instances.keys()) {
      statsByInstance.set(instId, {
        bookingCount: 0,
        totalHours: 0,
        latestBookedAt: null,
      });
    }

    for (const res of validReservations) {
      const resCandidates =
        res.candidates ?? candidatesByRes.get(res.id) ?? [];
      const assigned =
        resCandidates.find((c) => c.isAssigned) ??
        resCandidates[0] ??
        null;

      const instanceId =
        res.allocatedWorkspaceInstanceId ??
        assigned?.workspaceInstanceId ??
        null;

      if (!instanceId || !this.instances.has(instanceId)) {
        continue;
      }

      // Check date range filtering based on booking startAt or reservation createdAt
      const startAtIso = assigned?.startAt ?? res.createdAt;
      const startTime = new Date(startAtIso).getTime();

      if (fromTime !== null && startTime < fromTime) {
        continue;
      }
      if (toTime !== null && startTime > toTime) {
        continue;
      }

      // Compute duration in hours
      let hours = 1;
      if (assigned?.startAt && assigned?.endAt) {
        const diffMs =
          new Date(assigned.endAt).getTime() -
          new Date(assigned.startAt).getTime();
        hours = Math.max(0, diffMs / (1000 * 60 * 60));
      }

      const stat = statsByInstance.get(instanceId)!;
      stat.bookingCount += 1;
      stat.totalHours += hours;

      const bookedAtIso = res.createdAt || startAtIso;
      if (
        !stat.latestBookedAt ||
        new Date(bookedAtIso).getTime() > new Date(stat.latestBookedAt).getTime()
      ) {
        stat.latestBookedAt = bookedAtIso;
      }
    }

    // Construct records for all instances
    const records: WorkspaceUsageRecord[] = [];

    for (const [instanceId, instance] of this.instances.entries()) {
      const template = this.templates.get(instance.templateId);
      const stat = statsByInstance.get(instanceId) ?? {
        bookingCount: 0,
        totalHours: 0,
        latestBookedAt: null,
      };

      const tier =
        template?.tier ??
        (template?.rateAmount !== undefined
          ? `₱${template.rateAmount}/hr`
          : "Standard");

      records.push({
        instanceId,
        instanceName: instance.displayName || instance.instanceCode || "Workspace",
        templateName: template?.name ?? "Standard Desk",
        templateTier: tier,
        totalBookings: stat.bookingCount,
        totalHoursBooked: Math.round(stat.totalHours * 10) / 10,
        lastBookedAt: stat.latestBookedAt,
      });
    }

    return records;
  }
}
