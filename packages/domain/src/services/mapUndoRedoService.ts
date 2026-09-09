export interface MapBuilderObject {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  bookable: boolean;
  template: string | null;
  status: string | null;
  workspaceInstanceId: string | null;
  elementRole: string;
  elementType: string;
  color: string;
  [key: string]: any;
}

export type MapCommand =
  | {
      type: 'ADD_OBJECT';
      object: MapBuilderObject;
      index?: number;
    }
  | {
      type: 'REMOVE_OBJECT';
      object: MapBuilderObject;
      index: number;
    }
  | {
      type: 'MOVE_OBJECT';
      id: string;
      before: { x: number; y: number };
      after: { x: number; y: number };
    }
  | {
      type: 'RESIZE_OBJECT';
      id: string;
      before: { w: number; h: number; x: number; y: number };
      after: { w: number; h: number; x: number; y: number };
    }
  | {
      type: 'ROTATE_OBJECT';
      id: string;
      before: number;
      after: number;
    }
  | {
      type: 'UPDATE_PROPERTIES';
      id: string;
      before: Partial<MapBuilderObject>;
      after: Partial<MapBuilderObject>;
    }
  | {
      type: 'BATCH';
      commands: MapCommand[];
    };

/**
 * Pure function to apply a command in either 'undo' or 'redo' direction.
 */
export function applyMapCommand<T extends MapBuilderObject>(
  objects: T[],
  command: MapCommand,
  direction: 'undo' | 'redo'
): T[] {
  switch (command.type) {
    case 'ADD_OBJECT': {
      if (direction === 'undo') {
        return objects.filter((o) => o.id !== command.object.id);
      } else {
        // Redo: re-add object
        if (objects.some((o) => o.id === command.object.id)) return objects;
        if (typeof command.index === 'number' && command.index >= 0 && command.index <= objects.length) {
          const copy = [...objects];
          copy.splice(command.index, 0, command.object as T);
          return copy;
        }
        return [...objects, command.object as T];
      }
    }

    case 'REMOVE_OBJECT': {
      if (direction === 'undo') {
        // Undo: restore the removed object at its prior index
        if (objects.some((o) => o.id === command.object.id)) return objects;
        const copy = [...objects];
        const idx = Math.min(Math.max(0, command.index), copy.length);
        copy.splice(idx, 0, command.object as T);
        return copy;
      } else {
        // Redo: remove the object again
        return objects.filter((o) => o.id !== command.object.id);
      }
    }

    case 'MOVE_OBJECT': {
      const target = direction === 'undo' ? command.before : command.after;
      return objects.map((o) =>
        o.id === command.id ? ({ ...o, x: target.x, y: target.y } as T) : o
      );
    }

    case 'RESIZE_OBJECT': {
      const target = direction === 'undo' ? command.before : command.after;
      return objects.map((o) =>
        o.id === command.id
          ? ({ ...o, w: target.w, h: target.h, x: target.x, y: target.y } as T)
          : o
      );
    }

    case 'ROTATE_OBJECT': {
      const targetRotation = direction === 'undo' ? command.before : command.after;
      return objects.map((o) =>
        o.id === command.id ? ({ ...o, rotation: targetRotation } as T) : o
      );
    }

    case 'UPDATE_PROPERTIES': {
      const patch = direction === 'undo' ? command.before : command.after;
      return objects.map((o) =>
        o.id === command.id ? ({ ...o, ...patch } as T) : o
      );
    }

    case 'BATCH': {
      if (direction === 'undo') {
        // Undo batch in reverse order
        let result = objects;
        for (let i = command.commands.length - 1; i >= 0; i--) {
          result = applyMapCommand(result, command.commands[i], 'undo');
        }
        return result;
      } else {
        // Redo batch in original order
        let result = objects;
        for (const subCmd of command.commands) {
          result = applyMapCommand(result, subCmd, 'redo');
        }
        return result;
      }
    }

    default:
      return objects;
  }
}

export interface FloorStack {
  undo: MapCommand[];
  redo: MapCommand[];
}

export class MapUndoRedoManager {
  private stacks: Map<string, FloorStack> = new Map();
  private maxDepth: number;

  constructor(maxDepth = 50) {
    this.maxDepth = Math.max(1, maxDepth);
  }

  private getFloorStack(floorId: string): FloorStack {
    let stack = this.stacks.get(floorId);
    if (!stack) {
      stack = { undo: [], redo: [] };
      this.stacks.set(floorId, stack);
    }
    return stack;
  }

  push(floorId: string, command: MapCommand): void {
    if (!floorId) return;
    const stack = this.getFloorStack(floorId);
    stack.undo.push(command);
    if (stack.undo.length > this.maxDepth) {
      stack.undo.shift(); // drop oldest command
    }
    stack.redo = []; // a new action clears redo stack
  }

  canUndo(floorId: string | null): boolean {
    if (!floorId) return false;
    const stack = this.stacks.get(floorId);
    return Boolean(stack && stack.undo.length > 0);
  }

  canRedo(floorId: string | null): boolean {
    if (!floorId) return false;
    const stack = this.stacks.get(floorId);
    return Boolean(stack && stack.redo.length > 0);
  }

  undo<T extends MapBuilderObject>(
    floorId: string,
    currentObjects: T[]
  ): { updatedObjects: T[]; command: MapCommand | null; canUndo: boolean; canRedo: boolean } {
    if (!floorId) {
      return { updatedObjects: currentObjects, command: null, canUndo: false, canRedo: false };
    }
    const stack = this.getFloorStack(floorId);
    if (stack.undo.length === 0) {
      return { updatedObjects: currentObjects, command: null, canUndo: false, canRedo: stack.redo.length > 0 };
    }

    const command = stack.undo.pop()!;
    stack.redo.push(command);
    const updatedObjects = applyMapCommand(currentObjects, command, 'undo');

    return {
      updatedObjects,
      command,
      canUndo: stack.undo.length > 0,
      canRedo: stack.redo.length > 0,
    };
  }

  redo<T extends MapBuilderObject>(
    floorId: string,
    currentObjects: T[]
  ): { updatedObjects: T[]; command: MapCommand | null; canUndo: boolean; canRedo: boolean } {
    if (!floorId) {
      return { updatedObjects: currentObjects, command: null, canUndo: false, canRedo: false };
    }
    const stack = this.getFloorStack(floorId);
    if (stack.redo.length === 0) {
      return { updatedObjects: currentObjects, command: null, canUndo: stack.undo.length > 0, canRedo: false };
    }

    const command = stack.redo.pop()!;
    stack.undo.push(command);
    const updatedObjects = applyMapCommand(currentObjects, command, 'redo');

    return {
      updatedObjects,
      command,
      canUndo: stack.undo.length > 0,
      canRedo: stack.redo.length > 0,
    };
  }

  getStackSizes(floorId: string): { undoCount: number; redoCount: number } {
    const stack = this.stacks.get(floorId);
    return {
      undoCount: stack?.undo.length || 0,
      redoCount: stack?.redo.length || 0,
    };
  }

  clear(floorId?: string): void {
    if (floorId) {
      this.stacks.delete(floorId);
    } else {
      this.stacks.clear();
    }
  }
}
