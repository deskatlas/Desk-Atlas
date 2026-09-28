export const MIN_MAP_ZOOM = 0.2;
export const MAX_MAP_ZOOM = 2.0;
export const DEFAULT_MAP_CANVAS_WIDTH = 1600;
export const DEFAULT_MAP_CANVAS_HEIGHT = 1000;
export const DEFAULT_MAP_GRID_SIZE = 20;

export const MIN_MAP_CANVAS_WIDTH = 1200;
export const MIN_MAP_CANVAS_HEIGHT = 800;
export const MAX_MAP_CANVAS_WIDTH = 4000;
export const MAX_MAP_CANVAS_HEIGHT = 3000;

export interface CanvasDimensionPreset {
  id: string;
  label: string;
  width: number;
  height: number;
}

export const CANVAS_SIZE_PRESETS: CanvasDimensionPreset[] = [
  { id: 'standard', label: 'Standard (1600 x 1000 px)', width: 1600, height: 1000 },
  { id: 'large', label: 'Large (2000 x 1400 px)', width: 2000, height: 1400 },
  { id: 'extra-large', label: 'Extra Large (2400 x 1600 px)', width: 2400, height: 1600 },
  { id: 'ultra-wide', label: 'Ultra-Wide (3200 x 2000 px)', width: 3200, height: 2000 },
];

/**
 * Clamps canvas dimensions within safe boundaries (1200x800 to 4000x3000).
 */
export function clampMapCanvasDimensions(
  width: number,
  height: number
): { width: number; height: number } {
  const safeW = Number.isFinite(width) && width > 0 ? Math.round(width) : DEFAULT_MAP_CANVAS_WIDTH;
  const safeH = Number.isFinite(height) && height > 0 ? Math.round(height) : DEFAULT_MAP_CANVAS_HEIGHT;
  const clampedW = Math.max(MIN_MAP_CANVAS_WIDTH, Math.min(MAX_MAP_CANVAS_WIDTH, safeW));
  const clampedH = Math.max(MIN_MAP_CANVAS_HEIGHT, Math.min(MAX_MAP_CANVAS_HEIGHT, safeH));
  return { width: clampedW, height: clampedH };
}

/**
 * Checks whether canvas dimensions reside within valid bounds.
 */
export function isCanvasDimensionValid(width: number, height: number): boolean {
  return (
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width >= MIN_MAP_CANVAS_WIDTH &&
    width <= MAX_MAP_CANVAS_WIDTH &&
    height >= MIN_MAP_CANVAS_HEIGHT &&
    height <= MAX_MAP_CANVAS_HEIGHT
  );
}

export interface MapViewportBounds {
  canvasWidth: number;
  canvasHeight: number;
  zoom: number;
  scaledWidth: number;
  scaledHeight: number;
}

/**
 * Calculates the optimal zoom scale to fit the canvas within the given container dimensions.
 * Clamps to [MIN_MAP_ZOOM, MAX_MAP_ZOOM] and returns a number rounded to 2 decimal places.
 */
export function computeFitViewZoom(
  containerWidth: number,
  containerHeight: number,
  canvasWidth: number = DEFAULT_MAP_CANVAS_WIDTH,
  canvasHeight: number = DEFAULT_MAP_CANVAS_HEIGHT,
  padding: number = 0
): number {
  if (containerWidth <= 0 || containerHeight <= 0) {
    return 1;
  }
  const availableW = Math.max(50, containerWidth - padding);
  const availableH = Math.max(50, containerHeight - padding);
  const scaleX = availableW / (canvasWidth || DEFAULT_MAP_CANVAS_WIDTH);
  const scaleY = availableH / (canvasHeight || DEFAULT_MAP_CANVAS_HEIGHT);
  const optimalZoom = Math.min(scaleX, scaleY);
  return clampMapZoom(optimalZoom);
}

/**
 * Clamps the zoom level within supported minimum and maximum limits, rounded to 2 decimal places.
 */
export function clampMapZoom(
  zoom: number,
  minZoom: number = MIN_MAP_ZOOM,
  maxZoom: number = MAX_MAP_ZOOM
): number {
  if (!Number.isFinite(zoom) || isNaN(zoom)) {
    return 1;
  }
  const clamped = Math.min(maxZoom, Math.max(minZoom, zoom));
  return Number(clamped.toFixed(2));
}

/**
 * Retrieves the saved zoom preference for a floor from browser storage.
 */
export function getSavedMapZoom(
  floorId: string | null | undefined,
  storage?: { getItem: (key: string) => string | null }
): number | null {
  if (!floorId) return null;
  try {
    const store = storage || (typeof window !== 'undefined' ? window.localStorage : undefined);
    if (!store) return null;
    const raw = store.getItem(`deskatlas_map_zoom_${floorId}`);
    if (!raw) return null;
    const parsed = parseFloat(raw);
    if (Number.isFinite(parsed) && parsed >= MIN_MAP_ZOOM && parsed <= MAX_MAP_ZOOM) {
      return clampMapZoom(parsed);
    }
  } catch {
    // Graceful fallback on storage access restrictions
  }
  return null;
}

/**
 * Persists the zoom preference for a floor into browser storage.
 */
export function saveMapZoom(
  floorId: string | null | undefined,
  zoom: number,
  storage?: { setItem: (key: string, value: string) => void }
): void {
  if (!floorId) return;
  try {
    const store = storage || (typeof window !== 'undefined' ? window.localStorage : undefined);
    if (!store) return;
    const clamped = clampMapZoom(zoom);
    store.setItem(`deskatlas_map_zoom_${floorId}`, String(clamped));
  } catch {
    // Graceful fallback
  }
}

/**
 * Computes viewport bounding dimensions for map scaling wrappers.
 */
export function getMapViewportBounds(
  canvasWidth: number = DEFAULT_MAP_CANVAS_WIDTH,
  canvasHeight: number = DEFAULT_MAP_CANVAS_HEIGHT,
  zoom: number = 1
): MapViewportBounds {
  const safeZoom = clampMapZoom(zoom);
  const safeW = canvasWidth > 0 ? canvasWidth : DEFAULT_MAP_CANVAS_WIDTH;
  const safeH = canvasHeight > 0 ? canvasHeight : DEFAULT_MAP_CANVAS_HEIGHT;
  return {
    canvasWidth: safeW,
    canvasHeight: safeH,
    zoom: safeZoom,
    scaledWidth: Math.round(safeW * safeZoom),
    scaledHeight: Math.round(safeH * safeZoom),
  };
}
