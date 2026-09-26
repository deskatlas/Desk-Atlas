import { describe, expect, it } from 'vitest';
import {
  InMemoryAvailabilityRepository,
  createAvailabilityService,
} from '../packages/domain/src';

describe('MF-100: Kiosk Double Booking Prevention for Overlapping Online Reservations', () => {
  it('detects upcoming 6:00 PM online reservation when kiosk user is at 5:01 PM (54 mins away, 0 hours available)', async () => {
    const repo = new InMemoryAvailabilityRepository();
    const service = createAvailabilityService(repo);

    repo.seedWorkspaceInstance({
      id: 'desk-1',
      templateId: 'tpl-dedicated',
      displayName: 'Desk 01',
      operationalStatus: 'ACTIVE',
    });

    repo.seedOperatingHours(1, [{ opensAt: '08:00', closesAt: '22:00' }]);

    // Online booking at 6:00 PM to 7:00 PM Manila time
    // Manila is UTC+8: 6:00 PM Manila (18:00) = 10:00 UTC
    const onlineStartIso = '2026-09-14T10:00:00.000Z'; // 18:00 Manila
    const onlineEndIso = '2026-09-14T11:00:00.000Z';   // 19:00 Manila

    repo.seedBlockingReservation('desk-1', {
      reservationId: 'res-online-6pm',
      reservationStatus: 'PENDING_PAYMENT',
      startAt: onlineStartIso,
      endAt: onlineEndIso,
    });

    // Current time: 5:01 PM Manila (09:01 UTC)
    // With 5-minute leeway: 5:06 PM Manila (09:06 UTC)
    const nowWithLeewayIso = '2026-09-14T09:06:00.000Z';

    const upcoming = await service.getNextUpcomingBooking('desk-1', nowWithLeewayIso);

    expect(upcoming.nextBooking).not.toBeNull();
    expect(upcoming.nextBooking?.startAt).toBe(onlineStartIso);
    expect(upcoming.nextBooking?.startTimeFormatted).toContain('6:00');
    expect(upcoming.nextBooking?.startTimeFormatted).toContain('PM');

    // 5:06 PM to 6:00 PM is exactly 54 minutes
    expect(upcoming.minutesUntilNextBooking).toBe(54);
    expect(upcoming.maxAvailableMinutes).toBe(54);
    // Math.floor(54 / 60) === 0 -> 0 hours available!
    expect(upcoming.maxAvailableHours).toBe(0);

    // All standard 1-8 hour durations MUST be locked
    const durations = [1, 2, 3, 4, 5, 6, 7, 8];
    const lockedDurations = durations.filter(
      (h) => upcoming.maxAvailableMinutes !== null && (h * 60 > upcoming.maxAvailableMinutes || upcoming.maxAvailableMinutes < 60)
    );
    expect(lockedDurations).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('detects overlap for 1-hour walk-in at 5:01 PM (ends 6:06 PM) against 6:00 PM online reservation', async () => {
    const repo = new InMemoryAvailabilityRepository();
    const service = createAvailabilityService(repo);

    repo.seedWorkspaceInstance({
      id: 'desk-1',
      templateId: 'tpl-dedicated',
      displayName: 'Desk 01',
      operationalStatus: 'ACTIVE',
    });

    repo.seedOperatingHours(1, [{ opensAt: '08:00', closesAt: '22:00' }]);

    // Online booking at 6:00 PM (10:00 UTC) with CONFIRMED status
    repo.seedBlockingReservation('desk-1', {
      reservationId: 'res-online-6pm',
      reservationStatus: 'CONFIRMED',
      startAt: '2026-09-14T10:00:00.000Z',
      endAt: '2026-09-14T11:00:00.000Z',
    });

    // 5:01 PM with 5 min leeway = 5:06 PM (09:06 UTC)
    // 1 hour (60 min) walk-in extends to 6:06 PM (10:06 UTC)
    const nowWithLeewayIso = '2026-09-14T09:06:00.000Z';
    const occupied = await service.listOccupiedInstances({
      nowIso: nowWithLeewayIso,
      durationMinutes: 60,
    });

    // Must be marked OCCUPIED because 5:06-6:06 PM overlaps with 6:00-7:00 PM!
    expect(occupied.occupiedInstanceIds).toContain('desk-1');
  });

  it('marks desk unavailable in listTemplateAvailability when walk-in window overlaps with 6:00 PM reservation', async () => {
    const repo = new InMemoryAvailabilityRepository();
    const service = createAvailabilityService(repo);

    repo.seedWorkspaceInstance({
      id: 'desk-1',
      templateId: 'tpl-dedicated',
      displayName: 'Desk 01',
      operationalStatus: 'ACTIVE',
    });

    repo.seedOperatingHours(1, [{ opensAt: '08:00', closesAt: '22:00' }]);

    repo.seedBlockingReservation('desk-1', {
      reservationId: 'res-online-6pm',
      reservationStatus: 'PENDING_PAYMENT',
      startAt: '2026-09-14T10:00:00.000Z', // 18:00 Manila
      endAt: '2026-09-14T11:00:00.000Z',   // 19:00 Manila
    });

    // Template availability query for walk-in starting at 17:06 for 60 min (ends 18:06)
    const result = await service.listTemplateAvailability({
      templateId: 'tpl-dedicated',
      date: '2026-09-14',
      durationMinutes: 60,
      startTime: '17:06',
      nowIso: '2026-09-14T09:06:00.000Z',
    });

    const desk1 = result.allInstances.find((i) => i.workspaceInstanceId === 'desk-1');
    expect(desk1).toBeDefined();
    expect(desk1?.isAvailable).toBe(false);
    expect(desk1?.blockingReason).toBe('RESERVATION_CONFLICT');
  });

  it('permits walk-in booking when duration ends strictly before the 6:00 PM online reservation', async () => {
    const repo = new InMemoryAvailabilityRepository();
    const service = createAvailabilityService(repo);

    repo.seedWorkspaceInstance({
      id: 'desk-1',
      templateId: 'tpl-dedicated',
      displayName: 'Desk 01',
      operationalStatus: 'ACTIVE',
    });

    repo.seedOperatingHours(1, [{ opensAt: '08:00', closesAt: '22:00' }]);

    repo.seedBlockingReservation('desk-1', {
      reservationId: 'res-online-6pm',
      reservationStatus: 'CONFIRMED',
      startAt: '2026-09-14T10:00:00.000Z', // 18:00 Manila
      endAt: '2026-09-14T11:00:00.000Z',   // 19:00 Manila
    });

    // Walk-in at 4:30 PM (ends 5:30 PM with 60 min duration)
    // 4:30 PM Manila = 08:30 UTC. Ends at 09:30 UTC, well before 10:00 UTC (6:00 PM)
    const nowAt430Pm = '2026-09-14T08:30:00.000Z';
    const occupied = await service.listOccupiedInstances({
      nowIso: nowAt430Pm,
      durationMinutes: 60,
    });

    expect(occupied.occupiedInstanceIds).not.toContain('desk-1');
  });

  it('rejects candidate interval overlap with existing reservation in listBlockingReservations', async () => {
    const repo = new InMemoryAvailabilityRepository();

    repo.seedWorkspaceInstance({
      id: 'desk-1',
      templateId: 'tpl-dedicated',
      displayName: 'Desk 01',
      operationalStatus: 'ACTIVE',
    });

    repo.seedBlockingReservation('desk-1', {
      reservationId: 'res-online-6pm',
      reservationStatus: 'PENDING_PAYMENT',
      startAt: '2026-09-14T10:00:00.000Z', // 18:00 Manila
      endAt: '2026-09-14T11:00:00.000Z',   // 19:00 Manila
    });

    // Kiosk candidate: 5:06 PM to 6:06 PM Manila (09:06 to 10:06 UTC)
    const kioskCandidateStart = '2026-09-14T09:06:00.000Z';
    const kioskCandidateEnd = '2026-09-14T10:06:00.000Z';

    const blocking = await repo.listBlockingReservations(
      'desk-1',
      kioskCandidateStart,
      kioskCandidateEnd
    );

    expect(blocking).toHaveLength(1);
    expect(blocking[0].reservationId).toBe('res-online-6pm');
    expect(blocking[0].reservationStatus).toBe('PENDING_PAYMENT');
  });
});
