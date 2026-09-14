import { describe, expect, it } from 'vitest';
import {
  InMemoryAvailabilityRepository,
  createAvailabilityService,
} from '../packages/domain/src';

describe('MF-97: Kiosk Duration Lock & Double Booking Prevention (9pm-11pm online booking vs 6pm 4h kiosk)', () => {
  it('detects online 9pm-11pm reservation conflict when kiosk walk-in requests 4 hours at 6pm', async () => {
    const repo = new InMemoryAvailabilityRepository();
    const service = createAvailabilityService(repo);

    repo.seedWorkspaceInstance({
      id: 'spot-1',
      templateId: 'tpl-dedicated',
      displayName: 'Desk 01',
      operationalStatus: 'ACTIVE',
    });

    repo.seedOperatingHours(1, [{ opensAt: '06:00', closesAt: '24:00' }]);

    // Online confirmed reservation from 9:00 PM to 11:00 PM Manila time
    // Manila is UTC+8.
    // 2026-09-14:
    // 6:00 PM Manila (18:00) = 10:00 UTC
    // 9:00 PM Manila (21:00) = 13:00 UTC
    // 11:00 PM Manila (23:00) = 15:00 UTC
    // 10:00 PM Manila (22:00, 6pm + 4h) = 14:00 UTC
    const reservationStartIso = '2026-09-14T13:00:00.000Z'; // 21:00 Manila (9:00 PM)
    const reservationEndIso = '2026-09-14T15:00:00.000Z';   // 23:00 Manila (11:00 PM)

    repo.seedBlockingReservation('spot-1', {
      reservationId: 'res-online-9pm',
      reservationStatus: 'CONFIRMED',
      startAt: reservationStartIso,
      endAt: reservationEndIso,
    });

    const nowAt600Pm = '2026-09-14T10:00:00.000Z'; // 18:00 Manila (6:00 PM)

    // 1. Check getNextUpcomingBooking
    const upcoming = await service.getNextUpcomingBooking('spot-1', nowAt600Pm);

    expect(upcoming.nextBooking).not.toBeNull();
    expect(upcoming.nextBooking?.startAt).toBe(reservationStartIso);
    expect(upcoming.nextBooking?.startTimeFormatted).toContain('9:00');
    expect(upcoming.nextBooking?.startTimeFormatted).toContain('PM');
    // From 6:00 PM to 9:00 PM is exactly 180 minutes (3 hours)
    expect(upcoming.minutesUntilNextBooking).toBe(180);
    expect(upcoming.maxAvailableHours).toBe(3);
    expect(upcoming.maxAvailableMinutes).toBe(180);

    // Verify which durations are locked vs available:
    const durations = [1, 2, 3, 4, 5, 6, 7, 8];
    const lockedDurations = durations.filter(
      (h) => upcoming.maxAvailableMinutes !== null && h * 60 > upcoming.maxAvailableMinutes
    );
    const availableDurations = durations.filter(
      (h) => upcoming.maxAvailableMinutes === null || h * 60 <= upcoming.maxAvailableMinutes
    );

    // 1h (6pm-7pm), 2h (6pm-8pm), 3h (6pm-9pm) are available
    expect(availableDurations).toEqual([1, 2, 3]);
    // 4h (6pm-10pm), 5h (6pm-11pm), 6h, 7h, 8h are LOCKED
    expect(lockedDurations).toEqual([4, 5, 6, 7, 8]);

    // 2. Real-time occupied instances check
    // At 6:00 PM with 1 hour duration (6pm-7pm): NOT occupied
    const occupied1h = await service.listOccupiedInstances({
      nowIso: nowAt600Pm,
      durationMinutes: 60,
    });
    expect(occupied1h.occupiedInstanceIds).not.toContain('spot-1');

    // At 6:00 PM with 2 hours duration (6pm-8pm): NOT occupied
    const occupied2h = await service.listOccupiedInstances({
      nowIso: nowAt600Pm,
      durationMinutes: 120,
    });
    expect(occupied2h.occupiedInstanceIds).not.toContain('spot-1');

    // At 6:00 PM with 3 hours duration (6pm-9pm): NOT occupied (ends right when booking starts)
    const occupied3h = await service.listOccupiedInstances({
      nowIso: nowAt600Pm,
      durationMinutes: 180,
    });
    expect(occupied3h.occupiedInstanceIds).not.toContain('spot-1');

    // At 6:00 PM with 4 hours duration (6pm-10pm): OCCUPIED!
    const occupied4h = await service.listOccupiedInstances({
      nowIso: nowAt600Pm,
      durationMinutes: 240,
    });
    expect(occupied4h.occupiedInstanceIds).toContain('spot-1');

    // 3. Candidate Collision Check (Server-side gate)
    // Kiosk candidate: 6:00 PM to 10:00 PM (10:00 to 14:00 UTC)
    const kioskCandidateStart = '2026-09-14T10:00:00.000Z';
    const kioskCandidateEnd = '2026-09-14T14:00:00.000Z';

    const blocking = await repo.listBlockingReservations(
      'spot-1',
      kioskCandidateStart,
      kioskCandidateEnd
    );

    expect(blocking).toHaveLength(1);
    expect(blocking[0].reservationId).toBe('res-online-9pm');
  });

  it('handles venue operating hours closing time when earlier than next reservation', async () => {
    const repo = new InMemoryAvailabilityRepository();
    const service = createAvailabilityService(repo);

    repo.seedWorkspaceInstance({
      id: 'spot-2',
      templateId: 'tpl-dedicated',
      displayName: 'Desk 02',
      operationalStatus: 'ACTIVE',
    });

    // Space closes at 20:00 (8:00 PM)
    repo.seedOperatingHours(1, [{ opensAt: '08:00', closesAt: '20:00' }]);

    // Next booking is at 22:00 (10:00 PM, outside operating hours anyway)
    repo.seedBlockingReservation('spot-2', {
      reservationId: 'res-online-10pm',
      reservationStatus: 'CONFIRMED',
      startAt: '2026-09-14T14:00:00.000Z', // 22:00 Manila
      endAt: '2026-09-14T15:00:00.000Z',
    });

    // At 6:00 PM (18:00 Manila / 10:00 UTC):
    // Venue closes in 2 hours (at 8:00 PM)
    const nowAt600Pm = '2026-09-14T10:00:00.000Z';
    const upcoming = await service.getNextUpcomingBooking('spot-2', nowAt600Pm);

    expect(upcoming.minutesUntilClosing).toBe(120);
    expect(upcoming.maxAvailableHours).toBe(2);
    expect(upcoming.maxAvailableMinutes).toBe(120);

    // 1h and 2h are available; 3, 4, 5, 6, 7, 8h are locked due to closing
    const durations = [1, 2, 3, 4, 5, 6, 7, 8];
    const locked = durations.filter((h) => h * 60 > upcoming.maxAvailableMinutes!);
    expect(locked).toEqual([3, 4, 5, 6, 7, 8]);
  });
});
