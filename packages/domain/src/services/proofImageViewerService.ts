export const MIN_PROOF_ZOOM = 0.5;
export const MAX_PROOF_ZOOM = 5.0;
export const DEFAULT_PROOF_ZOOM = 1.0;
export const DEFAULT_PROOF_ZOOM_STEP = 0.25;
export const DOUBLE_CLICK_MAGNIFICATION = 2.5;

export interface ProofViewOffset {
  x: number;
  y: number;
}

export interface ProofViewTransform {
  scale: number;
  offset: ProofViewOffset;
}

export interface ProofContainerDimensions {
  width: number;
  height: number;
}

/**
 * Clamps the zoom level within [minZoom, maxZoom] and rounds to 2 decimal places.
 * If zoom is NaN or invalid, falls back to default 1.0.
 */
export function clampProofZoom(
  zoom: number,
  minZoom: number = MIN_PROOF_ZOOM,
  maxZoom: number = MAX_PROOF_ZOOM
): number {
  if (!Number.isFinite(zoom) || isNaN(zoom)) {
    return DEFAULT_PROOF_ZOOM;
  }
  const clamped = Math.min(maxZoom, Math.max(minZoom, zoom));
  return Number(clamped.toFixed(2));
}

/**
 * Clamps pan offset coordinates relative to container dimensions and current scale
 * to prevent dragging the image completely off the visible canvas.
 */
export function clampProofPanOffset(
  offset: ProofViewOffset,
  scale: number,
  container: ProofContainerDimensions = { width: 400, height: 280 },
  margin: number = 40
): ProofViewOffset {
  const safeWidth = Math.max(50, container.width || 400);
  const safeHeight = Math.max(50, container.height || 280);

  if (scale <= 1.0) {
    // When zoomed out (or at fit), keep centered with subtle margin tolerance
    const maxBoundX = Math.max(0, (safeWidth * (1.0 - scale)) / 2 + margin);
    const maxBoundY = Math.max(0, (safeHeight * (1.0 - scale)) / 2 + margin);
    return {
      x: Math.round(Math.max(-maxBoundX, Math.min(maxBoundX, offset.x))),
      y: Math.round(Math.max(-maxBoundY, Math.min(maxBoundY, offset.y))),
    };
  }

  // When zoomed in, allow panning across the expanded area
  const maxBoundX = (safeWidth * (scale - 1.0)) / 2 + margin;
  const maxBoundY = (safeHeight * (scale - 1.0)) / 2 + margin;

  return {
    x: Math.round(Math.max(-maxBoundX, Math.min(maxBoundX, offset.x))),
    y: Math.round(Math.max(-maxBoundY, Math.min(maxBoundY, offset.y))),
  };
}

/**
 * Computes zoom in / out step transform with offset clamping.
 */
export function computeProofStepZoom(
  current: ProofViewTransform,
  direction: 'in' | 'out',
  step: number = DEFAULT_PROOF_ZOOM_STEP,
  container: ProofContainerDimensions = { width: 400, height: 280 }
): ProofViewTransform {
  const targetScale = direction === 'in' ? current.scale + step : current.scale - step;
  const nextScale = clampProofZoom(targetScale);

  if (nextScale === 1.0) {
    return {
      scale: 1.0,
      offset: { x: 0, y: 0 },
    };
  }

  const scaleRatio = nextScale / current.scale;
  const newOffset = {
    x: current.offset.x * scaleRatio,
    y: current.offset.y * scaleRatio,
  };

  return {
    scale: nextScale,
    offset: clampProofPanOffset(newOffset, nextScale, container),
  };
}

/**
 * Computes mouse wheel zooming focused around the cursor position.
 */
export function computeProofZoomWheel(
  current: ProofViewTransform,
  deltaY: number,
  pointerPos: ProofViewOffset,
  container: ProofContainerDimensions = { width: 400, height: 280 }
): ProofViewTransform {
  // deltaY > 0 means wheel down (zoom out), deltaY < 0 means wheel up (zoom in)
  const zoomFactor = deltaY > 0 ? -0.15 : 0.15;
  const nextScale = clampProofZoom(current.scale + zoomFactor);

  if (nextScale === current.scale) {
    return current;
  }

  if (nextScale === 1.0) {
    return {
      scale: 1.0,
      offset: { x: 0, y: 0 },
    };
  }

  // Pointer position relative to container center
  const centerX = container.width / 2;
  const centerY = container.height / 2;
  const cursorRelX = pointerPos.x - centerX;
  const cursorRelY = pointerPos.y - centerY;

  const scaleRatio = nextScale / current.scale;
  const newOffsetX = cursorRelX - (cursorRelX - current.offset.x) * scaleRatio;
  const newOffsetY = cursorRelY - (cursorRelY - current.offset.y) * scaleRatio;

  return {
    scale: nextScale,
    offset: clampProofPanOffset({ x: newOffsetX, y: newOffsetY }, nextScale, container),
  };
}

/**
 * Toggles quick magnification on double click (1x <-> 2.5x).
 */
export function computeProofDoubleClickedZoom(
  currentScale: number,
  pointerPos?: ProofViewOffset,
  container: ProofContainerDimensions = { width: 400, height: 280 }
): ProofViewTransform {
  if (currentScale <= 1.05) {
    const nextScale = DOUBLE_CLICK_MAGNIFICATION;
    if (pointerPos) {
      const centerX = container.width / 2;
      const centerY = container.height / 2;
      const cursorRelX = pointerPos.x - centerX;
      const cursorRelY = pointerPos.y - centerY;
      const targetOffset = {
        x: -cursorRelX * (nextScale - 1),
        y: -cursorRelY * (nextScale - 1),
      };
      return {
        scale: nextScale,
        offset: clampProofPanOffset(targetOffset, nextScale, container),
      };
    }
    return {
      scale: nextScale,
      offset: { x: 0, y: 0 },
    };
  }

  // Reset to default 1x
  return resetProofView();
}

/**
 * Returns default 1.0x unpanned transform state.
 */
export function resetProofView(): ProofViewTransform {
  return {
    scale: DEFAULT_PROOF_ZOOM,
    offset: { x: 0, y: 0 },
  };
}
