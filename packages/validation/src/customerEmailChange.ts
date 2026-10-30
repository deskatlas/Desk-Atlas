// MS-98 Customer Identity Email Transfer Validation Schemas
// Traceability: MS-98, PRD-F4, PRD-F14, PRD-F22, SDD-C13, SDD-C15, ERD-E15, ERD-E23, QAD-TC22, QAD-TC36
import { z } from 'zod';

export const requestEmailChangeOtpSchema = z.object({
  email: z.string().trim().email('Please enter a valid email address.').max(254),
});

export const verifyEmailChangeOtpSchema = z.object({
  email: z.string().trim().email('Please enter a valid email address.').max(254),
  otp: z.string().trim().regex(/^\d{6}$/, 'Verification code must be exactly 6 digits.'),
});

export const initiateEmailChangeSchema = z.object({
  verificationToken: z.string().min(1, 'Verification token is required.'),
  newEmail: z.string().trim().email('Please enter a valid new email address.').max(254),
});

export const confirmEmailChangeSchema = z.object({
  token: z.string().min(1, 'Confirmation token is required.'),
});

export type RequestEmailChangeOtpInput = z.infer<typeof requestEmailChangeOtpSchema>;
export type VerifyEmailChangeOtpInput = z.infer<typeof verifyEmailChangeOtpSchema>;
export type InitiateEmailChangeInput = z.infer<typeof initiateEmailChangeSchema>;
export type ConfirmEmailChangeInput = z.infer<typeof confirmEmailChangeSchema>;

