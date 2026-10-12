/**
 * Reservation Single-Use Voucher Redemption Domain Helper
 * Traceability: MS-39, PRD-F4, PRD-F6, PRD-F8, PRD-F23, SDD-C5, SDD-C6, SDD-C14, ERD-E10, ERD-E18, QAD-TC39
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@supabase/supabase-js';
import type { Voucher } from '../models/voucher';
import type { VoucherRepository } from './voucherRepository';
import { VoucherSupabaseRepository } from './voucherSupabaseRepository';

export interface RedeemReservationVoucherInput {
  reservationId: string;
  voucherRepository?: VoucherRepository;
  supabaseClient?: SupabaseClient;
  voucherId?: string;
  discountAmount?: number;
  confirmedAt?: string;
}

export interface RedeemReservationVoucherResult {
  success: boolean;
  reservationId: string;
  voucherId?: string | null;
  redeemedVoucher?: Voucher | null;
  alreadyRedeemed?: boolean;
  skipped?: boolean;
  error?: string;
}

interface ReservationVoucherQueryResult {
  id: string;
  status: string;
  requested_voucher_id: string | null;
  promo_code_used: string | null;
  discount_amount: number | string | null;
  customer_id: string | null;
  confirmed_at: string | null;
}

export async function redeemReservationVoucher(
  input: RedeemReservationVoucherInput
): Promise<RedeemReservationVoucherResult> {
  const { reservationId } = input;
  if (!reservationId) {
    return {
      success: false,
      reservationId,
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

  let voucherRepo: VoucherRepository | undefined = input.voucherRepository;
  if (!voucherRepo && supabase) {
    voucherRepo = new VoucherSupabaseRepository(supabase);
  }

  if (!voucherRepo) {
    return {
      success: false,
      reservationId,
      error: 'VoucherRepository is not available',
    };
  }

  try {
    let targetVoucherId = input.voucherId || null;
    let discountAmount = input.discountAmount ?? 0;
    let confirmedAt = input.confirmedAt || new Date().toISOString();

    // Query reservation details from database if target voucher not fully provided
    if (supabase && (!targetVoucherId || input.discountAmount === undefined)) {
      const { data: resRow } = await supabase
        .from('reservations')
        .select('id, status, requested_voucher_id, promo_code_used, discount_amount, customer_id, confirmed_at')
        .eq('id', reservationId)
        .maybeSingle();

      if (resRow) {
        const row = resRow as ReservationVoucherQueryResult;
        targetVoucherId = targetVoucherId || row.requested_voucher_id;
        discountAmount = input.discountAmount ?? Number(row.discount_amount || 0);
        confirmedAt = input.confirmedAt || row.confirmed_at || confirmedAt;

        // Fallback: resolve voucher by promo code and customer ID if requested_voucher_id was not populated
        if (!targetVoucherId && row.promo_code_used && row.customer_id) {
          const matched = await voucherRepo.findVoucherByCode(row.promo_code_used);
          if (matched && (matched.customerId === row.customer_id || matched.customer_id === row.customer_id)) {
            targetVoucherId = matched.id;
          }
        }
      }
    }

    if (!targetVoucherId) {
      return {
        success: true,
        reservationId,
        skipped: true,
      };
    }

    // Inspect current voucher state
    const existing = await voucherRepo.findVoucherById(targetVoucherId);
    if (!existing) {
      return {
        success: false,
        reservationId,
        voucherId: targetVoucherId,
        error: `Voucher ${targetVoucherId} not found`,
      };
    }

    // Check if already redeemed for this reservation (e.g. by database trigger or previous request)
    const existingRedeemedResId = existing.redeemedReservationId || existing.redeemed_reservation_id;
    if (
      (existing.status === 'USED' || existing.redeemedAt || existing.redeemed_at) &&
      existingRedeemedResId === reservationId
    ) {
      return {
        success: true,
        reservationId,
        voucherId: targetVoucherId,
        redeemedVoucher: existing,
        alreadyRedeemed: true,
      };
    }

    // Attempt atomic single-use redemption
    try {
      const redeemed = await voucherRepo.redeemVoucher(
        targetVoucherId,
        reservationId,
        discountAmount,
        confirmedAt
      );

      return {
        success: true,
        reservationId,
        voucherId: targetVoucherId,
        redeemedVoucher: redeemed,
      };
    } catch (redeemErr: unknown) {
      // Re-check if redemption was completed concurrently or via database trigger
      const rechecked = await voucherRepo.findVoucherById(targetVoucherId);
      const recheckedResId = rechecked?.redeemedReservationId || rechecked?.redeemed_reservation_id;
      if (rechecked && recheckedResId === reservationId) {
        return {
          success: true,
          reservationId,
          voucherId: targetVoucherId,
          redeemedVoucher: rechecked,
          alreadyRedeemed: true,
        };
      }

      return {
        success: false,
        reservationId,
        voucherId: targetVoucherId,
        error: redeemErr instanceof Error ? redeemErr.message : 'Voucher redemption failed',
      };
    }
  } catch (err: unknown) {
    return {
      success: false,
      reservationId,
      error: err instanceof Error ? err.message : 'Unexpected voucher redemption error',
    };
  }
}

export interface HoldReservationVoucherInput {
  reservationId: string;
  voucherRepository?: VoucherRepository;
  supabaseClient?: SupabaseClient;
  voucherId?: string;
  heldAt?: string;
}

export interface HoldReservationVoucherResult {
  success: boolean;
  reservationId: string;
  voucherId?: string | null;
  heldVoucher?: Voucher | null;
  alreadyHeld?: boolean;
  skipped?: boolean;
  error?: string;
}

export async function holdReservationVoucher(
  input: HoldReservationVoucherInput
): Promise<HoldReservationVoucherResult> {
  const { reservationId } = input;
  if (!reservationId) {
    return {
      success: false,
      reservationId,
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

  let voucherRepo: VoucherRepository | undefined = input.voucherRepository;
  if (!voucherRepo && supabase) {
    voucherRepo = new VoucherSupabaseRepository(supabase);
  }

  if (!voucherRepo) {
    return {
      success: false,
      reservationId,
      error: 'VoucherRepository is not available',
    };
  }

  try {
    let targetVoucherId = input.voucherId || null;
    const heldAt = input.heldAt || new Date().toISOString();

    if (supabase && !targetVoucherId) {
      const { data: resRow } = await supabase
        .from('reservations')
        .select('id, status, requested_voucher_id, promo_code_used, customer_id')
        .eq('id', reservationId)
        .maybeSingle();

      if (resRow) {
        const row = resRow as ReservationVoucherQueryResult;
        targetVoucherId = targetVoucherId || row.requested_voucher_id;

        if (!targetVoucherId && row.promo_code_used && row.customer_id) {
          const matched = await voucherRepo.findVoucherByCode(row.promo_code_used);
          if (matched && (matched.customerId === row.customer_id || matched.customer_id === row.customer_id)) {
            targetVoucherId = matched.id;
          }
        }
      }
    }

    if (!targetVoucherId) {
      return {
        success: true,
        reservationId,
        skipped: true,
      };
    }

    const existing = await voucherRepo.findVoucherById(targetVoucherId);
    if (!existing) {
      return {
        success: false,
        reservationId,
        voucherId: targetVoucherId,
        error: `Voucher ${targetVoucherId} not found`,
      };
    }

    const existingPendingResId = existing.pendingReservationId || existing.pending_reservation_id;
    if (existing.status === 'PENDING_REDEMPTION' && existingPendingResId === reservationId) {
      return {
        success: true,
        reservationId,
        voucherId: targetVoucherId,
        heldVoucher: existing,
        alreadyHeld: true,
      };
    }

    try {
      const held = await voucherRepo.holdVoucher(targetVoucherId, reservationId, heldAt);
      return {
        success: true,
        reservationId,
        voucherId: targetVoucherId,
        heldVoucher: held,
      };
    } catch (holdErr: unknown) {
      const rechecked = await voucherRepo.findVoucherById(targetVoucherId);
      const recheckedResId = rechecked?.pendingReservationId || rechecked?.pending_reservation_id;
      if (rechecked && rechecked.status === 'PENDING_REDEMPTION' && recheckedResId === reservationId) {
        return {
          success: true,
          reservationId,
          voucherId: targetVoucherId,
          heldVoucher: rechecked,
          alreadyHeld: true,
        };
      }

      return {
        success: false,
        reservationId,
        voucherId: targetVoucherId,
        error: holdErr instanceof Error ? holdErr.message : 'Voucher hold acquisition failed',
      };
    }
  } catch (err: unknown) {
    return {
      success: false,
      reservationId,
      error: err instanceof Error ? err.message : 'Unexpected voucher hold error',
    };
  }
}

export interface ReleaseHeldReservationVoucherInput {
  reservationId: string;
  voucherRepository?: VoucherRepository;
  supabaseClient?: SupabaseClient;
  voucherId?: string;
}

export interface ReleaseHeldReservationVoucherResult {
  success: boolean;
  reservationId: string;
  voucherId?: string | null;
  releasedVoucher?: Voucher | null;
  alreadyReleased?: boolean;
  skipped?: boolean;
  error?: string;
}

export async function releaseHeldReservationVoucher(
  input: ReleaseHeldReservationVoucherInput
): Promise<ReleaseHeldReservationVoucherResult> {
  const { reservationId } = input;
  if (!reservationId) {
    return {
      success: false,
      reservationId,
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

  let voucherRepo: VoucherRepository | undefined = input.voucherRepository;
  if (!voucherRepo && supabase) {
    voucherRepo = new VoucherSupabaseRepository(supabase);
  }

  if (!voucherRepo) {
    return {
      success: false,
      reservationId,
      error: 'VoucherRepository is not available',
    };
  }

  try {
    let targetVoucherId = input.voucherId || null;

    if (supabase && !targetVoucherId) {
      // Find voucher directly held by this reservation
      const { data: vRow } = await supabase
        .from('vouchers')
        .select('id, status, pending_reservation_id')
        .eq('pending_reservation_id', reservationId)
        .maybeSingle();

      if (vRow) {
        targetVoucherId = (vRow as { id: string }).id;
      } else {
        const { data: resRow } = await supabase
          .from('reservations')
          .select('id, requested_voucher_id, promo_code_used, customer_id')
          .eq('id', reservationId)
          .maybeSingle();

        if (resRow) {
          const row = resRow as ReservationVoucherQueryResult;
          targetVoucherId = targetVoucherId || row.requested_voucher_id;
          if (!targetVoucherId && row.promo_code_used && row.customer_id) {
            const matched = await voucherRepo.findVoucherByCode(row.promo_code_used);
            if (matched && (matched.customerId === row.customer_id || matched.customer_id === row.customer_id)) {
              targetVoucherId = matched.id;
            }
          }
        }
      }
    }

    if (!targetVoucherId) {
      return {
        success: true,
        reservationId,
        skipped: true,
      };
    }

    const existing = await voucherRepo.findVoucherById(targetVoucherId);
    if (!existing) {
      return {
        success: false,
        reservationId,
        voucherId: targetVoucherId,
        error: `Voucher ${targetVoucherId} not found`,
      };
    }

    // If voucher reached USED status (confirmed booking), post-confirmation cancellation never refunds or reactivates
    if (existing.status === 'USED' || existing.redeemedAt || existing.redeemed_at) {
      return {
        success: true,
        reservationId,
        voucherId: targetVoucherId,
        skipped: true,
      };
    }

    // If already AVAILABLE and not held
    const existingPendingResId = existing.pendingReservationId || existing.pending_reservation_id;
    if (existing.status === 'AVAILABLE' && !existingPendingResId) {
      return {
        success: true,
        reservationId,
        voucherId: targetVoucherId,
        alreadyReleased: true,
      };
    }

    try {
      const released = await voucherRepo.releaseVoucher(targetVoucherId, reservationId);
      return {
        success: true,
        reservationId,
        voucherId: targetVoucherId,
        releasedVoucher: released,
      };
    } catch (releaseErr: unknown) {
      const rechecked = await voucherRepo.findVoucherById(targetVoucherId);
      const recheckedResId = rechecked?.pendingReservationId || rechecked?.pending_reservation_id;
      if (rechecked && rechecked.status === 'AVAILABLE' && !recheckedResId) {
        return {
          success: true,
          reservationId,
          voucherId: targetVoucherId,
          alreadyReleased: true,
        };
      }

      return {
        success: false,
        reservationId,
        voucherId: targetVoucherId,
        error: releaseErr instanceof Error ? releaseErr.message : 'Voucher release failed',
      };
    }
  } catch (err: unknown) {
    return {
      success: false,
      reservationId,
      error: err instanceof Error ? err.message : 'Unexpected voucher release error',
    };
  }
}
