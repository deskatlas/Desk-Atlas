import { describe, it, expect } from 'vitest';
import {
  validatePersonName,
  ReservationService,
  StaffManagementService,
  InMemoryWorkspaceRepository,
  ReservationMemoryRepository,
  StaffManagementMemoryRepository,
  ReservationError,
  StaffManagementError,
  CreateReservationRequest,
} from '@deskatlas/domain';

describe('MF-106: Name Input Fields Standard Alphabetic and Name Punctuation Validation', () => {
  describe('Unit Tests: validatePersonName', () => {
    it('accepts standard single and multi-word names', () => {
      expect(validatePersonName('John').isValid).toBe(true);
      expect(validatePersonName('Mary Jane').isValid).toBe(true);
      expect(validatePersonName('Juan de la Cruz').isValid).toBe(true);
    });

    it('accepts names with hyphens, apostrophes, and periods', () => {
      expect(validatePersonName('Smith-Jones').isValid).toBe(true);
      expect(validatePersonName("O'Connor").isValid).toBe(true);
      expect(validatePersonName('O’Neill').isValid).toBe(true);
      expect(validatePersonName("D'Angelo").isValid).toBe(true);
      expect(validatePersonName('St. Clair').isValid).toBe(true);
      expect(validatePersonName('Dr. John').isValid).toBe(true);
      expect(validatePersonName('José Jr.').isValid).toBe(true);
      expect(validatePersonName('Jean-Luc').isValid).toBe(true);
    });

    it('accepts names with Latin diacritics / accented characters', () => {
      expect(validatePersonName('Peña').isValid).toBe(true);
      expect(validatePersonName('Renée').isValid).toBe(true);
      expect(validatePersonName('François').isValid).toBe(true);
      expect(validatePersonName('Müller').isValid).toBe(true);
      expect(validatePersonName('Søren').isValid).toBe(true);
    });

    it('rejects empty, null, or whitespace-only names', () => {
      expect(validatePersonName('').isValid).toBe(false);
      expect(validatePersonName('   ').isValid).toBe(false);
      expect(validatePersonName(null as any).isValid).toBe(false);
      expect(validatePersonName(undefined as any).isValid).toBe(false);
      expect(validatePersonName('', 'First name').error).toBe('First name is required.');
    });

    it('rejects names exceeding 60 characters', () => {
      const longName = 'A'.repeat(61);
      const res = validatePersonName(longName, 'Last name');
      expect(res.isValid).toBe(false);
      expect(res.error).toBe('Last name cannot exceed 60 characters.');
    });

    it('rejects names containing digits', () => {
      const cases = ['John123', '42', 'Agent 007', 'Maria 2nd'];
      for (const c of cases) {
        const res = validatePersonName(c, 'First name');
        expect(res.isValid).toBe(false);
        expect(res.error).toBe('First name can only contain letters, spaces, hyphens, periods, and apostrophes.');
      }
    });

    it('rejects names containing non-name special characters or code injection', () => {
      const cases = [
        'Mary@Doe',
        'Maria$$$',
        'User_Name',
        'Jane+Doe',
        'John*',
        'Test <script>',
        '<b>Bold</b>',
        'Admin/Root',
        'Name=Value',
        'Hello #1',
      ];
      for (const c of cases) {
        const res = validatePersonName(c, 'Name');
        expect(res.isValid).toBe(false);
        expect(res.error).toBe('Name can only contain letters, spaces, hyphens, periods, and apostrophes.');
      }
    });

    it('rejects emojis and symbols', () => {
      const cases = ['🎉 Emoji', 'John 👍', '✨ Star ✨'];
      for (const c of cases) {
        const res = validatePersonName(c);
        expect(res.isValid).toBe(false);
      }
    });

    it('rejects inputs made entirely of punctuation/symbols without letters', () => {
      const cases = ['---', '...', '.', "'", "- . -"];
      for (const c of cases) {
        const res = validatePersonName(c, 'Display name');
        expect(res.isValid).toBe(false);
      }
    });
  });

  describe('ReservationService Integration', () => {
    async function setupReservationService() {
      const workspaceRepo = new InMemoryWorkspaceRepository();
      const floor = await workspaceRepo.createFloor({ floorNumber: 1, name: 'Floor 1' });
      const template = await workspaceRepo.createTemplate({
        name: 'Dedicated Desk',
        capacity: 1,
        rateAmount: 100,
        pricingUnit: 'HOURLY',
        isActive: true,
      });
      const instance = await workspaceRepo.createInstance({
        templateId: template.id,
        floorId: floor.id,
        instanceCode: 'D-01',
        displayName: 'Desk 01',
      });
      const reservationRepo = new ReservationMemoryRepository();
      const service = new ReservationService(reservationRepo, workspaceRepo);
      return { service, instance };
    }

    it('rejects reservation creation if customer first name contains invalid characters', async () => {
      const { service, instance } = await setupReservationService();
      const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
      const startAt = new Date(tomorrow.setHours(10, 0, 0, 0)).toISOString();
      const endAt = new Date(tomorrow.setHours(12, 0, 0, 0)).toISOString();

      const request: CreateReservationRequest = {
        source: 'KIOSK',
        customerFirstName: 'John123',
        customerLastName: 'Doe',
        customerEmail: 'john@example.com',
        candidates: [{ rank: 0, workspaceInstanceId: instance.id, startAt, endAt }],
      };

      await expect(service.createReservation(request)).rejects.toThrow(ReservationError);
      await expect(service.createReservation(request)).rejects.toThrow(
        'First name can only contain letters, spaces, hyphens, periods, and apostrophes.'
      );
    });

    it('rejects reservation creation if customer last name contains invalid characters', async () => {
      const { service, instance } = await setupReservationService();
      const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
      const startAt = new Date(tomorrow.setHours(10, 0, 0, 0)).toISOString();
      const endAt = new Date(tomorrow.setHours(12, 0, 0, 0)).toISOString();

      const request: CreateReservationRequest = {
        source: 'KIOSK',
        customerFirstName: 'John',
        customerLastName: 'Doe$$$',
        customerEmail: 'john@example.com',
        candidates: [{ rank: 0, workspaceInstanceId: instance.id, startAt, endAt }],
      };

      await expect(service.createReservation(request)).rejects.toThrow(ReservationError);
      await expect(service.createReservation(request)).rejects.toThrow(
        'Last name can only contain letters, spaces, hyphens, periods, and apostrophes.'
      );
    });

    it('accepts reservation creation with valid punctuated / accented names', async () => {
      const { service, instance } = await setupReservationService();
      const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
      const startAt = new Date(tomorrow.setHours(10, 0, 0, 0)).toISOString();
      const endAt = new Date(tomorrow.setHours(12, 0, 0, 0)).toISOString();

      const request: CreateReservationRequest = {
        source: 'KIOSK',
        customerFirstName: 'María José',
        customerLastName: "Peña-O'Connor",
        customerEmail: 'maria@example.com',
        candidates: [{ rank: 0, workspaceInstanceId: instance.id, startAt, endAt }],
      };

      const res = await service.createReservation(request);
      expect(res.customerFirstName).toBe('María José');
      expect(res.customerLastName).toBe("Peña-O'Connor");
    });
  });

  describe('StaffManagementService Integration', () => {
    function setupStaffService() {
      const repo = new StaffManagementMemoryRepository();
      const service = new StaffManagementService(repo);
      return { service, repo };
    }

    it('rejects createStaff if display name contains invalid characters', async () => {
      const { service } = setupStaffService();
      await expect(
        service.createStaff({
          email: 'staff1@deskatlas.com',
          displayName: 'Staff 007',
          role: 'STAFF',
          actorRole: 'ADMIN',
        })
      ).rejects.toThrow(StaffManagementError);
      await expect(
        service.createStaff({
          email: 'staff1@deskatlas.com',
          displayName: 'Staff 007',
          role: 'STAFF',
          actorRole: 'ADMIN',
        })
      ).rejects.toThrow('Display name can only contain letters, spaces, hyphens, periods, and apostrophes.');
    });

    it('rejects inviteStaff if display name contains invalid characters', async () => {
      const { service } = setupStaffService();
      await expect(
        service.inviteStaff({
          email: 'staff2@deskatlas.com',
          displayName: 'Admin <script>',
          role: 'STAFF',
          actorRole: 'ADMIN',
        })
      ).rejects.toThrow(StaffManagementError);
      await expect(
        service.inviteStaff({
          email: 'staff2@deskatlas.com',
          displayName: 'Admin <script>',
          role: 'STAFF',
          actorRole: 'ADMIN',
        })
      ).rejects.toThrow('Display name can only contain letters, spaces, hyphens, periods, and apostrophes.');
    });

    it('rejects updateStaff if display name is updated to an invalid format', async () => {
      const { service } = setupStaffService();
      const staff = await service.createStaff({
        email: 'staff3@deskatlas.com',
        displayName: 'John Doe',
        role: 'STAFF',
        actorRole: 'ADMIN',
      });

      await expect(
        service.updateStaff({
          staffUserId: staff.id,
          displayName: 'John_Doe_99',
          actorRole: 'ADMIN',
        })
      ).rejects.toThrow(StaffManagementError);
      await expect(
        service.updateStaff({
          staffUserId: staff.id,
          displayName: 'John_Doe_99',
          actorRole: 'ADMIN',
        })
      ).rejects.toThrow('Display name can only contain letters, spaces, hyphens, periods, and apostrophes.');
    });

    it('accepts staff creation and invitation with valid accented / hyphenated names', async () => {
      const { service } = setupStaffService();
      const staff = await service.createStaff({
        email: 'renee@deskatlas.com',
        displayName: "Renée St. John-Smith",
        role: 'STAFF',
        actorRole: 'ADMIN',
      });
      expect(staff.name).toBe("Renée St. John-Smith");

      const { invitation } = await service.inviteStaff({
        email: 'maria@deskatlas.com',
        displayName: "María Peña",
        role: 'STAFF',
        actorRole: 'ADMIN',
      });
      expect(invitation.displayName).toBe("María Peña");
    });
  });
});
