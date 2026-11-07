import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createElement } from '../apps/staff-dashboard/node_modules/react/index.js';
import { renderToStaticMarkup } from '../apps/staff-dashboard/node_modules/react-dom/server.node.js';
import {
  InMemoryAdditionalServiceRepository,
  InMemoryRentalRepository,
  createRentalService,
  RentalValidationError,
  type BookingRental,
} from '../packages/domain/src';
import { POST as staffExtendRental } from '../apps/staff-dashboard/src/app/api/operations/rentals/[id]/extend/route';
import { setStaffRentalService } from '../apps/staff-dashboard/src/app/api/operations/rentals/_lib/rentalService';
import { POST as adminExtendRental } from '../apps/admin-portal/src/app/api/admin/rentals/[id]/extend/route';
import { setAdminRentalService } from '../apps/admin-portal/src/app/api/admin/rentals/_lib/rentalService';
import { ActiveRentalsTable } from '../apps/staff-dashboard/src/features/rentals/components/ActiveRentalsTable';
import { ExtendRentalModal } from '../apps/staff-dashboard/src/features/rentals/components/ExtendRentalModal';

describe('MS-106: Equipment Rental Overdue Extension Restrictions and Duration Governance', () => {
  const rootDir = path.resolve(__dirname, '..');
  let serviceRepo: InMemoryAdditionalServiceRepository;
  let rentalRepo: InMemoryRentalRepository;
  let rentalService: ReturnType<typeof createRentalService>;

  beforeEach(async () => {
    serviceRepo = new InMemoryAdditionalServiceRepository();
    rentalRepo = new InMemoryRentalRepository([], serviceRepo);
    rentalService = createRentalService(rentalRepo);

    setStaffRentalService(rentalService);
    setAdminRentalService(rentalService);

    rentalRepo.addMockReservation({
      id: 'res-ms106-01',
      status: 'CHECKED_IN',
      customerId: 'cust-106',
      customerName: 'Patricia Gomez',
      customerEmail: 'patricia@example.com',
      spotName: 'Hot Desk #09',
      referenceCode: 'BK-1060',
    });

    await serviceRepo.createAdditionalService({
      name: '27-inch 4K External Monitor',
      description: 'UltraSharp USB-C / HDMI 65W PD',
      serviceType: 'rental',
      hourlyRate: 50.0,
      dailyRate: 250.0,
      totalInventory: 5,
      isActive: true,
    });
  });

  describe('MS106-TC01: Database Stored Procedure Overdue Extension Rejection', () => {
    it('verifies migration 053_block_overdue_rental_extensions.sql exists and enforces overdue check', () => {
      const migrationPath = path.join(
        rootDir,
        'supabase/migrations/053_block_overdue_rental_extensions.sql'
      );
      expect(fs.existsSync(migrationPath)).toBe(true);

      const content = fs.readFileSync(migrationPath, 'utf8');
      expect(content).toContain('CREATE OR REPLACE FUNCTION public.extend_booking_rental');
      expect(content).toContain('v_rental.due_at < v_now');
      expect(content).toContain(
        'Cannot extend an overdue rental. Overdue items must be returned to the counter.'
      );
      expect(content).toContain('rate_applied');
      expect(content).toContain('GRANT EXECUTE ON FUNCTION public.extend_booking_rental');
    });

    it('verifies rollback migration 053_block_overdue_rental_extensions_down.sql reverts procedure', () => {
      const rollbackPath = path.join(
        rootDir,
        'supabase/migrations/053_block_overdue_rental_extensions_down.sql'
      );
      expect(fs.existsSync(rollbackPath)).toBe(true);

      const content = fs.readFileSync(rollbackPath, 'utf8');
      expect(content).toContain('CREATE OR REPLACE FUNCTION public.extend_booking_rental');
      expect(content).not.toContain('Cannot extend an overdue rental');
    });
  });

  describe('MS106-TC02: Active Non-Overdue Rental Extension Succeeds', () => {
    it('allows duration extension when rental is active and not overdue', async () => {
      const services = await serviceRepo.listAdditionalServices({ serviceType: 'rental' });
      const monitor = services[0];

      const activeRental = await rentalService.assignRental({
        reservationId: 'res-ms106-01',
        serviceId: monitor.id,
        billingMode: 'hourly',
        durationUnits: 2,
        idVerified: true,
      });

      expect(activeRental.status).toBe('active');
      expect(activeRental.totalAmount).toBe(100.0);

      const extended = await rentalService.extendRental({
        rentalId: activeRental.id,
        extensionMode: 'hourly',
        additionalUnits: 1,
      });

      expect(extended.totalAmount).toBe(150.0);
      expect(new Date(extended.dueAt).getTime()).toBeGreaterThan(
        new Date(activeRental.dueAt).getTime()
      );
    });
  });

  describe('MS106-TC03: Domain Service and Repository Guard Against Overdue Extensions', () => {
    it('rejects rental extension via rentalService if dueAt is in the past', async () => {
      const services = await serviceRepo.listAdditionalServices({ serviceType: 'rental' });
      const monitor = services[0];

      const rental = await rentalService.assignRental({
        reservationId: 'res-ms106-01',
        serviceId: monitor.id,
        billingMode: 'hourly',
        durationUnits: 1,
        idVerified: true,
      });

      // Shift due timestamp 30 minutes into the past
      const pastDue = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      rentalRepo.updateRentalDueAt(rental.id, pastDue);

      await expect(
        rentalService.extendRental({
          rentalId: rental.id,
          extensionMode: 'hourly',
          additionalUnits: 1,
        })
      ).rejects.toThrow(RentalValidationError);

      await expect(
        rentalService.extendRental({
          rentalId: rental.id,
          extensionMode: 'hourly',
          additionalUnits: 1,
        })
      ).rejects.toThrow(
        'Cannot extend an overdue rental. Overdue items must be returned to the counter.'
      );
    });

    it('rejects rental extension via InMemoryRentalRepository directly if dueAt is in the past', async () => {
      const services = await serviceRepo.listAdditionalServices({ serviceType: 'rental' });
      const monitor = services[0];

      const rental = await rentalService.assignRental({
        reservationId: 'res-ms106-01',
        serviceId: monitor.id,
        billingMode: 'hourly',
        durationUnits: 1,
        idVerified: true,
      });

      const pastDue = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      rentalRepo.updateRentalDueAt(rental.id, pastDue);

      await expect(
        rentalRepo.extendRental({
          rentalId: rental.id,
          extensionMode: 'hourly',
          additionalUnits: 1,
        })
      ).rejects.toThrow(
        'Cannot extend an overdue rental. Overdue items must be returned to the counter.'
      );
    });
  });

  describe('MS106-TC04 & TC05: Staff and Admin API Routes Return HTTP 400 for Overdue Extension', () => {
    it('MS106-TC04: Staff Dashboard route returns status 400 when attempting to extend an overdue rental', async () => {
      const services = await serviceRepo.listAdditionalServices({ serviceType: 'rental' });
      const monitor = services[0];

      const rental = await rentalService.assignRental({
        reservationId: 'res-ms106-01',
        serviceId: monitor.id,
        billingMode: 'hourly',
        durationUnits: 1,
        idVerified: true,
      });

      const pastDue = new Date(Date.now() - 45 * 60 * 1000).toISOString();
      rentalRepo.updateRentalDueAt(rental.id, pastDue);

      const req = new Request(
        `http://localhost:3000/api/operations/rentals/${rental.id}/extend`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rentalId: rental.id,
            extensionMode: 'hourly',
            additionalUnits: 1,
          }),
        }
      );

      const res = await staffExtendRental(req as unknown as Parameters<typeof staffExtendRental>[0], {
        params: Promise.resolve({ id: rental.id }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('Cannot extend an overdue rental');
    });

    it('MS106-TC05: Admin Portal route returns status 400 when attempting to extend an overdue rental', async () => {
      const services = await serviceRepo.listAdditionalServices({ serviceType: 'rental' });
      const monitor = services[0];

      const rental = await rentalService.assignRental({
        reservationId: 'res-ms106-01',
        serviceId: monitor.id,
        billingMode: 'hourly',
        durationUnits: 1,
        idVerified: true,
      });

      const pastDue = new Date(Date.now() - 20 * 60 * 1000).toISOString();
      rentalRepo.updateRentalDueAt(rental.id, pastDue);

      const req = new Request(
        `http://localhost:3000/api/admin/rentals/${rental.id}/extend`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rentalId: rental.id,
            extensionMode: 'hourly',
            additionalUnits: 1,
          }),
        }
      );

      const res = await adminExtendRental(req as unknown as Parameters<typeof adminExtendRental>[0], {
        params: Promise.resolve({ id: rental.id }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('Cannot extend an overdue rental');
    });
  });

  describe('MS106-TC06: Staff UI Extend Time Button Disabled for Overdue Row & Modal Overdue Warning', () => {
    it('disables Extend Time button on overdue rows in ActiveRentalsTable', () => {
      const now = Date.now();
      const activeRental: BookingRental = {
        id: 'rnt-active-01',
        rentalCode: 'RNT-20261107-ACTIVE',
        reservationId: 'res-ms106-01',
        customerId: 'cust-106',
        serviceId: 'srv-01',
        unitCount: 1,
        billingMode: 'hourly',
        durationUnits: 2,
        rateApplied: 50,
        totalAmount: 100,
        idVerified: true,
        idNotes: '',
        status: 'active',
        rentedAt: new Date(now - 30 * 60 * 1000).toISOString(),
        dueAt: new Date(now + 90 * 60 * 1000).toISOString(),
        staffUserId: null,
        notes: '',
        createdAt: new Date(now - 30 * 60 * 1000).toISOString(),
        updatedAt: new Date(now - 30 * 60 * 1000).toISOString(),
        customerName: 'Patricia Gomez',
        spotName: 'Hot Desk #09',
        serviceName: '27-inch 4K External Monitor',
        isOverdue: false,
      };

      const overdueRental: BookingRental = {
        id: 'rnt-overdue-02',
        rentalCode: 'RNT-20261107-OVERDUE',
        reservationId: 'res-ms106-01',
        customerId: 'cust-106',
        serviceId: 'srv-01',
        unitCount: 1,
        billingMode: 'hourly',
        durationUnits: 1,
        rateApplied: 50,
        totalAmount: 50,
        idVerified: true,
        idNotes: '',
        status: 'active',
        rentedAt: new Date(now - 90 * 60 * 1000).toISOString(),
        dueAt: new Date(now - 30 * 60 * 1000).toISOString(),
        staffUserId: null,
        notes: '',
        createdAt: new Date(now - 90 * 60 * 1000).toISOString(),
        updatedAt: new Date(now - 90 * 60 * 1000).toISOString(),
        customerName: 'Patricia Gomez',
        spotName: 'Hot Desk #09',
        serviceName: '27-inch 4K External Monitor',
        isOverdue: true,
      };

      const html = renderToStaticMarkup(
        createElement(ActiveRentalsTable, {
          rentals: [activeRental, overdueRental],
          loading: false,
          onRefresh: () => {},
        })
      );

      // Verify overdue row has disabled extend button with not-allowed cursor
      expect(html).toContain('data-testid="extend-rental-btn-rnt-overdue-02"');
      expect(html).toMatch(/data-testid="extend-rental-btn-rnt-overdue-02"[^>]*disabled=""/);
      expect(html).toMatch(/data-testid="extend-rental-btn-rnt-overdue-02"[^>]*cursor:not-allowed/);

      // Verify active row has enabled extend button with pointer cursor
      expect(html).toContain('data-testid="extend-rental-btn-rnt-active-01"');
      expect(html).not.toMatch(/data-testid="extend-rental-btn-rnt-active-01"[^>]*disabled=""/);
      expect(html).toMatch(/data-testid="extend-rental-btn-rnt-active-01"[^>]*cursor:pointer/);
    });

    it('renders warning banner and disables submit in ExtendRentalModal for overdue rental', () => {
      const now = Date.now();
      const overdueRental: BookingRental = {
        id: 'rnt-overdue-modal-01',
        rentalCode: 'RNT-20261107-OVERDUE-MODAL',
        reservationId: 'res-ms106-01',
        customerId: 'cust-106',
        serviceId: 'srv-01',
        unitCount: 1,
        billingMode: 'hourly',
        durationUnits: 1,
        rateApplied: 50,
        totalAmount: 50,
        idVerified: true,
        idNotes: '',
        status: 'active',
        rentedAt: new Date(now - 120 * 60 * 1000).toISOString(),
        dueAt: new Date(now - 60 * 60 * 1000).toISOString(),
        staffUserId: null,
        notes: '',
        createdAt: new Date(now - 120 * 60 * 1000).toISOString(),
        updatedAt: new Date(now - 120 * 60 * 1000).toISOString(),
        customerName: 'Patricia Gomez',
        spotName: 'Hot Desk #09',
        serviceName: '27-inch 4K External Monitor',
        isOverdue: true,
      };

      const html = renderToStaticMarkup(
        createElement(ExtendRentalModal, {
          isOpen: true,
          onClose: () => {},
          onSuccess: () => {},
          rental: overdueRental,
        })
      );

      // Warning banner present
      expect(html).toContain('data-testid="extend-rental-overdue-warning"');
      expect(html).toContain(
        'This rental is overdue. Overdue items cannot be extended and must be returned.'
      );

      // Submit button disabled with not-allowed cursor
      expect(html).toMatch(/data-testid="confirm-extend-submit-btn"[^>]*disabled=""/);
      expect(html).toMatch(/data-testid="confirm-extend-submit-btn"[^>]*cursor:not-allowed/);
    });
  });

  describe('MS106-TC07: Zero Em-Dash Formatting Invariant (BAN-PUNCT-01)', () => {
    it('enforces BAN-PUNCT-01: zero em-dashes and en-dashes across all touched files', () => {
      const filesToCheck = [
        'supabase/migrations/053_block_overdue_rental_extensions.sql',
        'supabase/migrations/053_block_overdue_rental_extensions_down.sql',
        'packages/domain/src/services/rentalService.ts',
        'packages/domain/src/services/rentalMemoryRepository.ts',
        'apps/staff-dashboard/src/features/rentals/components/ActiveRentalsTable.tsx',
        'apps/staff-dashboard/src/features/rentals/components/ExtendRentalModal.tsx',
        'apps/staff-dashboard/src/app/api/operations/rentals/[id]/extend/route.ts',
        'apps/admin-portal/src/app/api/admin/rentals/[id]/extend/route.ts',
        'tests/ms106-rental-overdue-extension-guard.test.ts',
      ];

      for (const relativePath of filesToCheck) {
        const fullPath = path.join(rootDir, relativePath);
        if (fs.existsSync(fullPath)) {
          const content = fs.readFileSync(fullPath, 'utf8');
          const hasEmDash = content.includes('\u2014') || content.includes('\u2013');
          expect(hasEmDash, `File ${relativePath} contains em-dash or en-dash`).toBe(false);
        }
      }
    });
  });

  describe('MS106-TC08: Non-Existent and Returned Rental Guarding', () => {
    it('throws validation error when extending a returned rental', async () => {
      const services = await serviceRepo.listAdditionalServices({ serviceType: 'rental' });
      const monitor = services[0];

      const rental = await rentalService.assignRental({
        reservationId: 'res-ms106-01',
        serviceId: monitor.id,
        billingMode: 'hourly',
        durationUnits: 1,
        idVerified: true,
      });

      await rentalService.returnRental({ rentalId: rental.id });

      await expect(
        rentalService.extendRental({
          rentalId: rental.id,
          extensionMode: 'hourly',
          additionalUnits: 1,
        })
      ).rejects.toThrow('Cannot extend a returned rental');
    });

    it('throws validation error when extending a non-existent rental', async () => {
      await expect(
        rentalService.extendRental({
          rentalId: 'rnt-non-existent-999',
          extensionMode: 'hourly',
          additionalUnits: 1,
        })
      ).rejects.toThrow('Rental record not found');
    });
  });
});
