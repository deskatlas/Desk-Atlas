import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  AdditionalServiceValidationError,
  InMemoryAdditionalServiceRepository,
  createAdditionalServiceService,
  InMemorySettingsRepository,
  createAdminSettingsService,
  SettingsValidationError,
} from '../packages/domain/src';
import {
  createAdditionalServiceSchema,
  updateAdditionalServiceSchema,
  rentalAlertSettingsSchema,
} from '../packages/validation/src';

describe('MS-88: Additional Services Catalog, Rental Pricing & Inventory Architecture, and Alert Settings', () => {
  const rootDir = path.resolve(__dirname, '..');
  let serviceRepo: InMemoryAdditionalServiceRepository;
  let serviceService: ReturnType<typeof createAdditionalServiceService>;

  beforeEach(() => {
    serviceRepo = new InMemoryAdditionalServiceRepository();
    serviceService = createAdditionalServiceService(serviceRepo);
  });

  describe('Part 1: Validation Schemas & Invariant Boundaries (MS88-TC01 - MS88-TC06)', () => {
    it('MS88-TC01: Rental hourly rate is strictly required and must be greater than zero', async () => {
      // 1. Zod schema validation
      const missingRate = createAdditionalServiceSchema.safeParse({
        name: '4K Monitor',
        serviceType: 'rental',
        totalInventory: 2,
      });
      expect(missingRate.success).toBe(false);
      if (!missingRate.success) {
        expect(missingRate.error.issues.some((i) => i.message.includes('Hourly rate is required'))).toBe(true);
      }

      // 2. Domain service enforcement
      await expect(
        serviceService.createService({
          name: '4K Monitor',
          serviceType: 'rental',
          hourlyRate: 0,
          totalInventory: 2,
        })
      ).rejects.toThrow(AdditionalServiceValidationError);

      await expect(
        serviceService.createService({
          name: '4K Monitor',
          serviceType: 'rental',
          hourlyRate: -10,
          totalInventory: 2,
        })
      ).rejects.toThrow(AdditionalServiceValidationError);
    });

    it('MS88-TC02: Rental daily rate boundary rejects values strictly lower than hourly rate', async () => {
      // 1. Zod schema validation: dailyRate (40) < hourlyRate (50)
      const invalidDaily = createAdditionalServiceSchema.safeParse({
        name: 'Mechanical Keyboard',
        serviceType: 'rental',
        hourlyRate: 50,
        dailyRate: 40,
        totalInventory: 5,
      });
      expect(invalidDaily.success).toBe(false);
      if (!invalidDaily.success) {
        expect(invalidDaily.error.issues.some((i) => i.message.includes('Per-day rate must be greater than or equal to the hourly rate'))).toBe(true);
      }

      // 2. Domain service enforcement
      await expect(
        serviceService.createService({
          name: 'Mechanical Keyboard',
          serviceType: 'rental',
          hourlyRate: 50,
          dailyRate: 45,
          totalInventory: 5,
        })
      ).rejects.toThrow('Per-day rate must be greater than or equal to the hourly rate');
    });

    it('MS88-TC03: Rental daily rate is optional and persists cleanly as null when omitted', async () => {
      const parsed = createAdditionalServiceSchema.safeParse({
        name: 'USB-C Docking Station',
        serviceType: 'rental',
        hourlyRate: 35.5,
        totalInventory: 3,
      });
      expect(parsed.success).toBe(true);

      const created = await serviceService.createService({
        name: 'USB-C Docking Station',
        serviceType: 'rental',
        hourlyRate: 35.5,
        dailyRate: null,
        totalInventory: 3,
      });
      expect(created.id).toBeDefined();
      expect(created.hourlyRate).toBe(35.5);
      expect(created.dailyRate).toBeNull();
      expect(created.totalInventory).toBe(3);
      expect(created.availableInventory).toBe(3);
    });

    it('MS88-TC04: Rental inventory bounds enforce minimum count of 1 and non-negative available bounds', async () => {
      const zeroInventory = createAdditionalServiceSchema.safeParse({
        name: 'Ergonomic Chair Headrest',
        serviceType: 'rental',
        hourlyRate: 20,
        totalInventory: 0,
      });
      expect(zeroInventory.success).toBe(false);

      await expect(
        serviceService.createService({
          name: 'Ergonomic Chair Headrest',
          serviceType: 'rental',
          hourlyRate: 20,
          totalInventory: 0,
        })
      ).rejects.toThrow(AdditionalServiceValidationError);

      const validCreated = await serviceService.createService({
        name: 'Ergonomic Chair Headrest',
        serviceType: 'rental',
        hourlyRate: 20,
        totalInventory: 4,
      });
      expect(validCreated.totalInventory).toBe(4);

      // Cannot update availableInventory > totalInventory
      await expect(
        serviceService.updateService(validCreated.id, {
          availableInventory: 5,
        })
      ).rejects.toThrow('Available inventory must be between 0 and total inventory');
    });

    it('MS88-TC05: One-time consumable services strictly require informative service details', async () => {
      const emptyDetails = createAdditionalServiceSchema.safeParse({
        name: 'High-Speed Color Printing',
        serviceType: 'one_time',
        details: '',
      });
      expect(emptyDetails.success).toBe(false);
      if (!emptyDetails.success) {
        expect(emptyDetails.error.issues.some((i) => i.message.includes('details and pricing breakdown are required'))).toBe(true);
      }

      await expect(
        serviceService.createService({
          name: 'High-Speed Color Printing',
          serviceType: 'one_time',
          details: '   ',
        })
      ).rejects.toThrow(AdditionalServiceValidationError);

      const validService = await serviceService.createService({
        name: 'High-Speed Color Printing',
        serviceType: 'one_time',
        details: 'Color prints: PHP 10.00/page. Black & White: PHP 2.00/page.',
      });
      expect(validService.id).toBeDefined();
      expect(validService.serviceType).toBe('one_time');
      expect(validService.details).toBe('Color prints: PHP 10.00/page. Black & White: PHP 2.00/page.');
    });

    it('MS88-TC06: One-time services do not require rental rates and persist with null hourly/daily rates', async () => {
      // 1. Zod schema validation accepts totalInventory: 0 for one-time services
      const parsedOneTime = createAdditionalServiceSchema.safeParse({
        name: 'Document Lamination',
        serviceType: 'one_time',
        details: 'A4 pouch lamination at PHP 25.00 per sheet.',
        totalInventory: 0,
      });
      expect(parsedOneTime.success).toBe(true);

      const created = await serviceService.createService({
        name: 'Document Lamination',
        serviceType: 'one_time',
        details: 'A4 pouch lamination at PHP 25.00 per sheet.',
      });
      expect(created.hourlyRate).toBeNull();
      expect(created.dailyRate).toBeNull();
      expect(created.totalInventory).toBe(0);
      expect(created.availableInventory).toBe(0);

      // 2. Update schema also accepts totalInventory: 0 for one-time services
      const parsedUpdate = updateAdditionalServiceSchema.safeParse({
        serviceType: 'one_time',
        totalInventory: 0,
      });
      expect(parsedUpdate.success).toBe(true);
    });
  });

  describe('Part 2: Staff Rental Expiration Alert Settings (MS88-TC07 - MS88-TC08)', () => {
    it('MS88-TC07: Rental alert threshold enforces strict integer range between 1 and 60 minutes', () => {
      const outOfBoundsLow = rentalAlertSettingsSchema.safeParse({ rentalAlertMinutes: 0 });
      expect(outOfBoundsLow.success).toBe(false);

      const outOfBoundsHigh = rentalAlertSettingsSchema.safeParse({ rentalAlertMinutes: 61 });
      expect(outOfBoundsHigh.success).toBe(false);

      const nonInteger = rentalAlertSettingsSchema.safeParse({ rentalAlertMinutes: 5.5 });
      expect(nonInteger.success).toBe(false);

      const validBoundaryMin = rentalAlertSettingsSchema.safeParse({ rentalAlertMinutes: 1 });
      expect(validBoundaryMin.success).toBe(true);

      const validBoundaryMax = rentalAlertSettingsSchema.safeParse({ rentalAlertMinutes: 60 });
      expect(validBoundaryMax.success).toBe(true);

      const validDefault = rentalAlertSettingsSchema.safeParse({ rentalAlertMinutes: 5 });
      expect(validDefault.success).toBe(true);
    });

    it('MS88-TC08: Admin Settings Service persists rentalAlertMinutes and reflects across overview', async () => {
      const settingsRepo = new InMemorySettingsRepository();
      const settingsService = createAdminSettingsService(settingsRepo);

      // Verify default value is 5
      const initialOverview = await settingsService.getSettingsOverview();
      expect(initialOverview.businessSettings.rentalAlertMinutes).toBe(5);

      // Update to 10 minutes
      const updated = await settingsService.updateBusinessSettings({
        businessName: 'DeskAtlas BGC',
        timezone: 'Asia/Manila',
        bookingIntervalMinutes: 30,
        paymentExpiryMinutes: 60,
        rentalAlertMinutes: 10,
      });
      expect(updated.rentalAlertMinutes).toBe(10);

      // Verify retrieval returns 10
      const refreshedOverview = await settingsService.getSettingsOverview();
      expect(refreshedOverview.businessSettings.rentalAlertMinutes).toBe(10);

      // Attempting invalid value throws SettingsValidationError
      await expect(
        settingsService.updateBusinessSettings({
          businessName: 'DeskAtlas BGC',
          timezone: 'Asia/Manila',
          bookingIntervalMinutes: 30,
          paymentExpiryMinutes: 60,
          rentalAlertMinutes: 75,
        })
      ).rejects.toThrow(SettingsValidationError);
    });
  });

  describe('Part 3: Admin Catalog CRUD & Lifecycle Operations (MS88-TC09)', () => {
    it('MS88-TC09: Admin can create, query, update, toggle active status, and delete services', async () => {
      // 1. Create rental item
      const rental = await serviceService.createService({
        name: 'Noise-Canceling Headphones',
        description: 'Sony WH-1000XM5 wireless headset',
        serviceType: 'rental',
        hourlyRate: 40,
        dailyRate: 200,
        totalInventory: 3,
        isActive: true,
      });
      expect(rental.id).toBeDefined();

      // 2. Query list
      const listAll = await serviceService.listServices();
      expect(listAll.length).toBe(1);
      expect(listAll[0].name).toBe('Noise-Canceling Headphones');

      // 3. Update details and pricing
      const updated = await serviceService.updateService(rental.id, {
        hourlyRate: 45,
        dailyRate: 220,
        totalInventory: 4,
      });
      expect(updated.hourlyRate).toBe(45);
      expect(updated.dailyRate).toBe(220);
      expect(updated.totalInventory).toBe(4);

      // 4. Toggle isActive
      const deactivated = await serviceService.updateService(rental.id, {
        isActive: false,
      });
      expect(deactivated.isActive).toBe(false);

      const activeOnly = await serviceService.listServices({ isActive: true });
      expect(activeOnly.length).toBe(0);

      const inactiveOnly = await serviceService.listServices({ isActive: false });
      expect(inactiveOnly.length).toBe(1);

      // 5. Delete service
      const deleteResult = await serviceService.deleteService(rental.id);
      expect(deleteResult).toBe(true);

      const emptyList = await serviceService.listServices();
      expect(emptyList.length).toBe(0);
    });
  });

  describe('Part 4: Architectural Integrity & Zero Em-Dashes (MS88-TC10)', () => {
    it('MS88-TC10: Validates migration files exist with rollback parity and zero em-dashes', () => {
      const upMigrationPath = path.join(
        rootDir,
        'supabase/migrations/046_additional_services_and_rentals.sql'
      );
      const downMigrationPath = path.join(
        rootDir,
        'supabase/migrations/046_additional_services_and_rentals_down.sql'
      );

      expect(fs.existsSync(upMigrationPath)).toBe(true);
      expect(fs.existsSync(downMigrationPath)).toBe(true);

      const upContent = fs.readFileSync(upMigrationPath, 'utf-8');
      const downContent = fs.readFileSync(downMigrationPath, 'utf-8');

      // Parity assertions
      expect(upContent).toContain('CREATE TABLE IF NOT EXISTS public.additional_services');
      expect(upContent).toContain('chk_rental_pricing_and_stock');
      expect(upContent).toContain('rental_alert_minutes');
      expect(downContent).toContain('DROP TABLE IF EXISTS public.additional_services CASCADE');
      expect(downContent).toContain('DROP COLUMN IF EXISTS rental_alert_minutes');

      // BAN-PUNCT-01: Zero em-dashes across all MS-88 files
      const filesToCheck = [
        upMigrationPath,
        downMigrationPath,
        path.join(rootDir, 'packages/validation/src/additionalServices.ts'),
        path.join(rootDir, 'packages/domain/src/models/additionalService.ts'),
        path.join(rootDir, 'packages/domain/src/services/additionalServiceService.ts'),
        path.join(rootDir, 'packages/domain/src/services/additionalServiceMemoryRepository.ts'),
        path.join(rootDir, 'packages/domain/src/services/additionalServiceSupabaseRepository.ts'),
        path.join(rootDir, 'apps/admin-portal/src/features/services/components/ServiceFormModal.tsx'),
        path.join(rootDir, 'apps/admin-portal/src/features/services/components/ServicesListPage.tsx'),
        path.join(rootDir, 'apps/admin-portal/src/app/api/admin/services/route.ts'),
        path.join(rootDir, 'apps/admin-portal/src/app/api/admin/services/[id]/route.ts'),
      ];

      for (const file of filesToCheck) {
        expect(fs.existsSync(file), `File ${file} should exist`).toBe(true);
        const text = fs.readFileSync(file, 'utf-8');
        expect(text).not.toContain('\u2014'); // em-dash
        expect(text).not.toContain('&mdash;');
      }
    });
  });
});

