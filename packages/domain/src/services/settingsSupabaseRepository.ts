import type {
  AdminPaymentMethod,
  BusinessSettings,
  CreatePaymentMethodInput,
  UpdateBusinessSettingsInput,
  UpdatePaymentMethodInput,
} from '../models/settings';
import type { OperatingHoursInterval, ScheduleBlock } from '../models/availability';
import type { SettingsRepository } from './settingsRepository';

type BusinessSettingsRow = {
  id: number;
  business_name: string;
  timezone: string;
  contact_email: string | null;
  contact_phone: string | null;
  booking_interval_minutes: number;
  payment_expiry_minutes: number;
  kiosk_timeout_minutes: number | null;
  landing_preview_photos?: any;
  updated_at: string | null;
};

type OperatingHoursRow = {
  id: string;
  day_of_week: number;
  opens_at: string;
  closes_at: string;
  is_active: boolean;
};

type PaymentMethodRow = {
  id: string;
  method_type: 'GCASH' | 'BANK' | 'CASH';
  display_name: string;
  account_name: string | null;
  account_number: string | null;
  qr_image_path: string | null;
  instructions: string | null;
  allow_web: boolean;
  allow_kiosk: boolean;
  is_active: boolean;
  display_order: number;
};

type ScheduleBlockRow = {
  id: string;
  scope: 'BUSINESS' | 'WORKSPACE';
  workspace_instance_id: string | null;
  block_type: string;
  start_at: string;
  end_at: string;
  reason: string | null;
  created_by_user_id: string | null;
  created_at: string;
};


export class SupabaseSettingsRepository implements SettingsRepository {
  private readonly restUrl: string;
  private readonly serviceRoleKey: string;

  constructor(options?: { supabaseUrl?: string; serviceRoleKey?: string }) {
    const supabaseUrl =
      options?.supabaseUrl ?? process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = options?.serviceRoleKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl) {
      throw new Error('SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL is required for settings');
    }

    if (!serviceRoleKey) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for settings');
    }

    this.restUrl = `${supabaseUrl.replace(/\/$/, '')}/rest/v1`;
    this.serviceRoleKey = serviceRoleKey;
  }

  async getBusinessSettings(): Promise<BusinessSettings> {
    const rows = await this.request<BusinessSettingsRow[]>(
      '/business_settings?select=id,business_name,timezone,contact_email,contact_phone,booking_interval_minutes,payment_expiry_minutes,kiosk_timeout_minutes,landing_preview_photos,updated_at&id=eq.1&limit=1'
    ).catch(async () => {
      // Fallback if landing_preview_photos column is not yet queried
      return this.request<BusinessSettingsRow[]>(
        '/business_settings?select=id,business_name,timezone,contact_email,contact_phone,booking_interval_minutes,payment_expiry_minutes,kiosk_timeout_minutes,updated_at&id=eq.1&limit=1'
      );
    });
    const row = rows[0];
    if (!row) {
      return {
        id: 1,
        businessName: 'DeskAtlas Manila',
        timezone: 'Asia/Manila',
        contactEmail: null,
        contactPhone: null,
        bookingIntervalMinutes: 30,
        paymentExpiryMinutes: 60,
        kioskTimeoutMinutes: 5,
        landingPreviewPhotos: [],
      };
    }

    return {
      id: row.id,
      businessName: row.business_name,
      timezone: row.timezone,
      contactEmail: row.contact_email,
      contactPhone: row.contact_phone,
      bookingIntervalMinutes: row.booking_interval_minutes,
      paymentExpiryMinutes: row.payment_expiry_minutes,
      kioskTimeoutMinutes: row.kiosk_timeout_minutes,
      landingPreviewPhotos: Array.isArray(row.landing_preview_photos) ? row.landing_preview_photos : [],
      updatedAt: row.updated_at,
    };
  }

  async updateBusinessSettings(
    input: UpdateBusinessSettingsInput,
    updatedByUserId?: string | null
  ): Promise<BusinessSettings> {
    const payload: Record<string, unknown> = {
      business_name: input.businessName,
      timezone: input.timezone,
      contact_email: input.contactEmail,
      contact_phone: input.contactPhone,
      booking_interval_minutes: input.bookingIntervalMinutes,
      payment_expiry_minutes: input.paymentExpiryMinutes,
      kiosk_timeout_minutes: input.kioskTimeoutMinutes,
      updated_at: new Date().toISOString(),
    };

    if (input.landingPreviewPhotos !== undefined) {
      payload.landing_preview_photos = input.landingPreviewPhotos;
    }

    if (updatedByUserId) {
      payload.updated_by_user_id = updatedByUserId;
    }

    const rows = await this.request<BusinessSettingsRow[]>('/business_settings?id=eq.1', {
      method: 'PATCH',
      headers: {
        Prefer: 'return=representation',
      },
      body: JSON.stringify(payload),
    });

    let row = rows[0];
    if (!row) {
      const insertPayload = { id: 1, ...payload };
      const insertRows = await this.request<BusinessSettingsRow[]>('/business_settings', {
        method: 'POST',
        headers: {
          Prefer: 'return=representation,resolution=merge-duplicates',
        },
        body: JSON.stringify([insertPayload]),
      });
      row = insertRows[0];
    }

    if (!row) {
      throw new Error('Failed to update business settings');
    }

    return {
      id: row.id,
      businessName: row.business_name,
      timezone: row.timezone,
      contactEmail: row.contact_email,
      contactPhone: row.contact_phone,
      bookingIntervalMinutes: row.booking_interval_minutes,
      paymentExpiryMinutes: row.payment_expiry_minutes,
      kioskTimeoutMinutes: row.kiosk_timeout_minutes,
      landingPreviewPhotos: Array.isArray(row.landing_preview_photos) ? row.landing_preview_photos : [],
      updatedAt: row.updated_at,
    };
  }

  async listOperatingHours(): Promise<OperatingHoursInterval[]> {
    const rows = await this.request<OperatingHoursRow[]>(
      '/operating_hours?select=id,day_of_week,opens_at,closes_at,is_active&order=day_of_week.asc,opens_at.asc'
    );

    return rows.map((row) => ({
      id: row.id,
      dayOfWeek: row.day_of_week,
      opensAt: row.opens_at,
      closesAt: row.closes_at,
      isActive: row.is_active,
    }));
  }

  async replaceOperatingHours(
    intervals: Array<{
      dayOfWeek: number;
      opensAt: string;
      closesAt: string;
      isActive?: boolean;
    }>
  ): Promise<OperatingHoursInterval[]> {
    // Delete all existing operating hours
    await this.request('/operating_hours?day_of_week=gte.0', {
      method: 'DELETE',
    });

    if (intervals.length === 0) {
      return [];
    }

    const rowsToInsert = intervals.map((i) => ({
      day_of_week: i.dayOfWeek,
      opens_at: i.opensAt,
      closes_at: i.closesAt,
      is_active: i.isActive !== undefined ? i.isActive : true,
    }));

    const inserted = await this.request<OperatingHoursRow[]>('/operating_hours', {
      method: 'POST',
      headers: {
        Prefer: 'return=representation',
      },
      body: JSON.stringify(rowsToInsert),
    });

    return inserted.map((row) => ({
      id: row.id,
      dayOfWeek: row.day_of_week,
      opensAt: row.opens_at,
      closesAt: row.closes_at,
      isActive: row.is_active,
    }));
  }

  async listPaymentMethods(): Promise<AdminPaymentMethod[]> {
    const rows = await this.request<PaymentMethodRow[]>(
      '/payment_methods?select=id,method_type,display_name,account_name,account_number,qr_image_path,instructions,allow_web,allow_kiosk,is_active,display_order&order=display_order.asc,created_at.asc'
    );

    return rows.map((row) => ({
      id: row.id,
      methodType: row.method_type,
      displayName: row.display_name,
      accountName: row.account_name,
      accountNumber: row.account_number,
      qrImagePath: row.qr_image_path,
      instructions: row.instructions,
      allowWeb: row.allow_web,
      allowKiosk: row.allow_kiosk,
      isActive: row.is_active,
      displayOrder: row.display_order,
    }));
  }

  async createPaymentMethod(input: CreatePaymentMethodInput): Promise<AdminPaymentMethod> {
    let displayOrder = input.displayOrder;
    if (displayOrder === undefined) {
      const existing = await this.listPaymentMethods();
      const maxOrder = existing.reduce((max, p) => Math.max(max, p.displayOrder), 0);
      displayOrder = maxOrder + 1;
    }

    const payload: Record<string, unknown> = {
      method_type: input.methodType,
      display_name: input.displayName,
      account_name: input.accountName ?? null,
      account_number: input.accountNumber ?? null,
      qr_image_path: input.qrImagePath ?? null,
      instructions: input.instructions ?? null,
      allow_web: input.allowWeb,
      allow_kiosk: input.allowKiosk,
      is_active: input.isActive !== undefined ? input.isActive : true,
      display_order: displayOrder,
    };

    const rows = await this.request<PaymentMethodRow[]>('/payment_methods', {
      method: 'POST',
      headers: {
        Prefer: 'return=representation',
      },
      body: JSON.stringify([payload]),
    });

    const row = rows[0];
    if (!row) {
      throw new Error('Failed to create payment method');
    }

    return {
      id: row.id,
      methodType: row.method_type,
      displayName: row.display_name,
      accountName: row.account_name,
      accountNumber: row.account_number,
      qrImagePath: row.qr_image_path,
      instructions: row.instructions,
      allowWeb: row.allow_web,
      allowKiosk: row.allow_kiosk,
      isActive: row.is_active,
      displayOrder: row.display_order,
    };
  }

  async updatePaymentMethod(input: UpdatePaymentMethodInput): Promise<AdminPaymentMethod> {
    const payload: Record<string, unknown> = {
      display_name: input.displayName,
      account_name: input.accountName,
      account_number: input.accountNumber,
      qr_image_path: input.qrImagePath,
      instructions: input.instructions,
      allow_web: input.allowWeb,
      allow_kiosk: input.allowKiosk ?? false,
      is_active: input.isActive,
      updated_at: new Date().toISOString(),
    };

    if (input.methodType) {
      payload.method_type = input.methodType;
    }

    if (input.displayOrder !== undefined) {
      payload.display_order = input.displayOrder;
    }

    const rows = await this.request<PaymentMethodRow[]>(
      `/payment_methods?id=eq.${encodeURIComponent(input.id)}`,
      {
        method: 'PATCH',
        headers: {
          Prefer: 'return=representation',
        },
        body: JSON.stringify(payload),
      }
    );

    const row = rows[0];
    if (!row) {
      throw new Error(`Payment method ${input.id} not found`);
    }

    return {
      id: row.id,
      methodType: row.method_type,
      displayName: row.display_name,
      accountName: row.account_name,
      accountNumber: row.account_number,
      qrImagePath: row.qr_image_path,
      instructions: row.instructions,
      allowWeb: row.allow_web,
      allowKiosk: row.allow_kiosk,
      isActive: row.is_active,
      displayOrder: row.display_order,
    };
  }

  async deletePaymentMethod(id: string): Promise<void> {
    await this.request(`/payment_methods?id=eq.${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  async reorderPaymentMethods(orderedIds: string[]): Promise<AdminPaymentMethod[]> {
    for (let i = 0; i < orderedIds.length; i++) {
      const id = orderedIds[i];
      await this.request(`/payment_methods?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ display_order: i + 1000 }),
      });
    }
    for (let i = 0; i < orderedIds.length; i++) {
      const id = orderedIds[i];
      await this.request(`/payment_methods?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ display_order: i + 1 }),
      });
    }
    return this.listPaymentMethods();
  }

  async listBusinessScheduleBlocks(): Promise<ScheduleBlock[]> {
    const rows = await this.request<ScheduleBlockRow[]>(
      '/schedule_blocks?select=id,scope,workspace_instance_id,block_type,start_at,end_at,reason,created_by_user_id,created_at&scope=eq.BUSINESS&order=start_at.asc'
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

  async createScheduleBlock(block: {
    scope: 'BUSINESS' | 'WORKSPACE';
    workspaceInstanceId?: string | null;
    blockType: string;
    startAt: string;
    endAt: string;
    reason?: string | null;
    createdByUserId?: string | null;
  }): Promise<ScheduleBlock> {
    const payload: Record<string, unknown> = {
      scope: block.scope,
      workspace_instance_id: block.workspaceInstanceId ?? null,
      block_type: block.blockType,
      start_at: block.startAt,
      end_at: block.endAt,
      reason: block.reason ?? null,
    };

    if (block.createdByUserId) {
      payload.created_by_user_id = block.createdByUserId;
    }

    const rows = await this.request<ScheduleBlockRow[]>('/schedule_blocks', {
      method: 'POST',
      headers: {
        Prefer: 'return=representation',
      },
      body: JSON.stringify([payload]),
    });

    const row = rows[0];
    if (!row) {
      throw new Error('Failed to create schedule block');
    }

    return {
      id: row.id,
      scope: row.scope,
      workspaceInstanceId: row.workspace_instance_id,
      blockType: row.block_type,
      startAt: row.start_at,
      endAt: row.end_at,
      reason: row.reason,
    };
  }

  async deleteScheduleBlocks(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const filter = ids.map((id) => `"${id}"`).join(',');
    await this.request(`/schedule_blocks?id=in.(${filter})`, {
      method: 'DELETE',
    });
  }

  async deleteBusinessScheduleBlocksForDateRange(startIso: string, endIso: string): Promise<void> {
    await this.request(
      `/schedule_blocks?scope=eq.BUSINESS&start_at=lt.${encodeURIComponent(endIso)}&end_at=gt.${encodeURIComponent(startIso)}`,
      {
        method: 'DELETE',
      }
    );
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
      throw new Error(`Supabase settings request failed (${response.status}): ${detail}`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const text = await response.text();
    return text ? (JSON.parse(text) as T) : (undefined as T);
  }
}
