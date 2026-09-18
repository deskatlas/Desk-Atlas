import type {
  AvailabilityRepository,
  BlockingReservationWindow,
  BusinessAvailabilitySettings,
  OperatingHoursInterval,
  ScheduleBlock,
} from '../models/availability';
import type {
  Floor,
  WorkspaceInstanceDetails,
  WorkspaceOperationalStatus,
  WorkspaceTemplate,
} from '../models/workspace';

type BusinessSettingsRow = {
  timezone: string;
  booking_interval_minutes: number;
};

type OperatingHoursRow = {
  id: string;
  day_of_week: number;
  opens_at: string;
  closes_at: string;
  is_active: boolean;
};

type ScheduleBlockRow = {
  id: string;
  scope: 'BUSINESS' | 'WORKSPACE';
  workspace_instance_id: string | null;
  block_type: string;
  start_at: string;
  end_at: string;
  reason: string | null;
};

type WorkspaceTemplateRow = {
  id: string;
  name: string;
  description: string | null;
  photo_path: string | null;
  capacity: number;
  rate_amount: string | number;
  pricing_unit: 'HOURLY';
  default_shape: string;
  default_color: string;
  default_style: Record<string, unknown> | null;
  is_active: boolean;
};

type FloorRow = {
  id: string;
  name: string;
  floor_number: number | null;
  display_order: number;
  is_active: boolean;
};

type WorkspaceInstanceRow = {
  id: string;
  template_id: string;
  floor_id: string;
  instance_code: string;
  display_name: string;
  operational_status: WorkspaceOperationalStatus;
  template: WorkspaceTemplateRow | null;
  floor: FloorRow | null;
};

type BlockingReservationRow = {
  start_at: string;
  end_at: string;
  reservation: {
    id: string;
    status: string;
    created_at?: string;
  } | null;
};

export class SupabaseAvailabilityRepository implements AvailabilityRepository {
  private readonly restUrl: string;
  private readonly serviceRoleKey: string;

  constructor(options?: { supabaseUrl?: string; serviceRoleKey?: string }) {
    const supabaseUrl =
      options?.supabaseUrl ?? process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = options?.serviceRoleKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl) {
      throw new Error('SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL is required for availability routes');
    }

    if (!serviceRoleKey) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for availability routes');
    }

    this.restUrl = `${supabaseUrl.replace(/\/$/, '')}/rest/v1`;
    this.serviceRoleKey = serviceRoleKey;
  }

  async getWorkspaceInstance(instanceId: string): Promise<WorkspaceInstanceDetails | null> {
    const rows = await this.request<WorkspaceInstanceRow[]>(
      `/workspace_instances?select=id,template_id,floor_id,instance_code,display_name,operational_status,template:workspace_templates(id,name,description,photo_path,capacity,rate_amount,pricing_unit,default_shape,default_color,default_style,is_active),floor:floors(id,name,floor_number,display_order,is_active)&id=eq.${encodeURIComponent(
        instanceId
      )}&limit=1`
    );
    const row = rows[0];
    if (!row || !row.template || !row.floor) {
      return null;
    }

    return {
      id: row.id,
      templateId: row.template_id,
      floorId: row.floor_id,
      instanceCode: row.instance_code,
      displayName: row.display_name,
      operationalStatus: row.operational_status,
      template: mapWorkspaceTemplate(row.template),
      floor: mapFloor(row.floor),
    };
  }

  async listWorkspaceInstancesByTemplate(templateId: string): Promise<WorkspaceInstanceDetails[]> {
    const rows = await this.request<WorkspaceInstanceRow[]>(
      `/workspace_instances?select=id,template_id,floor_id,instance_code,display_name,operational_status,template:workspace_templates(id,name,description,photo_path,capacity,rate_amount,pricing_unit,default_shape,default_color,default_style,is_active),floor:floors(id,name,floor_number,display_order,is_active)&template_id=eq.${encodeURIComponent(
        templateId
      )}&operational_status=neq.INACTIVE`
    );

    return rows
      .filter((row) => row.template && row.floor && row.template.is_active && row.floor.is_active)
      .map((row) => ({
        id: row.id,
        templateId: row.template_id,
        floorId: row.floor_id,
        instanceCode: row.instance_code,
        displayName: row.display_name,
        operationalStatus: row.operational_status,
        template: mapWorkspaceTemplate(row.template!),
        floor: mapFloor(row.floor!),
      }));
  }

  async getBusinessSettings(): Promise<BusinessAvailabilitySettings> {
    const rows = await this.request<BusinessSettingsRow[]>(
      '/business_settings?select=timezone,booking_interval_minutes&id=eq.1&limit=1'
    );
    const row = rows[0];
    if (!row) {
      return {
        timezone: 'Asia/Manila',
        bookingIntervalMinutes: 30,
      };
    }

    return {
      timezone: row.timezone,
      bookingIntervalMinutes: row.booking_interval_minutes,
    };
  }

  async listOperatingHours(dayOfWeek: number): Promise<OperatingHoursInterval[]> {
    const rows = await this.request<OperatingHoursRow[]>(
      `/operating_hours?select=id,day_of_week,opens_at,closes_at,is_active&day_of_week=eq.${dayOfWeek}&is_active=eq.true&order=opens_at.asc`
    );

    return rows.map((row) => ({
      id: row.id,
      dayOfWeek: row.day_of_week,
      opensAt: row.opens_at,
      closesAt: row.closes_at,
      isActive: row.is_active,
    }));
  }

  async listScheduleBlocks(
    workspaceInstanceId: string,
    rangeStartIso: string,
    rangeEndIso: string
  ): Promise<ScheduleBlock[]> {
    const rows = await this.request<ScheduleBlockRow[]>(
      `/schedule_blocks?select=id,scope,workspace_instance_id,block_type,start_at,end_at,reason&start_at=lt.${encodeURIComponent(
        rangeEndIso
      )}&end_at=gt.${encodeURIComponent(
        rangeStartIso
      )}&or=(scope.eq.BUSINESS,workspace_instance_id.eq.${encodeURIComponent(workspaceInstanceId)})`
    );

    return rows.map((row) => ({
      id: row.id,
      scope: row.scope,
      workspaceInstanceId: row.workspace_instance_id,
      blockType: row.block_type,
      startAt: row.start_at,
      endAt: row.end_at,
      reason: row.reason,
    }));
  }

  async listBlockingReservations(
    workspaceInstanceId: string,
    rangeStartIso: string,
    rangeEndIso: string
  ): Promise<BlockingReservationWindow[]> {
    const [assignedRows, pendingRows] = await Promise.all([
      this.request<BlockingReservationRow[]>(
        `/reservation_candidates?select=start_at,end_at,reservation:reservations!inner(id,status,created_at)&workspace_instance_id=eq.${encodeURIComponent(
          workspaceInstanceId
        )}&start_at=lt.${encodeURIComponent(rangeEndIso)}&end_at=gt.${encodeURIComponent(
          rangeStartIso
        )}&is_assigned=eq.true&reservation.status=in.(CONFIRMED,CHECKED_IN)`
      ),
      this.request<BlockingReservationRow[]>(
        `/reservation_candidates?select=start_at,end_at,reservation:reservations!inner(id,status,created_at)&workspace_instance_id=eq.${encodeURIComponent(
          workspaceInstanceId
        )}&start_at=lt.${encodeURIComponent(rangeEndIso)}&end_at=gt.${encodeURIComponent(
          rangeStartIso
        )}&reservation.status=in.(PENDING_PAYMENT,PAYMENT_UNDER_REVIEW,PENDING_COUNTER_CONFIRMATION)`
      ).catch(() => []),
    ]);

    const nowMs = Date.now();
    const validPendingRows = (pendingRows || []).filter((row) => {
      if (!row.reservation) return false;
      if (row.reservation.status === 'PENDING_PAYMENT' && row.reservation.created_at) {
        const createdAtMs = new Date(row.reservation.created_at).getTime();
        // 1 hour (60 minutes) payment session window
        if (nowMs - createdAtMs > 60 * 60 * 1000) {
          return false;
        }
      }
      return true;
    });

    const combined = [...(assignedRows || []), ...validPendingRows];

    return combined
      .filter((row) => row.reservation)
      .map((row) => ({
        reservationId: row.reservation!.id,
        reservationStatus: row.reservation!.status,
        startAt: row.start_at,
        endAt: row.end_at,
      }));
  }

  async listOccupiedInstanceDetails(
    rangeStartIso: string,
    rangeEndIso: string
  ): Promise<Array<{ workspaceInstanceId: string; bookingEndAt: string | null }>> {
    const [candidateRows, pendingRows, blockRows] = await Promise.all([
      this.request<Array<{ workspace_instance_id: string; end_at?: string }>>(
        `/reservation_candidates?select=workspace_instance_id,start_at,end_at,is_assigned,reservation:reservations!inner(id,status)&start_at=lt.${encodeURIComponent(
          rangeEndIso
        )}&end_at=gt.${encodeURIComponent(
          rangeStartIso
        )}&is_assigned=eq.true&reservation.status=in.(CONFIRMED,CHECKED_IN)`
      ),
      this.request<Array<{ workspace_instance_id: string; end_at?: string; reservation?: { id: string; status: string; created_at?: string } }>>(
        `/reservation_candidates?select=workspace_instance_id,start_at,end_at,reservation:reservations!inner(id,status,created_at)&start_at=lt.${encodeURIComponent(
          rangeEndIso
        )}&end_at=gt.${encodeURIComponent(
          rangeStartIso
        )}&reservation.status=in.(PENDING_PAYMENT,PAYMENT_UNDER_REVIEW,PENDING_COUNTER_CONFIRMATION)`
      ).catch(() => []),
      this.request<Array<{ workspace_instance_id: string | null; end_at?: string; scope: string }>>(
        `/schedule_blocks?select=workspace_instance_id,start_at,end_at,scope&start_at=lt.${encodeURIComponent(
          rangeEndIso
        )}&end_at=gt.${encodeURIComponent(
          rangeStartIso
        )}`
      ).catch(() => []),
    ]);

    const detailsMap = new Map<string, string | null>();
    for (const r of candidateRows || []) {
      if (r.workspace_instance_id) {
        const existingEnd = detailsMap.get(r.workspace_instance_id);
        const endAt = r.end_at || null;
        if (!existingEnd || (endAt && new Date(endAt).getTime() > new Date(existingEnd).getTime())) {
          detailsMap.set(r.workspace_instance_id, endAt);
        }
      }
    }
    const nowMs = Date.now();
    for (const p of pendingRows || []) {
      if (p.workspace_instance_id && p.reservation) {
        if (p.reservation.status === 'PENDING_PAYMENT' && p.reservation.created_at) {
          const createdAtMs = new Date(p.reservation.created_at).getTime();
          if (nowMs - createdAtMs > 60 * 60 * 1000) {
            continue;
          }
        }
        const existingEnd = detailsMap.get(p.workspace_instance_id);
        const endAt = p.end_at || null;
        if (!existingEnd || (endAt && new Date(endAt).getTime() > new Date(existingEnd).getTime())) {
          detailsMap.set(p.workspace_instance_id, endAt);
        }
      }
    }
    const hasBusinessClosure = (blockRows || []).some((b) => b.scope === 'BUSINESS');
    if (hasBusinessClosure) {
      const allInstances = await this.request<Array<{ id: string }>>(
        `/workspace_instances?select=id&operational_status=neq.INACTIVE`
      ).catch(() => []);
      const closureBlock = (blockRows || []).find((b) => b.scope === 'BUSINESS');
      const closureEnd = closureBlock?.end_at || null;
      for (const inst of allInstances) {
        if (!detailsMap.has(inst.id)) {
          detailsMap.set(inst.id, closureEnd);
        }
      }
    }
    for (const b of blockRows || []) {
      if (b.workspace_instance_id) {
        if (!detailsMap.has(b.workspace_instance_id)) {
          detailsMap.set(b.workspace_instance_id, b.end_at || null);
        }
      }
    }

    return Array.from(detailsMap.entries()).map(([workspaceInstanceId, bookingEndAt]) => ({
      workspaceInstanceId,
      bookingEndAt,
    }));
  }

  async listOccupiedInstances(
    rangeStartIso: string,
    rangeEndIso: string
  ): Promise<string[]> {
    const details = await this.listOccupiedInstanceDetails(rangeStartIso, rangeEndIso);
    return details.map((d) => d.workspaceInstanceId);
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers = new Headers(options.headers);
    headers.set('apikey', this.serviceRoleKey);
    headers.set('Authorization', `Bearer ${this.serviceRoleKey}`);
    headers.set('Content-Type', 'application/json');

    const response = await fetch(`${this.restUrl}${path}`, {
      ...options,
      headers,
      cache: 'no-store',
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Supabase availability request failed (${response.status}): ${detail}`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const text = await response.text();
    return text ? (JSON.parse(text) as T) : (undefined as T);
  }
}

function mapWorkspaceTemplate(row: WorkspaceTemplateRow): WorkspaceTemplate {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    photoPath: row.photo_path,
    capacity: row.capacity,
    rateAmount: Number(row.rate_amount),
    pricingUnit: row.pricing_unit,
    defaultShape: row.default_shape,
    defaultColor: row.default_color,
    defaultStyle: row.default_style ?? {},
    isActive: row.is_active,
  };
}

function mapFloor(row: FloorRow): Floor {
  return {
    id: row.id,
    name: row.name,
    floorNumber: row.floor_number,
    displayOrder: row.display_order,
    isActive: row.is_active,
  };
}
