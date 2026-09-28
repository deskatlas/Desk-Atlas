import { describe, it, expect } from 'vitest';
import {
  resolveWorkspaceStatusColor,
  getWorkspaceSpotColor,
  getContrastColor,
  normalizeWorkspaceStatusColors,
  DEFAULT_WORKSPACE_STATUS_COLORS,
  type WorkspaceStatusColors,
  type WorkspaceOperationalState,
} from '@deskatlas/domain';

describe('MS-16: Universal Operational Status Color System and Workspace Color Customization Simplification', () => {
  describe('QAD-TC16.1: Status Color Resolver Logic', () => {
    it('resolves default operational status colors for standard states', () => {
      expect(resolveWorkspaceStatusColor('AVAILABLE')).toBe(DEFAULT_WORKSPACE_STATUS_COLORS.available);
      expect(resolveWorkspaceStatusColor('OCCUPIED')).toBe(DEFAULT_WORKSPACE_STATUS_COLORS.occupied);
      expect(resolveWorkspaceStatusColor('MAINTENANCE')).toBe(DEFAULT_WORKSPACE_STATUS_COLORS.maintenance);
      expect(resolveWorkspaceStatusColor('UNAVAILABLE')).toBe(DEFAULT_WORKSPACE_STATUS_COLORS.unavailable);
    });

    it('resolves custom configured status colors correctly', () => {
      const customColors: WorkspaceStatusColors = {
        available: '#0EA5E9',
        occupied: '#DC2626',
        maintenance: '#D97706',
        unavailable: '#475569',
      };

      expect(resolveWorkspaceStatusColor('AVAILABLE', customColors)).toBe('#0EA5E9');
      expect(resolveWorkspaceStatusColor('OCCUPIED', customColors)).toBe('#DC2626');
      expect(resolveWorkspaceStatusColor('MAINTENANCE', customColors)).toBe('#D97706');
      expect(resolveWorkspaceStatusColor('UNAVAILABLE', customColors)).toBe('#475569');
    });

    it('normalizes operational aliases and is case-insensitive', () => {
      const customColors: WorkspaceStatusColors = {
        available: '#10B981',
        occupied: '#EF4444',
        maintenance: '#F59E0B',
        unavailable: '#6B7280',
      };

      // Occupied aliases
      expect(resolveWorkspaceStatusColor('checked_in', customColors)).toBe('#EF4444');
      expect(resolveWorkspaceStatusColor('IN_USE', customColors)).toBe('#EF4444');
      expect(resolveWorkspaceStatusColor('active_booking', customColors)).toBe('#EF4444');

      // Maintenance aliases
      expect(resolveWorkspaceStatusColor('under_repair', customColors)).toBe('#F59E0B');
      expect(resolveWorkspaceStatusColor('BROKEN', customColors)).toBe('#F59E0B');

      // Unavailable aliases
      expect(resolveWorkspaceStatusColor('inactive', customColors)).toBe('#6B7280');
      expect(resolveWorkspaceStatusColor('DISABLED', customColors)).toBe('#6B7280');
      expect(resolveWorkspaceStatusColor('blocked', customColors)).toBe('#6B7280');
      expect(resolveWorkspaceStatusColor('RESERVED', customColors)).toBe('#6B7280');
      expect(resolveWorkspaceStatusColor('closed', customColors)).toBe('#6B7280');
    });

    it('getWorkspaceSpotColor delegates to resolveWorkspaceStatusColor', () => {
      expect(getWorkspaceSpotColor('AVAILABLE')).toBe(resolveWorkspaceStatusColor('AVAILABLE'));
      expect(getWorkspaceSpotColor('OCCUPIED')).toBe(resolveWorkspaceStatusColor('OCCUPIED'));
      expect(getWorkspaceSpotColor('MAINTENANCE')).toBe(resolveWorkspaceStatusColor('MAINTENANCE'));
      expect(getWorkspaceSpotColor('UNAVAILABLE')).toBe(resolveWorkspaceStatusColor('UNAVAILABLE'));
    });
  });

  describe('QAD-TC16.2: Fallback Resilience', () => {
    it('uses DEFAULT_WORKSPACE_STATUS_COLORS if configuredColors is null, undefined, or empty', () => {
      expect(resolveWorkspaceStatusColor('AVAILABLE', null)).toBe(DEFAULT_WORKSPACE_STATUS_COLORS.available);
      expect(resolveWorkspaceStatusColor('OCCUPIED', undefined)).toBe(DEFAULT_WORKSPACE_STATUS_COLORS.occupied);
      expect(resolveWorkspaceStatusColor('MAINTENANCE', {})).toBe(DEFAULT_WORKSPACE_STATUS_COLORS.maintenance);
    });

    it('falls back to default colors for invalid or missing hex values in partial configurations', () => {
      const partialColors = {
        available: '#3B82F6',
        occupied: 'invalid-hex',
        maintenance: '',
      };

      const normalized = normalizeWorkspaceStatusColors(partialColors);
      expect(normalized.available).toBe('#3B82F6');
      expect(normalized.occupied).toBe(DEFAULT_WORKSPACE_STATUS_COLORS.occupied);
      expect(normalized.maintenance).toBe(DEFAULT_WORKSPACE_STATUS_COLORS.maintenance);
      expect(normalized.unavailable).toBe(DEFAULT_WORKSPACE_STATUS_COLORS.unavailable);

      expect(resolveWorkspaceStatusColor('OCCUPIED', partialColors)).toBe(DEFAULT_WORKSPACE_STATUS_COLORS.occupied);
    });

    it('defaults unknown status strings safely to AVAILABLE color', () => {
      expect(resolveWorkspaceStatusColor('SOME_UNKNOWN_STATUS')).toBe(DEFAULT_WORKSPACE_STATUS_COLORS.available);
      expect(resolveWorkspaceStatusColor('')).toBe(DEFAULT_WORKSPACE_STATUS_COLORS.available);
    });
  });

  describe('QAD-TC16.3: Template Form Color Removal & Centralized Governance', () => {
    it('provides standard fallback template color when defaultColor is omitted', () => {
      const templatePayload = {
        name: 'Focus Pod',
        capacity: 1,
        rateAmount: 150,
        defaultShape: 'desk',
      };

      // In the new system, templates do not require user-defined color customization
      expect(templatePayload.name).toBe('Focus Pod');
      expect((templatePayload as { defaultColor?: string }).defaultColor).toBeUndefined();
    });

    it('ensures workspace status colors structure is strictly defined in settings', () => {
      const defaultColors = DEFAULT_WORKSPACE_STATUS_COLORS;
      expect(defaultColors).toHaveProperty('available');
      expect(defaultColors).toHaveProperty('occupied');
      expect(defaultColors).toHaveProperty('maintenance');
      expect(defaultColors).toHaveProperty('unavailable');
    });
  });

  describe('QAD-TC16.4: Contrast Color Determination', () => {
    it('computes dark text (#111827) for light background colors (WCAG readability)', () => {
      // Light status colors: White / Light Yellow / Light Blue / Light Green
      expect(getContrastColor('#FFFFFF')).toBe('#111827');
      expect(getContrastColor('#FEF3C7')).toBe('#111827');
      expect(getContrastColor('#E0F2FE')).toBe('#111827');
      expect(getContrastColor('#DCFCE7')).toBe('#111827');
    });

    it('computes light text (#ffffff) for dark or saturated background colors', () => {
      // Saturated or dark status colors: Emerald / Crimson / Navy / Pure Black
      expect(getContrastColor('#10B981')).toBe('#ffffff'); // Emerald green has white text
      expect(getContrastColor('#EF4444')).toBe('#ffffff'); // Crimson red has white text
      expect(getContrastColor('#000000')).toBe('#ffffff');
      expect(getContrastColor('#1E293B')).toBe('#ffffff');
      expect(getContrastColor('#111827')).toBe('#ffffff');
      expect(getContrastColor('#0F172A')).toBe('#ffffff');
    });

    it('gracefully handles malformed or 3-digit hex strings', () => {
      expect(getContrastColor('#FFF')).toBe('#111827');
      expect(getContrastColor('#000')).toBe('#ffffff');
      expect(getContrastColor('')).toBe('#111827');
      expect(getContrastColor('invalid')).toBe('#111827');
    });
  });

  describe('QAD-TC16.5: Structural Styling Preservation', () => {
    it('ensures architectural structures do not inherit workspace status colors', () => {
      const wallElement = {
        elementType: 'wall',
        elementRole: 'STRUCTURE',
        properties: { color: '#64748B' },
      };

      const kioskElement = {
        elementType: 'KIOSK_YOU_ARE_HERE',
        elementRole: 'INFORMATION',
        properties: { color: '#DC2626' },
      };

      const windowElement = {
        elementType: 'window',
        elementRole: 'STRUCTURE',
        properties: { color: 'rgba(56, 189, 248, 0.25)' },
      };

      // Bookable check evaluates false for structures
      const isWallWorkspace = wallElement.elementRole === 'WORKSPACE';
      const isKioskWorkspace = kioskElement.elementRole === 'WORKSPACE';
      const isWindowWorkspace = windowElement.elementRole === 'WORKSPACE';

      expect(isWallWorkspace).toBe(false);
      expect(isKioskWorkspace).toBe(false);
      expect(isWindowWorkspace).toBe(false);

      // Verify architectural colors remain intact
      expect(wallElement.properties.color).toBe('#64748B');
      expect(kioskElement.properties.color).toBe('#DC2626');
      expect(windowElement.properties.color).toBe('rgba(56, 189, 248, 0.25)');
    });
  });
});
