"use client";

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  computeFitViewZoom,
  clampMapZoom,
  getSavedMapZoom,
  saveMapZoom,
  DEFAULT_MAP_CANVAS_WIDTH,
  DEFAULT_MAP_CANVAS_HEIGHT,
  DEFAULT_MAP_GRID_SIZE,
  type Floor,
  type PublishedFloorMap,
} from '@deskatlas/domain';
import { WorkspaceCountdownBadge, useLiveCountdownClock } from '@deskatlas/ui';
import { fetchPublishedMap, updateStaffInstanceOperationalStatus, fetchStaffOccupancy } from '../../lib/publishedMapApi';
import { ExtendReservationModal } from '@/features/reservations/components/ExtendReservationModal';
import { useAuth } from '@/features/auth';

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

function AmenityIcon({ type, name, color }: { type?: string; name?: string; color?: string }) {
  const norm = (type || name || '').toLowerCase();
  const iconColor = color || '#1e293b';

  if (norm.includes('restroom') || norm.includes('toilet') || norm.includes('bath') || norm.includes('cr') || norm.includes('washroom')) {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="Restroom">
        <circle cx="8" cy="5" r="2" fill={iconColor} stroke="none" />
        <path d="M8 8v6M6 10h4M7 14v6M9 14v6" stroke={iconColor} strokeWidth="1.75" />
        <circle cx="16" cy="5" r="2" fill={iconColor} stroke="none" />
        <path d="M14 10l2-2 2 2M16 8v3M14 14l1-3h2l1 3M15 14v6M17 14v6" stroke={iconColor} strokeWidth="1.75" />
      </svg>
    );
  }

  if (norm.includes('pantry') || norm.includes('kitchen') || norm.includes('dining') || norm.includes('cafe') || norm.includes('coffee') || norm.includes('snack')) {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="Pantry">
        <path d="M18 8h1a4 4 0 0 1 0 8h-1" />
        <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" />
        <line x1="6" y1="1" x2="6" y2="4" />
        <line x1="10" y1="1" x2="10" y2="4" />
        <line x1="14" y1="1" x2="14" y2="4" />
      </svg>
    );
  }

  if (norm.includes('exit') || norm.includes('emergency')) {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="Emergency Exit">
        <path d="M13 4h6a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6" />
        <path d="M3 12h11" />
        <path d="M10 8l4 4-4 4" />
        <circle cx="6" cy="7" r="1.5" fill={iconColor} stroke="none" />
        <path d="M6 9v3l-2 2" stroke={iconColor} strokeWidth="1.75" />
      </svg>
    );
  }

  if (norm.includes('door')) {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="Doorway">
        <path d="M18 20V6a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v14" />
        <path d="M2 20h20" />
        <circle cx="14" cy="12" r="1" fill={iconColor} />
      </svg>
    );
  }

  return null;
}

export default function WorkspaceMapPage() {
  const { user } = useAuth();
  const currentTick = useLiveCountdownClock(1000);
  const [builderZoom, setBuilderZoom] = useState(1);
  const [selectedObjId, setSelectedObjId] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasDimensions, setCanvasDimensions] = useState({
    width: DEFAULT_MAP_CANVAS_WIDTH,
    height: DEFAULT_MAP_CANVAS_HEIGHT,
    gridSize: DEFAULT_MAP_GRID_SIZE,
  });

  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [floors, setFloors] = useState<Floor[]>([]);
  const [selectedFloorId, setSelectedFloorId] = useState<string | null>(null);
  const [publishedMap, setPublishedMap] = useState<PublishedFloorMap | null>(null);
  const [occupancyList, setOccupancyList] = useState<any[]>([]);
  const [showExtendModal, setShowExtendModal] = useState<boolean>(false);
  const [extendModalData, setExtendModalData] = useState<any>(null);

  const loadOccupancy = async () => {
    try {
      const data = await fetchStaffOccupancy();
      setOccupancyList(data || []);
    } catch {
      // keep existing occupancy state
    }
  };

  const occupancyByInstanceId = useMemo(() => {
    const map = new Map<string, any>();
    for (const occ of occupancyList) {
      if (occ.workspaceInstanceId) {
        map.set(occ.workspaceInstanceId, occ);
      }
    }
    return map;
  }, [occupancyList]);

  // Load published map and floors
  const loadMapData = async (floorId?: string) => {
    try {
      setLoading(true);
      setErrorMsg(null);
      setSelectedObjId(null);

      const [result] = await Promise.all([
        fetchPublishedMap(floorId),
        loadOccupancy(),
      ]);
      setFloors(result.floors);

      if (result.published) {
        setPublishedMap(result.published);
        const currentFloorId = result.published.floor.id;
        setSelectedFloorId(currentFloorId);

        const canvasW = Number(result.published.version?.canvasWidth) || DEFAULT_MAP_CANVAS_WIDTH;
        const canvasH = Number(result.published.version?.canvasHeight) || DEFAULT_MAP_CANVAS_HEIGHT;
        const grid = Number(result.published.version?.gridSize) || DEFAULT_MAP_GRID_SIZE;
        setCanvasDimensions({ width: canvasW, height: canvasH, gridSize: grid });

        const savedZoom = getSavedMapZoom(currentFloorId);
        if (savedZoom !== null) {
          setBuilderZoom(savedZoom);
        } else if (containerRef.current) {
          const fitZoom = computeFitViewZoom(
            containerRef.current.clientWidth,
            containerRef.current.clientHeight,
            canvasW,
            canvasH,
            0
          );
          setBuilderZoom(fitZoom);
        } else {
          setBuilderZoom(1);
        }
      } else {
        setPublishedMap(null);
        if (result.floors.length > 0 && !floorId) {
          setSelectedFloorId(result.floors[0].id);
        }
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to load published workspace map');
      setPublishedMap(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMapData();
    const interval = setInterval(loadOccupancy, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!containerRef.current || !selectedFloorId) return;
    const checkAndFit = () => {
      if (!containerRef.current) return;
      const savedZoom = getSavedMapZoom(selectedFloorId);
      if (savedZoom !== null) {
        setBuilderZoom(savedZoom);
      } else if (containerRef.current.clientWidth > 0 && containerRef.current.clientHeight > 0) {
        const fitZoom = computeFitViewZoom(
          containerRef.current.clientWidth,
          containerRef.current.clientHeight,
          canvasDimensions.width,
          canvasDimensions.height,
          0
        );
        setBuilderZoom(fitZoom);
      }
    };

    const timeout = setTimeout(checkAndFit, 60);
    window.addEventListener('resize', checkAndFit);
    return () => {
      clearTimeout(timeout);
      window.removeEventListener('resize', checkAndFit);
    };
  }, [selectedFloorId, canvasDimensions.width, canvasDimensions.height, loading]);

  const handleFloorChange = async (newFloorId: string) => {
    setSelectedFloorId(newFloorId);
    await loadMapData(newFloorId);
  };

  const handleFitView = () => {
    if (!containerRef.current) {
      setBuilderZoom(1);
      return;
    }
    const fitZoom = computeFitViewZoom(
      containerRef.current.clientWidth,
      containerRef.current.clientHeight,
      canvasDimensions.width,
      canvasDimensions.height,
      0
    );
    setBuilderZoom(fitZoom);
    if (selectedFloorId) {
      saveMapZoom(selectedFloorId, fitZoom);
    }
  };

  const handleZoomIn = () => {
    setBuilderZoom((z) => {
      const next = clampMapZoom(Number((z + 0.1).toFixed(2)));
      if (selectedFloorId) saveMapZoom(selectedFloorId, next);
      return next;
    });
  };

  const handleZoomOut = () => {
    setBuilderZoom((z) => {
      const next = clampMapZoom(Number((z - 0.1).toFixed(2)));
      if (selectedFloorId) saveMapZoom(selectedFloorId, next);
      return next;
    });
  };

  // Staff action: Update instance operational status
  const handleUpdateInstanceStatus = async (instanceId: string, newStatus: string) => {
    try {
      setActionLoading(true);
      setErrorMsg(null);
      await updateStaffInstanceOperationalStatus(
        instanceId,
        newStatus,
        user?.id
          ? {
              userId: user.id,
              role: user.role?.toUpperCase() || 'STAFF',
            }
          : undefined
      );

      // Update local state
      setPublishedMap((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          elements: prev.elements.map((el) => {
            if (el.workspace?.workspaceInstanceId === instanceId) {
              const isBookable = newStatus === 'ACTIVE';
              const blockingReason = isBookable ? null : 'OPERATIONAL_STATUS_BLOCKED';
              return {
                ...el,
                workspace: {
                  ...el.workspace,
                  operationalStatus: newStatus as any,
                  isBookable,
                  blockingReason,
                },
              };
            }
            return el;
          }),
        };
      });

      setSuccessMsg(`Status updated to ${newStatus}`);
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to update workspace status');
    } finally {
      setActionLoading(false);
    }
  };

  const elements = publishedMap?.elements || [];
  const selectedElement = elements.find((e) => e.id === selectedObjId) || null;

  return (
    <main style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', flex: 1 }}>
      {/* Toast Notifications */}
      {errorMsg && (
        <div style={{ background: '#fef2f2', borderBottom: '1px solid #fecaca', color: '#b91c1c', padding: '8px 16px', fontSize: '13px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 50 }}>
          <span>{errorMsg}</span>
          <button onClick={() => setErrorMsg(null)} style={{ border: 'none', background: 'none', color: '#b91c1c', cursor: 'pointer', fontWeight: 700 }}>✕</button>
        </div>
      )}
      {successMsg && (
        <div style={{ background: '#ecfdf5', borderBottom: '1px solid #a7f3d0', color: '#065f46', padding: '8px 16px', fontSize: '13px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 50 }}>
          <span>{successMsg}</span>
          <button onClick={() => setSuccessMsg(null)} style={{ border: 'none', background: 'none', color: '#065f46', cursor: 'pointer', fontWeight: 700 }}>✕</button>
        </div>
      )}

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 20px', background: '#fff', borderBottom: '1px solid var(--da-border)', flexWrap: 'wrap', gap: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <span style={{ fontSize: '16px', fontWeight: 800, color: 'var(--da-text-primary)' }}>Workspace Map</span>
          {floors.length > 0 ? (
            <select
              value={selectedFloorId || ''}
              onChange={(e) => handleFloorChange(e.target.value)}
              style={{ border: '1px solid var(--da-border)', borderRadius: '8px', padding: '7px 12px', fontSize: '12px', fontFamily: 'var(--da-font-family)', background: '#fff', fontWeight: 700 }}
            >
              {floors.map(f => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          ) : (
            <span style={{ fontSize: '12px', color: 'var(--da-text-secondary)' }}>No published floors</span>
          )}

          {publishedMap && (
            <span style={{ fontSize: '11px', fontWeight: 700, padding: '3px 8px', borderRadius: '9999px', background: 'var(--da-info)', color: 'var(--da-brand-dark)' }}>
              v{publishedMap.version.versionNumber} Live
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button onClick={handleZoomOut} style={{ width: '36px', height: '36px', borderRadius: '8px', border: '1px solid var(--da-border)', background: '#fff', cursor: 'pointer', fontSize: '15px', fontWeight: 700 }}>−</button>
          <span style={{ fontSize: '12px', fontFamily: 'var(--da-font-family)', width: '40px', textAlign: 'center' }}>{Math.round(builderZoom * 100)}%</span>
          <button onClick={handleZoomIn} style={{ width: '36px', height: '36px', borderRadius: '8px', border: '1px solid var(--da-border)', background: '#fff', cursor: 'pointer', fontSize: '15px', fontWeight: 700 }}>+</button>
          <button onClick={handleFitView} style={{ border: '1px solid var(--da-border)', background: '#fff', borderRadius: '6px', padding: '6px 10px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}>Fit View</button>
        </div>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minWidth: 0, minHeight: 0, width: '100%' }}>
        {/* Canvas Area */}
        <div
          ref={containerRef}
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            overflow: 'auto',
            background: '#fff',
            position: 'relative',
            padding: 0,
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'flex-start',
          }}
        >
          {loading ? (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--da-text-secondary)', fontSize: '14px', fontFamily: 'var(--da-font-family)' }}>
              Loading workspace map...
            </div>
          ) : !publishedMap || elements.length === 0 ? (
            /* Empty State when no published map is available */
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px', textAlign: 'center' }}>
              <div style={{ background: '#fff', border: '1px solid var(--da-border)', borderRadius: '16px', padding: '40px 32px', maxWidth: '460px', boxShadow: 'var(--da-shadow-md)' }}>
                <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: 'var(--da-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: '24px' }}>
                  🗺️
                </div>
                <h2 style={{ fontSize: '19px', fontWeight: 800, color: 'var(--da-brand-dark)', margin: '0 0 8px', letterSpacing: '-0.02em' }}>
                  No workspace map created yet
                </h2>
                <p style={{ fontSize: '13px', color: 'var(--da-text-secondary)', margin: '0', lineHeight: 1.5, fontFamily: 'var(--da-font-family)' }}>
                  No published floor plan was found for this floor. Please check back once an administrator publishes a workspace layout.
                </p>
              </div>
            </div>
          ) : (
            /* Published Map Canvas View */
            <div
              style={{
                width: `${canvasDimensions.width * builderZoom}px`,
                height: `${canvasDimensions.height * builderZoom}px`,
                minWidth: '100%',
                minHeight: '100%',
                position: 'relative',
                flexShrink: 0,
                background: '#fff',
              }}
            >
              <div
                ref={canvasRef}
                style={{
                  width: `${canvasDimensions.width}px`,
                  height: `${canvasDimensions.height}px`,
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  background: '#fff',
                  borderRadius: '8px',
                  boxShadow: '0 4px 20px rgba(0,0,0,0.06)',
                  transform: `scale(${builderZoom})`,
                  transformOrigin: 'top left',
                  backgroundImage: 'radial-gradient(var(--da-border) 1px, transparent 1px)',
                  backgroundSize: `${canvasDimensions.gridSize}px ${canvasDimensions.gridSize}px`,
                  overflow: 'hidden',
                }}
              >
                {elements.map((el) => {
                  const isWorkspace = el.elementRole === 'WORKSPACE' || Boolean(el.workspace);
                  const isWall = !isWorkspace && (el.elementType?.toLowerCase().includes('wall') || el.elementType?.toLowerCase().includes('thin_wall') || el.elementType?.toLowerCase().includes('glass') || el.elementType?.toLowerCase().includes('separator'));
                  const isSelected = selectedObjId === el.id;

                  const isRestroom = el.elementType?.toLowerCase().includes('restroom') || el.label?.toLowerCase().includes('restroom');
                  const isPantry = el.elementType?.toLowerCase().includes('pantry') || el.label?.toLowerCase().includes('pantry');
                  const isEmergencyExit = el.elementType?.toLowerCase().includes('exit') || el.elementType?.toLowerCase().includes('emergency') || el.label?.toLowerCase().includes('exit') || el.label?.toLowerCase().includes('emergency');
                  const isAmenity = el.elementRole === 'AMENITY' || isRestroom || isPantry || isEmergencyExit;
                  const isKioskMarker =
                    el.elementType === 'KIOSK_YOU_ARE_HERE' ||
                    el.elementRole === 'INFORMATION' ||
                    (el.style as any)?.markerType === 'KIOSK_YOU_ARE_HERE' ||
                    el.label?.toLowerCase() === 'you are here' ||
                    el.label?.toLowerCase().includes('kiosk');

                  let defaultAmenityColor = '#F3F7F4';
                  if (isRestroom) defaultAmenityColor = '#E0F2FE';
                  else if (isPantry) defaultAmenityColor = '#FEF3C7';
                  else if (isEmergencyExit) defaultAmenityColor = '#DCFCE7';

                  const displayName = el.workspace?.displayName || el.label || (isKioskMarker ? '📍 You Are Here' : (el.workspace?.templateName || formatStructureLabel(el.elementType)));
                  const itemColor = el.style?.color || (el.style as any)?.fillColor || (isWorkspace ? '#009689' : (isKioskMarker ? '#DC2626' : (isAmenity ? defaultAmenityColor : (isWall ? '#334155' : '#F3F7F4'))));

                  const occupancy = isWorkspace && el.workspace?.workspaceInstanceId ? occupancyByInstanceId.get(el.workspace.workspaceInstanceId) : null;
                  const isOccupied = Boolean(occupancy);

                  let bg = isKioskMarker ? '#DC2626' : String(itemColor);
                  let textColor = isKioskMarker ? '#ffffff' : getContrastColor(bg);
                  let border = isSelected ? '3px solid var(--da-brand-dark)' : (isKioskMarker ? '2px solid #ffffff' : '1px solid rgba(0, 0, 0, 0.15)');

                  const status = el.workspace?.operationalStatus || 'ACTIVE';
                  if (isWorkspace) {
                    if (status === 'MAINTENANCE') {
                      border = '2px dashed #f59e0b';
                    } else if (status === 'INACTIVE' || status === 'BROKEN' || (!el.workspace?.isBookable && status !== 'ACTIVE')) {
                      border = '2px dashed #94a3b8';
                      bg = 'rgba(148, 163, 184, 0.4)';
                      textColor = '#334155';
                    } else if (isOccupied) {
                      bg = '#EF4444';
                      textColor = '#ffffff';
                      border = isSelected ? '3px solid var(--da-brand-dark)' : '1.5px solid #DC2626';
                    }
                  } else if (el.elementType?.toLowerCase().includes('door')) {
                    border = '2px dashed var(--da-brand-dark)';
                  }

                  return (
                    <div
                      key={el.id}
                      style={{
                        position: 'absolute',
                        left: el.x,
                        top: el.y,
                        width: el.width,
                        height: el.height,
                        transform: `rotate(${el.rotation || 0}deg)`,
                        zIndex: isKioskMarker ? 20 : (el.zIndex || 1),
                      }}
                    >
                      <button
                        onClick={() => setSelectedObjId(el.id)}
                        aria-pressed={isSelected}
                        style={{
                          width: '100%',
                          height: '100%',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '11px',
                          fontWeight: 700,
                          textAlign: 'center',
                          cursor: 'pointer',
                          fontFamily: 'var(--da-font-family)',
                          padding: '4px',
                          lineHeight: 1.2,
                          background: bg,
                          border: border,
                          borderRadius: isKioskMarker ? '14px' : (isWall ? '2px' : '8px'),
                          color: textColor,
                          position: 'relative',
                          overflow: 'hidden',
                          boxShadow: isSelected ? '0 0 0 2px var(--da-brand-dark)' : (isKioskMarker ? '0 4px 14px rgba(220, 38, 38, 0.35)' : 'none'),
                          transition: 'all 0.15s ease',
                        }}
                      >
                        {isWorkspace ? (
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', maxWidth: '100%', gap: '2px' }}>
                            <span style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {displayName}
                            </span>
                            {isOccupied && (
                              <WorkspaceCountdownBadge
                                bookingEndAt={occupancy.bookingEndAt}
                                nowMs={currentTick}
                              />
                            )}
                          </div>
                        ) : isKioskMarker ? (
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '2px', pointerEvents: 'none', maxWidth: '100%', maxHeight: '100%' }}>
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="You Are Here">
                              <path d="M12 2a8 8 0 0 0-8 8c0 5.25 8 12 8 12s8-6.75 8-12a8 8 0 0 0-8-8z" fill="#ffffff" stroke="#DC2626" strokeWidth="1.5" />
                              <circle cx="12" cy="10" r="3" fill="#DC2626" />
                            </svg>
                            <span style={{ fontSize: '10px', fontWeight: 800, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#ffffff', textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}>
                              {displayName}
                            </span>
                          </div>
                        ) : isAmenity ? (
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '3px', pointerEvents: 'none', maxWidth: '100%', maxHeight: '100%' }}>
                            <AmenityIcon type={el.elementType} name={displayName} color={textColor} />
                            <span style={{ fontSize: '10px', fontWeight: 700, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: 0.9 }}>
                              {displayName}
                            </span>
                          </div>
                        ) : (
                          <span
                            style={{
                              maxWidth: '100%',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              fontSize: el.height <= 20 ? '9px' : '11px',
                              fontWeight: el.height <= 20 ? 800 : 700,
                              letterSpacing: el.height <= 20 ? '0.05em' : 'normal',
                              textTransform: el.height <= 20 ? 'uppercase' : 'none',
                              padding: '0 4px',
                              lineHeight: 1,
                              pointerEvents: 'none',
                            }}
                          >
                            {displayName}
                          </span>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Inspector Sidebar with Operational Status Controls */}
        {selectedElement && (
          <aside style={{ width: '280px', background: '#fff', borderLeft: '1px solid var(--da-border)', padding: '20px', flexShrink: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--da-text-secondary)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                  {selectedElement.elementRole}
                </span>
                <h3 style={{ fontSize: '16px', fontWeight: 800, color: 'var(--da-brand-dark)', margin: '3px 0 0' }}>
                  {selectedElement.workspace?.displayName || selectedElement.label || selectedElement.elementType}
                </h3>
              </div>
              <button onClick={() => setSelectedObjId(null)} style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: 'var(--da-text-secondary)' }}>&times;</button>
            </div>

            {selectedElement.workspace ? (
              <>
                {selectedElement.workspace.workspaceInstanceId && occupancyByInstanceId.get(selectedElement.workspace.workspaceInstanceId) && (
                  <div style={{ padding: '12px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 800, color: '#991B1B', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                        Occupied Spot
                      </span>
                      <WorkspaceCountdownBadge
                        bookingEndAt={occupancyByInstanceId.get(selectedElement.workspace.workspaceInstanceId).bookingEndAt}
                        nowMs={currentTick}
                      />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#7F1D1D' }}>Customer:</span>
                      <span style={{ fontWeight: 700, color: '#991B1B' }}>
                        {occupancyByInstanceId.get(selectedElement.workspace.workspaceInstanceId).customerFirstName} {occupancyByInstanceId.get(selectedElement.workspace.workspaceInstanceId).customerLastName}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#7F1D1D' }}>Reference:</span>
                      <span style={{ fontWeight: 700, color: '#991B1B', fontFamily: 'monospace' }}>
                        {occupancyByInstanceId.get(selectedElement.workspace.workspaceInstanceId).referenceCode}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#7F1D1D' }}>Status:</span>
                      <span style={{ fontWeight: 700, color: '#991B1B' }}>
                        {occupancyByInstanceId.get(selectedElement.workspace.workspaceInstanceId).reservationStatus === 'CHECKED_IN' ? 'Checked In' : 'Confirmed'}
                      </span>
                    </div>
                    {occupancyByInstanceId.get(selectedElement.workspace.workspaceInstanceId).bookingStartAt && occupancyByInstanceId.get(selectedElement.workspace.workspaceInstanceId).bookingEndAt && (
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: '#7F1D1D' }}>Window:</span>
                        <span style={{ fontWeight: 600, color: '#991B1B' }}>
                          {new Date(occupancyByInstanceId.get(selectedElement.workspace.workspaceInstanceId).bookingStartAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - {new Date(occupancyByInstanceId.get(selectedElement.workspace.workspaceInstanceId).bookingEndAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    )}
                    <button
                      data-testid="map-extend-booking-button"
                      onClick={() => {
                        const occ = occupancyByInstanceId.get(selectedElement.workspace.workspaceInstanceId);
                        if (occ) {
                          setExtendModalData({
                            reservationId: occ.reservationId || occ.id,
                            referenceCode: occ.referenceCode,
                            customerName: `${occ.customerFirstName} ${occ.customerLastName}`.trim(),
                            spotDisplayName: selectedElement.workspace.displayName || selectedElement.workspace.instanceCode,
                            templateName: selectedElement.workspace.templateName,
                            currentSchedule: occ.bookingStartAt && occ.bookingEndAt
                              ? `${new Date(occ.bookingStartAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${new Date(occ.bookingEndAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                              : undefined,
                            currentEndAt: occ.bookingEndAt || undefined,
                            hourlyRate: selectedElement.workspace.rateAmount ?? 150,
                          });
                          setShowExtendModal(true);
                        }
                      }}
                      style={{
                        marginTop: '6px',
                        padding: '7px 12px',
                        backgroundColor: '#fff',
                        border: '1px solid #DC2626',
                        borderRadius: '6px',
                        color: '#991B1B',
                        fontSize: '11px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        width: '100%',
                      }}
                    >
                      Extend Time
                    </button>
                  </div>
                )}


                <div style={{ padding: '12px', background: 'var(--da-canvas)', borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--da-text-secondary)' }}>Template:</span>
                    <span style={{ fontWeight: 700, color: 'var(--da-text-primary)' }}>{selectedElement.workspace.templateName}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--da-text-secondary)' }}>Code:</span>
                    <span style={{ fontWeight: 700, color: 'var(--da-text-primary)' }}>{selectedElement.workspace.instanceCode}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--da-text-secondary)' }}>Rate:</span>
                    <span style={{ fontWeight: 700, color: 'var(--da-text-primary)' }}>₱{selectedElement.workspace.rateAmount}/hr</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--da-text-secondary)' }}>Capacity:</span>
                    <span style={{ fontWeight: 700, color: 'var(--da-text-primary)' }}>{selectedElement.workspace.capacity} Person(s)</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--da-text-secondary)' }}>Floor:</span>
                    <span style={{ fontWeight: 700, color: 'var(--da-text-primary)' }}>{publishedMap?.floor.name || 'Ground Floor'}</span>
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: 'var(--da-text-primary)', marginBottom: '6px' }}>
                    Operational Status
                  </label>
                  <select
                    disabled={actionLoading}
                    value={selectedElement.workspace.operationalStatus || 'ACTIVE'}
                    onChange={(e) => handleUpdateInstanceStatus(selectedElement.workspace!.workspaceInstanceId, e.target.value)}
                    style={{
                      width: '100%',
                      border: '1px solid var(--da-border)',
                      borderRadius: '8px',
                      padding: '9px 12px',
                      fontSize: '13px',
                      fontFamily: 'var(--da-font-family)',
                      background: '#fff',
                      fontWeight: 600,
                      cursor: actionLoading ? 'not-allowed' : 'pointer',
                    }}
                  >
                    <option value="ACTIVE">Active (Bookable)</option>
                    <option value="MAINTENANCE">Maintenance (Blocked)</option>
                    <option value="INACTIVE">Inactive (Hidden)</option>
                  </select>
                </div>
              </>
            ) : (
              <div style={{ padding: '12px', background: 'var(--da-canvas)', borderRadius: '8px', fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--da-text-secondary)' }}>Type:</span>
                  <span style={{ fontWeight: 700 }}>{selectedElement.elementType}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--da-text-secondary)' }}>Size:</span>
                  <span style={{ fontWeight: 700 }}>{selectedElement.width} × {selectedElement.height} px</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--da-text-secondary)' }}>Rotation:</span>
                  <span style={{ fontWeight: 700 }}>{selectedElement.rotation || 0}°</span>
                </div>
              </div>
            )}
          </aside>
        )}
      </div>


      {extendModalData && (
        <ExtendReservationModal
          isOpen={showExtendModal}
          onClose={() => {
            setShowExtendModal(false);
            setExtendModalData(null);
          }}
          onSuccess={() => {
            loadOccupancy();
            setSuccessMsg('Reservation time extended successfully.');
          }}
          reservationId={extendModalData.reservationId}
          referenceCode={extendModalData.referenceCode}
          customerName={extendModalData.customerName}
          spotDisplayName={extendModalData.spotDisplayName}
          templateName={extendModalData.templateName}
          currentSchedule={extendModalData.currentSchedule}
          currentEndAt={extendModalData.currentEndAt}
          hourlyRate={extendModalData.hourlyRate}
          apiPrefix="/api/operations/reservations"
          actorRole="STAFF"
        />
      )}
    </main>
  );
}


