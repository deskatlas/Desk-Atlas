import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  InMemoryAdditionalServiceRepository,
  createAdditionalServiceService,
  InMemoryRentalRepository,
  createRentalService,
  RentalService,
  renderRentalConfirmationEmail,
  renderRentalEndingAlertEmail,
  type RentalConfirmationEmailInput,
  type RentalEndingAlertEmailInput,
  type BookingRental,
} from '../packages/domain/src';
import {
  GET as staffGetRentalAlerts,
} from '../apps/staff-dashboard/src/app/api/operations/rentals/alerts/route';
import {
  GET as adminGetRentalAlerts,
} from '../apps/admin-portal/src/app/api/admin/rentals/alerts/route';
import { setStaffRentalService } from '../apps/staff-dashboard/src/app/api/operations/rentals/_lib/rentalService';
import { setAdminRentalService } from '../apps/admin-portal/src/app/api/admin/rentals/_lib/rentalService';

describe('MS-92: Equipment Rental Email Notifications (Receipt Confirmation and Configured Nearing-End Alerts)', () => {
  let serviceRepo: InMemoryAdditionalServiceRepository;
  let rentalRepo: InMemoryRentalRepository;
  let mockEmailService: {
    sendRentalConfirmationEmail: ReturnType<typeof vi.fn>;
    sendRentalEndingAlertEmail: ReturnType<typeof vi.fn>;
  };
  let rentalService: RentalService;

  beforeEach(async () => {
    serviceRepo = new InMemoryAdditionalServiceRepository();
    rentalRepo = new InMemoryRentalRepository([], serviceRepo);

    mockEmailService = {
      sendRentalConfirmationEmail: vi.fn().mockResolvedValue({ success: true, id: 'mock-confirm-id' }),
      sendRentalEndingAlertEmail: vi.fn().mockResolvedValue({ success: true, id: 'mock-ending-id' }),
    };

    rentalService = new RentalService(rentalRepo, mockEmailService as any);
    setStaffRentalService(rentalService);
    setAdminRentalService(rentalService);

    // Seed mock active reservation with email
    rentalRepo.addMockReservation({
      id: 'res-cust-01',
      status: 'CHECKED_IN',
      customerId: 'cust-01',
      customerName: 'Juan Dela Cruz',
      customerEmail: 'juan@example.com',
      spotName: 'Dedicated Desk #08',
      referenceCode: 'BK-1001',
    });

    // Seed mock reservation without email (guest phone-only walk-in)
    rentalRepo.addMockReservation({
      id: 'res-no-email-02',
      status: 'CHECKED_IN',
      customerId: 'cust-02',
      customerName: 'Anonymous Guest',
      spotName: 'Flex Desk #03',
      referenceCode: 'BK-2002',
    });

    // Seed rental hardware items
    await serviceRepo.createAdditionalService({
      name: '27-inch 4K External Monitor',
      description: 'Dell UltraSharp USB-C / HDMI with 65W PD',
      serviceType: 'rental',
      hourlyRate: 50.0,
      dailyRate: 250.0,
      totalInventory: 5,
      isActive: true,
    });

    await serviceRepo.createAdditionalService({
      name: 'Mechanical Ergonomic Keyboard',
      description: 'Tactile quiet switches with wrist rest',
      serviceType: 'rental',
      hourlyRate: 30.0,
      dailyRate: 150.0,
      totalInventory: 3,
      isActive: true,
    });
  });

  describe('Part 1: Successful Rental Confirmation Email Dispatch', () => {
    it('dispatches confirmation email with complete rental details upon successful rental assignment', async () => {
      const items = await serviceRepo.listAdditionalServices();
      const monitor = items.find((i) => i.name.includes('Monitor'))!;

      const rental = await rentalService.assignRental({
        reservationId: 'res-cust-01',
        serviceId: monitor.id,
        billingMode: 'hourly',
        durationUnits: 3,
        idVerified: true,
        idNotes: 'Passport held at front desk',
        notes: 'HDMI cable included',
      });

      expect(rental).toBeDefined();
      expect(rental.status).toBe('active');
      expect(rental.rentalCode).toMatch(/^RNT-/);
      expect(rental.totalAmount).toBe(150.0);

      // Verify email was sent
      expect(mockEmailService.sendRentalConfirmationEmail).toHaveBeenCalledTimes(1);
      const callArg = mockEmailService.sendRentalConfirmationEmail.mock.calls[0][0];

      expect(callArg.to).toBe('juan@example.com');
      expect(callArg.customerName).toBe('Juan Dela Cruz');
      expect(callArg.rentalCode).toBe(rental.rentalCode);
      expect(callArg.referenceCode).toBe('BK-1001');
      expect(callArg.spotName).toBe('Dedicated Desk #08');
      expect(callArg.itemName).toBe('27-inch 4K External Monitor');
      expect(callArg.billingMode).toBe('hourly');
      expect(callArg.durationUnits).toBe(3);
      expect(callArg.rateApplied).toBe(50.0);
      expect(callArg.totalAmount).toBe(150.0);
      expect(callArg.rentedAt).toBe(rental.rentedAt);
      expect(callArg.dueAt).toBe(rental.dueAt);
      expect(callArg.idVerified).toBe(true);

      // Verify confirmationSentAt was marked in repository
      const savedRental = await rentalRepo.getRentalById(rental.id);
      expect(savedRental?.confirmationSentAt).toBeDefined();
    });

    it('skips email dispatch gracefully without throwing when reservation has no customer email', async () => {
      const items = await serviceRepo.listAdditionalServices();
      const keyboard = items.find((i) => i.name.includes('Keyboard'))!;

      const rental = await rentalService.assignRental({
        reservationId: 'res-no-email-02',
        serviceId: keyboard.id,
        billingMode: 'hourly',
        durationUnits: 1,
        idVerified: true,
      });

      expect(rental).toBeDefined();
      expect(rental.status).toBe('active');
      expect(mockEmailService.sendRentalConfirmationEmail).not.toHaveBeenCalled();
    });
  });

  describe('Part 2: Configured Staff Alert Timing and Ending Alert Email Dispatch', () => {
    it('dispatches ending alert email when rental approaches due date within configured threshold', async () => {
      const items = await serviceRepo.listAdditionalServices();
      const monitor = items.find((i) => i.name.includes('Monitor'))!;

      const rental = await rentalService.assignRental({
        reservationId: 'res-cust-01',
        serviceId: monitor.id,
        billingMode: 'hourly',
        durationUnits: 2,
        idVerified: true,
      });

      // Initially rental has 2 hours remaining, threshold is 10 minutes
      const resultFar = await rentalService.processRentalEndAlertEmails(10, new Date());
      expect(resultFar.sentCount).toBe(0);
      expect(mockEmailService.sendRentalEndingAlertEmail).not.toHaveBeenCalled();

      // Simulate time advancing to 8 minutes before dueAt (within 10-minute threshold)
      const dueTime = new Date(rental.dueAt).getTime();
      const simulatedNow = new Date(dueTime - 8 * 60 * 1000);

      const resultNear = await rentalService.processRentalEndAlertEmails(10, simulatedNow);
      expect(resultNear.sentCount).toBe(1);
      expect(resultNear.rentalIds).toContain(rental.id);

      expect(mockEmailService.sendRentalEndingAlertEmail).toHaveBeenCalledTimes(1);
      const alertArg = mockEmailService.sendRentalEndingAlertEmail.mock.calls[0][0];

      expect(alertArg.to).toBe('juan@example.com');
      expect(alertArg.customerName).toBe('Juan Dela Cruz');
      expect(alertArg.rentalCode).toBe(rental.rentalCode);
      expect(alertArg.spotName).toBe('Dedicated Desk #08');
      expect(alertArg.itemName).toBe('27-inch 4K External Monitor');
      expect(alertArg.dueAt).toBe(rental.dueAt);
      expect(alertArg.timeRemainingMinutes).toBe(8);

      // Verify endAlertSentAt was updated in repository
      const updatedRental = await rentalRepo.getRentalById(rental.id);
      expect(updatedRental?.endAlertSentAt).toBeDefined();
    });

    it('enforces idempotency and does not send duplicate ending emails on subsequent checks', async () => {
      const items = await serviceRepo.listAdditionalServices();
      const monitor = items.find((i) => i.name.includes('Monitor'))!;

      const rental = await rentalService.assignRental({
        reservationId: 'res-cust-01',
        serviceId: monitor.id,
        billingMode: 'hourly',
        durationUnits: 1,
        idVerified: true,
      });

      const dueTime = new Date(rental.dueAt).getTime();
      const simulatedNow = new Date(dueTime - 4 * 60 * 1000); // 4 minutes remaining (within 5-min threshold)

      // First check sends email
      const firstRun = await rentalService.processRentalEndAlertEmails(5, simulatedNow);
      expect(firstRun.sentCount).toBe(1);
      expect(mockEmailService.sendRentalEndingAlertEmail).toHaveBeenCalledTimes(1);

      // Second check 30 seconds later must be idempotent (zero additional emails)
      const simulatedNext = new Date(simulatedNow.getTime() + 30 * 1000);
      const secondRun = await rentalService.processRentalEndAlertEmails(5, simulatedNext);
      expect(secondRun.sentCount).toBe(0);
      expect(mockEmailService.sendRentalEndingAlertEmail).toHaveBeenCalledTimes(1);
    });

    it('resets alert state upon duration extension so customer receives second alert for new end time', async () => {
      const items = await serviceRepo.listAdditionalServices();
      const monitor = items.find((i) => i.name.includes('Monitor'))!;

      const rental = await rentalService.assignRental({
        reservationId: 'res-cust-01',
        serviceId: monitor.id,
        billingMode: 'hourly',
        durationUnits: 1,
        idVerified: true,
      });

      // 1. Initial expiration alert sent
      const initialDueTime = new Date(rental.dueAt).getTime();
      const simulatedNow = new Date(initialDueTime - 3 * 60 * 1000);
      await rentalService.processRentalEndAlertEmails(5, simulatedNow);
      expect(mockEmailService.sendRentalEndingAlertEmail).toHaveBeenCalledTimes(1);

      // Verify endAlertSentAt is set
      let record = await rentalRepo.getRentalById(rental.id);
      expect(record?.endAlertSentAt).toBeTruthy();

      // 2. Customer extends rental by 2 hours
      const extended = await rentalService.extendRental({
        rentalId: rental.id,
        extensionMode: 'hourly',
        additionalUnits: 2,
      });

      // endAlertSentAt must be reset to null/undefined
      record = await rentalRepo.getRentalById(rental.id);
      expect(record?.endAlertSentAt).toBeFalsy();

      // 3. Simulate approaching new extended due time (4 minutes before new dueAt)
      const newDueTime = new Date(extended.dueAt).getTime();
      const simulatedNewTime = new Date(newDueTime - 4 * 60 * 1000);

      const extensionAlertRun = await rentalService.processRentalEndAlertEmails(5, simulatedNewTime);
      expect(extensionAlertRun.sentCount).toBe(1);
      expect(mockEmailService.sendRentalEndingAlertEmail).toHaveBeenCalledTimes(2);

      const secondAlertArg = mockEmailService.sendRentalEndingAlertEmail.mock.calls[1][0];
      expect(secondAlertArg.dueAt).toBe(extended.dueAt);
      expect(secondAlertArg.timeRemainingMinutes).toBe(4);
    });

    it('does not send alert emails for rentals that have already been returned', async () => {
      const items = await serviceRepo.listAdditionalServices();
      const monitor = items.find((i) => i.name.includes('Monitor'))!;

      const rental = await rentalService.assignRental({
        reservationId: 'res-cust-01',
        serviceId: monitor.id,
        billingMode: 'hourly',
        durationUnits: 1,
        idVerified: true,
      });

      // Return the item
      await rentalService.returnRental({ rentalId: rental.id });

      // Simulate being inside the alert threshold
      const dueTime = new Date(rental.dueAt).getTime();
      const simulatedNow = new Date(dueTime - 2 * 60 * 1000);

      const result = await rentalService.processRentalEndAlertEmails(5, simulatedNow);
      expect(result.sentCount).toBe(0);
      expect(mockEmailService.sendRentalEndingAlertEmail).not.toHaveBeenCalled();
    });
  });

  describe('Part 3: Staff & Admin Alert API Endpoints Integration', () => {
    it('staff alerts endpoint triggers customer ending alert email at the configured alert threshold', async () => {
      const items = await serviceRepo.listAdditionalServices();
      const monitor = items.find((i) => i.name.includes('Monitor'))!;

      const rental = await rentalService.assignRental({
        reservationId: 'res-cust-01',
        serviceId: monitor.id,
        billingMode: 'hourly',
        durationUnits: 1,
        idVerified: true,
      });

      // Force dueAt to be 3 minutes from now (inside default 5 min threshold)
      const nearDue = new Date(Date.now() + 3 * 60 * 1000).toISOString();
      rentalRepo.updateRentalDueAt(rental.id, nearDue);

      const response = await staffGetRentalAlerts();
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.rentalAlertCount).toBeGreaterThanOrEqual(1);
      expect(data.thresholdMinutes).toBe(5);

      // Verify customer received the ending alert email
      expect(mockEmailService.sendRentalEndingAlertEmail).toHaveBeenCalledTimes(1);
      expect(mockEmailService.sendRentalEndingAlertEmail.mock.calls[0][0].rentalCode).toBe(rental.rentalCode);
    });

    it('admin alerts endpoint triggers customer ending alert email with admin parity', async () => {
      const items = await serviceRepo.listAdditionalServices();
      const keyboard = items.find((i) => i.name.includes('Keyboard'))!;

      const rental = await rentalService.assignRental({
        reservationId: 'res-cust-01',
        serviceId: keyboard.id,
        billingMode: 'hourly',
        durationUnits: 1,
        idVerified: true,
      });

      // Force dueAt to be 2 minutes from now (inside default 5 min threshold)
      const nearDue = new Date(Date.now() + 2 * 60 * 1000).toISOString();
      rentalRepo.updateRentalDueAt(rental.id, nearDue);

      const response = await adminGetRentalAlerts();
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.rentalAlertCount).toBeGreaterThanOrEqual(1);

      // Verify email dispatch
      expect(mockEmailService.sendRentalEndingAlertEmail).toHaveBeenCalledTimes(1);
    });
  });

  describe('Part 4: Email Content Rendering & BAN-PUNCT-01 Quality Constraints', () => {
    it('renderRentalConfirmationEmail produces valid HTML and text with all required details and zero em-dashes', () => {
      const input: RentalConfirmationEmailInput = {
        to: 'juan@example.com',
        customerName: 'Juan Dela Cruz',
        rentalCode: 'RNT-20261030-XYZ789',
        referenceCode: 'BK-1001',
        spotName: 'Dedicated Desk #08',
        itemName: '27-inch 4K External Monitor',
        billingMode: 'hourly',
        durationUnits: 3,
        rateApplied: 50.0,
        totalAmount: 150.0,
        rentedAt: '2026-10-30T10:00:00.000Z',
        dueAt: '2026-10-30T13:00:00.000Z',
        idVerified: true,
      };

      const rendered = renderRentalConfirmationEmail(input);

      expect(rendered.subject).toContain('Your Equipment Rental Confirmation');
      expect(rendered.subject).toContain('RNT-20261030-XYZ789');
      expect(rendered.subject).toContain('27-inch 4K External Monitor');

      // Check HTML content
      expect(rendered.html).toContain('Juan Dela Cruz');
      expect(rendered.html).toContain('RNT-20261030-XYZ789');
      expect(rendered.html).toContain('BK-1001');
      expect(rendered.html).toContain('Dedicated Desk #08');
      expect(rendered.html).toContain('27-inch 4K External Monitor');
      expect(rendered.html).toContain('3 hours (Hourly)');
      expect(rendered.html).toContain('₱150.00');
      expect(rendered.html).toContain('Front Desk ID Deposit');

      // Check Text content
      expect(rendered.text).toContain('EQUIPMENT RENTAL RECEIPT');
      expect(rendered.text).toContain('RNT-20261030-XYZ789');
      expect(rendered.text).toContain('₱150.00');

      // Strict BAN-PUNCT-01 verification: NO EM-DASHES
      expect(rendered.subject).not.toContain('—');
      expect(rendered.subject).not.toContain('–');
      expect(rendered.html).not.toContain('—');
      expect(rendered.html).not.toContain('–');
      expect(rendered.text).not.toContain('—');
      expect(rendered.text).not.toContain('–');
    });

    it('renderRentalEndingAlertEmail produces valid HTML and text with urgent notice and zero em-dashes', () => {
      const input: RentalEndingAlertEmailInput = {
        to: 'juan@example.com',
        customerName: 'Juan Dela Cruz',
        rentalCode: 'RNT-20261030-XYZ789',
        referenceCode: 'BK-1001',
        spotName: 'Dedicated Desk #08',
        itemName: '27-inch 4K External Monitor',
        dueAt: '2026-10-30T13:00:00.000Z',
        timeRemainingMinutes: 5,
      };

      const rendered = renderRentalEndingAlertEmail(input);

      expect(rendered.subject).toContain('Reminder: Your Equipment Rental for 27-inch 4K External Monitor is Ending Soon');
      expect(rendered.subject).toContain('RNT-20261030-XYZ789');

      // Check HTML content
      expect(rendered.html).toContain('Juan Dela Cruz');
      expect(rendered.html).toContain('Ending Soon');
      expect(rendered.html).toContain('5 minutes');
      expect(rendered.html).toContain('RNT-20261030-XYZ789');
      expect(rendered.html).toContain('Return the item to the front desk');
      expect(rendered.html).toContain('Need more time?');

      // Check Text content
      expect(rendered.text).toContain('EQUIPMENT RENTAL EXPIRATION REMINDER');
      expect(rendered.text).toContain('5 minutes');

      // Strict BAN-PUNCT-01 verification: NO EM-DASHES
      expect(rendered.subject).not.toContain('—');
      expect(rendered.subject).not.toContain('–');
      expect(rendered.html).not.toContain('—');
      expect(rendered.html).not.toContain('–');
      expect(rendered.text).not.toContain('—');
      expect(rendered.text).not.toContain('–');
    });
  });
});

