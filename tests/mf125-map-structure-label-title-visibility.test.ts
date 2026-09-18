import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'vitest';

describe('MF-125: Map Structure Label Title Visibility on All Floor Maps', () => {
  function getContrastColor(hexColor?: string): string {
    if (!hexColor || !hexColor.startsWith('#') || hexColor.length < 7) return '#111827';
    const r = parseInt(hexColor.slice(1, 3), 16);
    const g = parseInt(hexColor.slice(3, 5), 16);
    const b = parseInt(hexColor.slice(5, 7), 16);
    const yiq = (r * 299 + g * 587 + b * 114) / 1000;
    return yiq >= 150 ? '#111827' : '#ffffff';
  }

  function formatStructureLabel(raw?: string | null): string {
    if (!raw || !raw.trim()) return 'Structure';
    const cleaned = raw.replace(/[_-]+/g, ' ').trim();
    if (!cleaned) return 'Structure';
    return cleaned
      .split(' ')
      .filter(Boolean)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  describe('Structure Name Formatting & Fallbacks', () => {
    it('formats raw snake_case and kebab-case structure types cleanly', () => {
      assert.equal(formatStructureLabel('wall'), 'Wall');
      assert.equal(formatStructureLabel('thin_wall'), 'Thin Wall');
      assert.equal(formatStructureLabel('glass_partition'), 'Glass Partition');
      assert.equal(formatStructureLabel('doorway-main'), 'Doorway Main');
      assert.equal(formatStructureLabel('structural_pillar'), 'Structural Pillar');
    });

    it('handles uppercase and mixed case strings gracefully', () => {
      assert.equal(formatStructureLabel('WALL'), 'Wall');
      assert.equal(formatStructureLabel('THIN_WALL'), 'Thin Wall');
      assert.equal(formatStructureLabel('Glass Partition'), 'Glass Partition');
    });

    it('falls back to "Structure" if label/type is null, undefined, or empty', () => {
      assert.equal(formatStructureLabel(null), 'Structure');
      assert.equal(formatStructureLabel(undefined), 'Structure');
      assert.equal(formatStructureLabel(''), 'Structure');
      assert.equal(formatStructureLabel('   '), 'Structure');
    });
  });

  describe('Contrast Text Color Computation', () => {
    it('returns #ffffff for dark wall fills (#334155, #1E293B, #000000)', () => {
      assert.equal(getContrastColor('#334155'), '#ffffff');
      assert.equal(getContrastColor('#1E293B'), '#ffffff');
      assert.equal(getContrastColor('#000000'), '#ffffff');
    });

    it('returns #111827 for light background fills (#FFFFFF, #F3F7F4, #E0F2FE)', () => {
      assert.equal(getContrastColor('#FFFFFF'), '#111827');
      assert.equal(getContrastColor('#F3F7F4'), '#111827');
      assert.equal(getContrastColor('#E0F2FE'), '#111827');
    });

    it('returns dark text fallback for rgba or non-hex colors (e.g. glass partitions)', () => {
      assert.equal(getContrastColor('rgba(59, 130, 246, 0.15)'), '#111827');
      assert.equal(getContrastColor(undefined), '#111827');
    });
  });

  describe('Structure Geometry & Styling Rules', () => {
    it('applies compact 9px uppercase typography for thin structures (height <= 20px)', () => {
      const isThin = (height: number) => height <= 20;
      assert.equal(isThin(10), true);
      assert.equal(isThin(20), true);
      assert.equal(isThin(80), false);

      const getStyle = (height: number) => ({
        fontSize: height <= 20 ? '9px' : '11px',
        fontWeight: height <= 20 ? 800 : 700,
        letterSpacing: height <= 20 ? '0.05em' : 'normal',
        textTransform: height <= 20 ? 'uppercase' : 'none',
      });

      const thinStyle = getStyle(10);
      assert.equal(thinStyle.fontSize, '9px');
      assert.equal(thinStyle.fontWeight, 800);
      assert.equal(thinStyle.letterSpacing, '0.05em');
      assert.equal(thinStyle.textTransform, 'uppercase');

      const regularStyle = getStyle(80);
      assert.equal(regularStyle.fontSize, '11px');
      assert.equal(regularStyle.fontWeight, 700);
      assert.equal(regularStyle.letterSpacing, 'normal');
      assert.equal(regularStyle.textTransform, 'none');
    });
  });

  describe('Cross-Portal Implementation Parity Verification', () => {
    const rootDir = path.resolve(__dirname, '..');

    it('Admin MapBuilder (MapEditor.tsx) renders structure titles and formatStructureLabel', () => {
      const content = fs.readFileSync(
        path.join(rootDir, 'apps/admin-portal/src/features/map-builder/components/MapEditor.tsx'),
        'utf-8'
      );
      assert.ok(content.includes('function formatStructureLabel'), 'MapEditor should define formatStructureLabel');
      assert.ok(content.includes('formatStructureLabel(obj.elementType)'), 'MapEditor should format structure elementType when name is missing');
      assert.ok(content.includes('textOverflow: \'ellipsis\''), 'MapEditor should apply ellipsis to prevent overflow');
    });

    it('Admin Published Map (manage/workspace-map/page.tsx) renders structure titles', () => {
      const content = fs.readFileSync(
        path.join(rootDir, 'apps/admin-portal/src/app/manage/workspace-map/page.tsx'),
        'utf-8'
      );
      assert.ok(content.includes('function formatStructureLabel'), 'Admin workspace map should define formatStructureLabel');
      assert.ok(content.includes('formatStructureLabel(el.elementType)'), 'Admin workspace map should format structure label');
      assert.ok(content.includes('textOverflow: \'ellipsis\''), 'Admin workspace map should apply ellipsis');
    });

    it('Staff Published Map (manage/workspace-map/page.tsx) renders structure titles', () => {
      const content = fs.readFileSync(
        path.join(rootDir, 'apps/staff-dashboard/src/app/manage/workspace-map/page.tsx'),
        'utf-8'
      );
      assert.ok(content.includes('function formatStructureLabel'), 'Staff workspace map should define formatStructureLabel');
      assert.ok(content.includes('formatStructureLabel(el.elementType)'), 'Staff workspace map should format structure label');
      assert.ok(content.includes('textOverflow: \'ellipsis\''), 'Staff workspace map should apply ellipsis');
    });

    it('Customer Reservation Map (ReservationPage.tsx) renders structure titles', () => {
      const content = fs.readFileSync(
        path.join(rootDir, 'apps/customer-website/src/features/reservation/components/ReservationPage.tsx'),
        'utf-8'
      );
      assert.ok(content.includes('function formatStructureLabel'), 'Customer ReservationPage should define formatStructureLabel');
      assert.ok(content.includes('formatStructureLabel(el.elementType)'), 'Customer ReservationPage should format structure label');
      assert.ok(content.includes('textOverflow: "ellipsis"'), 'Customer ReservationPage should apply ellipsis');
    });

    it('Kiosk Reserve Map (kiosk/reserve/page.tsx) renders structure titles', () => {
      const content = fs.readFileSync(
        path.join(rootDir, 'apps/kiosk/src/app/kiosk/reserve/page.tsx'),
        'utf-8'
      );
      assert.ok(content.includes('function formatStructureLabel'), 'Kiosk reserve page should define formatStructureLabel');
      assert.ok(content.includes('formatStructureLabel(el.elementType)'), 'Kiosk reserve page should format structure label');
      assert.ok(content.includes('textOverflow: "ellipsis"'), 'Kiosk reserve page should apply ellipsis');
    });
  });
});
