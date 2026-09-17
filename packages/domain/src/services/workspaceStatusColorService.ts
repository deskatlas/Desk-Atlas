import {
  DEFAULT_WORKSPACE_STATUS_COLORS,
  type WorkspaceStatusColors,
} from '../models/settings';

/**
 * Validates whether a given string is a valid 3-digit or 6-digit hex color (e.g. #FFF or #10B981)
 */
export function isValidHexColor(color?: string | null): boolean {
  if (!color || typeof color !== 'string') return false;
  return /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(color.trim());
}

/**
 * Computes high-contrast text color (#111827 or #ffffff) based on YIQ luminance of the hex background
 */
export function getContrastColor(hexColor?: string): string {
  if (!hexColor || !hexColor.startsWith('#') || (hexColor.length !== 4 && hexColor.length !== 7)) {
    return '#111827';
  }
  let hex = hexColor.slice(1);
  if (hex.length === 3) {
    hex = hex.split('').map((c) => c + c).join('');
  }
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) {
    return '#111827';
  }
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 150 ? '#111827' : '#ffffff';
}

/**
 * Normalizes a partial or custom WorkspaceStatusColors object, falling back to system defaults for invalid or missing values
 */
export function normalizeWorkspaceStatusColors(
  colors?: Partial<WorkspaceStatusColors> | null
): WorkspaceStatusColors {
  return {
    available: isValidHexColor(colors?.available)
      ? colors!.available!.trim().toUpperCase()
      : DEFAULT_WORKSPACE_STATUS_COLORS.available,
    occupied: isValidHexColor(colors?.occupied)
      ? colors!.occupied!.trim().toUpperCase()
      : DEFAULT_WORKSPACE_STATUS_COLORS.occupied,
    maintenance: isValidHexColor(colors?.maintenance)
      ? colors!.maintenance!.trim().toUpperCase()
      : DEFAULT_WORKSPACE_STATUS_COLORS.maintenance,
    unavailable: isValidHexColor(colors?.unavailable)
      ? colors!.unavailable!.trim().toUpperCase()
      : DEFAULT_WORKSPACE_STATUS_COLORS.unavailable,
  };
}

/**
 * Returns badge/pill styles (backgroundColor, textColor, borderColor) for a given workspace operational/occupancy status
 */
export function getStatusPillStyle(
  status: 'AVAILABLE' | 'OCCUPIED' | 'MAINTENANCE' | 'UNAVAILABLE' | string,
  customColors?: Partial<WorkspaceStatusColors> | null
): { backgroundColor: string; color: string; borderColor: string } {
  const colors = normalizeWorkspaceStatusColors(customColors);
  const norm = (status || '').toUpperCase().trim();
  let bg = colors.available;

  if (
    norm === 'OCCUPIED' ||
    norm === 'IN_USE' ||
    norm === 'ACTIVE_BOOKING' ||
    norm === 'CHECKED_IN'
  ) {
    bg = colors.occupied;
  } else if (
    norm === 'MAINTENANCE' ||
    norm === 'UNDER_REPAIR' ||
    norm === 'BROKEN'
  ) {
    bg = colors.maintenance;
  } else if (
    norm === 'UNAVAILABLE' ||
    norm === 'DISABLED' ||
    norm === 'INACTIVE' ||
    norm === 'BLOCKED' ||
    norm === 'RESERVED'
  ) {
    bg = colors.unavailable;
  }

  const textColor = getContrastColor(bg);
  return {
    backgroundColor: bg,
    color: textColor,
    borderColor: bg,
  };
}

/**
 * Returns the spot background color for a given workspace operational/occupancy status
 */
export function getWorkspaceSpotColor(
  status: 'AVAILABLE' | 'OCCUPIED' | 'MAINTENANCE' | 'UNAVAILABLE' | string,
  customColors?: Partial<WorkspaceStatusColors> | null
): string {
  const pillStyle = getStatusPillStyle(status, customColors);
  return pillStyle.backgroundColor;
}
