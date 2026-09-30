import { describe, it, expect } from 'vitest';
import {
  getNextAvailableInstanceNumber,
  resolveBookingSpotName,
  evaluateApproachingBookingEnds,
  ActiveBookingCandidate,
} from '@deskatlas/domain';

describe('MS-28: Global Template Instance Auto-Naming Collision Prevention and Operational Near-End Booking Spot Resolution', () => {
  describe('QAD-TC28-01: Multi-Floor Non-Restarting Sequential Auto-Naming', () => {
    it('generates Design Dock 2 when Floor 1 has Design Dock 1 and Floor 2 is being populated', () => {
      const allVenueInstances = [
        { displayName: 'Design Dock 1', floorId: 'floor-1', templateId: 'tpl-dd' },
      ];
      const canvasObjects: Array<{ name?: string; template?: string }> = [];

      const existingNames = Array.from(
        new Set([
          ...allVenueInstances.map((i) => i.displayName || '').filter(Boolean),
          ...canvasObjects.map((o) => o.name || '').filter(Boolean),
        ])
      );

      const result = getNextAvailableInstanceNumber('Design Dock', existingNames, 'MAX_PLUS_ONE');
      expect(result.sequenceNumber).toBe(2);
      expect(result.displayName).toBe('Design Dock 2');
    });
  });

  describe('QAD-TC28-02: Monotonic Forward Progression over Gap-Fill', () => {
    it('generates Design Dock 4 when Design Dock 1 and Design Dock 3 exist under MAX_PLUS_ONE', () => {
      const existingNames = ['Design Dock 1', 'Design Dock 3'];
      const result = getNextAvailableInstanceNumber('Design Dock', existingNames, 'MAX_PLUS_ONE');

      expect(result.sequenceNumber).toBe(4);
      expect(result.displayName).toBe('Design Dock 4');
    });
  });

  describe('QAD-TC28-03: Collision Verification Safety Guarantee', () => {
    it('guarantees generated name is strictly not present in existing name set', () => {
      const templateName = 'Focus Pod';
      const existingNames = ['Focus Pod 1', 'Focus Pod 2', 'Focus Pod 3', 'Focus Pod 4'];

      const { displayName: initialDisplayName, sequenceNumber } = getNextAvailableInstanceNumber(
        templateName,
        existingNames,
        'MAX_PLUS_ONE'
      );

      let displayName = initialDisplayName;
      let counter = 1;
      const lowerExisting = new Set(existingNames.map((n) => n.trim().toLowerCase()));

      while (lowerExisting.has(displayName.trim().toLowerCase())) {
        const nextNum = sequenceNumber + counter;
        displayName = `${templateName} ${nextNum}`;
        counter++;
      }

      expect(displayName).toBe('Focus Pod 5');
      expect(lowerExisting.has(displayName.trim().toLowerCase())).toBe(false);
    });
  });

  describe('QAD-TC28-04: Operational Spot Resolution for workspaceDisplayName', () => {
    it('resolves workspaceDisplayName directly from operational reservation DTO', () => {
      const operationalBooking: ActiveBookingCandidate = {
        id: 'res-op-1',
        referenceCode: 'DA-2026-OP01',
        status: 'CHECKED_IN',
        customerFirstName: 'Maria',
        customerLastName: 'Santos',
        workspaceDisplayName: 'Design Dock 1',
        workspaceInstanceCode: 'DD-01',
        workspaceTemplateName: 'Design Dock',
        endAt: '2026-09-30T10:05:00.000Z',
      };

      const spotName = resolveBookingSpotName(operationalBooking);
      expect(spotName).toBe('Design Dock 1');

      const now = new Date('2026-09-30T10:00:00.000Z');
      const alerts = evaluateApproachingBookingEnds([operationalBooking], 15, now);

      expect(alerts).toHaveLength(1);
      expect(alerts[0].spotName).toBe('Design Dock 1');
      expect(alerts[0].customerName).toBe('Maria Santos');
      expect(alerts[0].minutesRemaining).toBe(5);
    });
  });

  describe('QAD-TC28-05: Operational Spot Resolution for workspaceInstanceCode Fallback', () => {
    it('resolves workspaceInstanceCode when workspaceDisplayName is missing', () => {
      const candidateBooking: ActiveBookingCandidate = {
        id: 'res-op-2',
        referenceCode: 'DA-2026-OP02',
        status: 'CHECKED_IN',
        customerFirstName: 'Juan',
        customerLastName: 'Dela Cruz',
        workspaceDisplayName: null,
        workspaceInstanceCode: 'DD-101',
        endAt: '2026-09-30T10:04:00.000Z',
      };

      const spotName = resolveBookingSpotName(candidateBooking);
      expect(spotName).toBe('DD-101');

      const now = new Date('2026-09-30T10:00:00.000Z');
      const alerts = evaluateApproachingBookingEnds([candidateBooking], 15, now);

      expect(alerts).toHaveLength(1);
      expect(alerts[0].spotName).toBe('DD-101');
    });

    it('resolves workspaceTemplateName as fallback when display name and code are missing', () => {
      const candidateBooking: ActiveBookingCandidate = {
        id: 'res-op-3',
        referenceCode: 'DA-2026-OP03',
        status: 'CHECKED_IN',
        customerFirstName: 'Elena',
        customerLastName: 'Reyes',
        workspaceDisplayName: null,
        workspaceInstanceCode: null,
        workspaceTemplateName: 'Focus Pod Standard',
        endAt: '2026-09-30T10:04:00.000Z',
      };

      const spotName = resolveBookingSpotName(candidateBooking);
      expect(spotName).toBe('Focus Pod Standard');
    });
  });

  describe('QAD-TC28-06: Unassigned Candidate Spot Graceful Fallback', () => {
    it('gracefully falls back to Unassigned Spot when no spot details are present', () => {
      const unassignedBooking: ActiveBookingCandidate = {
        id: 'res-op-4',
        referenceCode: 'DA-2026-OP04',
        status: 'CHECKED_IN',
        customerFirstName: 'Guest',
        customerLastName: 'User',
        endAt: '2026-09-30T10:03:00.000Z',
      };

      const spotName = resolveBookingSpotName(unassignedBooking);
      expect(spotName).toBe('Unassigned Spot');

      const now = new Date('2026-09-30T10:00:00.000Z');
      const alerts = evaluateApproachingBookingEnds([unassignedBooking], 15, now);

      expect(alerts).toHaveLength(1);
      expect(alerts[0].spotName).toBe('Unassigned Spot');
    });
  });
});
