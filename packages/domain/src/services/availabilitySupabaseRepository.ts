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
import {
  type CacheInvalidationRegistry,
  getProjectReferenceCaches,
  ensureReferenceDataRealtimeInvalidation,
  normalizeSupabaseProjectUrl,
  QueryCache,
  loadReferenceData,
} from './referenceDataCache';

type AvailabilityReferenceValue = BusinessAvailabilitySettings | OperatingHoursInterval[];

type BusinessSettingsRow = {
  timezone: string;
  booking_interval_minutes: number;
  max_advance_booking_days?: number | null;
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
    status: BlockingReservationWindow['reservationStatus'];
    created_at?: string;
  } | null;
};

export class SupabaseAvailabilityRepository implements AvailabilityRepository {
  private readonly restUrl: string;
  private readonly serviceRoleKey: string;
  private readonly requestSignal?: AbortSignal;
  private readonly projectUrl: string;
  private readonly cache: QueryCache<AvailabilityReferenceValue>;

  constructor(options?: {
    supabaseUrl?: string;
    serviceRoleKey?: string;
    cache?: QueryCache<AvailabilityReferenceValue>;
    invalidationRegistry?: CacheInvalidationRegistry;
    // MS77-TC09/11: optional request-bound cancellation for authoritative reads.
    signal?: AbortSignal;
  }) {
    const supabaseUrl =
      options?.supabaseUrl ?? process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = options?.serviceRoleKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl) {
      throw new Error('SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL is required for availability routes');
    }

    if (!serviceRoleKey) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for availability routes');
    }

    this.projectUrl = normalizeSupabaseProjectUrl(supabaseUrl);
    this.restUrl = `${this.projectUrl}/rest/v1`;
    this.serviceRoleKey = serviceRoleKey;
    this.requestSignal = options?.signal;
    const projectCaches = getProjectReferenceCaches(this.projectUrl);
    this.cache = options?.cache ?? (projectCaches.referenceData as QueryCache<AvailabilityReferenceValue>);
    const registry = options?.invalidationRegistry ?? projectCaches.invalidationRegistry;
    ensureReferenceDataRealtimeInvalidation(this.projectUrl, this.serviceRoleKey, registry);
    registry.registerCache('business_settings', this.cache, this.cacheKey('availability-business-settings'));
    registry.registerCache('operating_hours', this.cache, this.cacheKey('operating-hours:'));
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
    return loadReferenceData(this.cache, this.cacheKey('availability-business-settings'), () => this.loadBusinessSettings());
  }

  private async loadBusinessSettings(): Promise<BusinessAvailabilitySettings> {
    const rows = await this.request<BusinessSettingsRow[]>(
      '/business_settings?select=timezone,booking_interval_minutes,max_advance_booking_days&id=eq.1&limit=1'
    ).catch(async () => {
      return this.request<BusinessSettingsRow[]>(
        '/business_settings?select=timezone,booking_interval_minutes&id=eq.1&limit=1'
      );
    });
    const row = rows[0];
    if (!row) {
      return {
        timezone: 'Asia/Manila',
        bookingIntervalMinutes: 30,
        maxAdvanceBookingDays: 90,
      };
    }

    return {
      timezone: row.timezone,
      bookingIntervalMinutes: row.booking_interval_minutes,
      maxAdvanceBookingDays: row.max_advance_booking_days ?? 90,
    };
  }

  async listOperatingHours(dayOfWeek: number): Promise<OperatingHoursInterval[]> {
    return loadReferenceData(this.cache, this.cacheKey(`operating-hours:${dayOfWeek}`), () => this.loadOperatingHours(dayOfWeek));
  }

  private async loadOperatingHours(dayOfWeek: number): Promise<OperatingHoursInterval[]> {
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
    // PRD-F4: pending selections and payment reviews never hold inventory.
    const combined = await this.request<BlockingReservationRow[]>(
      `/reservation_candidates?select=start_at,end_at,reservation:reservations!inner(id,status,created_at)&workspace_instance_id=eq.${encodeURIComponent(
          workspaceInstanceId
        )}&start_at=lt.${encodeURIComponent(rangeEndIso)}&end_at=gt.${encodeURIComponent(
          rangeStartIso
        )}&is_assigned=eq.true&reservation.status=in.(CONFIRMED,CHECKED_IN)`
    );

    return combined
      .filter((row) => row.reservation)
      .map((row) => ({
        reservationId: row.reservation!.id,
        reservationStatus: row.reservation!.status,
        startAt: row.start_at,
        endAt: row.end_at,
      }));
  }

  // Request-local snapshot for one template search. Never retained by the repository.
  async prepareWindow(instanceIds: string[], startAt: string, endAt: string): Promise<Pick<AvailabilityRepository,
    'listScheduleBlocks' | 'listBlockingReservations'>> {
    const ids = [...new Set(instanceIds)];
    const blocks = new Map<string, ScheduleBlockRow>();
    const windows: Array<BlockingReservationRow & { workspace_instance_id: string }> = [];
    for (let i = 0; i < ids.length; i += 60) {
      const filter = ids.slice(i, i + 60).map(encodeURIComponent).join(',');
      const range = `start_at=lt.${encodeURIComponent(endAt)}&end_at=gt.${encodeURIComponent(startAt)}`;
      const [blockRows, candidateRows] = await Promise.all([
        this.requestWindowRows<ScheduleBlockRow>(`/schedule_blocks?select=id,scope,workspace_instance_id,block_type,start_at,end_at,reason&${range}&or=(scope.eq.BUSINESS,workspace_instance_id.in.(${filter}))`),
        this.requestWindowRows<BlockingReservationRow & { workspace_instance_id: string }>(`/reservation_candidates?select=workspace_instance_id,start_at,end_at,reservation:reservations!inner(id,status,created_at)&${range}&workspace_instance_id=in.(${filter})&is_assigned=eq.true&reservation.status=in.(CONFIRMED,CHECKED_IN)`),
      ]);
      blockRows.forEach(row => blocks.set(row.id, row)); windows.push(...candidateRows);
    }
    const overlaps = (start: string, end: string, from: string, to: string) => Date.parse(start) < Date.parse(to) && Date.parse(end) > Date.parse(from);
    const covered = (from: string, to: string) => Date.parse(from) >= Date.parse(startAt) && Date.parse(to) <= Date.parse(endAt);
    return {
      listScheduleBlocks: async (id, from, to) => {
        if (!ids.includes(id) || !covered(from, to)) return this.listScheduleBlocks(id, from, to);
        return [...blocks.values()].filter(row => (row.scope === 'BUSINESS' || row.workspace_instance_id === id)
          && overlaps(row.start_at, row.end_at, from, to)).map(row => ({ id: row.id, scope: row.scope,
            workspaceInstanceId: row.workspace_instance_id, blockType: row.block_type,
            startAt: row.start_at, endAt: row.end_at, reason: row.reason }));
      },
      listBlockingReservations: async (id, from, to) => {
        if (!ids.includes(id) || !covered(from, to)) return this.listBlockingReservations(id, from, to);
        return windows.filter(row => row.workspace_instance_id === id && row.reservation
          && overlaps(row.start_at, row.end_at, from, to)).map(row => ({ reservationId: row.reservation!.id,
            reservationStatus: row.reservation!.status, startAt: row.start_at, endAt: row.end_at }));
      },
    };
  }

  async listOccupiedInstanceDetails(
    rangeStartIso: string,
    rangeEndIso: string
  ): Promise<Array<{ workspaceInstanceId: string; bookingEndAt: string | null }>> {
    const [candidateRows, blockRows] = await Promise.all([
      this.request<Array<{ workspace_instance_id: string; end_at?: string }>>(
        `/reservation_candidates?select=workspace_instance_id,start_at,end_at,is_assigned,reservation:reservations!inner(id,status)&start_at=lte.${encodeURIComponent(
          rangeEndIso
        )}&end_at=gte.${encodeURIComponent(
          rangeStartIso
        )}&is_assigned=eq.true&reservation.status=in.(CONFIRMED,CHECKED_IN)`
      ),
      this.request<Array<{ workspace_instance_id: string | null; end_at?: string; scope: string }>>(
        `/schedule_blocks?select=workspace_instance_id,start_at,end_at,scope&start_at=lte.${encodeURIComponent(
          rangeEndIso
        )}&end_at=gte.${encodeURIComponent(
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

  private async requestWindowRows<T>(path: string): Promise<T[]> {
    const rows: T[] = [];
    let offset = 0;
    while (true) {
      let total: number | undefined;
      const page = await this.request<T[]>(`${path}&order=id.asc&offset=${offset}&limit=500`,
        { headers: { Prefer: 'count=exact' } }, response => {
          const match = response.headers.get('content-range')?.match(/\/(\d+)$/);
          if (match) total = Number(match[1]);
        });
      rows.push(...page); offset += page.length;
      if (total !== undefined && offset >= total) return rows;
      if (!page.length) {
        if (total !== undefined && total > offset) throw new Error('Incomplete availability window');
        return rows;
      }
      if (total === undefined && page.length < 500) return rows;
    }
  }

  private async request<T>(path: string, options: RequestInit = {}, observe?: (response: Response) => void): Promise<T> {
    const headers = new Headers(options.headers);
    headers.set('apikey', this.serviceRoleKey);
    headers.set('Authorization', `Bearer ${this.serviceRoleKey}`);
    headers.set('Content-Type', 'application/json');

    const response = await fetch(`${this.restUrl}${path}`, {
      ...options,
      headers,
      cache: 'no-store',
      ...(this.requestSignal ? { signal: AbortSignal.any([this.requestSignal, AbortSignal.timeout(10000), ...(options.signal ? [options.signal] : [])]) } : {}),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Supabase availability request failed (${response.status}): ${detail}`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    observe?.(response);

    const text = await response.text();
    return text ? (JSON.parse(text) as T) : (undefined as T);
  }

  private cacheKey(category: string): string {
    return `${this.projectUrl}:${category}`;
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
