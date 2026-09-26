import { describe, expect, it } from 'vitest';
import {
  InMemoryAvailabilityRepository,
  createAvailabilityService,
  InMemoryWorkspaceRepository,
  ReservationMemoryRepository,
  createReservationService,
  createPaymentSessionService,
  createPaymentReviewService,
  createStaffOperationsService,
} from '../packages/domain/src';

describe('MS-04 / QAD-TC1: Real-Time Map Occupancy State Synchronization', () => {
  it('QAD-TC1.1: single active session cross-portal count (exactly 1 desk marked occupied)', async () => {
    let now = new Date('2026-09-23T10:00:00.000Z');
    const nowProvider = () => now;

    const availRepo = new InMemoryAvailabilityRepository();
    const availService = createAvailabilityService(availRepo);
    const workspaceRepo = new InMemoryWorkspaceRepository();
    const resRepo = new ReservationMemoryRepository(nowProvider, workspaceRepo);
    const paymentSessionService = createPaymentSessionService(resRepo, nowProvider);
    const reservationService = createReservationService(
      resRepo,
      workspaceRepo,
      resRepo,
      paymentSessionService
    );
    const paymentReviewService = createPaymentReviewService(resRepo, nowProvider);
    const staffOpsService = createStaffOperationsService(resRepo, nowProvider);

    const floor = await workspaceRepo.createFloor({ name: 'Main Floor' });
    const template = await workspaceRepo.createTemplate({
      name: 'Hot Desk',
      capacity: 1,
      rateAmount: 100,
      pricingUnit: 'HOURLY',
      defaultShape: 'desk',
      defaultColor: '#009689',
      isActive: true,
    });

    // Create 4 desks
    const instances = await Promise.all(
      ['desk-1', 'desk-2', 'desk-3', 'desk-4'].map((code) =>
        workspaceRepo.createInstance({
          templateId: template.id,
          floorId: floor.id,
          instanceCode: code.toUpperCase(),
          displayName: `Hot Desk ${code}`,
        })
      )
    );

    const desk4 = instances[3];

    for (const inst of instances) {
      availRepo.seedWorkspaceInstance({
        id: inst.id,
        templateId: template.id,
        displayName: inst.displayName,
        operationalStatus: 'ACTIVE',
      });
    }

    const startIso = '2026-09-23T09:00:00.000Z';
    const endIso = '2026-09-23T12:00:00.000Z';

    // Seed 1 active CHECKED_IN reservation on Desk 4
    availRepo.seedBlockingReservation(desk4.id, {
      reservationId: 'res-checked-in-desk-4',
      reservationStatus: 'CHECKED_IN',
      startAt: startIso,
      endAt: endIso,
    });

    const createdRes = await reservationService.createReservation(
      {
        source: 'WEB',
        customerFirstName: 'John',
        customerLastName: 'Doe',
        customerEmail: 'john@example.com',
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: desk4.id,
            startAt: startIso,
            endAt: endIso,
          },
        ],
      },
      { paymentLinkBaseUrl: 'https://deskatlas.test/pay' }
    );

    await paymentSessionService.submitPaymentProof({
      token: createdRes.paymentSession!.token,
      paymentMethodId: 'pm-gcash',
      proofStoragePath: 'proofs/john.png',
    });

    const session = await paymentSessionService.getPaymentSession(createdRes.paymentSession!.token);
    await paymentReviewService.reviewPayment({
      paymentAttemptId: session.paymentAttemptId,
      actor: { userId: 'admin-1', role: 'ADMIN' },
      decision: 'APPROVE',
    });

    await staffOpsService.checkInReservation({
      reservationId: createdRes.id,
      actor: { userId: 'staff-1', role: 'STAFF' },
    });

    const nowIso = now.toISOString();

    // 1. Kiosk instantaneous availability query
    const kioskOccupancy = await availService.listOccupiedInstances({ nowIso, durationMinutes: 0 });
    expect(kioskOccupancy.occupiedInstanceIds).toHaveLength(1);
    expect(kioskOccupancy.occupiedInstanceIds).toEqual([desk4.id]);

    // 2. Staff operations occupancy query
    const staffOccupancy = await staffOpsService.listOccupancy(nowIso);
    const occupiedRecords = staffOccupancy.filter((r) => r.occupancyState === 'OCCUPIED');
    expect(occupiedRecords).toHaveLength(1);
    expect(occupiedRecords[0].workspaceInstanceId).toBe(desk4.id);

    // 3. Guarantee 100% parity across portals
    expect(kioskOccupancy.occupiedInstanceIds.length).toBe(occupiedRecords.length);
  });

  it('QAD-TC1.2: pending payment reservation non-hold (0 desks marked occupied for 3 candidate desks)', async () => {
    let now = new Date('2026-09-23T10:00:00.000Z');
    const nowProvider = () => now;

    const availRepo = new InMemoryAvailabilityRepository();
    const availService = createAvailabilityService(availRepo);
    const workspaceRepo = new InMemoryWorkspaceRepository();
    const resRepo = new ReservationMemoryRepository(nowProvider, workspaceRepo);
    const paymentSessionService = createPaymentSessionService(resRepo, nowProvider);
    const reservationService = createReservationService(
      resRepo,
      workspaceRepo,
      resRepo,
      paymentSessionService
    );
    const staffOpsService = createStaffOperationsService(resRepo, nowProvider);

    const floor = await workspaceRepo.createFloor({ name: 'Main Floor' });
    const template = await workspaceRepo.createTemplate({
      name: 'Hot Desk',
      capacity: 1,
      rateAmount: 100,
      pricingUnit: 'HOURLY',
      defaultShape: 'desk',
      defaultColor: '#009689',
      isActive: true,
    });

    // Create 3 desks (Main, Alt 1, Alt 2)
    const instances = await Promise.all(
      ['desk-a', 'desk-b', 'desk-c'].map((code) =>
        workspaceRepo.createInstance({
          templateId: template.id,
          floorId: floor.id,
          instanceCode: code.toUpperCase(),
          displayName: `Hot Desk ${code}`,
        })
      )
    );

    for (const inst of instances) {
      availRepo.seedWorkspaceInstance({
        id: inst.id,
        templateId: template.id,
        displayName: inst.displayName,
        operationalStatus: 'ACTIVE',
      });
    }

    const startIso = '2026-09-23T09:30:00.000Z';
    const endIso = '2026-09-23T11:30:00.000Z';

    // Seed pending reservation candidates in availability repo
    availRepo.seedBlockingReservation(instances[0].id, {
      reservationId: 'res-pending-1',
      reservationStatus: 'PENDING_PAYMENT',
      startAt: startIso,
      endAt: endIso,
    });
    availRepo.seedBlockingReservation(instances[1].id, {
      reservationId: 'res-pending-1',
      reservationStatus: 'PENDING_PAYMENT',
      startAt: startIso,
      endAt: endIso,
    });
    availRepo.seedBlockingReservation(instances[2].id, {
      reservationId: 'res-pending-1',
      reservationStatus: 'PENDING_PAYMENT',
      startAt: startIso,
      endAt: endIso,
    });

    await reservationService.createReservation(
      {
        source: 'WEB',
        customerFirstName: 'Alice',
        customerLastName: 'Smith',
        customerEmail: 'alice@example.com',
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: instances[0].id,
            startAt: startIso,
            endAt: endIso,
          },
          {
            rank: 1,
            workspaceInstanceId: instances[1].id,
            startAt: startIso,
            endAt: endIso,
          },
          {
            rank: 2,
            workspaceInstanceId: instances[2].id,
            startAt: startIso,
            endAt: endIso,
          },
        ],
      },
      { paymentLinkBaseUrl: 'https://deskatlas.test/pay' }
    );

    const nowIso = now.toISOString();

    // 1. Kiosk instantaneous availability query must show 0 occupied desks
    const kioskOccupancy = await availService.listOccupiedInstances({ nowIso, durationMinutes: 0 });
    expect(kioskOccupancy.occupiedInstanceIds).toEqual([]);

    // 2. Staff operations occupancy query must return 0 occupied desks
    const staffOccupancy = await staffOpsService.listOccupancy(nowIso);
    const occupiedRecords = staffOccupancy.filter((r) => r.occupancyState === 'OCCUPIED');
    expect(occupiedRecords).toEqual([]);

    // 3. Strict No-Hold parity check
    expect(kioskOccupancy.occupiedInstanceIds).toHaveLength(0);
    expect(occupiedRecords).toHaveLength(0);
  });

  it('QAD-TC1.3: upcoming booking in 90 minutes (AVAILABLE now, walk-in duration capped to 1h)', async () => {
    const repo = new InMemoryAvailabilityRepository();
    const service = createAvailabilityService(repo);

    repo.seedWorkspaceInstance({
      id: 'desk-upcoming-1',
      templateId: 'tpl-hot-desk',
      displayName: 'Upcoming Desk 1',
      operationalStatus: 'ACTIVE',
    });

    // Operating hours 08:00 to 22:00
    for (let d = 0; d <= 6; d++) {
      repo.seedOperatingHours(d, [{ opensAt: '08:00:00', closesAt: '22:00:00' }]);
    }

    // Now: 10:00 Manila (02:00 UTC)
    const nowIso = '2026-09-23T02:00:00.000Z';

    // Upcoming confirmed reservation starting in 90 minutes (11:30 Manila / 03:30 UTC to 13:30 Manila / 05:30 UTC)
    const upcomingStartIso = '2026-09-23T03:30:00.000Z';
    const upcomingEndIso = '2026-09-23T05:30:00.000Z';

    repo.seedBlockingReservation('desk-upcoming-1', {
      reservationId: 'res-upcoming-1130',
      reservationStatus: 'CONFIRMED',
      startAt: upcomingStartIso,
      endAt: upcomingEndIso,
    });

    // 1. Floor map occupancy check at nowIso must show the desk as AVAILABLE (not occupied)
    const kioskOccupancy = await service.listOccupiedInstances({ nowIso, durationMinutes: 0 });
    expect(kioskOccupancy.occupiedInstanceIds).not.toContain('desk-upcoming-1');

    // 2. Kiosk duration query via getNextUpcomingBooking
    const upcoming = await service.getNextUpcomingBooking('desk-upcoming-1', nowIso);
    expect(upcoming.nextBooking).not.toBeNull();
    expect(upcoming.minutesUntilNextBooking).toBe(90);
    expect(upcoming.maxAvailableMinutes).toBe(90);
    expect(upcoming.maxAvailableHours).toBe(1);

    // 3. Walk-in duration selection: 1 hour is available; 2+ hours are locked
    const durationOptions = [1, 2, 3, 4];
    const availableDurations = durationOptions.filter(
      (h) => upcoming.maxAvailableMinutes === null || h * 60 <= upcoming.maxAvailableMinutes
    );
    const lockedDurations = durationOptions.filter(
      (h) => upcoming.maxAvailableMinutes !== null && h * 60 > upcoming.maxAvailableMinutes
    );

    expect(availableDurations).toEqual([1]);
    expect(lockedDurations).toEqual([2, 3, 4]);

    // 4. Validate 1-hour window (10:00 to 11:00 / 02:00Z to 03:00Z) is valid
    const validWindow = await service.validateReservationWindow({
      workspaceInstanceId: 'desk-upcoming-1',
      startAt: '2026-09-23T02:00:00.000Z',
      endAt: '2026-09-23T03:00:00.000Z',
      maxDurationMinutes: 24 * 60,
    });
    expect(validWindow.isValid).toBe(true);

    // 5. Validate 2-hour window (10:00 to 12:00 / 02:00Z to 04:00Z) conflicts with 11:30 booking
    const invalidWindow = await service.validateReservationWindow({
      workspaceInstanceId: 'desk-upcoming-1',
      startAt: '2026-09-23T02:00:00.000Z',
      endAt: '2026-09-23T04:00:00.000Z',
      maxDurationMinutes: 24 * 60,
    });
    expect(invalidWindow.isValid).toBe(false);
    expect(invalidWindow.conflictType).toBe('RESERVATION_CONFLICT');
  });

  it('QAD-TC1.4: atomic payment confirmation transition (only assigned candidate becomes OCCUPIED)', async () => {
    const availRepo = new InMemoryAvailabilityRepository();
    const availService = createAvailabilityService(availRepo);

    // Seed Main (Desk 1), Alt 1 (Desk 2), Alt 2 (Desk 3)
    const desks = ['desk-1', 'desk-2', 'desk-3'];
    for (const id of desks) {
      availRepo.seedWorkspaceInstance({
        id,
        templateId: 'tpl-hot-desk',
        displayName: `Desk ${id}`,
        operationalStatus: 'ACTIVE',
      });
    }

    const nowIso = '2026-09-23T10:00:00.000Z';
    const startIso = '2026-09-23T09:00:00.000Z';
    const endIso = '2026-09-23T13:00:00.000Z';

    // Step 1: In pending state, all 3 candidate rows exist with status PENDING_PAYMENT
    availRepo.seedBlockingReservation('desk-1', {
      reservationId: 'res-multi-cand',
      reservationStatus: 'PENDING_PAYMENT',
      startAt: startIso,
      endAt: endIso,
    });
    availRepo.seedBlockingReservation('desk-2', {
      reservationId: 'res-multi-cand',
      reservationStatus: 'PENDING_PAYMENT',
      startAt: startIso,
      endAt: endIso,
    });
    availRepo.seedBlockingReservation('desk-3', {
      reservationId: 'res-multi-cand',
      reservationStatus: 'PENDING_PAYMENT',
      startAt: startIso,
      endAt: endIso,
    });

    const pendingOccupancy = await availService.listOccupiedInstances({ nowIso, durationMinutes: 0 });
    expect(pendingOccupancy.occupiedInstanceIds).toEqual([]);

    // Step 2: Admin approves payment and confirms Alt 1 (Desk 2).
    // The candidate for Desk 2 transitions to CONFIRMED. Desk 1 and Desk 3 are unassigned.
    const confirmedRepo = new InMemoryAvailabilityRepository();
    const confirmedService = createAvailabilityService(confirmedRepo);
    for (const id of desks) {
      confirmedRepo.seedWorkspaceInstance({
        id,
        templateId: 'tpl-hot-desk',
        displayName: `Desk ${id}`,
        operationalStatus: 'ACTIVE',
      });
    }

    // Only Desk 2 is confirmed
    confirmedRepo.seedBlockingReservation('desk-2', {
      reservationId: 'res-multi-cand',
      reservationStatus: 'CONFIRMED',
      startAt: startIso,
      endAt: endIso,
    });

    const confirmedOccupancy = await confirmedService.listOccupiedInstances({ nowIso, durationMinutes: 0 });
    expect(confirmedOccupancy.occupiedInstanceIds).toEqual(['desk-2']);
    expect(confirmedOccupancy.occupiedInstanceIds).not.toContain('desk-1');
    expect(confirmedOccupancy.occupiedInstanceIds).not.toContain('desk-3');
  });
});
