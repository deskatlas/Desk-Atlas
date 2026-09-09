import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  MapUndoRedoManager,
  applyMapCommand,
  type MapBuilderObject,
  type MapCommand,
} from '@deskatlas/domain';

describe('MF-53: Map Builder Undo/Redo Engine', () => {
  const sampleObj1: MapBuilderObject = {
    id: 'el-1',
    name: 'Desk 1',
    x: 100,
    y: 100,
    w: 80,
    h: 80,
    rotation: 0,
    bookable: true,
    template: 'Desk',
    status: 'ACTIVE',
    workspaceInstanceId: 'inst-1',
    elementRole: 'WORKSPACE',
    elementType: 'desk',
    color: '#009689',
  };

  const sampleObj2: MapBuilderObject = {
    id: 'el-2',
    name: 'Wall 1',
    x: 200,
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
    color: '#F3F7F4',
  };

  it('correctly handles ADD_OBJECT command undo and redo', () => {
    const manager = new MapUndoRedoManager(50);
    const floorId = 'floor-1';
    let currentObjects: MapBuilderObject[] = [];

    // User adds sampleObj1
    currentObjects = [sampleObj1];
    manager.push(floorId, {
      type: 'ADD_OBJECT',
      object: sampleObj1,
    });

    assert.equal(manager.canUndo(floorId), true);
    assert.equal(manager.canRedo(floorId), false);

    // Undo -> object should be removed
    const undoRes = manager.undo(floorId, currentObjects);
    currentObjects = undoRes.updatedObjects;
    assert.equal(currentObjects.length, 0);
    assert.equal(undoRes.canUndo, false);
    assert.equal(undoRes.canRedo, true);

    // Redo -> object should be restored
    const redoRes = manager.redo(floorId, currentObjects);
    currentObjects = redoRes.updatedObjects;
    assert.equal(currentObjects.length, 1);
    assert.equal(currentObjects[0].id, 'el-1');
    assert.equal(redoRes.canUndo, true);
    assert.equal(redoRes.canRedo, false);
  });

  it('correctly handles REMOVE_OBJECT command with index restoration', () => {
    const manager = new MapUndoRedoManager(50);
    const floorId = 'floor-1';
    let currentObjects = [sampleObj1, sampleObj2];

    // Remove sampleObj1 (at index 0)
    currentObjects = [sampleObj2];
    manager.push(floorId, {
      type: 'REMOVE_OBJECT',
      object: sampleObj1,
      index: 0,
    });

    assert.equal(manager.canUndo(floorId), true);

    // Undo -> sampleObj1 should be restored at index 0
    const undoRes = manager.undo(floorId, currentObjects);
    currentObjects = undoRes.updatedObjects;
    assert.equal(currentObjects.length, 2);
    assert.equal(currentObjects[0].id, 'el-1');
    assert.equal(currentObjects[1].id, 'el-2');

    // Redo -> sampleObj1 removed again
    const redoRes = manager.redo(floorId, currentObjects);
    currentObjects = redoRes.updatedObjects;
    assert.equal(currentObjects.length, 1);
    assert.equal(currentObjects[0].id, 'el-2');
  });

  it('correctly handles MOVE_OBJECT command undo and redo', () => {
    const manager = new MapUndoRedoManager(50);
    const floorId = 'floor-1';
    let currentObjects = [{ ...sampleObj1, x: 300, y: 350 }];

    manager.push(floorId, {
      type: 'MOVE_OBJECT',
      id: 'el-1',
      before: { x: 100, y: 100 },
      after: { x: 300, y: 350 },
    });

    // Undo move
    const undoRes = manager.undo(floorId, currentObjects);
    currentObjects = undoRes.updatedObjects;
    assert.equal(currentObjects[0].x, 100);
    assert.equal(currentObjects[0].y, 100);

    // Redo move
    const redoRes = manager.redo(floorId, currentObjects);
    currentObjects = redoRes.updatedObjects;
    assert.equal(currentObjects[0].x, 300);
    assert.equal(currentObjects[0].y, 350);
  });

  it('correctly handles RESIZE_OBJECT command undo and redo', () => {
    const manager = new MapUndoRedoManager(50);
    const floorId = 'floor-1';
    let currentObjects = [{ ...sampleObj1, w: 160, h: 120, x: 100, y: 100 }];

    manager.push(floorId, {
      type: 'RESIZE_OBJECT',
      id: 'el-1',
      before: { w: 80, h: 80, x: 100, y: 100 },
      after: { w: 160, h: 120, x: 100, y: 100 },
    });

    // Undo resize
    const undoRes = manager.undo(floorId, currentObjects);
    currentObjects = undoRes.updatedObjects;
    assert.equal(currentObjects[0].w, 80);
    assert.equal(currentObjects[0].h, 80);

    // Redo resize
    const redoRes = manager.redo(floorId, currentObjects);
    currentObjects = redoRes.updatedObjects;
    assert.equal(currentObjects[0].w, 160);
    assert.equal(currentObjects[0].h, 120);
  });

  it('correctly handles ROTATE_OBJECT command undo and redo', () => {
    const manager = new MapUndoRedoManager(50);
    const floorId = 'floor-1';
    let currentObjects = [{ ...sampleObj1, rotation: 90 }];

    manager.push(floorId, {
      type: 'ROTATE_OBJECT',
      id: 'el-1',
      before: 0,
      after: 90,
    });

    // Undo rotate
    const undoRes = manager.undo(floorId, currentObjects);
    currentObjects = undoRes.updatedObjects;
    assert.equal(currentObjects[0].rotation, 0);

    // Redo rotate
    const redoRes = manager.redo(floorId, currentObjects);
    currentObjects = redoRes.updatedObjects;
    assert.equal(currentObjects[0].rotation, 90);
  });

  it('correctly handles UPDATE_PROPERTIES command undo and redo', () => {
    const manager = new MapUndoRedoManager(50);
    const floorId = 'floor-1';
    let currentObjects = [{ ...sampleObj1, color: '#DC2626', name: 'Renamed Desk', status: 'MAINTENANCE' }];

    manager.push(floorId, {
      type: 'UPDATE_PROPERTIES',
      id: 'el-1',
      before: { color: '#009689', name: 'Desk 1', status: 'ACTIVE' },
      after: { color: '#DC2626', name: 'Renamed Desk', status: 'MAINTENANCE' },
    });

    // Undo properties
    const undoRes = manager.undo(floorId, currentObjects);
    currentObjects = undoRes.updatedObjects;
    assert.equal(currentObjects[0].color, '#009689');
    assert.equal(currentObjects[0].name, 'Desk 1');
    assert.equal(currentObjects[0].status, 'ACTIVE');

    // Redo properties
    const redoRes = manager.redo(floorId, currentObjects);
    currentObjects = redoRes.updatedObjects;
    assert.equal(currentObjects[0].color, '#DC2626');
    assert.equal(currentObjects[0].name, 'Renamed Desk');
    assert.equal(currentObjects[0].status, 'MAINTENANCE');
  });

  it('correctly handles BATCH command undo (in reverse) and redo (in order)', () => {
    const manager = new MapUndoRedoManager(50);
    const floorId = 'floor-1';

    let currentObjects = [
      { ...sampleObj1, color: '#AABBCC' },
      { ...sampleObj2, color: '#AABBCC' },
    ];

    const batchCommand: MapCommand = {
      type: 'BATCH',
      commands: [
        {
          type: 'UPDATE_PROPERTIES',
          id: 'el-1',
          before: { color: '#009689' },
          after: { color: '#AABBCC' },
        },
        {
          type: 'UPDATE_PROPERTIES',
          id: 'el-2',
          before: { color: '#F3F7F4' },
          after: { color: '#AABBCC' },
        },
      ],
    };

    manager.push(floorId, batchCommand);

    // Undo batch
    const undoRes = manager.undo(floorId, currentObjects);
    currentObjects = undoRes.updatedObjects;
    assert.equal(currentObjects[0].color, '#009689');
    assert.equal(currentObjects[1].color, '#F3F7F4');

    // Redo batch
    const redoRes = manager.redo(floorId, currentObjects);
    currentObjects = redoRes.updatedObjects;
    assert.equal(currentObjects[0].color, '#AABBCC');
    assert.equal(currentObjects[1].color, '#AABBCC');
  });

  it('enforces maximum stack depth by dropping the oldest command', () => {
    const maxDepth = 5;
    const manager = new MapUndoRedoManager(maxDepth);
    const floorId = 'floor-1';

    for (let i = 1; i <= 8; i++) {
      manager.push(floorId, {
        type: 'MOVE_OBJECT',
        id: 'el-1',
        before: { x: (i - 1) * 10, y: 0 },
        after: { x: i * 10, y: 0 },
      });
    }

    const sizes = manager.getStackSizes(floorId);
    assert.equal(sizes.undoCount, maxDepth); // should be capped at 5

    let objects = [{ ...sampleObj1, x: 80, y: 0 }];

    // Undo 5 times
    for (let i = 0; i < maxDepth; i++) {
      const res = manager.undo(floorId, objects);
      objects = res.updatedObjects;
    }

    // Since commands 1, 2, 3 were dropped, 5 undos take x back to 30 (from 80 -> 70 -> 60 -> 50 -> 40 -> 30)
    assert.equal(objects[0].x, 30);
    assert.equal(manager.canUndo(floorId), false);
  });

  it('clears redo stack when a new action is pushed after an undo', () => {
    const manager = new MapUndoRedoManager(50);
    const floorId = 'floor-1';
    let currentObjects = [sampleObj1];

    // Push 2 move commands
    manager.push(floorId, {
      type: 'MOVE_OBJECT',
      id: 'el-1',
      before: { x: 100, y: 100 },
      after: { x: 120, y: 100 },
    });
    manager.push(floorId, {
      type: 'MOVE_OBJECT',
      id: 'el-1',
      before: { x: 120, y: 100 },
      after: { x: 140, y: 100 },
    });

    // Undo 1 command -> redo stack should have 1 item
    manager.undo(floorId, currentObjects);
    assert.equal(manager.canRedo(floorId), true);
    assert.equal(manager.getStackSizes(floorId).redoCount, 1);

    // Push a new action -> redo stack must be cleared
    manager.push(floorId, {
      type: 'MOVE_OBJECT',
      id: 'el-1',
      before: { x: 120, y: 100 },
      after: { x: 200, y: 200 },
    });

    assert.equal(manager.canRedo(floorId), false);
    assert.equal(manager.getStackSizes(floorId).redoCount, 0);
  });

  it('isolates undo/redo stacks per floor', () => {
    const manager = new MapUndoRedoManager(50);
    const floorA = 'floor-a';
    const floorB = 'floor-b';

    let objectsA = [sampleObj1];
    let objectsB = [sampleObj2];

    // Action on Floor A
    manager.push(floorA, {
      type: 'MOVE_OBJECT',
      id: 'el-1',
      before: { x: 100, y: 100 },
      after: { x: 150, y: 150 },
    });

    // Action on Floor B
    manager.push(floorB, {
      type: 'ROTATE_OBJECT',
      id: 'el-2',
      before: 90,
      after: 180,
    });

    assert.equal(manager.canUndo(floorA), true);
    assert.equal(manager.canUndo(floorB), true);
    assert.equal(manager.getStackSizes(floorA).undoCount, 1);
    assert.equal(manager.getStackSizes(floorB).undoCount, 1);

    // Undo on Floor A
    const undoResA = manager.undo(floorA, [{ ...sampleObj1, x: 150, y: 150 }]);
    assert.equal(undoResA.updatedObjects[0].x, 100);
    assert.equal(manager.canUndo(floorA), false);
    assert.equal(manager.canRedo(floorA), true);

    // Floor B's stack remains unaffected
    assert.equal(manager.canUndo(floorB), true);
    assert.equal(manager.canRedo(floorB), false);
  });
});
