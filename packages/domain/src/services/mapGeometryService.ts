export interface Point {
  x: number;
  y: number;
}

export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export interface RotatedElementGeometry {
  center: Point;
  corners: Point[];
  aabb: BoundingBox;
}

export interface ClampElementInput {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
}

export interface ClampedElementPosition {
  x: number;
  y: number;
  cx: number;
  cy: number;
  wasAdjusted: boolean;
  overflow: {
    left: number;
    right: number;
    top: number;
    bottom: number;
  };
}

/**
 * Computes the 4 corners of a rotated rectangle in canvas space using trigonometric projection
 * around the rectangle's center point.
 *
 * Corners are returned in order: Top-Left, Top-Right, Bottom-Right, Bottom-Left (relative to unrotated frame).
 */
export function computeRotatedElementCorners(
  x: number,
  y: number,
  width: number,
  height: number,
  rotationDegrees: number = 0
): Point[] {
  const cx = x + width / 2;
  const cy = y + height / 2;
  const rad = (rotationDegrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const halfW = width / 2;
  const halfH = height / 2;

  const relativeCorners = [
    { dx: -halfW, dy: -halfH }, // Top-Left
    { dx: halfW, dy: -halfH },  // Top-Right
    { dx: halfW, dy: halfH },   // Bottom-Right
    { dx: -halfW, dy: halfH },  // Bottom-Left
  ];

  return relativeCorners.map((c) => ({
    x: Number((cx + c.dx * cos - c.dy * sin).toFixed(6)),
    y: Number((cy + c.dx * sin + c.dy * cos).toFixed(6)),
  }));
}

/**
 * Computes the axis-aligned bounding box (AABB) of a rotated element using trigonometric projection
 * of all four corners.
 */
export function computeRotatedAABB(
  x: number,
  y: number,
  width: number,
  height: number,
  rotationDegrees: number = 0
): BoundingBox {
  const corners = computeRotatedElementCorners(x, y, width, height, rotationDegrees);
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  return {
    minX: Number(minX.toFixed(4)),
    minY: Number(minY.toFixed(4)),
    maxX: Number(maxX.toFixed(4)),
    maxY: Number(maxY.toFixed(4)),
    width: Number((maxX - minX).toFixed(4)),
    height: Number((maxY - minY).toFixed(4)),
  };
}

/**
 * Returns complete geometry including center, 4 rotated corner coordinates, and AABB.
 */
export function computeRotatedElementGeometry(
  element: ClampElementInput
): RotatedElementGeometry {
  const rotation = element.rotation ?? 0;
  const cx = Number((element.x + element.width / 2).toFixed(4));
  const cy = Number((element.y + element.height / 2).toFixed(4));
  const corners = computeRotatedElementCorners(element.x, element.y, element.width, element.height, rotation);
  const aabb = computeRotatedAABB(element.x, element.y, element.width, element.height, rotation);

  return {
    center: { x: cx, y: cy },
    corners,
    aabb,
  };
}

/**
 * Checks whether an element's rotated AABB stays strictly within the canvas bounds.
 */
export function isRotatedElementWithinBounds(
  element: ClampElementInput,
  canvasWidth: number,
  canvasHeight: number,
  tolerance: number = 1e-4
): boolean {
  const aabb = computeRotatedAABB(element.x, element.y, element.width, element.height, element.rotation ?? 0);
  return (
    aabb.minX >= -tolerance &&
    aabb.maxX <= canvasWidth + tolerance &&
    aabb.minY >= -tolerance &&
    aabb.maxY <= canvasHeight + tolerance &&
    element.x >= -tolerance &&
    element.y >= -tolerance &&
    element.x + element.width <= canvasWidth + tolerance &&
    element.y + element.height <= canvasHeight + tolerance
  );
}

/**
 * Clamps an element's position so that:
 * 1. Its rotated AABB stays fully within the map canvas bounds [0, canvasWidth] x [0, canvasHeight].
 * 2. If it is already within bounds, it pivots around the element's center point with ZERO displacement.
 * 3. If rotation or movement causes any part of the rotated element to exceed canvas boundaries,
 *    it is pushed inward by the exact necessary offset to fit flush against the edge.
 * 4. Both the rotated AABB and the unrotated coordinates respect non-negative and canvas limits.
 */
export function clampRotatedElementToBounds(
  element: ClampElementInput,
  canvasWidth: number,
  canvasHeight: number
): ClampedElementPosition {
  const rotation = element.rotation ?? 0;
  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;

  const aabb = computeRotatedAABB(element.x, element.y, element.width, element.height, rotation);

  const overflowLeft = Math.max(0, -aabb.minX);
  const overflowRight = Math.max(0, aabb.maxX - canvasWidth);
  const overflowTop = Math.max(0, -aabb.minY);
  const overflowBottom = Math.max(0, aabb.maxY - canvasHeight);

  // Maximum half-extent in X and Y taking both rotated AABB and unrotated box into account
  const halfAabbW = aabb.width / 2;
  const halfAabbH = aabb.height / 2;
  const extentX = Math.max(element.width / 2, halfAabbW);
  const extentY = Math.max(element.height / 2, halfAabbH);

  let clampedCx = cx;
  let clampedCy = cy;

  if (2 * extentX <= canvasWidth) {
    clampedCx = Math.max(extentX, Math.min(canvasWidth - extentX, cx));
  } else {
    // If element is wider than canvas itself, center it
    clampedCx = canvasWidth / 2;
  }

  if (2 * extentY <= canvasHeight) {
    clampedCy = Math.max(extentY, Math.min(canvasHeight - extentY, cy));
  } else {
    // If element is taller than canvas itself, center it
    clampedCy = canvasHeight / 2;
  }

  const newX = Number((clampedCx - element.width / 2).toFixed(4));
  const newY = Number((clampedCy - element.height / 2).toFixed(4));

  const wasAdjusted = Math.abs(newX - element.x) > 1e-4 || Math.abs(newY - element.y) > 1e-4;

  return {
    x: newX,
    y: newY,
    cx: Number(clampedCx.toFixed(4)),
    cy: Number(clampedCy.toFixed(4)),
    wasAdjusted,
    overflow: {
      left: Number(overflowLeft.toFixed(4)),
      right: Number(overflowRight.toFixed(4)),
      top: Number(overflowTop.toFixed(4)),
      bottom: Number(overflowBottom.toFixed(4)),
    },
  };
}

export interface CollidingElementCandidate {
  id: string;
  x: number;
  y: number;
  w?: number;
  width?: number;
  h?: number;
  height?: number;
  bookable?: boolean;
  role?: string;
  elementRole?: string;
  category?: string;
  elementType?: string;
  name?: string;
}

export function findCollidingElements(elements: CollidingElementCandidate[]): Set<string> {
  const colliding = new Set<string>();
  for (let i = 0; i < elements.length; i++) {
    for (let j = i + 1; j < elements.length; j++) {
      const a = elements[i];
      const b = elements[j];
      const aw = a.w ?? a.width ?? 0;
      const ah = a.h ?? a.height ?? 0;
      const bw = b.w ?? b.width ?? 0;
      const bh = b.h ?? b.height ?? 0;

      const isAWorkspace = Boolean(a.bookable || a.role === 'WORKSPACE' || a.elementRole === 'WORKSPACE');
      const isBWorkspace = Boolean(b.bookable || b.role === 'WORKSPACE' || b.elementRole === 'WORKSPACE');
      const isAWall = !isAWorkspace && Boolean(
        a.category === 'structure' ||
        a.role === 'STRUCTURE' ||
        a.elementRole === 'STRUCTURE' ||
        a.elementType === 'wall' ||
        a.elementType === 'divider' ||
        a.elementType === 'thin_wall' ||
        a.elementType === 'thin-wall' ||
        a.elementType === 'glass' ||
        a.name?.toLowerCase().includes('wall') ||
        a.name?.toLowerCase().includes('divider')
      );
      const isBWall = !isBWorkspace && Boolean(
        b.category === 'structure' ||
        b.role === 'STRUCTURE' ||
        b.elementRole === 'STRUCTURE' ||
        b.elementType === 'wall' ||
        b.elementType === 'divider' ||
        b.elementType === 'thin_wall' ||
        b.elementType === 'thin-wall' ||
        b.elementType === 'glass' ||
        b.name?.toLowerCase().includes('wall') ||
        b.name?.toLowerCase().includes('divider')
      );

      if ((isAWorkspace && isBWorkspace) || (isAWorkspace && isBWall) || (isBWorkspace && isAWall)) {
        const overlaps =
          a.x < b.x + bw &&
          a.x + aw > b.x &&
          a.y < b.y + bh &&
          a.y + ah > b.y;

        if (overlaps) {
          colliding.add(a.id);
          colliding.add(b.id);
        }
      }
    }
  }
  return colliding;
}
