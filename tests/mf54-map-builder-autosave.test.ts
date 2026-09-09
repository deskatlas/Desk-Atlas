import assert from 'node:assert/strict';
import { describe, it, vi, beforeEach, afterEach, expect } from 'vitest';
import {
  serializeMapElementsForSnapshot,
  isMapDraftDirty,
  createAutosaveDebouncer,
  AUTOSAVE_DEBOUNCE_MS,
  NAVIGATION_WARNING_MESSAGE,
} from '@deskatlas/domain';

describe('MF-54: Map Builder Autosave and Navigation Warning', () => {
  const sampleElements = [
    {
      id: 'desk-1',
      name: 'Desk 1',
      x: 100,
      y: 200,
      w: 80,
      h: 80,
      rotation: 0,
      bookable: true,
      template: 'Standard Desk',
      status: 'ACTIVE',
      workspaceInstanceId: 'inst-1',
      elementRole: 'WORKSPACE',
      elementType: 'desk',
      color: '#009689',
    },
    {
      id: 'wall-1',
      name: 'Wall 1',
      x: 300,
      y: 200,
      w: 160,
      h: 20,
      rotation: 90,
      bookable: false,
      template: null,
      status: null,
      workspaceInstanceId: null,
      elementRole: 'STRUCTURE',
      elementType: 'wall',
      color: '#94a3b8',
    },
  ];

  describe('1. Canonical Snapshot Serialization', () => {
    it('produces identical serialized snapshots regardless of element insertion order', () => {
      const orderA = [sampleElements[0], sampleElements[1]];
      const orderB = [sampleElements[1], sampleElements[0]];

      const snapshotA = serializeMapElementsForSnapshot(orderA);
      const snapshotB = serializeMapElementsForSnapshot(orderB);

      assert.equal(snapshotA, snapshotB);
    });

    it('rounds coordinates to eliminate floating-point jitter from zoom scaling', () => {
      const elementsWithFloat = [
        { ...sampleElements[0], x: 100.0001, y: 199.999 },
        { ...sampleElements[1] },
      ];

      const snapshotBase = serializeMapElementsForSnapshot(sampleElements);
      const snapshotFloat = serializeMapElementsForSnapshot(elementsWithFloat);

      assert.equal(snapshotFloat, snapshotBase);
    });
  });

  describe('2. Dirty-State Tracking', () => {
    it('returns false when snapshot is null or undefined (initial loading state)', () => {
      assert.equal(isMapDraftDirty(null, sampleElements), false);
      assert.equal(isMapDraftDirty(undefined, sampleElements), false);
    });

    it('returns false when current elements match the snapshot', () => {
      const snapshot = serializeMapElementsForSnapshot(sampleElements);
      assert.equal(isMapDraftDirty(snapshot, sampleElements), false);
    });

    it('detects position changes (moving an element)', () => {
      const snapshot = serializeMapElementsForSnapshot(sampleElements);
      const moved = [
        { ...sampleElements[0], x: 140 },
        sampleElements[1],
      ];

      assert.equal(isMapDraftDirty(snapshot, moved), true);
    });

    it('detects dimension changes (resizing an element)', () => {
      const snapshot = serializeMapElementsForSnapshot(sampleElements);
      const resized = [
        sampleElements[0],
        { ...sampleElements[1], w: 200 },
      ];

      assert.equal(isMapDraftDirty(snapshot, resized), true);
    });

    it('detects rotation changes', () => {
      const snapshot = serializeMapElementsForSnapshot(sampleElements);
      const rotated = [
        { ...sampleElements[0], rotation: 90 },
        sampleElements[1],
      ];

      assert.equal(isMapDraftDirty(snapshot, rotated), true);
    });

    it('detects property and label changes (renaming, color, operational status)', () => {
      const snapshot = serializeMapElementsForSnapshot(sampleElements);
      const renamed = [
        { ...sampleElements[0], name: 'Desk 1 Renovated' },
        sampleElements[1],
      ];
      const recolored = [
        { ...sampleElements[0], color: '#ff0000' },
        sampleElements[1],
      ];
      const statusChanged = [
        { ...sampleElements[0], status: 'MAINTENANCE' },
        sampleElements[1],
      ];

      assert.equal(isMapDraftDirty(snapshot, renamed), true);
      assert.equal(isMapDraftDirty(snapshot, recolored), true);
      assert.equal(isMapDraftDirty(snapshot, statusChanged), true);
    });

    it('detects element additions and deletions', () => {
      const snapshot = serializeMapElementsForSnapshot(sampleElements);
      const added = [
        ...sampleElements,
        {
          id: 'kiosk-1',
          name: 'You Are Here',
          x: 50,
          y: 50,
          w: 80,
          h: 80,
          rotation: 0,
          bookable: false,
          template: null,
          status: null,
          workspaceInstanceId: null,
          elementRole: 'INFORMATION',
          elementType: 'KIOSK_YOU_ARE_HERE',
          color: '#dc2626',
        },
      ];
      const deleted = [sampleElements[0]];

      assert.equal(isMapDraftDirty(snapshot, added), true);
      assert.equal(isMapDraftDirty(snapshot, deleted), true);
    });

    it('clears dirty state if changes are reverted back to the snapshot values', () => {
      const snapshot = serializeMapElementsForSnapshot(sampleElements);
      const moved = [{ ...sampleElements[0], x: 500 }, sampleElements[1]];
      assert.equal(isMapDraftDirty(snapshot, moved), true);

      // Revert back
      const reverted = [{ ...sampleElements[0], x: 100 }, sampleElements[1]];
      assert.equal(isMapDraftDirty(snapshot, reverted), false);
    });
  });

  describe('3. Autosave Debouncer and Timing', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('defaults to 2500ms debounce interval', () => {
      assert.equal(AUTOSAVE_DEBOUNCE_MS, 2500);
    });

    it('triggers save callback only after debounce delay expires', async () => {
      const saveSpy = vi.fn().mockResolvedValue(undefined);
      const debouncer = createAutosaveDebouncer(saveSpy, 2500);

      assert.equal(debouncer.isPending(), false);
      debouncer.schedule();
      assert.equal(debouncer.isPending(), true);
      expect(saveSpy).toHaveBeenCalledTimes(0);

      // Fast forward 1500ms (inactivity not yet reached)
      vi.advanceTimersByTime(1500);
      expect(saveSpy).toHaveBeenCalledTimes(0);
      assert.equal(debouncer.isPending(), true);

      // Fast forward remaining 1000ms
      vi.advanceTimersByTime(1000);
      expect(saveSpy).toHaveBeenCalledTimes(1);
      assert.equal(debouncer.isPending(), false);
    });

    it('resets debounce timer on rapid successive actions (debounces correctly)', async () => {
      const saveSpy = vi.fn().mockResolvedValue(undefined);
      const debouncer = createAutosaveDebouncer(saveSpy, 2000);

      debouncer.schedule();
      vi.advanceTimersByTime(1000); // 1.0s elapsed
      debouncer.schedule(); // Action 2 resets timer
      vi.advanceTimersByTime(1000); // 1.0s elapsed since action 2 (2s total)
      expect(saveSpy).toHaveBeenCalledTimes(0);

      debouncer.schedule(); // Action 3 resets timer
      vi.advanceTimersByTime(2000); // Full 2.0s elapsed since action 3
      expect(saveSpy).toHaveBeenCalledTimes(1);
    });

    it('cancels pending autosave when cancel() is called', () => {
      const saveSpy = vi.fn();
      const debouncer = createAutosaveDebouncer(saveSpy, 2000);

      debouncer.schedule();
      assert.equal(debouncer.isPending(), true);

      debouncer.cancel();
      assert.equal(debouncer.isPending(), false);

      vi.advanceTimersByTime(3000);
      expect(saveSpy).toHaveBeenCalledTimes(0);
    });

    it('immediately executes pending save on flush() and cancels timer', async () => {
      const saveSpy = vi.fn().mockResolvedValue(undefined);
      const debouncer = createAutosaveDebouncer(saveSpy, 2000);

      debouncer.schedule();
      assert.equal(debouncer.isPending(), true);

      await debouncer.flush();
      expect(saveSpy).toHaveBeenCalledTimes(1);
      assert.equal(debouncer.isPending(), false);

      // Timer should not fire again later
      vi.advanceTimersByTime(3000);
      expect(saveSpy).toHaveBeenCalledTimes(1);
    });

    it('handles save function errors without throwing unhandled exceptions', async () => {
      const saveSpy = vi.fn().mockRejectedValue(new Error('Network error'));
      const debouncer = createAutosaveDebouncer(saveSpy, 1000);

      debouncer.schedule();
      // Should not throw unhandled rejection
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
      expect(saveSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('4. Save Flow and Snapshot Refresh', () => {
    it('clears dirty state when snapshot is updated to match new canvas state', () => {
      let snapshot = serializeMapElementsForSnapshot(sampleElements);
      let elements = [...sampleElements];

      // Mutate
      elements = [{ ...elements[0], x: 450 }, elements[1]];
      assert.equal(isMapDraftDirty(snapshot, elements), true);

      // Successful save updates snapshot
      snapshot = serializeMapElementsForSnapshot(elements);
      assert.equal(isMapDraftDirty(snapshot, elements), false);
    });
  });

  describe('5. Navigation Warning Constants and Rules', () => {
    it('uses the required prompt text for unsaved changes', () => {
      assert.equal(NAVIGATION_WARNING_MESSAGE, 'You have unsaved changes. Leave without saving?');
    });

    it('beforeunload event contract conforms to browser navigation guard specs', () => {
      const mockEvent = {
        preventDefault: vi.fn(),
        returnValue: '',
      };

      const handleBeforeUnload = (e: typeof mockEvent, isDirty: boolean) => {
        if (!isDirty) return;
        e.preventDefault();
        e.returnValue = NAVIGATION_WARNING_MESSAGE;
        return NAVIGATION_WARNING_MESSAGE;
      };

      // Clean state -> does not block
      const resultClean = handleBeforeUnload(mockEvent, false);
      assert.equal(resultClean, undefined);
      expect(mockEvent.preventDefault).toHaveBeenCalledTimes(0);

      // Dirty state -> blocks with standard message
      const resultDirty = handleBeforeUnload(mockEvent, true);
      assert.equal(resultDirty, NAVIGATION_WARNING_MESSAGE);
      assert.equal(mockEvent.returnValue, NAVIGATION_WARNING_MESSAGE);
      expect(mockEvent.preventDefault).toHaveBeenCalledTimes(1);
    });
  });
});
