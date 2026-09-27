import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'vitest';
import {
  InMemorySettingsRepository,
  createAdminSettingsService,
  SettingsValidationError,
  getNearCheckoutThresholdMinutes,
  isNearCheckout,
  evaluateApproachingBookingEnds,
  getNearCheckoutReservations,
  makeEndAlertDismissKey,
  type BusinessSettings,
  type OperationalReservation,
  type StaffOperationsRepository,
} from '@deskatlas/domain';

// Mock in-memory StaffOperationsRepository for testing
class MockStaffOperationsRepository implements StaffOperationsRepository {
  private reservations: OperationalReservation[] = [];

  constructor(initial: OperationalReservation[] = []) {
    this.reservations = [...initial];
  }

  setReservations(reservations: OperationalReservation[]) {
    this.reservations = [...reservations];
  }

  async listOperationalReservations(_nowIso: string): Promise<any[]> {
    return this.reservations.filter(
      (r) => r.status === 'CHECKED_IN' || r.status === 'ACTIVE'
    );
  }

  async listActiveCheckedInReservations(): Promise<OperationalReservation[]> {
    return this.reservations.filter(
      (r) => r.status === 'CHECKED_IN' || r.status === 'ACTIVE'
    );
  }

  async listTodayReservations(): Promise<OperationalReservation[]> {
    return this.reservations;
  }

  async findReservationById(id: string): Promise<OperationalReservation | null> {
    return this.reservations.find((r) => r.id === id) || null;
  }

  async checkInReservation(id: string): Promise<OperationalReservation> {
    const res = await this.findReservationById(id);
    if (!res) throw new Error('Not found');
    res.status = 'CHECKED_IN';
    return res;
  }

  async checkOutReservation(id: string): Promise<OperationalReservation> {
    const res = await this.findReservationById(id);
    if (!res) throw new Error('Not found');
    res.status = 'CHECKED_OUT';
    return res;
  }

  async extendReservation(id: string, additionalMinutes: number): Promise<OperationalReservation> {
    const res = await this.findReservationById(id);
    if (!res) throw new Error('Not found');
    const end = new Date(res.endAt);
    end.setMinutes(end.getMinutes() + additionalMinutes);
    res.endAt = end.toISOString();
    return res;
  }
}

function createSampleReservation(overrides: Partial<OperationalReservation> = {}): OperationalReservation {
  return {
    id: 'res-test-01',
    bookingReference: 'REF-001',
    workspaceId: 'ws-01',
    workspaceName: 'Desk 01',
    spotCode: 'FL1-01',
    customerName: 'Juan Dela Cruz',
    customerEmail: 'juan@example.com',
    customerPhone: '09171234567',
    startAt: '2026-09-26T09:00:00.000Z',
    endAt: '2026-09-26T12:00:00.000Z',
    status: 'CHECKED_IN',
    paymentStatus: 'PAID',
    paymentMethod: 'GCASH',
    amountPaid: 250,
    checkInTime: '2026-09-26T09:05:00.000Z',
    checkOutTime: null,
    createdAt: '2026-09-26T08:30:00.000Z',
    updatedAt: '2026-09-26T09:05:00.000Z',
    ...overrides,
  };
}

describe('MS-13: Active Reservation Near-Checkout Proximity Monitoring and Triage', () => {
  let settingsRepo: InMemorySettingsRepository;
  let settingsService: ReturnType<typeof createAdminSettingsService>;

  beforeEach(() => {
    settingsRepo = new InMemorySettingsRepository();
    settingsService = createAdminSettingsService(settingsRepo);
  });

  describe('QAD-TC13.1: Business Settings Persistence and Threshold Validation', () => {
    const baseSettingsInput = {
      businessName: 'DeskAtlas Manila',
      timezone: 'Asia/Manila',
      bookingIntervalMinutes: 30,
      paymentExpiryMinutes: 60,
    };

    it('returns default near_checkout_threshold_minutes of 15 when unconfigured', async () => {
      const overview = await settingsService.getSettingsOverview();
      assert.equal(overview.businessSettings.nearCheckoutThresholdMinutes, 15);

      const helperThreshold = getNearCheckoutThresholdMinutes(overview.businessSettings);
      assert.equal(helperThreshold, 15);
    });

    it('successfully updates near_checkout_threshold_minutes within valid range (5 to 60 minutes)', async () => {
      // Update to 20 minutes
      const updated20 = await settingsService.updateBusinessSettings({
        ...baseSettingsInput,
        nearCheckoutThresholdMinutes: 20,
      });
      assert.equal(updated20.nearCheckoutThresholdMinutes, 20);

      // Verify persistence via getSettingsOverview
      const overview20 = await settingsService.getSettingsOverview();
      assert.equal(overview20.businessSettings.nearCheckoutThresholdMinutes, 20);

      // Update to lower bound (5 minutes)
      const updated5 = await settingsService.updateBusinessSettings({
        ...baseSettingsInput,
        nearCheckoutThresholdMinutes: 5,
      });
      assert.equal(updated5.nearCheckoutThresholdMinutes, 5);

      // Update to upper bound (60 minutes)
      const updated60 = await settingsService.updateBusinessSettings({
        ...baseSettingsInput,
        nearCheckoutThresholdMinutes: 60,
      });
      assert.equal(updated60.nearCheckoutThresholdMinutes, 60);
    });

    it('rejects invalid near_checkout_threshold_minutes values (< 5, > 60, or non-integer)', async () => {
      // Reject below 5
      await assert.rejects(
        () =>
          settingsService.updateBusinessSettings({
            ...baseSettingsInput,
            nearCheckoutThresholdMinutes: 4,
          }),
        (err: Error) => {
          assert.ok(err instanceof SettingsValidationError);
          assert.match(err.message, /between 5 and 60 minutes/i);
          return true;
        }
      );

      // Reject above 60
      await assert.rejects(
        () =>
          settingsService.updateBusinessSettings({
            ...baseSettingsInput,
            nearCheckoutThresholdMinutes: 61,
          }),
        (err: Error) => {
          assert.ok(err instanceof SettingsValidationError);
          assert.match(err.message, /between 5 and 60 minutes/i);
          return true;
        }
      );

      // Reject non-integer
      await assert.rejects(
        () =>
          settingsService.updateBusinessSettings({
            ...baseSettingsInput,
            nearCheckoutThresholdMinutes: 15.5,
          }),
        (err: Error) => {
          assert.ok(err instanceof SettingsValidationError);
          assert.match(err.message, /between 5 and 60 minutes/i);
          return true;
        }
      );
    });
  });

  describe('QAD-TC13.2: Boundary Math and Active-State Proximity Filtering', () => {
    it('correctly classifies a reservation as near-checkout when 0 < remaining <= threshold', () => {
      const now = new Date('2026-09-26T11:48:00.000Z'); // 12 minutes before 12:00
      const endAt = '2026-09-26T12:00:00.000Z';

      // 12 mins remaining with 15 min threshold -> true
      assert.equal(isNearCheckout(endAt, 15, now), true);

      // 12 mins remaining with 10 min threshold -> false
      assert.equal(isNearCheckout(endAt, 10, now), false);

      // Exact boundary: 15 mins remaining with 15 min threshold -> true
      const now15 = new Date('2026-09-26T11:45:00.000Z');
      assert.equal(isNearCheckout(endAt, 15, now15), true);

      // Exact boundary: 1 sec inside threshold -> true
      const now1SecInside = new Date('2026-09-26T11:59:59.000Z');
      assert.equal(isNearCheckout(endAt, 15, now1SecInside), true);
    });

    it('evaluates approaching booking ends and sorts by soonest checkout', () => {
      const now = new Date('2026-09-26T11:45:00.000Z');
      const bookings: OperationalReservation[] = [
        createSampleReservation({
          id: 'res-01',
          spotCode: 'FL1-01',
          customerName: 'Maria Santos',
          endAt: '2026-09-26T11:58:00.000Z', // 13 mins left
          status: 'CHECKED_IN',
        }),
        createSampleReservation({
          id: 'res-02',
          spotCode: 'FL1-02',
          customerName: 'Juan Dela Cruz',
          endAt: '2026-09-26T11:50:00.000Z', // 5 mins left
          status: 'ACTIVE',
        }),
        createSampleReservation({
          id: 'res-03',
          spotCode: 'FL1-03',
          customerName: 'Pedro Penduko',
          endAt: '2026-09-26T11:55:00.000Z', // 10 mins left
          status: 'CHECKED_IN',
        }),
      ];

      const alerts = evaluateApproachingBookingEnds(bookings, 15, now);
      assert.equal(alerts.length, 3);

      // Sorted by remaining time ascending: res-02 (5m), res-03 (10m), res-01 (13m)
      assert.equal(alerts[0].reservationId, 'res-02');
      assert.equal(alerts[0].minutesRemaining, 5);
      assert.equal(alerts[0].urgency, 'critical'); // <= 5m is critical

      assert.equal(alerts[1].reservationId, 'res-03');
      assert.equal(alerts[1].minutesRemaining, 10);
      assert.equal(alerts[1].urgency, 'warning'); // > 5m is warning

      assert.equal(alerts[2].reservationId, 'res-01');
      assert.equal(alerts[2].minutesRemaining, 13);
      assert.equal(alerts[2].urgency, 'warning');
    });
  });

  describe('QAD-TC13.3: Boundary Exclusion and Inactive State Isolation', () => {
    it('excludes reservations that have more time than threshold or have already expired', () => {
      const now = new Date('2026-09-26T11:45:00.000Z');
      const bookings: OperationalReservation[] = [
        // 16 mins remaining (outside 15 min threshold)
        createSampleReservation({
          id: 'res-future',
          endAt: '2026-09-26T12:01:00.000Z',
          status: 'CHECKED_IN',
        }),
        // Exact 0 mins remaining (expired)
        createSampleReservation({
          id: 'res-exact-expired',
          endAt: '2026-09-26T11:45:00.000Z',
          status: 'CHECKED_IN',
        }),
        // Past end time (-5 mins remaining)
        createSampleReservation({
          id: 'res-past-expired',
          endAt: '2026-09-26T11:40:00.000Z',
          status: 'CHECKED_IN',
        }),
      ];

      const alerts = evaluateApproachingBookingEnds(bookings, 15, now);
      assert.equal(alerts.length, 0);
    });

    it('excludes reservations in non-active operational states even if ending soon', () => {
      const now = new Date('2026-09-26T11:50:00.000Z'); // 10 mins before 12:00
      const endAt = '2026-09-26T12:00:00.000Z';

      const inactiveStatuses = [
        'PENDING_PAYMENT',
        'CONFIRMED',
        'PENDING_REVIEW',
        'REJECTED',
        'CANCELLED',
        'CHECKED_OUT',
        'NO_SHOW',
      ] as const;

      for (const status of inactiveStatuses) {
        const bookings = [
          createSampleReservation({
            id: `res-${status}`,
            endAt,
            status,
          }),
        ];
        const alerts = evaluateApproachingBookingEnds(bookings, 15, now);
        assert.equal(
          alerts.length,
          0,
          `Expected status ${status} to be excluded from near-checkout alerts`
        );
      }
    });
  });

  describe('QAD-TC13.4: Dismissal Key Deduplication and Triage Independence', () => {
    it('generates consistent dismissal keys based on reservation ID and end time', () => {
      const endAt = '2026-09-26T12:00:00.000Z';
      const key1 = makeEndAlertDismissKey('res-101', endAt);
      const key2 = makeEndAlertDismissKey('res-101', endAt);
      assert.equal(key1, key2);
      assert.equal(key1, 'res-101:2026-09-26T12:00:00.000Z');

      // If reservation is extended, dismissal key changes so new alert can fire for extended session
      const extendedEndAt = '2026-09-26T13:00:00.000Z';
      const keyExtended = makeEndAlertDismissKey('res-101', extendedEndAt);
      assert.notEqual(key1, keyExtended);
    });

    it('suppresses toast when dismissed while keeping item in triage overview list', async () => {
      const now = new Date('2026-09-26T11:50:00.000Z');
      const mockRepo = new MockStaffOperationsRepository([
        createSampleReservation({
          id: 'res-triage-01',
          spotCode: 'FL1-05',
          customerName: 'Carlos Garcia',
          endAt: '2026-09-26T12:00:00.000Z',
          status: 'CHECKED_IN',
        }),
      ]);

      // Step 1: Triage query returns the near-checkout reservation
      const alerts = await getNearCheckoutReservations(15, mockRepo, now);
      assert.equal(alerts.length, 1);
      assert.equal(alerts[0].reservationId, 'res-triage-01');

      // Step 2: Simulate client dismissing the toast by recording dismissal key in local storage/set
      const dismissedKeys = new Set<string>();
      const dismissKey = makeEndAlertDismissKey(alerts[0].reservationId, alerts[0].endTime);
      dismissedKeys.add(dismissKey);

      // Step 3: Toast layer filters out dismissed items
      const visibleToasts = alerts.filter(
        (a) => !dismissedKeys.has(makeEndAlertDismissKey(a.reservationId, a.endTime))
      );
      assert.equal(visibleToasts.length, 0, 'Toast is suppressed after dismissal');

      // Step 4: Overview / triage query still returns the reservation for staff action
      const triageList = await getNearCheckoutReservations(15, mockRepo, now);
      assert.equal(triageList.length, 1, 'Triage list preserves the near checkout reservation');
      assert.equal(triageList[0].spotCode, 'FL1-05');
    });
  });

  describe('QAD-TC13.5: Workspace Overview Count Parity and Quick Action Integration', () => {
    it('matches near checkout count with triage item count', async () => {
      const now = new Date('2026-09-26T11:45:00.000Z');
      const mockRepo = new MockStaffOperationsRepository([
        // Near checkout (10 mins left)
        createSampleReservation({
          id: 'res-near-1',
          spotCode: 'FL1-01',
          endAt: '2026-09-26T11:55:00.000Z',
          status: 'CHECKED_IN',
        }),
        // Near checkout (15 mins left)
        createSampleReservation({
          id: 'res-near-2',
          spotCode: 'FL1-02',
          endAt: '2026-09-26T12:00:00.000Z',
          status: 'CHECKED_IN',
        }),
        // Not near checkout (45 mins left)
        createSampleReservation({
          id: 'res-far',
          spotCode: 'FL1-03',
          endAt: '2026-09-26T12:30:00.000Z',
          status: 'CHECKED_IN',
        }),
      ]);

      const nearCheckoutAlerts = await getNearCheckoutReservations(15, mockRepo, now);
      assert.equal(nearCheckoutAlerts.length, 2);

      // Verify quick action: checkout removes reservation from near-checkout list
      await mockRepo.checkOutReservation('res-near-1');
      const updatedAlertsAfterCheckout = await getNearCheckoutReservations(15, mockRepo, now);
      assert.equal(updatedAlertsAfterCheckout.length, 1);
      assert.equal(updatedAlertsAfterCheckout[0].reservationId, 'res-near-2');

      // Verify quick action: extend time pushes reservation out of near-checkout window
      await mockRepo.extendReservation('res-near-2', 60); // Adds 60 mins -> ends at 13:00 (75 mins left)
      const updatedAlertsAfterExtension = await getNearCheckoutReservations(15, mockRepo, now);
      assert.equal(updatedAlertsAfterExtension.length, 0);
    });
  });
});
