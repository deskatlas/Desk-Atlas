import { describe, it, expect } from 'vitest';
import {
  DEFAULT_WORKSPACE_STATUS_COLORS,
  isValidHexColor,
  getContrastColor,
  normalizeWorkspaceStatusColors,
  getStatusPillStyle,
  getWorkspaceSpotColor,
  InMemorySettingsRepository,
  createAdminSettingsService,
  SettingsValidationError,
  type WorkspaceStatusColors,
} from '@deskatlas/domain';

describe('MF-117 — Admin Settings Configurable Workspace Status Colors', () => {
  describe('Default Status Colors Contract', () => {
    it('provides standard default hex colors for all 4 workspace operational/occupancy states', () => {
      expect(DEFAULT_WORKSPACE_STATUS_COLORS).toEqual({
        available: '#10B981',
        occupied: '#EF4444',
        maintenance: '#F59E0B',
        unavailable: '#6B7280',
      });
    });
  });

  describe('Hex Color Validation (isValidHexColor)', () => {
    it('accepts valid 6-digit hex color strings', () => {
      expect(isValidHexColor('#10B981')).toBe(true);
      expect(isValidHexColor('#ef4444')).toBe(true);
      expect(isValidHexColor('#FFFFFF')).toBe(true);
      expect(isValidHexColor('#000000')).toBe(true);
      expect(isValidHexColor('#3B82F6')).toBe(true);
    });

    it('accepts valid 3-digit shorthand hex strings', () => {
      expect(isValidHexColor('#FFF')).toBe(true);
      expect(isValidHexColor('#000')).toBe(true);
      expect(isValidHexColor('#f0a')).toBe(true);
    });

    it('rejects invalid color formats', () => {
      expect(isValidHexColor(null)).toBe(false);
      expect(isValidHexColor(undefined)).toBe(false);
      expect(isValidHexColor('')).toBe(false);
      expect(isValidHexColor('10B981')).toBe(false); // missing hash
      expect(isValidHexColor('rgb(16, 185, 129)')).toBe(false);
      expect(isValidHexColor('#12')).toBe(false); // too short
      expect(isValidHexColor('#12345')).toBe(false); // 5 digits
      expect(isValidHexColor('#1234567')).toBe(false); // 7 digits
      expect(isValidHexColor('#GGGGGG')).toBe(false); // non-hex characters
    });
  });

  describe('Contrast Text Resolution (getContrastColor)', () => {
    it('returns dark text (#111827) for bright/light background colors', () => {
      expect(getContrastColor('#FFFFFF')).toBe('#111827');
      expect(getContrastColor('#FCF060')).toBe('#111827');
      expect(getContrastColor('#F59E0B')).toBe('#111827');
      expect(getContrastColor('#E0F2FE')).toBe('#111827');
      expect(getContrastColor('#CCFBF1')).toBe('#111827');
    });

    it('returns light text (#ffffff) for dark or medium-dark background colors', () => {
      expect(getContrastColor('#000000')).toBe('#ffffff');
      expect(getContrastColor('#10B981')).toBe('#ffffff');
      expect(getContrastColor('#EF4444')).toBe('#ffffff');
      expect(getContrastColor('#1E293B')).toBe('#ffffff');
      expect(getContrastColor('#6B7280')).toBe('#ffffff');
      expect(getContrastColor('#1E1B4B')).toBe('#ffffff');
    });

    it('handles 3-digit shorthand hex strings correctly', () => {
      expect(getContrastColor('#FFF')).toBe('#111827');
      expect(getContrastColor('#000')).toBe('#ffffff');
    });
  });

  describe('Status Colors Normalization (normalizeWorkspaceStatusColors)', () => {
    it('returns defaults when input is empty or null', () => {
      const normalized = normalizeWorkspaceStatusColors(null);
      expect(normalized).toEqual(DEFAULT_WORKSPACE_STATUS_COLORS);
    });

    it('replaces invalid hex inputs with default values', () => {
      const normalized = normalizeWorkspaceStatusColors({
        available: 'invalid-green',
        occupied: '#FF0000',
        maintenance: '',
        unavailable: '#333333',
      });
      expect(normalized.available).toBe(DEFAULT_WORKSPACE_STATUS_COLORS.available);
      expect(normalized.occupied).toBe('#FF0000');
      expect(normalized.maintenance).toBe(DEFAULT_WORKSPACE_STATUS_COLORS.maintenance);
      expect(normalized.unavailable).toBe('#333333');
    });

    it('uppercases valid hex strings', () => {
      const normalized = normalizeWorkspaceStatusColors({
        available: '#00cc66',
        occupied: '#cc0000',
        maintenance: '#ffbb00',
        unavailable: '#888888',
      });
      expect(normalized.available).toBe('#00CC66');
      expect(normalized.occupied).toBe('#CC0000');
      expect(normalized.maintenance).toBe('#FFBB00');
      expect(normalized.unavailable).toBe('#888888');
    });
  });

  describe('Badge Pill Style & Spot Color Generation', () => {
    const customColors: WorkspaceStatusColors = {
      available: '#06D6A0',
      occupied: '#E63946',
      maintenance: '#FFB703',
      unavailable: '#457B9D',
    };

    it('generates correct pill styles for AVAILABLE status', () => {
      const pill = getStatusPillStyle('AVAILABLE', customColors);
      expect(pill.backgroundColor).toBe('#06D6A0');
      expect(pill.color).toBe(getContrastColor('#06D6A0'));
    });

    it('generates correct pill styles for OCCUPIED / IN_USE / CHECKED_IN status', () => {
      const pillOccupied = getStatusPillStyle('OCCUPIED', customColors);
      expect(pillOccupied.backgroundColor).toBe('#E63946');
      expect(pillOccupied.color).toBe(getContrastColor('#E63946'));

      const pillInUse = getStatusPillStyle('IN_USE', customColors);
      expect(pillInUse.backgroundColor).toBe('#E63946');

      const pillCheckedIn = getStatusPillStyle('CHECKED_IN', customColors);
      expect(pillCheckedIn.backgroundColor).toBe('#E63946');
    });

    it('generates correct pill styles for MAINTENANCE status', () => {
      const pill = getStatusPillStyle('MAINTENANCE', customColors);
      expect(pill.backgroundColor).toBe('#FFB703');
      expect(pill.color).toBe(getContrastColor('#FFB703'));
    });

    it('generates correct pill styles for UNAVAILABLE / DISABLED / INACTIVE / BROKEN status', () => {
      const pillUnavailable = getStatusPillStyle('UNAVAILABLE', customColors);
      expect(pillUnavailable.backgroundColor).toBe('#457B9D');

      const pillDisabled = getStatusPillStyle('DISABLED', customColors);
      expect(pillDisabled.backgroundColor).toBe('#457B9D');

      const pillInactive = getStatusPillStyle('INACTIVE', customColors);
      expect(pillInactive.backgroundColor).toBe('#457B9D');
    });

    it('resolves workspace spot background colors correctly', () => {
      expect(getWorkspaceSpotColor('AVAILABLE', customColors)).toBe('#06D6A0');
      expect(getWorkspaceSpotColor('OCCUPIED', customColors)).toBe('#E63946');
      expect(getWorkspaceSpotColor('MAINTENANCE', customColors)).toBe('#FFB703');
      expect(getWorkspaceSpotColor('UNAVAILABLE', customColors)).toBe('#457B9D');
    });
  });

  describe('Settings Service & Persistence Integration', () => {
    it('initializes in-memory repository with default status colors', async () => {
      const repo = new InMemorySettingsRepository();
      const service = createAdminSettingsService(repo);
      const settings = await service.getSettingsOverview();

      expect(settings.businessSettings.statusColors).toEqual(DEFAULT_WORKSPACE_STATUS_COLORS);
    });

    it('allows administrators to update status colors', async () => {
      const repo = new InMemorySettingsRepository();
      const service = createAdminSettingsService(repo);

      const customColors: WorkspaceStatusColors = {
        available: '#22C55E',
        occupied: '#DC2626',
        maintenance: '#EAB308',
        unavailable: '#475569',
      };

      const updated = await service.updateBusinessSettings({
        businessName: 'DeskAtlas Metro',
        timezone: 'Asia/Manila',
        contactEmail: 'admin@deskatlas.com',
        bookingIntervalMinutes: 30,
        paymentExpiryMinutes: 60,
        statusColors: customColors,
      });

      expect(updated.statusColors).toEqual(customColors);

      // Verify persistence via getSettingsOverview
      const overview = await service.getSettingsOverview();
      expect(overview.businessSettings.statusColors).toEqual(customColors);
    });

    it('exposes custom status colors in getPublicBusinessSettings endpoint contract', async () => {
      const repo = new InMemorySettingsRepository();
      const service = createAdminSettingsService(repo);

      const customColors: WorkspaceStatusColors = {
        available: '#14B8A6',
        occupied: '#F43F5E',
        maintenance: '#F59E0B',
        unavailable: '#64748B',
      };

      await service.updateBusinessSettings({
        businessName: 'DeskAtlas Metro',
        timezone: 'Asia/Manila',
        contactEmail: 'admin@deskatlas.com',
        bookingIntervalMinutes: 30,
        paymentExpiryMinutes: 60,
        statusColors: customColors,
      });

      const publicSettings = await service.getPublicBusinessSettings();
      expect(publicSettings.statusColors).toEqual(customColors);
    });

    it('rejects invalid statusColors input types', async () => {
      const repo = new InMemorySettingsRepository();
      const service = createAdminSettingsService(repo);

      await expect(
        service.updateBusinessSettings({
          businessName: 'DeskAtlas Manila',
          timezone: 'Asia/Manila',
          contactEmail: 'admin@deskatlas.com',
          bookingIntervalMinutes: 30,
          paymentExpiryMinutes: 60,
          statusColors: 'invalid-string' as any,
        })
      ).rejects.toThrow(SettingsValidationError);
    });
  });
});
