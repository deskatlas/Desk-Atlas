import { createClient } from '@supabase/supabase-js';
import { CampaignAnalyticsService, CampaignAnalyticsSupabaseRepository } from '@deskatlas/domain';
import { NextResponse } from 'next/server';
import { verifyAdminSession } from '../../../auth/_lib/adminSession';

// MS-43: SDD-C19, QAD-TC43.2. Never trust caller-supplied role or user ID.
export async function authorizeCampaignAnalytics(request: Request) {
  const token = request.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) return null;
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Campaign analytics is not configured');
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  let userId: string;
  if (token.startsWith('da_admin_v1.')) {
    const sessionUserId = verifyAdminSession(token, key);
    if (!sessionUserId) return null;
    userId = sessionUserId;
  } else {
    const { data, error } = await client.auth.getUser(token);
    if (error || !data.user) return null;
    userId = data.user.id;
  }
  const profile = await client.from('staff_profiles').select('role,is_active').eq('user_id', userId).maybeSingle();
  if (profile.error) throw new Error('Unable to verify administrator');
  if (!profile.data?.is_active || String(profile.data.role).toUpperCase() !== 'ADMIN') return null;
  return new CampaignAnalyticsService(new CampaignAnalyticsSupabaseRepository(client));
}
export const analyticsForbidden = () => NextResponse.json({ error: 'Administrator access required.' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
export const analyticsFailure = () => NextResponse.json({ error: 'Unable to load campaign analytics. Please try again.' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
