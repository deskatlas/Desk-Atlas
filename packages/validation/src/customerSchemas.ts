// MS-86 Customer ID Recovery Validation Schema
// Traceability: MS-86, PRD-F4, PRD-F22, SDD-C15, ERD-E15, QAD-TC22
import { z } from 'zod';

export const forgotCustomerIdSchema = z.object({
  email: z.string().trim().email('Please enter a valid email address.').max(255),
});

export type ForgotCustomerIdInput = z.infer<typeof forgotCustomerIdSchema>;

