import type { SupabaseClient } from '@supabase/supabase-js';
import type { CampaignAnalyticsData, CampaignAnalyticsRepository } from '../models/campaignAnalytics';

// MS-43: SDD-C19, ERD-E10/E16-E18. Read-only, paginated, contact-free projections.
export class CampaignAnalyticsSupabaseRepository implements CampaignAnalyticsRepository {
  constructor(private readonly client: SupabaseClient) {}

  private async rows<T>(table: string, columns: string): Promise<T[]> {
    const rows: T[] = [];
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await this.client.from(table).select(columns).order('id').range(offset, offset + pageSize - 1);
      if (error) throw new Error(`Unable to load campaign analytics: ${table}`);
      const page = (data ?? []) as unknown as T[];
      rows.push(...page);
      if (page.length < pageSize) return rows;
    }
  }

  async load(): Promise<CampaignAnalyticsData> {
    const [campaigns, rules, vouchers, reservations, settings] = await Promise.all([
      this.rows<CampaignAnalyticsData['campaigns'][number]>('campaigns', 'id,name,status,starts_at,ends_at,created_at'),
      this.rows<CampaignAnalyticsData['rules'][number]>('campaign_rules', 'id,campaign_id,label,version,reward_type,reward_value,rule_definition'),
      this.rows<CampaignAnalyticsData['vouchers'][number]>('vouchers', 'id,campaign_id,campaign_rule_id,customer_id,promo_code,status,issued_at,expires_at,redeemed_at,redeemed_reservation_id,redeemed_discount_amount,reward_snapshot'),
      this.rows<CampaignAnalyticsData['reservations'][number]>('reservations', 'id,reference_code,source,status,requested_voucher_id,confirmed_at,gross_amount_due,amount_due'),
      this.client.from('business_settings').select('timezone').limit(1).maybeSingle(),
    ]);
    if (settings.error) throw new Error('Unable to load analytics timezone');
    return { campaigns, rules, vouchers, reservations, timeZone: settings.data?.timezone ?? 'Asia/Manila' };
  }
}
