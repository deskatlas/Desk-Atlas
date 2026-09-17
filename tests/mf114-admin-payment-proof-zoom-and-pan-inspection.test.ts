import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  clampProofZoom,
  clampProofPanOffset,
  computeProofStepZoom,
  computeProofZoomWheel,
  computeProofDoubleClickedZoom,
  resetProofView,
  MIN_PROOF_ZOOM,
  MAX_PROOF_ZOOM,
  DEFAULT_PROOF_ZOOM,
  DOUBLE_CLICK_MAGNIFICATION,
} from '@deskatlas/domain';

describe('MF-114: Admin Portal Payment Proof Interactive Zoom and Pan Inspection', () => {
  const container = { width: 400, height: 280 };

  describe('Zoom Level Clamping & Defaults', () => {
    it('defaults to 1.0 (100%) zoom scale', () => {
      assert.equal(DEFAULT_PROOF_ZOOM, 1.0);
      assert.equal(MIN_PROOF_ZOOM, 0.5);
      assert.equal(MAX_PROOF_ZOOM, 5.0);
      assert.equal(DOUBLE_CLICK_MAGNIFICATION, 2.5);
    });

    it('clamps zoom within [0.5, 5.0]', () => {
      assert.equal(clampProofZoom(0.1), 0.5);
      assert.equal(clampProofZoom(0.5), 0.5);
      assert.equal(clampProofZoom(1.0), 1.0);
      assert.equal(clampProofZoom(2.5), 2.5);
      assert.equal(clampProofZoom(5.0), 5.0);
      assert.equal(clampProofZoom(6.5), 5.0);
    });

    it('handles NaN and non-finite zoom values gracefully by falling back to 1.0', () => {
      assert.equal(clampProofZoom(NaN), 1.0);
      assert.equal(clampProofZoom(Infinity), 1.0);
      assert.equal(clampProofZoom(-Infinity), 1.0);
    });

    it('rounds zoom levels to 2 decimal places', () => {
      assert.equal(clampProofZoom(1.3333333), 1.33);
      assert.equal(clampProofZoom(2.6666666), 2.67);
    });
  });

  describe('Step Zooming (Zoom In / Zoom Out Toolbar Buttons)', () => {
    it('increases zoom step by step and clamps at maximum 5.0 (500%)', () => {
      let state = { scale: 1.0, offset: { x: 0, y: 0 } };

      state = computeProofStepZoom(state, 'in', 0.25, container);
      assert.equal(state.scale, 1.25);

      state = computeProofStepZoom(state, 'in', 0.25, container);
      assert.equal(state.scale, 1.5);

      // Scale near maximum
      state = { scale: 4.9, offset: { x: 0, y: 0 } };
      state = computeProofStepZoom(state, 'in', 0.25, container);
      assert.equal(state.scale, 5.0);

      // Attempting to zoom beyond max stays at 5.0
      state = computeProofStepZoom(state, 'in', 0.25, container);
      assert.equal(state.scale, 5.0);
    });

    it('decreases zoom step by step and clamps at minimum 0.5 (50%)', () => {
      let state = { scale: 1.0, offset: { x: 0, y: 0 } };

      state = computeProofStepZoom(state, 'out', 0.25, container);
      assert.equal(state.scale, 0.75);

      state = computeProofStepZoom(state, 'out', 0.25, container);
      assert.equal(state.scale, 0.5);

      // Attempting to zoom below min stays at 0.5
      state = computeProofStepZoom(state, 'out', 0.25, container);
      assert.equal(state.scale, 0.5);
    });

    it('resets pan offset to (0, 0) when zooming back to 1.0', () => {
      const state = { scale: 1.25, offset: { x: 50, y: 30 } };
      const next = computeProofStepZoom(state, 'out', 0.25, container);
      assert.equal(next.scale, 1.0);
      assert.deepEqual(next.offset, { x: 0, y: 0 });
    });
  });

  describe('Pan Bounds Clamping', () => {
    it('locks offset to bounds when scale is 1.0 or below', () => {
      const clampedAt1 = clampProofPanOffset({ x: 500, y: 500 }, 1.0, container, 40);
      assert.equal(clampedAt1.x, 40);
      assert.equal(clampedAt1.y, 40);

      const clampedNegAt1 = clampProofPanOffset({ x: -500, y: -500 }, 1.0, container, 40);
      assert.equal(clampedNegAt1.x, -40);
      assert.equal(clampedNegAt1.y, -40);
    });

    it('allows proportional panning when scale > 1.0', () => {
      // At scale 2.0 on 400x280 container with 40px margin:
      // maxBoundX = (400 * 1.0) / 2 + 40 = 240
      // maxBoundY = (280 * 1.0) / 2 + 40 = 180
      const validOffset = clampProofPanOffset({ x: 150, y: 100 }, 2.0, container, 40);
      assert.equal(validOffset.x, 150);
      assert.equal(validOffset.y, 100);

      const excessOffset = clampProofPanOffset({ x: 999, y: 999 }, 2.0, container, 40);
      assert.equal(excessOffset.x, 240);
      assert.equal(excessOffset.y, 180);

      const excessNegOffset = clampProofPanOffset({ x: -999, y: -999 }, 2.0, container, 40);
      assert.equal(excessNegOffset.x, -240);
      assert.equal(excessNegOffset.y, -180);
    });
  });

  describe('Mouse Wheel Zooming (Cursor Centered)', () => {
    it('zooms in when mouse wheel scrolls up (negative deltaY)', () => {
      const current = { scale: 1.0, offset: { x: 0, y: 0 } };
      const pointerPos = { x: 200, y: 140 }; // center
      const next = computeProofZoomWheel(current, -100, pointerPos, container);

      assert.equal(next.scale, 1.15);
      assert.equal(next.offset.x, 0);
      assert.equal(next.offset.y, 0);
    });

    it('zooms out when mouse wheel scrolls down (positive deltaY)', () => {
      const current = { scale: 2.0, offset: { x: 0, y: 0 } };
      const pointerPos = { x: 200, y: 140 };
      const next = computeProofZoomWheel(current, 100, pointerPos, container);

      assert.equal(next.scale, 1.85);
    });

    it('adjusts offset to zoom into non-center pointer position', () => {
      const current = { scale: 1.0, offset: { x: 0, y: 0 } };
      // Pointer in top-left quadrant (x=100, y=70; relX = -100, relY = -70)
      const pointerPos = { x: 100, y: 70 };
      const next = computeProofZoomWheel(current, -100, pointerPos, container);

      assert.equal(next.scale, 1.15);
      // As zoom expands towards top-left, offset shifts positively to pull top-left towards center
      assert.ok(next.offset.x !== 0);
      assert.ok(next.offset.y !== 0);
    });

    it('returns exact same transform if zoom is already at boundary', () => {
      const atMax = { scale: 5.0, offset: { x: 10, y: 10 } };
      const next = computeProofZoomWheel(atMax, -100, { x: 200, y: 140 }, container);
      assert.deepEqual(next, atMax);
    });
  });

  describe('Double-Click Quick Magnification Toggle', () => {
    it('toggles from 1.0x to 2.5x magnification', () => {
      const next = computeProofDoubleClickedZoom(1.0, { x: 200, y: 140 }, container);
      assert.equal(next.scale, 2.5);
    });

    it('toggles from 2.5x back to 1.0x and resets offset to (0, 0)', () => {
      const next = computeProofDoubleClickedZoom(2.5, { x: 200, y: 140 }, container);
      assert.equal(next.scale, 1.0);
      assert.deepEqual(next.offset, { x: 0, y: 0 });
    });

    it('shifts viewport towards clicked coordinate when magnifying', () => {
      const pointerPos = { x: 300, y: 210 }; // bottom-right quadrant
      const next = computeProofDoubleClickedZoom(1.0, pointerPos, container);
      assert.equal(next.scale, 2.5);
      // Offset should be negative to shift bottom-right towards center
      assert.ok(next.offset.x < 0);
      assert.ok(next.offset.y < 0);
    });
  });

  describe('Reset Proof View', () => {
    it('resets scale to 1.0 and offset to (0, 0)', () => {
      const reset = resetProofView();
      assert.deepEqual(reset, {
        scale: 1.0,
        offset: { x: 0, y: 0 },
      });
    });
  });
});
