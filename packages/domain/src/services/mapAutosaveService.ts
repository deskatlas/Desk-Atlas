export const AUTOSAVE_DEBOUNCE_MS = 2500;
export const NAVIGATION_WARNING_MESSAGE = 'You have unsaved changes. Leave without saving?';

export type MapSaveIndicatorState =
  | 'Saved'
  | 'Saving...'
  | 'Unsaved changes'
  | 'Save failed'
  | 'Draft loaded'
  | 'Published map loaded';

/**
 * Normalizes and strips ephemeral UI state from a canvas object to ensure stable snapshot comparisons.
 */
export function normalizeMapElementForSnapshot(element: Record<string, any>): Record<string, any> {
  return {
    id: String(element.id || ''),
    name: element.name ? String(element.name).trim() : null,
    x: Math.round(Number(element.x) || 0),
    y: Math.round(Number(element.y) || 0),
    w: Math.round(Number(element.w) || 0),
    h: Math.round(Number(element.h) || 0),
    rotation: (((Number(element.rotation) || 0) % 360) + 360) % 360,
    bookable: Boolean(element.bookable),
    template: element.template ? String(element.template).trim() : null,
    status: element.status ? String(element.status).trim() : null,
    workspaceInstanceId: element.workspaceInstanceId ? String(element.workspaceInstanceId) : null,
    elementRole: element.elementRole ? String(element.elementRole) : 'STRUCTURE',
    elementType: element.elementType ? String(element.elementType) : 'generic',
    color: element.color ? String(element.color).toLowerCase() : null,
  };
}

/**
 * Serializes an array of builder objects into a deterministic JSON string sorted by element id.
 */
export function serializeMapElementsForSnapshot(elements: Array<Record<string, any>>): string {
  if (!Array.isArray(elements)) return '[]';

  const normalized = elements.map(normalizeMapElementForSnapshot);
  normalized.sort((a, b) => a.id.localeCompare(b.id));

  return JSON.stringify(normalized);
}

/**
 * Compares current canvas elements against the last saved or loaded snapshot.
 * Returns false if no snapshot exists yet (e.g. before initial load completes).
 */
export function isMapDraftDirty(
  savedSnapshot: string | null | undefined,
  currentElements: Array<Record<string, any>>
): boolean {
  if (savedSnapshot === null || savedSnapshot === undefined) {
    return false;
  }
  const currentSerialized = serializeMapElementsForSnapshot(currentElements);
  return currentSerialized !== savedSnapshot;
}

export interface AutosaveDebouncer {
  schedule: () => void;
  cancel: () => void;
  flush: () => Promise<void>;
  isPending: () => boolean;
}

/**
 * Creates an autosave debouncer that executes the given async callback after inactivity.
 */
export function createAutosaveDebouncer(
  saveFn: () => Promise<void> | void,
  debounceMs: number = AUTOSAVE_DEBOUNCE_MS
): AutosaveDebouncer {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cancel = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const schedule = () => {
    cancel();
    timer = setTimeout(async () => {
      timer = null;
      try {
        await saveFn();
      } catch {
        // Errors are caught and reported by the saveFn implementation
      }
    }, debounceMs);
  };

  const flush = async () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
      await saveFn();
    }
  };

  const isPending = () => timer !== null;

  return {
    schedule,
    cancel,
    flush,
    isPending,
  };
}
