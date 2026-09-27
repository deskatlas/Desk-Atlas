import type {
  CreatePromotionalRateInput,
  PromotionalRate,
  RateTargetType,
  UpdatePromotionalRateInput,
} from '../models/promotionalRate';
import type { PromotionalRateRepository } from './promotionalRateRepository';
import { PromotionalValidationError, validatePromotionalRateInput } from './promotionalPricingService';

type PromotionalRateRow = {
  id: string;
  name: string;
  workspace_template_ids: string[];
  rate_type: RateTargetType;
  promotional_price: string | number;
  start_at: string;
  end_at: string;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
};

function mapPromotionalRate(row: PromotionalRateRow): PromotionalRate {
  return {
    id: row.id,
    name: row.name,
    workspaceTemplateIds: row.workspace_template_ids || [],
    rateType: row.rate_type,
    promotionalPrice: Number(row.promotional_price),
    startAt: row.start_at,
    endAt: row.end_at,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SupabasePromotionalRepository implements PromotionalRateRepository {
  private readonly restUrl: string;
  private readonly serviceRoleKey: string;

  constructor(options?: { supabaseUrl?: string; serviceRoleKey?: string }) {
    const supabaseUrl =
      options?.supabaseUrl ?? process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = options?.serviceRoleKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl) {
      throw new Error('SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL is required for promotional routes');
    }

    if (!serviceRoleKey) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for promotional routes');
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
      throw new Error(`Promotional Supabase error [${res.status}]: ${body}`);
    }

    if (res.status === 204) {
      return undefined as T;
    }

    return (await res.json()) as T;
  }

  async listPromotions(options?: { onlyActive?: boolean }): Promise<PromotionalRate[]> {
    let query = '/promotional_rates?select=*&order=created_at.desc';
    if (options?.onlyActive) {
      query += '&is_active=eq.true';
    }
    const rows = await this.request<PromotionalRateRow[]>(query);
    return rows.map(mapPromotionalRate);
  }

  async getPromotionById(id: string): Promise<PromotionalRate | null> {
    const rows = await this.request<PromotionalRateRow[]>(
      `/promotional_rates?id=eq.${encodeURIComponent(id)}&select=*&limit=1`
    );
    if (rows.length === 0) return null;
    return mapPromotionalRate(rows[0]);
  }

  async createPromotion(input: CreatePromotionalRateInput): Promise<PromotionalRate> {
    validatePromotionalRateInput(input);
    const payload = {
      name: input.name.trim(),
      workspace_template_ids: input.workspaceTemplateIds,
      rate_type: input.rateType,
      promotional_price: input.promotionalPrice,
      start_at: new Date(input.startAt).toISOString(),
      end_at: new Date(input.endAt).toISOString(),
      is_active: input.isActive ?? true,
    };

    const rows = await this.request<PromotionalRateRow[]>('/promotional_rates?select=*', {
      method: 'POST',
      headers: {
        Prefer: 'return=representation',
      },
      body: JSON.stringify(payload),
    });

    if (rows.length === 0) {
      throw new Error('Failed to create promotional rate record.');
    }

    return mapPromotionalRate(rows[0]);
  }

  async updatePromotion(id: string, input: UpdatePromotionalRateInput): Promise<PromotionalRate> {
    validatePromotionalRateInput(input, true);
    const payload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (input.name !== undefined) payload.name = input.name.trim();
    if (input.workspaceTemplateIds !== undefined) payload.workspace_template_ids = input.workspaceTemplateIds;
    if (input.rateType !== undefined) payload.rate_type = input.rateType;
    if (input.promotionalPrice !== undefined) payload.promotional_price = input.promotionalPrice;
    if (input.startAt !== undefined) payload.start_at = new Date(input.startAt).toISOString();
    if (input.endAt !== undefined) payload.end_at = new Date(input.endAt).toISOString();
    if (input.isActive !== undefined) payload.is_active = input.isActive;

    const rows = await this.request<PromotionalRateRow[]>(
      `/promotional_rates?id=eq.${encodeURIComponent(id)}&select=*`,
      {
        method: 'PATCH',
        headers: {
          Prefer: 'return=representation',
        },
        body: JSON.stringify(payload),
      }
    );

    if (rows.length === 0) {
      throw new PromotionalValidationError(`Promotion not found: ${id}`);
    }

    return mapPromotionalRate(rows[0]);
  }

  async deletePromotion(id: string): Promise<boolean> {
    await this.request(`/promotional_rates?id=eq.${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    return true;
  }
}
