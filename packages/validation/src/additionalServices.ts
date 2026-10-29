import { z } from 'zod';

export const additionalServiceTypeSchema = z.enum(['rental', 'one_time']);

export const createAdditionalServiceSchema = z
  .object({
    name: z.string().trim().min(2, 'Service name must be at least 2 characters').max(100),
    description: z.string().trim().max(500).default(''),
    serviceType: additionalServiceTypeSchema,
    hourlyRate: z.number().positive('Hourly rate must be greater than 0').nullable().optional(),
    dailyRate: z.number().positive('Daily rate must be greater than 0').nullable().optional(),
    totalInventory: z.number().int().min(0, 'Total inventory cannot be negative').default(0),
    details: z.string().trim().max(2000).default(''),
    isActive: z.boolean().default(true),
  })
  .superRefine((data, ctx) => {
    if (data.serviceType === 'rental') {
      if (data.totalInventory === undefined || data.totalInventory === null || data.totalInventory < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Total inventory must be at least 1',
          path: ['totalInventory'],
        });
      }
      if (data.hourlyRate === undefined || data.hourlyRate === null || data.hourlyRate <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Hourly rate is required and must be greater than 0 for rental items',
          path: ['hourlyRate'],
        });
      }
      if (
        data.dailyRate !== undefined &&
        data.dailyRate !== null &&
        data.hourlyRate !== undefined &&
        data.hourlyRate !== null
      ) {
        if (data.dailyRate < data.hourlyRate) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Per-day rate must be greater than or equal to the hourly rate',
            path: ['dailyRate'],
          });
        }
      }
    } else if (data.serviceType === 'one_time') {
      if (!data.details || data.details.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Service details and pricing breakdown are required for one-time services',
          path: ['details'],
        });
      }
    }
  });

export const updateAdditionalServiceSchema = z
  .object({
    name: z.string().trim().min(2, 'Service name must be at least 2 characters').max(100).optional(),
    description: z.string().trim().max(500).optional(),
    serviceType: additionalServiceTypeSchema.optional(),
    hourlyRate: z.number().positive('Hourly rate must be greater than 0').nullable().optional(),
    dailyRate: z.number().positive('Daily rate must be greater than 0').nullable().optional(),
    totalInventory: z.number().int().min(0, 'Total inventory cannot be negative').optional(),
    availableInventory: z.number().int().min(0).optional(),
    details: z.string().trim().max(2000).optional(),
    isActive: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.serviceType === 'rental') {
      if (data.totalInventory !== undefined && data.totalInventory !== null && data.totalInventory < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Total inventory must be at least 1',
          path: ['totalInventory'],
        });
      }
    }
    if (
      data.dailyRate !== undefined &&
      data.dailyRate !== null &&
      data.hourlyRate !== undefined &&
      data.hourlyRate !== null
    ) {
      if (data.dailyRate < data.hourlyRate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Per-day rate must be greater than or equal to the hourly rate',
          path: ['dailyRate'],
        });
      }
    }
  });

export const rentalAlertSettingsSchema = z.object({
  rentalAlertMinutes: z
    .number()
    .int('Alert threshold must be an integer')
    .min(1, 'Alert threshold must be at least 1 minute')
    .max(60, 'Alert threshold cannot exceed 60 minutes'),
});

export type AdditionalServiceTypeDto = z.infer<typeof additionalServiceTypeSchema>;
export type CreateAdditionalServiceDto = z.infer<typeof createAdditionalServiceSchema>;
export type UpdateAdditionalServiceDto = z.infer<typeof updateAdditionalServiceSchema>;
export type RentalAlertSettingsDto = z.infer<typeof rentalAlertSettingsSchema>;

