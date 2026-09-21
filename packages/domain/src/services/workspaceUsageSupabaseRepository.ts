import type {
  WorkspaceUsageDateRange,
  WorkspaceUsageRecord,
  WorkspaceUsageRepository,
} from "./workspaceUsageService";

type TemplateRow = {
  id: string;
  name: string;
  rate_amount: number | string;
  pricing_unit?: string;
};

type InstanceRow = {
  id: string;
  template_id: string;
  display_name: string;
  instance_code: string;
};

type ReservationCandidateRow = {
  reservation_id: string;
  workspace_instance_id: string;
  start_at: string;
  end_at: string;
  is_assigned: boolean;
};

type ReservationRow = {
  id: string;
  status: string;
  created_at: string;
  allocated_workspace_instance_id?: string | null;
};

const VALID_STATUSES = new Set([
  "CONFIRMED",
  "CHECKED_IN",
  "COMPLETED",
  "CHECKED_OUT",
]);

export class WorkspaceUsageSupabaseRepository implements WorkspaceUsageRepository {
  private readonly restUrl: string;
  private readonly serviceRoleKey: string;

  constructor(options?: { supabaseUrl?: string; serviceRoleKey?: string }) {
    const supabaseUrl =
      options?.supabaseUrl ??
      process.env.SUPABASE_URL ??
      process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey =
      options?.serviceRoleKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl) {
      throw new Error(
        "SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL is required for workspace usage repository"
      );
    }

    if (!serviceRoleKey) {
      throw new Error(
        "SUPABASE_SERVICE_ROLE_KEY is required for workspace usage repository"
      );
    }

    this.restUrl = `${supabaseUrl.replace(/\/$/, "")}/rest/v1`;
    this.serviceRoleKey = serviceRoleKey;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers = new Headers(options.headers);
    headers.set("apikey", this.serviceRoleKey);
    headers.set("Authorization", `Bearer ${this.serviceRoleKey}`);
    headers.set("Content-Type", "application/json");

    const response = await fetch(`${this.restUrl}${path}`, {
      ...options,
      headers,
      cache: "no-store",
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Supabase request failed (${response.status}): ${detail}`);
    }

    if (response.status === 204) return undefined as T;
    return response.json();
  }

  async getWorkspaceUsageRecords(
    dateRange?: WorkspaceUsageDateRange
  ): Promise<WorkspaceUsageRecord[]> {
    const [templates, instances, candidates, reservations] = await Promise.all([
      this.request<TemplateRow[]>("/workspace_templates?select=id,name,rate_amount,pricing_unit"),
      this.request<InstanceRow[]>("/workspace_instances?select=id,template_id,display_name,instance_code"),
      this.request<ReservationCandidateRow[]>("/reservation_candidates?select=reservation_id,workspace_instance_id,start_at,end_at,is_assigned"),
      this.request<ReservationRow[]>("/reservations?select=id,status,created_at&order=created_at.desc&limit=1000"),
    ]);

    const templatesMap = new Map<string, TemplateRow>(
      (templates ?? []).map((t) => [t.id, t])
    );
    const instancesMap = new Map<string, InstanceRow>(
      (instances ?? []).map((i) => [i.id, i])
    );

    const candidatesByReservation = new Map<string, ReservationCandidateRow[]>();
    for (const c of candidates ?? []) {
      const list = candidatesByReservation.get(c.reservation_id) ?? [];
      list.push(c);
      candidatesByReservation.set(c.reservation_id, list);
    }

    const fromTime = dateRange?.from ? new Date(dateRange.from).getTime() : null;
    const toTime = dateRange?.to ? new Date(dateRange.to).getTime() : null;

    const statsByInstance = new Map<
      string,
      {
        bookingCount: number;
        totalHours: number;
        latestBookedAt: string | null;
      }
    >();

    for (const inst of instances ?? []) {
      statsByInstance.set(inst.id, {
        bookingCount: 0,
        totalHours: 0,
        latestBookedAt: null,
      });
    }

    const validReservations = (reservations ?? []).filter((r) =>
      VALID_STATUSES.has(r.status)
    );

    for (const res of validReservations) {
      const resCandidates = candidatesByReservation.get(res.id) ?? [];
      const assigned =
        resCandidates.find((c) => c.is_assigned) ??
        resCandidates[0] ??
        null;

      const instanceId = assigned?.workspace_instance_id ?? null;

      if (!instanceId || !instancesMap.has(instanceId)) {
        continue;
      }

      const startAtIso = assigned?.start_at ?? res.created_at;
      const startTime = new Date(startAtIso).getTime();

      if (fromTime !== null && startTime < fromTime) {
        continue;
      }
      if (toTime !== null && startTime > toTime) {
        continue;
      }

      let hours = 1;
      if (assigned?.start_at && assigned?.end_at) {
        const diffMs =
          new Date(assigned.end_at).getTime() -
          new Date(assigned.start_at).getTime();
        hours = Math.max(0, diffMs / (1000 * 60 * 60));
      }

      const stat = statsByInstance.get(instanceId)!;
      stat.bookingCount += 1;
      stat.totalHours += hours;

      const bookedAtIso = res.created_at || startAtIso;
      if (
        !stat.latestBookedAt ||
        new Date(bookedAtIso).getTime() > new Date(stat.latestBookedAt).getTime()
      ) {
        stat.latestBookedAt = bookedAtIso;
      }
    }

    const records: WorkspaceUsageRecord[] = [];

    for (const inst of instances ?? []) {
      const template = templatesMap.get(inst.template_id);
      const stat = statsByInstance.get(inst.id) ?? {
        bookingCount: 0,
        totalHours: 0,
        latestBookedAt: null,
      };

      const tier = template?.rate_amount !== undefined
        ? `₱${Number(template.rate_amount)}/hr`
        : "Standard";

      records.push({
        instanceId: inst.id,
        instanceName: inst.display_name || inst.instance_code || "Workspace",
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
