import { describe, expect, it } from 'vitest';
import {
  InMemoryAvailabilityRepository,
  createAvailabilityService,
  validateCandidates,
  ReservationMemoryRepository,
  type CandidateSubmissionDTO,
  type CandidateValidationContext,
  type WorkspaceInstance,
  type WorkspaceTemplate,
} from '../packages/domain/src';

describe('MS-01 / QAD-TC18: Kiosk Multi-Day and Overnight Reservation Support', () => {
  it('QAD-TC18.1: calculates 24/7 operating hours overnight availability at 23:00 (2h, 4h, 8h, 12h available)', async () => {
    const repo = new InMemoryAvailabilityRepository();
    const service = createAvailabilityService(repo);

    repo.seedWorkspaceInstance({
      id: 'spot-overnight-1',
      templateId: 'tpl-standard',
      displayName: 'Overnight Desk 1',
      operationalStatus: 'ACTIVE',
    });

    // Seed 24/7 operating hours across all days (0 to 6)
    for (let day = 0; day <= 6; day++) {
      repo.seedOperatingHours(day, [{ opensAt: '00:00:00', closesAt: '24:00:00' }]);
    }

    // Current time: 11:00 PM (23:00) Manila time (UTC+8) on Monday 2026-09-14
    // 23:00 Manila = 15:00 UTC
    const nowIso = '2026-09-14T15:00:00.000Z';

    const upcoming = await service.getNextUpcomingBooking('spot-overnight-1', nowIso);

    expect(upcoming.nextBooking).toBeNull();
    expect(upcoming.minutesUntilClosing).toBeGreaterThanOrEqual(1440);
    expect(upcoming.maxAvailableMinutes).toBe(1440);
    expect(upcoming.maxAvailableHours).toBe(24);

    // Verify duration availability for standard kiosk duration options
    const durationOptions = [1, 2, 3, 4, 6, 8, 12, 24];
    const availableDurations = durationOptions.filter(
      (hours) => upcoming.maxAvailableMinutes === null || hours * 60 <= upcoming.maxAvailableMinutes
    );
    const lockedDurations = durationOptions.filter(
      (hours) => upcoming.maxAvailableMinutes !== null && hours * 60 > upcoming.maxAvailableMinutes
    );

    expect(availableDurations).toEqual([1, 2, 3, 4, 6, 8, 12, 24]);
    expect(lockedDurations).toEqual([]);

    // Validate 4-hour reservation window: 11:00 PM to 03:00 AM next day (15:00Z to 19:00Z)
    const windowValidation = await service.validateReservationWindow({
      workspaceInstanceId: 'spot-overnight-1',
      startAt: '2026-09-14T15:00:00.000Z',
      endAt: '2026-09-14T19:00:00.000Z',
      maxDurationMinutes: 24 * 60,
    });

    expect(windowValidation.isValid).toBe(true);
  });

  it('QAD-TC18.2: restricts overnight stays when next day has no operating hours (locked with BUSINESS_CLOSED)', async () => {
    const repo = new InMemoryAvailabilityRepository();
    const service = createAvailabilityService(repo);

    repo.seedWorkspaceInstance({
      id: 'spot-overnight-2',
      templateId: 'tpl-standard',
      displayName: 'Overnight Desk 2',
      operationalStatus: 'ACTIVE',
    });

    // Monday (day 1) open 00:00 to 24:00; Tuesday (day 2) closed (no intervals)
    repo.seedOperatingHours(1, [{ opensAt: '00:00:00', closesAt: '24:00:00' }]);

    // Monday 11:00 PM Manila time (15:00 UTC)
    const nowIso = '2026-09-14T15:00:00.000Z';

    const upcoming = await service.getNextUpcomingBooking('spot-overnight-2', nowIso);

    // Facility closes at midnight (60 minutes remaining today)
    expect(upcoming.minutesUntilClosing).toBe(60);
    expect(upcoming.maxAvailableMinutes).toBe(60);
    expect(upcoming.maxAvailableHours).toBe(1);

    const durationOptions = [1, 2, 4, 8, 12, 24];
    const availableDurations = durationOptions.filter(
      (hours) => upcoming.maxAvailableMinutes === null || hours * 60 <= upcoming.maxAvailableMinutes
    );
    const lockedDurations = durationOptions.filter(
      (hours) => upcoming.maxAvailableMinutes !== null && hours * 60 > upcoming.maxAvailableMinutes
    );

    // Only 1 hour is available; all multi-hour durations crossing midnight are locked
    expect(availableDurations).toEqual([1]);
    expect(lockedDurations).toEqual([2, 4, 8, 12, 24]);

    // Validation for 2-hour reservation extending past midnight must fail
    const windowValidation = await service.validateReservationWindow({
      workspaceInstanceId: 'spot-overnight-2',
      startAt: '2026-09-14T15:00:00.000Z',
      endAt: '2026-09-14T17:00:00.000Z',
      maxDurationMinutes: 24 * 60,
    });

    expect(windowValidation.isValid).toBe(false);
    expect(windowValidation.conflictType).toBe('BUSINESS_CLOSED');
  });

  it('QAD-TC18.3: clamps max available duration when next-day morning booking conflict exists at 02:00 AM', async () => {
    const repo = new InMemoryAvailabilityRepository();
    const service = createAvailabilityService(repo);

    repo.seedWorkspaceInstance({
      id: 'spot-overnight-3',
      templateId: 'tpl-standard',
      displayName: 'Overnight Desk 3',
      operationalStatus: 'ACTIVE',
    });

    // 24/7 operating hours
    for (let day = 0; day <= 6; day++) {
      repo.seedOperatingHours(day, [{ opensAt: '00:00:00', closesAt: '24:00:00' }]);
    }

    // Confirmed booking tomorrow at 02:00 AM to 05:00 AM Manila time
    // Tuesday 02:00 AM Manila = Monday 18:00 UTC
    // Tuesday 05:00 AM Manila = Monday 21:00 UTC
    repo.seedBlockingReservation('spot-overnight-3', {
      reservationId: 'res-tuesday-2am',
      reservationStatus: 'CONFIRMED',
      startAt: '2026-09-14T18:00:00.000Z',
      endAt: '2026-09-14T21:00:00.000Z',
    });

    // Walk-in approaches at 11:00 PM Manila time (15:00 UTC)
    const nowIso = '2026-09-14T15:00:00.000Z';

    const upcoming = await service.getNextUpcomingBooking('spot-overnight-3', nowIso);

    expect(upcoming.nextBooking).not.toBeNull();
    expect(upcoming.nextBooking?.startAt).toBe('2026-09-14T18:00:00.000Z');
    expect(upcoming.nextBooking?.startTimeFormatted).toContain('2:00');
    expect(upcoming.nextBooking?.startTimeFormatted).toContain('AM');

    // From 23:00 to 02:00 next day is exactly 3 hours (180 minutes)
    expect(upcoming.minutesUntilNextBooking).toBe(180);
    expect(upcoming.maxAvailableMinutes).toBe(180);
    expect(upcoming.maxAvailableHours).toBe(3);

    const durationOptions = [1, 2, 3, 4, 6, 8];
    const availableDurations = durationOptions.filter(
      (hours) => upcoming.maxAvailableMinutes === null || hours * 60 <= upcoming.maxAvailableMinutes
    );
    const lockedDurations = durationOptions.filter(
      (hours) => upcoming.maxAvailableMinutes !== null && hours * 60 > upcoming.maxAvailableMinutes
    );

    expect(availableDurations).toEqual([1, 2, 3]);
    expect(lockedDurations).toEqual([4, 6, 8]);

    // Validation for 4-hour window (23:00 to 03:00) must return RESERVATION_CONFLICT
    const conflictValidation = await service.validateReservationWindow({
      workspaceInstanceId: 'spot-overnight-3',
      startAt: '2026-09-14T15:00:00.000Z',
      endAt: '2026-09-14T19:00:00.000Z',
      maxDurationMinutes: 24 * 60,
    });

    expect(conflictValidation.isValid).toBe(false);
    expect(conflictValidation.conflictType).toBe('RESERVATION_CONFLICT');
  });

  it('QAD-TC18.4: validates candidate timestamps and chronological validity across midnight (endAt = startAt + duration)', async () => {
    const template: WorkspaceTemplate = {
      id: 'tpl-overnight-pod',
      name: 'Night Owl Pod',
      description: 'Dedicated overnight pod',
      photoPath: null,
      capacity: 1,
      rateAmount: 120,
      pricingUnit: 'HOURLY',
      defaultShape: 'rectangle',
      defaultColor: '#12251A',
      defaultStyle: {},
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const instance: WorkspaceInstance = {
      id: 'inst-overnight-4',
      templateId: 'tpl-overnight-pod',
      floorId: 'floor-1',
      instanceCode: 'NOP-04',
      displayName: 'Night Owl 04',
      operationalStatus: 'ACTIVE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const context: CandidateValidationContext = {
      instances: [instance],
      templates: [template],
    };

    // Candidate starting 11:00 PM Manila on 2026-09-14 (15:00 UTC) for 8 hours (until 07:00 AM Manila / 23:00 UTC)
    const startIso = '2026-09-14T15:00:00.000Z';
    const durationHours = 8;
    const durationMs = durationHours * 3600 * 1000;
    const endIso = new Date(new Date(startIso).getTime() + durationMs).toISOString();

    expect(endIso).toBe('2026-09-14T23:00:00.000Z');

    const candidates: CandidateSubmissionDTO[] = [
      {
        rank: 0,
        workspaceInstanceId: instance.id,
        startAt: startIso,
        endAt: endIso,
      },
    ];

    // validateCandidates must succeed without throwing
    validateCandidates(candidates, context);

    // Repository persists reservation with valid candidate timestamps
    const memoryRepo = new ReservationMemoryRepository();
    const reservation = await memoryRepo.createReservation(
      {
        source: 'KIOSK',
        customerFirstName: 'Reynard',
        customerLastName: 'Rabanal',
        customerEmail: 'reynard@deskatlas.com',
        candidates,
      },
      120,
      960
    );

    expect(reservation.id).toBeDefined();
    expect(reservation.status).toBe('PENDING_COUNTER_CONFIRMATION');
    expect(reservation.candidates).toHaveLength(1);

    const cand = reservation.candidates[0];
    expect(cand.startAt).toBe(startIso);
    expect(cand.endAt).toBe(endIso);
    expect(new Date(cand.startAt).getTime()).toBeLessThan(new Date(cand.endAt).getTime());
    expect(new Date(cand.endAt).getTime() - new Date(cand.startAt).getTime()).toBe(durationMs);
  });
});
