import { z } from 'zod';

export const rentalBillingModeSchema = z.enum(['hourly', 'daily']);

export const assignRentalSchema = z.object({
  reservationId: z.string().trim().min(1, 'Reservation ID is required'),
  serviceId: z.string().trim().min(1, 'Service ID is required'),
  billingMode: rentalBillingModeSchema,
  durationUnits: z.number().int('Duration units must be an integer').min(1, 'Duration must be at least 1'),
  idVerified: z.boolean().refine((val) => val === true, {
    message: 'Customer ID must be verified and deposited before assigning equipment',
  }),
  idNotes: z.string().trim().max(500).default('').optional(),
  staffUserId: z.string().trim().nullable().optional(),
  notes: z.string().trim().max(500).default('').optional(),
});

export const extendRentalSchema = z.object({
  rentalId: z.string().trim().min(1, 'Rental ID is required'),
  extensionMode: rentalBillingModeSchema,
  additionalUnits: z.number().int('Additional units must be an integer').min(1, 'Additional units must be at least 1'),
  staffUserId: z.string().trim().nullable().optional(),
});

export const returnRentalSchema = z.object({
  rentalId: z.string().trim().min(1, 'Rental ID is required'),
  staffUserId: z.string().trim().nullable().optional(),
});

export type AssignRentalDto = z.infer<typeof assignRentalSchema>;
export type ExtendRentalDto = z.infer<typeof extendRentalSchema>;
export type ReturnRentalDto = z.infer<typeof returnRentalSchema>;

