import { z } from 'zod';

export const PROMO_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const PROMO_CODE_LENGTH = 8;
export const PROMO_CODE_REGEX = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/;

export function normalizePromoCode(code: string): string {
  if (typeof code !== 'string') {
    throw new Error('Promo code must be a string');
  }
  return code.trim().toUpperCase();
}

export function isValidPromoCode(code: string): boolean {
  if (typeof code !== 'string') return false;
  const normalized = normalizePromoCode(code);
  return PROMO_CODE_REGEX.test(normalized);
}

export const SPEC3_ERROR_MESSAGES = {
  IDENTITY_MISMATCH: 'Customer ID and email do not match our records. Please check and try again.',
  ACCESS_EXPIRED: 'Re-enter Customer ID and registered email to continue.',
  PROMO_INVALID: 'Invalid promo code. Please check and try again.',
  PROMO_EXPIRED: 'This promo code has expired.',
  PROMO_USED: 'This promo code has already been redeemed.',
  PROMO_INELIGIBLE: 'This promo code is not eligible for this booking.',
  PROMO_REVALIDATION_REQUIRED: 'Your promo or price changed. Review the updated amount before continuing.',
  RATE_LIMITED: 'Too many attempts. Please try again later.',
  VOUCHER_UNAVAILABLE: 'This voucher is not available for emailing.',
} as const;

export function createSuccessResponse<T>(data: T) {
  return { data };
}

export function createErrorResponse(
  code: keyof typeof SPEC3_ERROR_MESSAGES | string,
  customMessage?: string,
  fieldErrors?: Record<string, string[]>
) {
  const message =
    customMessage ||
    (SPEC3_ERROR_MESSAGES as Record<string, string>)[code] ||
    'An unexpected error occurred.';
  return {
    error: {
      code,
      message,
      ...(fieldErrors ? { fieldErrors } : {}),
    },
  };
}

export const customerVerifyIdentitySchema = z.object({
  customer_code: z.string().trim().length(6),
  email: z.string().trim().email().max(254),
});

export const customerBookingsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const customerVouchersQuerySchema = z.object({
  status: z.enum(['AVAILABLE', 'USED', 'EXPIRED']),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const customerCheckEligibilitySchema = z.object({});

export const customerEmailVoucherSchema = z.object({
  voucher_id: z.string().uuid(),
  request_id: z.string().uuid(),
});

export const customerEmailVoucherStatusSchema = z.object({
  notification_id: z.string().uuid(),
});

export const bookingContextCandidateSchema = z.object({
  rank: z.number().int().min(0),
  workspaceInstanceId: z.string(),
  startAt: z.string(),
  endAt: z.string(),
  rateType: z.string().optional(),
});

export const bookingContextSchema = z.object({
  channel: z.enum(['WEB', 'KIOSK']),
  candidates: z.array(bookingContextCandidateSchema).min(1),
  schedule: z.any().optional(),
  rateType: z.string().optional(),
  grossAmount: z.number().optional(),
});

export const validatePromoSchema = z.object({
  promo_code: z
    .string()
    .trim()
    .length(8)
    .regex(PROMO_CODE_REGEX, 'Promo code must be 8 alphanumeric characters from the authorized alphabet'),
  email: z.string().trim().email().max(254),
  booking_context: bookingContextSchema,
});

export type CustomerVerifyIdentityInput = z.infer<typeof customerVerifyIdentitySchema>;
export type CustomerBookingsQueryInput = z.infer<typeof customerBookingsQuerySchema>;
export type CustomerVouchersQueryInput = z.infer<typeof customerVouchersQuerySchema>;
export type CustomerEmailVoucherInput = z.infer<typeof customerEmailVoucherSchema>;
export type CustomerEmailVoucherStatusInput = z.infer<typeof customerEmailVoucherStatusSchema>;
export type ValidatePromoInput = z.infer<typeof validatePromoSchema>;
