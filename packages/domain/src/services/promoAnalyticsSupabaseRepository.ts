import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  PromoAnalyticsBookingRecord,
  PromoAnalyticsData,
  PromoAnalyticsRepository,
  PromoAnalyticsTemplateRecord,
} from '../models/promoAnalytics';
import type { PromotionalRate, RateTargetType } from '../models/promotionalRate';

// MS-74: SDD-C7, SDD-C11, SDD-C19, ERD-E9/E10/E19.
export class PromoAnalyticsSupabaseRepository implements PromoAnalyticsRepository {
  constructor(private readonly client: SupabaseClient) {}

  private async rows<T>(table: string, columns: string): Promise<T[]> {
    const rows: T[] = [];
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await this.client
        .from(table)
        .select(columns)
        .order('id')
        .range(offset, offset + pageSize - 1);
      if (error) throw new Error(`Unable to load promo analytics: ${table}`);
      const page = (data ?? []) as unknown as T[];
      rows.push(...page);
      if (page.length < pageSize) return rows;
    }
  }

  async load(): Promise<PromoAnalyticsData> {
    const [promotionsRaw, templatesRaw, reservationsRaw, candidatesRaw, settings] =
      await Promise.all([
        this.rows<{
          id: string;
          name: string;
          workspace_template_ids: string[];
          rate_type: RateTargetType;
          promotional_price: number;
          start_at: string;
          end_at: string;
          is_active: boolean;
          created_at?: string;
        }>(
          'promotional_rates',
          'id,name,workspace_template_ids,rate_type,promotional_price,start_at,end_at,is_active,created_at'
        ),
        this.rows<{
          id: string;
          name: string;
          rate_amount: number;
          day_pass_price: number | null;
          night_pass_price: number | null;
        }>(
          'workspace_templates',
          'id,name,rate_amount,day_pass_price,night_pass_price'
        ),
        this.rows<{
          id: string;
          reference_code: string;
          source: 'WEB' | 'KIOSK';
          status: string;
          customer_first_name: string;
          customer_last_name: string;
          customer_email: string;
          amount_due: number;
          rate_snapshot: number;
          created_at: string;
          confirmed_at: string | null;
        }>(
          'reservations',
          'id,reference_code,source,status,customer_first_name,customer_last_name,customer_email,amount_due,rate_snapshot,created_at,confirmed_at'
        ),
        this.rows<{
          reservation_id: string;
          workspace_template_id?: string;
          start_at: string;
          end_at: string;
          rank: number;
          is_assigned: boolean;
        }>(
          'reservation_candidates',
          'id,reservation_id,start_at,end_at,rank,is_assigned'
        ).catch(() => []),
        this.client.from('business_settings').select('timezone').limit(1).maybeSingle(),
      ]);

    if (settings.error) throw new Error('Unable to load analytics timezone');

    const promotions: PromotionalRate[] = promotionsRaw.map((p) => ({
      id: p.id,
      name: p.name,
      workspaceTemplateIds: p.workspace_template_ids || [],
      rateType: p.rate_type,
      promotionalPrice: Number(p.promotional_price),
      startAt: p.start_at,
      endAt: p.end_at,
      isActive: Boolean(p.is_active),
      createdAt: p.created_at,
    }));

    const templates: PromoAnalyticsTemplateRecord[] = templatesRaw.map((t) => ({
      id: t.id,
      name: t.name,
      rateAmount: Number(t.rate_amount),
      dayPassPrice: t.day_pass_price !== null ? Number(t.day_pass_price) : null,
      nightPassPrice: t.night_pass_price !== null ? Number(t.night_pass_price) : null,
    }));

    const candidateByRes = new Map<string, { start_at: string; end_at: string; workspace_template_id?: string }>();
    for (const c of candidatesRaw) {
      if (!candidateByRes.has(c.reservation_id) || c.is_assigned || c.rank === 0) {
        candidateByRes.set(c.reservation_id, c);
      }
    }

    const reservations: PromoAnalyticsBookingRecord[] = reservationsRaw.map((r) => {
      const candidate = candidateByRes.get(r.id);
      let durationHours = 1;
      if (candidate?.start_at && candidate?.end_at) {
        const start = Date.parse(candidate.start_at);
        const end = Date.parse(candidate.end_at);
        if (end > start) {
          durationHours = Math.max(1, (end - start) / (1000 * 60 * 60));
        }
      }

      return {
        id: r.id,
        referenceCode: r.reference_code,
        source: r.source,
        status: r.status,
        customerFirstName: r.customer_first_name || '',
        customerLastName: r.customer_last_name || '',
        customerEmail: r.customer_email || '',
        amountDue: Number(r.amount_due),
        rateSnapshot: Number(r.rate_snapshot),
        createdAt: r.created_at,
        confirmedAt: r.confirmed_at,
        workspaceTemplateId: candidate?.workspace_template_id,
        startAt: candidate?.start_at,
        endAt: candidate?.end_at,
        durationHours,
      };
    });

    return {
      promotions,
      templates,
      reservations,
      timeZone: settings.data?.timezone ?? 'Asia/Manila',
    };
  }
}
