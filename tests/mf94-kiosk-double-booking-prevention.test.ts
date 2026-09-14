import { describe, expect, it } from 'vitest';
import {
  InMemoryAvailabilityRepository,
  createAvailabilityService,
} from '../packages/domain/src';

describe('MF-94: Kiosk Double Booking Prevention', () => {
  it('detects upcoming reservation conflict when duration extends into reserved window', async () => {
    const repo = new InMemoryAvailabilityRepository();
    const service = createAvailabilityService(repo);

    repo.seedWorkspaceInstance({
      id: 'desk-1',
      templateId: 'template-desk',
      displayName: 'Desk 01',
      operationalStatus: 'ACTIVE',
    });

    // Seed an online confirmed reservation for 6:00 PM to 7:00 PM Manila time
    // 6:00 PM Manila is 10:00 AM UTC
    const reservationStartIso = '2026-09-14T10:00:00.000Z'; // 18:00 Manila
    const reservationEndIso = '2026-09-14T11:00:00.000Z';   // 19:00 Manila

    repo.seedBlockingReservation('desk-1', {
      reservationId: 'res-online-6pm',
      reservationStatus: 'CONFIRMED',
      startAt: reservationStartIso,
      endAt: reservationEndIso,
    });

    // Scenario 1: Kiosk user at 5:01 PM Manila (09:01 UTC) selects 1 hour (60 min)
    // 5:01 PM + 60 min = 6:01 PM (10:01 UTC), which overlaps with 18:00-19:00
    const nowAt501Pm = '2026-09-14T09:01:00.000Z';
    const result1Hour = await service.listOccupiedInstances({
      nowIso: nowAt501Pm,
      durationMinutes: 60,
    });

    expect(result1Hour.occupiedInstanceIds).toContain('desk-1');

    // Scenario 2: Default 5-minute instantaneous check (5:01 to 5:06 PM)
    // 5:06 PM does not overlap with 6:00 PM
    const result5Min = await service.listOccupiedInstances({
      nowIso: nowAt501Pm,
    });
    expect(result5Min.occupiedInstanceIds).not.toContain('desk-1');

    // Scenario 3: Kiosk user at 4:30 PM Manila (08:30 UTC) selects 1 hour (ends at 5:30 PM / 09:30 UTC)
    // 4:30 to 5:30 PM does NOT overlap with 6:00 PM
    const nowAt430Pm = '2026-09-14T08:30:00.000Z';
    const result1HourAt430 = await service.listOccupiedInstances({
      nowIso: nowAt430Pm,
      durationMinutes: 60,
    });
    expect(result1HourAt430.occupiedInstanceIds).not.toContain('desk-1');

    // Scenario 4: Kiosk user at 4:30 PM Manila (08:30 UTC) selects 2 hours (ends at 6:30 PM / 10:30 UTC)
    // 4:30 to 6:30 PM DOES overlap with 6:00 PM to 7:00 PM
    const result2HoursAt430 = await service.listOccupiedInstances({
      nowIso: nowAt430Pm,
      durationMinutes: 120,
    });
    expect(result2HoursAt430.occupiedInstanceIds).toContain('desk-1');
  });

  it('evaluates category availability correctly for non-interval walk-in start times', async () => {
    const repo = new InMemoryAvailabilityRepository();
    const service = createAvailabilityService(repo);

    repo.seedWorkspaceInstance({
      id: 'desk-1',
      templateId: 'template-desk',
      displayName: 'Desk 01',
      operationalStatus: 'ACTIVE',
    });

    repo.seedOperatingHours(1, [{ opensAt: '08:00', closesAt: '22:00' }]);

    // Seed confirmed reservation from 18:00 to 19:00 Manila (10:00 to 11:00 UTC)
    repo.seedBlockingReservation('desk-1', {
      reservationId: 'res-online-6pm',
      reservationStatus: 'CONFIRMED',
      startAt: '2026-09-14T10:00:00.000Z',
      endAt: '2026-09-14T11:00:00.000Z',
    });

    // 2026-09-14 is a Monday (dayOfWeek = 1)
    // Walk-in attempt at 17:01 for 60 min (ends at 18:01, conflicting with 18:00)
    const result = await service.listTemplateAvailability({
      templateId: 'template-desk',
      date: '2026-09-14',
      durationMinutes: 60,
      startTime: '17:01',
      nowIso: '2026-09-14T09:01:00.000Z',
    });

    const desk1 = result.allInstances.find((i) => i.workspaceInstanceId === 'desk-1');
    expect(desk1).toBeDefined();
    expect(desk1?.isAvailable).toBe(false);
    expect(desk1?.blockingReason).toBe('RESERVATION_CONFLICT');
  });

  it('detects blocking reservations across the entire candidate duration window', async () => {
    const repo = new InMemoryAvailabilityRepository();

    repo.seedWorkspaceInstance({
      id: 'desk-1',
      templateId: 'template-desk',
      displayName: 'Desk 01',
      operationalStatus: 'ACTIVE',
    });

    repo.seedBlockingReservation('desk-1', {
      reservationId: 'res-online-6pm',
      reservationStatus: 'CONFIRMED',
      startAt: '2026-09-14T10:00:00.000Z',
      endAt: '2026-09-14T11:00:00.000Z',
    });

    // Candidate window: 17:06 to 18:06 Manila time (09:06 to 10:06 UTC)
    const candidateStart = '2026-09-14T09:06:00.000Z';
    const candidateEnd = '2026-09-14T10:06:00.000Z';

    const blocking = await repo.listBlockingReservations('desk-1', candidateStart, candidateEnd);
    expect(blocking).toHaveLength(1);
    expect(blocking[0].reservationId).toBe('res-online-6pm');
  });
});
