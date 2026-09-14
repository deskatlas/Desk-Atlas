import { describe, it, expect } from 'vitest';
import {
  InMemoryAvailabilityRepository,
  createAvailabilityService,
} from '../packages/domain/src';
import { POST as createReservationRoute } from '../apps/customer-website/src/app/api/reservations/route';

describe('MF-102: Customer Online 30-Minute Advance Booking Cutoff & Walk-In Handoff', () => {
  function setupRepo() {
    const repository = new InMemoryAvailabilityRepository();
    repository.setBusinessSettings({
      timezone: 'Asia/Manila',
      bookingIntervalMinutes: 30,
    });
    repository.seedWorkspaceInstance({
      id: 'inst_1',
      templateId: 'tpl_hotdesk',
      floorId: 'floor_1',
      instanceCode: 'D01',
      displayName: 'Desk 01',
      operationalStatus: 'ACTIVE',
    });
    repository.seedWorkspaceInstance({
      id: 'inst_2',
      templateId: 'tpl_hotdesk',
      floorId: 'floor_1',
      instanceCode: 'D02',
      displayName: 'Desk 02',
      operationalStatus: 'ACTIVE',
    });

    // Seed operating hours: 08:00 to 22:00 for all days (day 0 through 6)
    for (let day = 0; day <= 6; day++) {
      repository.seedOperatingHours(day, [
        { opensAt: '08:00:00', closesAt: '22:00:00' },
      ]);
    }

    return repository;
  }

  it('blocks 5:00 PM slot for online booking at 4:31 PM (29 minutes away) with IMMEDIATE_WALK_IN_ONLY', async () => {
    const repository = setupRepo();
    const service = createAvailabilityService(repository);

    // 4:31 PM Manila (UTC+8) is 08:31 UTC
    const nowAt431PmManila = '2026-09-14T08:31:00.000Z';
    const targetDate = '2026-09-14';

    const result = await service.listTimeAvailability({
      workspaceInstanceId: 'inst_1',
      date: targetDate,
      durationMinutes: 60,
      nowIso: nowAt431PmManila,
      channel: 'ONLINE',
    });

    // 4:30 PM slot is in the past
    const slot430 = result.slots.find((s) => s.startTime === '16:30');
    expect(slot430).toBeDefined();
    expect(slot430?.isAvailable).toBe(false);
    expect(slot430?.blockingReason).toBe('PAST_TIME');

    // 5:00 PM slot is 29 minutes away (< 30 min buffer)
    const slot500 = result.slots.find((s) => s.startTime === '17:00');
    expect(slot500).toBeDefined();
    expect(slot500?.isAvailable).toBe(false);
    expect(slot500?.blockingReason).toBe('IMMEDIATE_WALK_IN_ONLY');

    // 5:30 PM slot is 59 minutes away (>= 30 min buffer)
    const slot530 = result.slots.find((s) => s.startTime === '17:30');
    expect(slot530).toBeDefined();
    expect(slot530?.isAvailable).toBe(true);
    expect(slot530?.blockingReason).toBeNull();
  });

  it('allows 5:00 PM slot for Kiosk / walk-in booking at 4:31 PM', async () => {
    const repository = setupRepo();
    const service = createAvailabilityService(repository);

    const nowAt431PmManila = '2026-09-14T08:31:00.000Z';
    const targetDate = '2026-09-14';

    // Kiosk channel has 0 minimum lead time
    const result = await service.listTimeAvailability({
      workspaceInstanceId: 'inst_1',
      date: targetDate,
      durationMinutes: 60,
      nowIso: nowAt431PmManila,
      channel: 'KIOSK',
    });

    const slot500 = result.slots.find((s) => s.startTime === '17:00');
    expect(slot500).toBeDefined();
    expect(slot500?.isAvailable).toBe(true);
    expect(slot500?.blockingReason).toBeNull();
  });

  it('enforces 30-minute lead cutoff in listTemplateAvailability for ONLINE channel', async () => {
    const repository = setupRepo();
    const service = createAvailabilityService(repository);

    const nowAt431PmManila = '2026-09-14T08:31:00.000Z';
    const targetDate = '2026-09-14';

    // Query template availability for 5:00 PM (starts in 29 minutes)
    const templateResult500 = await service.listTemplateAvailability({
      templateId: 'tpl_hotdesk',
      date: targetDate,
      durationMinutes: 60,
      startTime: '17:00',
      nowIso: nowAt431PmManila,
      channel: 'ONLINE',
    });

    expect(templateResult500.availableInstances).toHaveLength(0);
    for (const inst of templateResult500.allInstances) {
      expect(inst.isAvailable).toBe(false);
      expect(inst.blockingReason).toBe('IMMEDIATE_WALK_IN_ONLY');
    }

    // Query template availability for 5:30 PM (starts in 59 minutes)
    const templateResult530 = await service.listTemplateAvailability({
      templateId: 'tpl_hotdesk',
      date: targetDate,
      durationMinutes: 60,
      startTime: '17:30',
      nowIso: nowAt431PmManila,
      channel: 'ONLINE',
    });

    expect(templateResult530.availableInstances.length).toBeGreaterThan(0);
    const inst1 = templateResult530.availableInstances.find((i) => i.workspaceInstanceId === 'inst_1');
    expect(inst1?.isAvailable).toBe(true);
    expect(inst1?.blockingReason).toBeNull();
  });

  it('server-side online reservation endpoint rejects bookings starting within 30 minutes', async () => {
    // 15 minutes in the future from current time
    const startWithin15Mins = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const endWithin15Mins = new Date(Date.now() + 75 * 60 * 1000).toISOString();

    const req = new Request('http://localhost:3000/api/reservations', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        customerFirstName: 'Maria',
        customerLastName: 'Santos',
        customerEmail: 'maria.santos@example.com',
        source: 'WEB',
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: 'inst_1',
            startAt: startWithin15Mins,
            endAt: endWithin15Mins,
          },
        ],
      }),
    });

    const response = await createReservationRoute(req);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error).toBe(
      'Online reservations must be made at least 30 minutes in advance. For immediate bookings, please use the in-house kiosk.'
    );
  });

  it('server-side online reservation endpoint rejects bookings starting in 29 minutes', async () => {
    const startWithin29Mins = new Date(Date.now() + 29 * 60 * 1000).toISOString();
    const endWithin29Mins = new Date(Date.now() + 89 * 60 * 1000).toISOString();

    const req = new Request('http://localhost:3000/api/reservations', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        customerFirstName: 'Juan',
        customerLastName: 'Dela Cruz',
        customerEmail: 'juan@example.com',
        source: 'WEB',
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: 'inst_1',
            startAt: startWithin29Mins,
            endAt: endWithin29Mins,
          },
        ],
      }),
    });

    const response = await createReservationRoute(req);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error).toBe(
      'Online reservations must be made at least 30 minutes in advance. For immediate bookings, please use the in-house kiosk.'
    );
  });

  it('server-side online reservation endpoint rejects bookings with start time in the past', async () => {
    const startInPast = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const endInFuture = new Date(Date.now() + 50 * 60 * 1000).toISOString();

    const req = new Request('http://localhost:3000/api/reservations', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        customerFirstName: 'Juan',
        customerLastName: 'Dela Cruz',
        customerEmail: 'juan@example.com',
        source: 'WEB',
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: 'inst_1',
            startAt: startInPast,
            endAt: endInFuture,
          },
        ],
      }),
    });

    const response = await createReservationRoute(req);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error).toBe(
      'Online reservations must be made at least 30 minutes in advance. For immediate bookings, please use the in-house kiosk.'
    );
  });

  it('marks date as NO_TIME_REMAINING when only immediate walk-in slots remain online', async () => {
    const repository = setupRepo();
    const service = createAvailabilityService(repository);

    // Facility closes at 22:00. At 21:05 (13:05 UTC), latest 60-min start time is 21:00 (which is in the past).
    // Let's test with 30-min duration where latest slot is 21:30.
    // At 21:05 (13:05 UTC):
    // 21:00 is past.
    // 21:30 is 25 minutes away (< 30 min lead time, blocked as IMMEDIATE_WALK_IN_ONLY).
    // Thus all remaining slots on this day are either PAST_TIME or IMMEDIATE_WALK_IN_ONLY.
    const nowAt905PmManila = '2026-09-14T13:05:00.000Z';
    const targetDate = '2026-09-14';

    const dateResult = await service.listDateAvailability({
      workspaceInstanceId: 'inst_1',
      startDate: targetDate,
      endDate: targetDate,
      durationMinutes: 30,
      nowIso: nowAt905PmManila,
      channel: 'ONLINE',
    });

    expect(dateResult.dates).toHaveLength(1);
    expect(dateResult.dates[0].isAvailable).toBe(false);
    expect(dateResult.dates[0].reason).toBe('NO_TIME_REMAINING');
    expect(dateResult.dates[0].firstAvailableTime).toBeNull();
  });
});
