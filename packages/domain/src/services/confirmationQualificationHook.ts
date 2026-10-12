/**
 * Booking Confirmation Campaign Qualification Pipeline Hook
 * Traceability: MS-36, PRD-F23, PRD-F24, SDD-C5, SDD-C6, SDD-C11, SDD-C14, SDD-C15, ERD-E18, ERD-E19, QAD-TC36
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@supabase/supabase-js';
import type { CustomerRepository } from './customerRepository';
import type { VoucherRepository } from './voucherRepository';
import { VoucherSupabaseRepository } from './voucherSupabaseRepository';
import { CustomerSupabaseRepository } from './customerSupabaseRepository';
import { VoucherService } from './voucherService';
import type {
  EligibilityResult,
  QualifyingBookingFact,
  Voucher,
} from '../models/voucher';
import type { TransactionalEmailService } from './transactionalEmailService';
import { createTransactionalEmailService } from './transactionalEmailService';

export interface ConfirmationQualificationInput {
  reservationId: string;
  source?: 'WEB' | 'KIOSK';
  confirmedAt?: string;
  emailService?: TransactionalEmailService;
  supabaseClient?: SupabaseClient;
  voucherRepository?: VoucherRepository;
  customerRepository?: CustomerRepository;
}

export interface ConfirmationQualificationResult {
  success: boolean;
  reservationId: string;
  customerId?: string | null;
  factRecorded: boolean;
  newVouchers: Voucher[];
  eligibilityResult?: EligibilityResult | null;
  error?: string;
}

export function formatVoucherDiscountText(rewardSnapshot: {
  rewardType?: string;
  reward_type?: string;
  rewardValue?: number;
  reward_value?: number;
  maxDiscountAmount?: number | null;
  max_discount_amount?: number | null;
}): string {
  const type = rewardSnapshot.rewardType || rewardSnapshot.reward_type || 'FIXED_AMOUNT_DISCOUNT';
  const val = rewardSnapshot.rewardValue ?? rewardSnapshot.reward_value ?? 0;
  const max = rewardSnapshot.maxDiscountAmount ?? rewardSnapshot.max_discount_amount;

  if (type === 'PERCENTAGE_DISCOUNT') {
    if (max && max > 0) {
      return `${val}% off up to PHP ${Number(max).toFixed(2)}`;
    }
    return `${val}% off`;
  }
  return `PHP ${Number(val).toFixed(2)} off`;
}

export async function handleConfirmedReservationCampaignQualification(
  input: ConfirmationQualificationInput
): Promise<ConfirmationQualificationResult> {
  const { reservationId } = input;
  if (!reservationId) {
    return {
      success: false,
      reservationId,
      factRecorded: false,
      newVouchers: [],
      error: 'reservationId is required',
    };
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  let supabase: SupabaseClient | null = input.supabaseClient || null;
  if (!supabase && supabaseUrl && serviceRoleKey) {
    supabase = createClient(supabaseUrl.replace(/\/$/, ''), serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  let voucherRepo: VoucherRepository = input.voucherRepository as VoucherRepository;
  let customerRepo: CustomerRepository = input.customerRepository as CustomerRepository;

  if (!voucherRepo && supabase) {
    voucherRepo = new VoucherSupabaseRepository(supabase);
  }
  if (!customerRepo && supabase && supabaseUrl && serviceRoleKey) {
    customerRepo = new CustomerSupabaseRepository({
      supabaseUrl,
      serviceRoleKey,
    });
  }

  if (!voucherRepo || !customerRepo) {
    return {
      success: false,
      reservationId,
      factRecorded: false,
      newVouchers: [],
      error: 'Repositories not available',
    };
  }

  try {
    let customerId: string | null = null;
    let customerEmail: string | null = null;
    let customerFirstName: string | null = null;
    let customerLastName: string | null = null;
    let source: 'WEB' | 'KIOSK' = input.source || 'WEB';
    let amountDue = 0;
    let confirmedAt = input.confirmedAt || new Date().toISOString();
    let workspaceTypeId: string | null = null;
    let bookedMinutes = 60;

    if (supabase) {
      // 1. Fetch reservation
      const { data: resRow } = await supabase
        .from('reservations')
        .select('id, customer_id, source, amount_due, customer_email, customer_first_name, customer_last_name, confirmed_at')
        .eq('id', reservationId)
        .maybeSingle();

      if (resRow) {
        customerId = resRow.customer_id;
        source = (input.source || resRow.source || 'WEB') as 'WEB' | 'KIOSK';
        amountDue = Number(resRow.amount_due || 0);
        customerEmail = resRow.customer_email;
        customerFirstName = resRow.customer_first_name;
        customerLastName = resRow.customer_last_name;
        confirmedAt = input.confirmedAt || resRow.confirmed_at || confirmedAt;
      }

      // If customer_id not yet linked in reservations, query by email
      if (!customerId && customerEmail) {
        const cust = await customerRepo.findCustomerByEmail(customerEmail);
        if (cust) {
          customerId = cust.id;
        }
      }

      // 2. Resolve template ID and duration from candidate
      const { data: candRows } = await supabase
        .from('reservation_candidates')
        .select(`
          rank,
          is_assigned,
          start_at,
          end_at,
          workspace_instances (
            template_id
          )
        `)
        .eq('reservation_id', reservationId)
        .order('rank', { ascending: true });

      if (candRows && candRows.length > 0) {
        type CandidateWithInstance = {
          rank: number;
          is_assigned: boolean;
          start_at: string;
          end_at: string;
          workspace_instances?: { template_id?: string | null } | Array<{ template_id?: string | null }> | null;
        };
        const candidates = candRows as unknown as CandidateWithInstance[];
        const assigned = candidates.find((c) => c.is_assigned) || candidates[0];

        const start = new Date(assigned.start_at).getTime();
        const end = new Date(assigned.end_at).getTime();
        bookedMinutes = Math.max(1, Math.round((end - start) / 60000));

        const wi = assigned.workspace_instances;
        if (wi) {
          if (Array.isArray(wi)) {
            workspaceTypeId = wi[0]?.template_id || null;
          } else {
            workspaceTypeId = wi.template_id || null;
          }
        }
      }
    }

    let factRecorded = false;
    if (customerId && workspaceTypeId) {
      const fact: QualifyingBookingFact = {
        reservationId,
        reservation_id: reservationId,
        customerId,
        customer_id: customerId,
        confirmedAt,
        confirmed_at: confirmedAt,
        source,
        workspaceTypeId,
        workspace_type_id: workspaceTypeId,
        netPaidAmount: amountDue,
        net_paid_amount: amountDue,
        bookedMinutes,
        booked_minutes: bookedMinutes,
        isQualifying: true,
        is_qualifying: true,
        createdAt: new Date().toISOString(),
      };

      await voucherRepo.recordQualifyingFact(fact);
      factRecorded = true;
    }

    if (!customerId) {
      return {
        success: true,
        reservationId,
        customerId: null,
        factRecorded: false,
        newVouchers: [],
      };
    }

    // 3. Evaluate voucher eligibility immediately
    const emailService = input.emailService || createTransactionalEmailService();
    const voucherService = new VoucherService(voucherRepo, customerRepo, emailService);
    const eligibilityResult = await voucherService.checkEligibility(customerId, new Date(confirmedAt));

    // 4. Dispatch award emails for newly unlocked vouchers
    if (eligibilityResult.newVouchers.length > 0 && customerEmail) {
      for (const voucher of eligibilityResult.newVouchers) {
        const discountText = formatVoucherDiscountText(voucher.rewardSnapshot || {});
        try {
          await emailService.sendVoucherAwardedEmail({
            to: customerEmail,
            customerFirstName: customerFirstName || undefined,
            customerLastName: customerLastName || undefined,
            promoCode: voucher.promoCode,
            discountDescription: discountText,
            discountText,
            campaignName: voucher.campaignNameSnapshot,
            expiresAt: voucher.expiresAt,
            terms: voucher.rewardSnapshot as unknown as Record<string, unknown>,
          });
        } catch (emailErr: unknown) {
          console.warn('[ConfirmationQualificationHook] Failed to dispatch award email:', emailErr);
        }
      }
    }

    return {
      success: true,
      reservationId,
      customerId,
      factRecorded,
      newVouchers: eligibilityResult.newVouchers,
      eligibilityResult,
    };
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[ConfirmationQualificationHook] Error evaluating campaign qualification:', errorMsg);
    return {
      success: false,
      reservationId,
      factRecorded: false,
      newVouchers: [],
      error: errorMsg,
    };
  }
}
