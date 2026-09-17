"use client";

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  clampProofZoom,
  clampProofPanOffset,
  computeProofStepZoom,
  computeProofZoomWheel,
  computeProofDoubleClickedZoom,
  resetProofView,
  MIN_PROOF_ZOOM,
  MAX_PROOF_ZOOM,
  type ProofViewTransform,
  type ProofContainerDimensions,
} from '@deskatlas/domain';

export interface ProofImageViewerProps {
  proofUrl?: string | null;
  loading?: boolean;
  alt?: string;
  height?: number | string;
}

export function ProofImageViewer({
  proofUrl,
  loading = false,
  alt = 'Payment proof submission',
  height = '280px',
}: ProofImageViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState<ProofViewTransform>({
    scale: 1.0,
    offset: { x: 0, y: 0 },
  });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ startX: number; startY: number; initialOffset: { x: number; y: number } }>({
    startX: 0,
    startY: 0,
    initialOffset: { x: 0, y: 0 },
  });

  const getContainerDimensions = useCallback((): ProofContainerDimensions => {
    if (containerRef.current) {
      return {
        width: containerRef.current.clientWidth || 400,
        height: containerRef.current.clientHeight || 280,
      };
    }
    return { width: 400, height: 280 };
  }, []);

  const handleZoomIn = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    e?.preventDefault();
    setTransform((prev) => computeProofStepZoom(prev, 'in', 0.25, getContainerDimensions()));
  };

  const handleZoomOut = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    e?.preventDefault();
    setTransform((prev) => computeProofStepZoom(prev, 'out', 0.25, getContainerDimensions()));
  };

  const handleReset = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    e?.preventDefault();
    setTransform(resetProofView());
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    const pointerPos = rect
      ? { x: e.clientX - rect.left, y: e.clientY - rect.top }
      : { x: 200, y: 140 };

    setTransform((prev) =>
      computeProofZoomWheel(prev, e.deltaY, pointerPos, getContainerDimensions())
    );
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    const pointerPos = rect
      ? { x: e.clientX - rect.left, y: e.clientY - rect.top }
      : { x: 200, y: 140 };

    setTransform((prev) =>
      computeProofDoubleClickedZoom(prev.scale, pointerPos, getContainerDimensions())
    );
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return; // Only primary mouse button
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setIsDragging(true);
    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initialOffset: { ...transform.offset },
    };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStartRef.current.startX;
    const dy = e.clientY - dragStartRef.current.startY;
    const newOffset = {
      x: dragStartRef.current.initialOffset.x + dx,
      y: dragStartRef.current.initialOffset.y + dy,
    };
    setTransform((prev) => ({
      ...prev,
      offset: clampProofPanOffset(newOffset, prev.scale, getContainerDimensions()),
    }));
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (isDragging) {
      setIsDragging(false);
      try {
        (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
      } catch {
        // ignore capture errors
      }
    }
  };

  // Reset transform whenever proofUrl changes
  useEffect(() => {
    setTransform(resetProofView());
  }, [proofUrl]);

  const zoomPercentage = Math.round(transform.scale * 100);

  return (
    <div
      ref={containerRef}
      data-testid="proof-image-viewer"
      onWheel={proofUrl ? handleWheel : undefined}
      onDoubleClick={proofUrl ? handleDoubleClick : undefined}
      onPointerDown={proofUrl ? handlePointerDown : undefined}
      onPointerMove={proofUrl ? handlePointerMove : undefined}
      onPointerUp={proofUrl ? handlePointerUp : undefined}
      onPointerCancel={proofUrl ? handlePointerUp : undefined}
      style={{
        position: 'relative',
        width: '100%',
        height: typeof height === 'number' ? `${height}px` : height,
        background: 'var(--da-canvas, #F7F5F0)',
        borderRadius: '10px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--da-text-secondary)',
        fontSize: '12px',
        fontFamily: 'var(--da-font-family)',
        marginBottom: '16px',
        overflow: 'hidden',
        userSelect: 'none',
        touchAction: 'none',
        cursor: !proofUrl
          ? 'default'
          : isDragging
          ? 'grabbing'
          : transform.scale > 1.0
          ? 'grab'
          : 'default',
      }}
    >
      {proofUrl ? (
        <>
          <img
            src={proofUrl}
            alt={alt}
            draggable={false}
            data-testid="proof-preview-image"
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              transform: `translate(${transform.offset.x}px, ${transform.offset.y}px) scale(${transform.scale})`,
              transformOrigin: 'center center',
              transition: isDragging ? 'none' : 'transform 0.15s ease-out',
              pointerEvents: 'none',
            }}
          />

          {/* Interaction Instruction Badge */}
          <div
            data-testid="proof-viewer-hint"
            style={{
              position: 'absolute',
              bottom: '10px',
              left: '10px',
              fontSize: '11px',
              fontWeight: 500,
              color: 'var(--da-text-secondary, #64748B)',
              background: 'rgba(255, 255, 255, 0.88)',
              backdropFilter: 'blur(4px)',
              padding: '3px 8px',
              borderRadius: '6px',
              border: '1px solid var(--da-border, #E2E8F0)',
              pointerEvents: 'none',
              zIndex: 5,
            }}
          >
            Drag to pan · Scroll or double-click to zoom
          </div>

          {/* Interactive Zoom Controls Toolbar */}
          <div
            data-testid="proof-viewer-toolbar"
            style={{
              position: 'absolute',
              bottom: '10px',
              right: '10px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              background: 'rgba(255, 255, 255, 0.92)',
              backdropFilter: 'blur(4px)',
              padding: '3px 6px',
              borderRadius: '8px',
              border: '1px solid var(--da-border, #E2E8F0)',
              boxShadow: '0 2px 6px rgba(0,0,0,0.06)',
              zIndex: 10,
            }}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              aria-label="Zoom out"
              onClick={handleZoomOut}
              disabled={transform.scale <= MIN_PROOF_ZOOM}
              style={{
                width: '26px',
                height: '26px',
                borderRadius: '5px',
                border: '1px solid var(--da-border, #CBD5E1)',
                background: '#fff',
                cursor: transform.scale <= MIN_PROOF_ZOOM ? 'not-allowed' : 'pointer',
                opacity: transform.scale <= MIN_PROOF_ZOOM ? 0.5 : 1,
                fontSize: '14px',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--da-text-primary, #0F172A)',
                padding: 0,
              }}
            >
              −
            </button>

            <span
              data-testid="proof-zoom-indicator"
              style={{
                fontSize: '11px',
                fontFamily: 'var(--da-font-family)',
                fontWeight: 700,
                minWidth: '40px',
                textAlign: 'center',
                color: 'var(--da-text-primary, #0F172A)',
              }}
            >
              {zoomPercentage}%
            </span>

            <button
              type="button"
              aria-label="Zoom in"
              onClick={handleZoomIn}
              disabled={transform.scale >= MAX_PROOF_ZOOM}
              style={{
                width: '26px',
                height: '26px',
                borderRadius: '5px',
                border: '1px solid var(--da-border, #CBD5E1)',
                background: '#fff',
                cursor: transform.scale >= MAX_PROOF_ZOOM ? 'not-allowed' : 'pointer',
                opacity: transform.scale >= MAX_PROOF_ZOOM ? 0.5 : 1,
                fontSize: '14px',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--da-text-primary, #0F172A)',
                padding: 0,
              }}
            >
              +
            </button>

            <button
              type="button"
              aria-label="Reset zoom and pan"
              onClick={handleReset}
              style={{
                height: '26px',
                padding: '0 8px',
                borderRadius: '5px',
                border: '1px solid var(--da-border, #CBD5E1)',
                background: '#fff',
                cursor: 'pointer',
                fontSize: '11px',
                fontWeight: 600,
                fontFamily: 'var(--da-font-family)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--da-text-secondary, #475569)',
              }}
            >
              Reset
            </button>
          </div>
        </>
      ) : loading ? (
        <span>Loading proof preview...</span>
      ) : (
        <span>No proof image available</span>
      )}
    </div>
  );
}
