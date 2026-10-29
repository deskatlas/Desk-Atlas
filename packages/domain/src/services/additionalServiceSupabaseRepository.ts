import type {
  AdditionalService,
  AdditionalServiceType,
  CreateAdditionalServiceInput,
  UpdateAdditionalServiceInput,
} from '../models/additionalService';
import type { AdditionalServiceRepository } from './additionalServiceRepository';

type AdditionalServiceRow = {
  id: string;
  name: string;
  description: string;
  service_type: 'rental' | 'one_time';
  hourly_rate: string | number | null;
  daily_rate: string | number | null;
  total_inventory: number;
  available_inventory: number;
  details: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

function mapAdditionalServiceRow(row: AdditionalServiceRow): AdditionalService {
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    serviceType: row.service_type,
    hourlyRate:
      row.hourly_rate !== null && row.hourly_rate !== undefined ? Number(row.hourly_rate) : null,
    dailyRate:
      row.daily_rate !== null && row.daily_rate !== undefined ? Number(row.daily_rate) : null,
    totalInventory: row.total_inventory ?? 0,
    availableInventory: row.available_inventory ?? 0,
    details: row.details || '',
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SupabaseAdditionalServiceRepository implements AdditionalServiceRepository {
  private readonly restUrl: string;
  private readonly serviceRoleKey: string;

  constructor(options?: { supabaseUrl?: string; serviceRoleKey?: string }) {
    const supabaseUrl =
      options?.supabaseUrl ?? process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = options?.serviceRoleKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl) {
      throw new Error('SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL is required for services repository');
    }

    if (!serviceRoleKey) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for services repository');
    }

    this.restUrl = `${supabaseUrl.replace(/\/$/, '')}/rest/v1`;
    this.serviceRoleKey = serviceRoleKey;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('apikey', this.serviceRoleKey);
    headers.set('Authorization', `Bearer ${this.serviceRoleKey}`);
    headers.set('Content-Type', 'application/json');

    const res = await fetch(`${this.restUrl}${path}`, {
      ...init,
      headers,
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Additional Services Supabase error [${res.status}]: ${body}`);
    }

    if (res.status === 204) {
      return undefined as T;
    }

    return (await res.json()) as T;
  }

  async listAdditionalServices(filter?: {
    isActive?: boolean;
    serviceType?: AdditionalServiceType;
  }): Promise<AdditionalService[]> {
    let query = '/additional_services?select=*&order=created_at.desc';
    if (filter?.isActive !== undefined) {
      query += `&is_active=eq.${filter.isActive}`;
    }
    if (filter?.serviceType !== undefined) {
      query += `&service_type=eq.${filter.serviceType}`;
    }
    const rows = await this.request<AdditionalServiceRow[]>(query);
    return rows.map(mapAdditionalServiceRow);
  }

  async getAdditionalServiceById(id: string): Promise<AdditionalService | null> {
    const rows = await this.request<AdditionalServiceRow[]>(
      `/additional_services?id=eq.${encodeURIComponent(id)}&select=*&limit=1`
    );
    if (!rows || rows.length === 0) return null;
    return mapAdditionalServiceRow(rows[0]);
  }

  async createAdditionalService(input: CreateAdditionalServiceInput): Promise<AdditionalService> {
    const totalInventory = input.serviceType === 'rental' ? (input.totalInventory ?? 1) : 0;
    const payload = {
      name: input.name.trim(),
      description: input.description?.trim() ?? '',
      service_type: input.serviceType,
      hourly_rate: input.serviceType === 'rental' ? (input.hourlyRate ?? null) : null,
      daily_rate: input.serviceType === 'rental' ? (input.dailyRate ?? null) : null,
      total_inventory: totalInventory,
      available_inventory: totalInventory,
      details: input.details?.trim() ?? '',
      is_active: input.isActive ?? true,
    };

    const rows = await this.request<AdditionalServiceRow[]>('/additional_services?select=*', {
      method: 'POST',
      headers: {
        Prefer: 'return=representation',
      },
      body: JSON.stringify(payload),
    });

    if (!rows || rows.length === 0) {
      throw new Error('Failed to create additional service record.');
    }

    return mapAdditionalServiceRow(rows[0]);
  }

  async updateAdditionalService(
    id: string,
    input: UpdateAdditionalServiceInput
  ): Promise<AdditionalService> {
    const payload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (input.name !== undefined) payload.name = input.name.trim();
    if (input.description !== undefined) payload.description = input.description.trim();
    if (input.serviceType !== undefined) payload.service_type = input.serviceType;
    if (input.hourlyRate !== undefined) payload.hourly_rate = input.hourlyRate;
    if (input.dailyRate !== undefined) payload.daily_rate = input.dailyRate;
    if (input.totalInventory !== undefined) payload.total_inventory = input.totalInventory;
    if (input.availableInventory !== undefined) payload.available_inventory = input.availableInventory;
    if (input.details !== undefined) payload.details = input.details.trim();
    if (input.isActive !== undefined) payload.is_active = input.isActive;

    const rows = await this.request<AdditionalServiceRow[]>(
      `/additional_services?id=eq.${encodeURIComponent(id)}&select=*`,
      {
        method: 'PATCH',
        headers: {
          Prefer: 'return=representation',
        },
        body: JSON.stringify(payload),
      }
    );

    if (!rows || rows.length === 0) {
      throw new Error(`Additional service not found: ${id}`);
    }

    return mapAdditionalServiceRow(rows[0]);
  }

  async deleteAdditionalService(id: string): Promise<boolean> {
    await this.request(`/additional_services?id=eq.${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    return true;
  }
}

