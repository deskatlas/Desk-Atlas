import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DEFAULT_WORKSPACE_STATUS_COLORS,
  normalizeWorkspaceStatusColors,
  getContrastColor,
  type OccupancyRecord,
  type WorkspaceStatusColors,
} from '@deskatlas/domain';
import {
  fetchStaffOccupancy,
  fetchWorkspaceStatusColors,
} from '../apps/staff-dashboard/src/app/lib/publishedMapApi';

describe('MF-120: Staff Workspace Map Occupancy Visibility', () => {
  const sampleOccupancy: OccupancyRecord[] = [
    {
      reservationId: 'res-001',
      referenceCode: 'DA-2026-0001',
      source: 'WEB',
      customerFirstName: 'Maria',
      customerLastName: 'Santos',
      customerEmail: 'maria@example.com',
      reservationStatus: 'CHECKED_IN',
      checkInState: 'CHECKED_IN',
      workspaceInstanceId: 'inst-desk-01',
      workspaceDisplayName: 'Dedicated Desk 1',
      workspaceInstanceCode: 'DD-01',
      workspaceTemplateName: 'Dedicated Desk',
      floorName: 'Ground Floor',
      bookingStartAt: '2026-09-17T09:00:00Z',
      bookingEndAt: '2026-09-17T17:00:00Z',
      confirmedAt: '2026-09-17T08:30:00Z',
      checkedInAt: '2026-09-17T09:05:00Z',
      checkedOutAt: null,
      qrIssuedAt: '2026-09-17T08:30:00Z',
      occupancyState: 'OCCUPIED',
    },
    {
      reservationId: 'res-002',
      referenceCode: 'DA-2026-0002',
      source: 'KIOSK',
      customerFirstName: 'Juan',
      customerLastName: 'Dela Cruz',
      customerEmail: 'juan@example.com',
      reservationStatus: 'CONFIRMED',
      checkInState: 'NOT_CHECKED_IN',
      workspaceInstanceId: 'inst-desk-02',
      workspaceDisplayName: 'Hot Desk 2',
      workspaceInstanceCode: 'HD-02',
      workspaceTemplateName: 'Hot Desk',
      floorName: 'Ground Floor',
      bookingStartAt: '2026-09-17T10:00:00Z',
      bookingEndAt: '2026-09-17T14:00:00Z',
      confirmedAt: '2026-09-17T09:55:00Z',
      checkedInAt: null,
      checkedOutAt: null,
      qrIssuedAt: '2026-09-17T09:55:00Z',
      occupancyState: 'RESERVED',
    },
  ];

  describe('Occupancy Lookup Map', () => {
    it('creates an O(1) map indexed by workspaceInstanceId', () => {
      const map = new Map<string, OccupancyRecord>();
      for (const occ of sampleOccupancy) {
        if (occ.workspaceInstanceId) {
          map.set(occ.workspaceInstanceId, occ);
        }
      }

      expect(map.has('inst-desk-01')).toBe(true);
      expect(map.get('inst-desk-01')?.customerFirstName).toBe('Maria');
      expect(map.get('inst-desk-01')?.reservationStatus).toBe('CHECKED_IN');

      expect(map.has('inst-desk-02')).toBe(true);
      expect(map.get('inst-desk-02')?.customerFirstName).toBe('Juan');

      expect(map.has('inst-unoccupied')).toBe(false);
    });
  });

  describe('Spot Visual Status & Color Hierarchy', () => {
    function resolveSpotVisuals(
      operationalStatus: string,
      isBookable: boolean,
      isOccupied: boolean,
      statusColors: WorkspaceStatusColors
    ) {
      let bg = statusColors.available;
      let borderStyle = 'solid';
      let borderColor = 'rgba(0, 0, 0, 0.15)';
      let statusTag = 'AVAILABLE';

      if (operationalStatus === 'MAINTENANCE') {
        borderStyle = 'dashed';
        borderColor = statusColors.maintenance;
        bg = statusColors.maintenance;
        statusTag = 'MAINTENANCE';
      } else if (operationalStatus === 'INACTIVE' || operationalStatus === 'BROKEN' || !isBookable) {
        borderStyle = 'dashed';
        borderColor = statusColors.unavailable;
        bg = statusColors.unavailable;
        statusTag = 'INACTIVE';
      } else if (isOccupied) {
        borderStyle = 'solid';
        borderColor = statusColors.occupied;
        bg = statusColors.occupied;
        statusTag = 'OCCUPIED';
      }

      const textColor = getContrastColor(bg);

      return { bg, borderColor, borderStyle, textColor, statusTag };
    }

    it('renders available desks with available status color', () => {
      const visuals = resolveSpotVisuals('ACTIVE', true, false, DEFAULT_WORKSPACE_STATUS_COLORS);
      expect(visuals.statusTag).toBe('AVAILABLE');
      expect(visuals.bg).toBe(DEFAULT_WORKSPACE_STATUS_COLORS.available);
      expect(visuals.borderStyle).toBe('solid');
    });

    it('renders occupied desks with occupied status color and high-contrast text', () => {
      const visuals = resolveSpotVisuals('ACTIVE', true, true, DEFAULT_WORKSPACE_STATUS_COLORS);
      expect(visuals.statusTag).toBe('OCCUPIED');
      expect(visuals.bg).toBe(DEFAULT_WORKSPACE_STATUS_COLORS.occupied);
      expect(visuals.borderColor).toBe(DEFAULT_WORKSPACE_STATUS_COLORS.occupied);
      expect(visuals.textColor).toBe('#ffffff');
    });

    it('prioritizes MAINTENANCE over occupancy if desk is blocked by staff', () => {
      const visuals = resolveSpotVisuals('MAINTENANCE', false, true, DEFAULT_WORKSPACE_STATUS_COLORS);
      expect(visuals.statusTag).toBe('MAINTENANCE');
      expect(visuals.bg).toBe(DEFAULT_WORKSPACE_STATUS_COLORS.maintenance);
      expect(visuals.borderStyle).toBe('dashed');
    });

    it('prioritizes INACTIVE over occupancy if desk is deactivated', () => {
      const visuals = resolveSpotVisuals('INACTIVE', false, true, DEFAULT_WORKSPACE_STATUS_COLORS);
      expect(visuals.statusTag).toBe('INACTIVE');
      expect(visuals.bg).toBe(DEFAULT_WORKSPACE_STATUS_COLORS.unavailable);
      expect(visuals.borderStyle).toBe('dashed');
    });

    it('adapts dynamically to custom workspace status colors configured in Admin Settings', () => {
      const customColors = normalizeWorkspaceStatusColors({
        available: '#059669',
        occupied: '#DC2626',
        maintenance: '#D97706',
        unavailable: '#4B5563',
      });

      const visuals = resolveSpotVisuals('ACTIVE', true, true, customColors);
      expect(visuals.bg).toBe('#DC2626');
      expect(visuals.borderColor).toBe('#DC2626');
    });
  });

  describe('Floor Occupancy Summary Counter', () => {
    it('correctly calculates total vs occupied workspaces on a floor', () => {
      const elements = [
        { id: '1', elementRole: 'WORKSPACE', workspace: { workspaceInstanceId: 'inst-desk-01' } },
        { id: '2', elementRole: 'WORKSPACE', workspace: { workspaceInstanceId: 'inst-desk-02' } },
        { id: '3', elementRole: 'WORKSPACE', workspace: { workspaceInstanceId: 'inst-desk-03' } },
        { id: '4', elementRole: 'WORKSPACE', workspace: { workspaceInstanceId: 'inst-desk-04' } },
        { id: '5', elementRole: 'AMENITY', workspace: null },
      ];

      const occupancyMap = new Map<string, OccupancyRecord>([
        ['inst-desk-01', sampleOccupancy[0]],
        ['inst-desk-02', sampleOccupancy[1]],
      ]);

      const workspaceElements = elements.filter(
        (e) => e.elementRole === 'WORKSPACE' || Boolean(e.workspace)
      );
      const totalWorkspaces = workspaceElements.length;
      const occupiedWorkspaces = workspaceElements.filter((e) =>
        Boolean(e.workspace?.workspaceInstanceId && occupancyMap.has(e.workspace.workspaceInstanceId))
      ).length;

      expect(totalWorkspaces).toBe(4);
      expect(occupiedWorkspaces).toBe(2);
    });
  });

  describe('Active Occupant Card Details Formatting', () => {
    it('formats guest full name, reference code, and check-in state', () => {
      const record = sampleOccupancy[0];
      const fullName = `${record.customerFirstName} ${record.customerLastName}`;
      expect(fullName).toBe('Maria Santos');
      expect(record.referenceCode).toBe('DA-2026-0001');

      const isCheckedIn = record.checkedInAt !== null || record.reservationStatus === 'CHECKED_IN';
      expect(isCheckedIn).toBe(true);
    });

    it('differentiates checked-in vs confirmed awaiting arrival', () => {
      const checkedInRecord = sampleOccupancy[0];
      const awaitingRecord = sampleOccupancy[1];

      const getCheckInLabel = (rec: OccupancyRecord) => {
        if (rec.checkedInAt) return 'Checked In';
        if (rec.reservationStatus === 'CHECKED_IN') return 'Checked In';
        return 'Confirmed (Awaiting Arrival)';
      };

      expect(getCheckInLabel(checkedInRecord)).toBe('Checked In');
      expect(getCheckInLabel(awaitingRecord)).toBe('Confirmed (Awaiting Arrival)');
    });
  });

  describe('fetchStaffOccupancy API Client', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('returns occupancy array on successful response', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ occupancy: sampleOccupancy }),
      });
      global.fetch = mockFetch;

      const result = await fetchStaffOccupancy();
      expect(result).toHaveLength(2);
      expect(result[0].referenceCode).toBe('DA-2026-0001');
      expect(mockFetch).toHaveBeenCalledWith('/api/operations/occupancy', { cache: 'no-store' });
    });

    it('gracefully returns empty array on network or server error', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Internal server error' }),
      });
      global.fetch = mockFetch;

      const result = await fetchStaffOccupancy();
      expect(result).toEqual([]);
    });
  });

  describe('fetchWorkspaceStatusColors API Client (Admin Configured Colors)', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('returns admin-configured status colors from /api/settings', async () => {
      const adminConfiguredColors: WorkspaceStatusColors = {
        available: '#00AA55',
        occupied: '#FF2222',
        maintenance: '#FFAA00',
        unavailable: '#333333',
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ statusColors: adminConfiguredColors }),
      });
      global.fetch = mockFetch;

      const result = await fetchWorkspaceStatusColors();
      expect(result).toEqual(adminConfiguredColors);
      expect(mockFetch).toHaveBeenCalledWith('/api/settings', { cache: 'no-store' });
    });

    it('falls back to default workspace status colors on error', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      });
      global.fetch = mockFetch;

      const result = await fetchWorkspaceStatusColors();
      expect(result).toEqual(DEFAULT_WORKSPACE_STATUS_COLORS);
    });
  });
});
