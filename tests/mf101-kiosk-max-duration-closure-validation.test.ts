import { describe, expect, it } from 'vitest';
import {
  InMemoryAvailabilityRepository,
  createAvailabilityService,
} from '../packages/domain/src';

describe('MF-101: Kiosk Max Duration Cap & Facility Closure / Operating Hours Validation', () => {
  it('rejects 2000 hours booking as exceeding max kiosk walk-in duration cap', async () => {
    const repo = new InMemoryAvailabilityRepository();
    const service = createAvailabilityService(repo);

    repo.seedWorkspaceInstance({
      id: 'spot-1',
      templateId: 'tpl-dedicated',
      displayName: 'Desk 01',
      operationalStatus: 'ACTIVE',
    });

    // 24/7 operating hours
    repo.seedOperatingHours(0, [{ opensAt: '00:00', closesAt: '24:00' }]);
    repo.seedOperatingHours(1, [{ opensAt: '00:00', closesAt: '24:00' }]);
    repo.seedOperatingHours(2, [{ opensAt: '00:00', closesAt: '24:00' }]);
    repo.seedOperatingHours(3, [{ opensAt: '00:00', closesAt: '24:00' }]);
    repo.seedOperatingHours(4, [{ opensAt: '00:00', closesAt: '24:00' }]);
    repo.seedOperatingHours(5, [{ opensAt: '00:00', closesAt: '24:00' }]);
    repo.seedOperatingHours(6, [{ opensAt: '00:00', closesAt: '24:00' }]);

    const startAt = '2026-09-13T02:00:00.000Z'; // 10:00 AM Manila
    // 2000 hours later = 120,000 minutes
    const endAt = new Date(new Date(startAt).getTime() + 2000 * 60 * 60 * 1000).toISOString();

    const result = await service.validateReservationWindow({
      workspaceInstanceId: 'spot-1',
      startAt,
      endAt,
      maxDurationMinutes: 24 * 60, // 24-hour cap
    });

    expect(result.isValid).toBe(false);
    expect(result.conflictType).toBe('MAX_DURATION_EXCEEDED');
    expect(result.errorMessage).toBe(
      'The requested duration extends into a scheduled facility closure or non-operational period.'
    );
  });

  it('rejects reservation that extends into a scheduled facility closure', async () => {
    const repo = new InMemoryAvailabilityRepository();
    const service = createAvailabilityService(repo);

    repo.seedWorkspaceInstance({
      id: 'spot-1',
      templateId: 'tpl-dedicated',
      displayName: 'Desk 01',
      operationalStatus: 'ACTIVE',
    });

    // Operates 06:00 to 24:00
    for (let day = 0; day <= 6; day++) {
      repo.seedOperatingHours(day, [{ opensAt: '06:00', closesAt: '24:00' }]);
    }

    // Facility closure on Sept 16, 2026 (whole day closure)
    repo.seedScheduleBlock({
      id: 'block-closure-16',
      scope: 'BUSINESS',
      workspaceInstanceId: null,
      blockType: 'CLOSURE',
      startAt: '2026-09-15T16:00:00.000Z', // 2026-09-16 00:00 Manila (UTC+8)
      endAt: '2026-09-16T16:00:00.000Z',   // 2026-09-17 00:00 Manila
      reason: 'Scheduled Facility Maintenance Closure',
    });

    // Multi-day booking starting Sept 15 18:00 Manila (10:00 UTC) extending for 8 hours into Sept 16
    const startAt = '2026-09-15T10:00:00.000Z'; // 18:00 Manila
    const endAt = '2026-09-15T18:00:00.000Z';   // 02:00 Manila on Sept 16 (crosses closure)

    const result = await service.validateReservationWindow({
      workspaceInstanceId: 'spot-1',
      startAt,
      endAt,
      maxDurationMinutes: 24 * 60,
    });

    expect(result.isValid).toBe(false);
    expect(result.conflictType).toBe('FACILITY_CLOSURE');
    expect(result.errorMessage).toBe(
      'The requested duration extends into a scheduled facility closure or non-operational period.'
    );
  });

  it('rejects reservation extending beyond venue daily operating hours closing time', async () => {
    const repo = new InMemoryAvailabilityRepository();
    const service = createAvailabilityService(repo);

    repo.seedWorkspaceInstance({
      id: 'spot-1',
      templateId: 'tpl-dedicated',
      displayName: 'Desk 01',
      operationalStatus: 'ACTIVE',
    });

    // Space closes at 20:00 (8:00 PM Manila) on Mondays (dayOfWeek = 1)
    repo.seedOperatingHours(1, [{ opensAt: '08:00', closesAt: '20:00' }]);

    // Booking at 18:00 Manila (10:00 UTC) requesting 4 hours (until 22:00 Manila / 14:00 UTC)
    const startAt = '2026-09-14T10:00:00.000Z'; // 18:00 Manila (Monday)
    const endAt = '2026-09-14T14:00:00.000Z';   // 22:00 Manila (past 20:00 closing)

    const result = await service.validateReservationWindow({
      workspaceInstanceId: 'spot-1',
      startAt,
      endAt,
      maxDurationMinutes: 24 * 60,
    });

    expect(result.isValid).toBe(false);
    expect(result.conflictType).toBe('BUSINESS_CLOSED');
    expect(result.errorMessage).toBe(
      'The requested duration extends into a scheduled facility closure or non-operational period.'
    );
  });

  it('rejects reservation when venue is closed for the day', async () => {
    const repo = new InMemoryAvailabilityRepository();
    const service = createAvailabilityService(repo);

    repo.seedWorkspaceInstance({
      id: 'spot-1',
      templateId: 'tpl-dedicated',
      displayName: 'Desk 01',
      operationalStatus: 'ACTIVE',
    });

    // No operating hours on Sunday (dayOfWeek = 0)
    // Seed Monday only
    repo.seedOperatingHours(1, [{ opensAt: '08:00', closesAt: '20:00' }]);

    // Sunday Sept 13, 2026 at 10:00 AM Manila (02:00 UTC)
    const startAt = '2026-09-13T02:00:00.000Z';
    const endAt = '2026-09-13T04:00:00.000Z';

    const result = await service.validateReservationWindow({
      workspaceInstanceId: 'spot-1',
      startAt,
      endAt,
      maxDurationMinutes: 24 * 60,
    });

    expect(result.isValid).toBe(false);
    expect(result.conflictType).toBe('BUSINESS_CLOSED');
    expect(result.errorMessage).toBe(
      'The requested duration extends into a scheduled facility closure or non-operational period.'
    );
  });

  it('getNextUpcomingBooking reports minutesUntilClosing = 0 and maxAvailableHours = 0 on closed days', async () => {
    const repo = new InMemoryAvailabilityRepository();
    const service = createAvailabilityService(repo);

    repo.seedWorkspaceInstance({
      id: 'spot-closed',
      templateId: 'tpl-dedicated',
      displayName: 'Desk Closed',
      operationalStatus: 'ACTIVE',
    });

    // Closed on Sunday (dayOfWeek = 0)
    const sundayNow = '2026-09-13T02:00:00.000Z';
    const upcoming = await service.getNextUpcomingBooking('spot-closed', sundayNow);

    expect(upcoming.minutesUntilClosing).toBe(0);
    expect(upcoming.maxAvailableMinutes).toBe(0);
    expect(upcoming.maxAvailableHours).toBe(0);
  });

  it('listOccupiedInstances marks all workspaces as occupied during business facility closures', async () => {
    const repo = new InMemoryAvailabilityRepository();
    const service = createAvailabilityService(repo);

    repo.seedWorkspaceInstance({
      id: 'spot-a',
      templateId: 'tpl-dedicated',
      displayName: 'Desk A',
      operationalStatus: 'ACTIVE',
    });
    repo.seedWorkspaceInstance({
      id: 'spot-b',
      templateId: 'tpl-dedicated',
      displayName: 'Desk B',
      operationalStatus: 'ACTIVE',
    });

    // Business-wide closure
    repo.seedScheduleBlock({
      id: 'holiday-block',
      scope: 'BUSINESS',
      workspaceInstanceId: null,
      blockType: 'CLOSURE',
      startAt: '2026-09-16T00:00:00.000Z',
      endAt: '2026-09-17T00:00:00.000Z',
      reason: 'National Holiday Closure',
    });

    const occupied = await service.listOccupiedInstances({
      nowIso: '2026-09-16T05:00:00.000Z',
      durationMinutes: 120,
    });

    expect(occupied.occupiedInstanceIds).toContain('spot-a');
    expect(occupied.occupiedInstanceIds).toContain('spot-b');
  });
});
