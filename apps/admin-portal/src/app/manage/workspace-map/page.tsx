"use client";

import React, { useState, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  computeFitViewZoom,
  clampMapZoom,
  getSavedMapZoom,
  saveMapZoom,
  DEFAULT_MAP_CANVAS_WIDTH,
  DEFAULT_MAP_CANVAS_HEIGHT,
  DEFAULT_MAP_GRID_SIZE,
  DEFAULT_WORKSPACE_STATUS_COLORS,
  normalizeWorkspaceStatusColors,
  getContrastColor,
  type WorkspaceStatusColors,
} from '@deskatlas/domain';
import { WorkspaceCountdownBadge, useLiveCountdownClock } from '@deskatlas/ui';
import { ExtendReservationModal } from '@/features/reservations/components/ExtendReservationModal';
import { useAuth } from '@/features/auth';

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

  if (norm.includes('window')) {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-label="Window">
        <rect x="3" y="3" width="18" height="18" rx="2" fill="rgba(56, 189, 248, 0.2)" stroke="#0284C7" />
        <line x1="12" y1="3" x2="12" y2="21" stroke="#0284C7" />
        <line x1="3" y1="12" x2="21" y2="12" stroke="#0284C7" />
      </svg>
    );
  }

  if (norm.includes('stair')) {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-label="Stairs">
        <path d="M19 5h-4v4h-4v4H7v4H3v2h18V5z" fill="#E2E8F0" stroke="#64748B" />
        <polyline points="7 9 11 9 11 13 15 13 15 17 19 17" stroke="#475569" strokeWidth="1.5" />
      </svg>
    );
  }

  return null;
}

export default function WorkspaceMapPage() {
  const router = useRouter();
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
  const [loadingMap, setLoadingMap] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [floors, setFloors] = useState<any[]>([]);
  const [selectedFloorId, setSelectedFloorId] = useState<string | null>(null);
  const [templates, setTemplates] = useState<any[]>([]);
  const [instances, setInstances] = useState<any[]>([]);
  const [publishedMap, setPublishedMap] = useState<any | null>(null);
  const [statusColors, setStatusColors] = useState<WorkspaceStatusColors>(DEFAULT_WORKSPACE_STATUS_COLORS);
  const [occupancyList, setOccupancyList] = useState<any[]>([]);
  const [showExtendModal, setShowExtendModal] = useState<boolean>(false);
  const [extendModalData, setExtendModalData] = useState<any>(null);
  const [maintenanceNoteInput, setMaintenanceNoteInput] = useState<string>('');

  const loadOccupancy = async () => {
    try {
      const res = await fetch('/api/admin/occupancy');
      if (res.ok) {
        const data = await res.json();
        setOccupancyList(data.occupancy || []);
      }
    } catch {
      // preserve occupancy state
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

  // Load catalog and initial floor
  const loadInitialData = async () => {
    try {
      setLoading(true);
      setErrorMsg(null);

      const [wsRes, floorsRes, settingsRes] = await Promise.all([
        fetch('/api/admin/workspaces'),
        fetch('/api/admin/workspaces/floors'),
        fetch('/api/admin/settings').catch(() => null),
        loadOccupancy(),
      ]);

      const wsData = wsRes.ok ? await wsRes.json() : {};
      const floorsData = floorsRes.ok ? await floorsRes.json() : {};
      const settingsData = settingsRes && settingsRes.ok ? await settingsRes.json() : null;

      if (settingsData?.data?.businessSettings?.statusColors) {
        setStatusColors(normalizeWorkspaceStatusColors(settingsData.data.businessSettings.statusColors));
      }

      const loadedFloors = floorsData.floors || wsData.floors || [];
      const loadedTemplates = wsData.templates || [];
      const loadedInstances = wsData.instances || [];

      setFloors(loadedFloors);
      setTemplates(loadedTemplates);
      setInstances(loadedInstances);

      if (loadedFloors.length > 0) {
        const firstFloorId = loadedFloors[0].id;
        setSelectedFloorId(firstFloorId);
        await loadPublishedMapForFloor(firstFloorId);
      } else {
        setPublishedMap(null);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to load workspace map data');
    } finally {
      setLoading(false);
    }
  };

  const loadPublishedMapForFloor = async (floorId: string) => {
    try {
      setLoadingMap(true);
      setSelectedObjId(null);
      const res = await fetch(`/api/admin/maps/published?floorId=${encodeURIComponent(floorId)}`);
      if (res.ok) {
        const data = await res.json();
        const pub = data.published || null;
        setPublishedMap(pub);

        const canvasW = Number(pub?.version?.canvasWidth) || DEFAULT_MAP_CANVAS_WIDTH;
        const canvasH = Number(pub?.version?.canvasHeight) || DEFAULT_MAP_CANVAS_HEIGHT;
        const grid = Number(pub?.version?.gridSize) || DEFAULT_MAP_GRID_SIZE;
        setCanvasDimensions({ width: canvasW, height: canvasH, gridSize: grid });

        const savedZoom = getSavedMapZoom(floorId);
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
      }
    } catch (err) {
      setPublishedMap(null);
    } finally {
      setLoadingMap(false);
    }
  };

  useEffect(() => {
    loadInitialData();
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
  }, [selectedFloorId, canvasDimensions.width, canvasDimensions.height, loading, loadingMap]);

  const handleFloorChange = async (newFloorId: string) => {
    setSelectedFloorId(newFloorId);
    await loadPublishedMapForFloor(newFloorId);
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

  // Handle status update for an instance from the inspector
  const handleUpdateInstanceStatus = async (instanceId: string, newStatus: string, note?: string | null) => {
    try {
      setActionLoading(true);
      setErrorMsg(null);

      const resolvedNote = newStatus === 'MAINTENANCE' ? (note !== undefined ? note : (maintenanceNoteInput.trim() || null)) : null;

      const res = await fetch(`/api/admin/workspaces/instances/${instanceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operationalStatus: newStatus,
          maintenanceNote: resolvedNote,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to update workspace status');
      }

      // Update local state
      setInstances(prev =>
        prev.map(ins => (ins.id === instanceId ? { ...ins, operationalStatus: newStatus, maintenanceNote: resolvedNote } : ins))
      );

      if (newStatus !== 'MAINTENANCE') {
        setMaintenanceNoteInput('');
      }

      setSuccessMsg(`Status updated to ${newStatus}`);
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to update status');
    } finally {
      setActionLoading(false);
    }
  };

  const handleUpdateInstanceNote = async (instanceId: string, noteText: string) => {
    try {
      setActionLoading(true);
      setErrorMsg(null);

      const trimmedNote = noteText.trim() || null;
      const res = await fetch(`/api/admin/workspaces/instances/${instanceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operationalStatus: 'MAINTENANCE',
          maintenanceNote: trimmedNote,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to save maintenance note');
      }

      setInstances(prev =>
        prev.map(ins => (ins.id === instanceId ? { ...ins, maintenanceNote: trimmedNote } : ins))
      );

      setSuccessMsg('Maintenance note saved');
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to save note');
    } finally {
      setActionLoading(false);
    }
  };

  const elements = (publishedMap?.elements || []).filter((el: any) => {
    if (el.elementRole === 'WORKSPACE' || el.workspaceInstanceId) {
      const inst = instances.find((ins) => ins.id === el.workspaceInstanceId);
      const tmpl = inst
        ? (inst.template || templates.find((t) => t.id === inst.templateId))
        : templates.find((t) => t.id === el.properties?.templateId || t.name === el.properties?.template);
      if (tmpl && tmpl.isActive === false) return false;
    }
    return true;
  });
  const selectedElement = elements.find((e: any) => e.id === selectedObjId);
  const selectedInstance = selectedElement
    ? instances.find(ins => ins.id === selectedElement.workspaceInstanceId)
    : null;
  const selectedTemplate = selectedInstance
    ? selectedInstance.template || templates.find(t => t.id === selectedInstance.templateId)
    : null;

  useEffect(() => {
    if (selectedInstance) {
      setMaintenanceNoteInput(selectedInstance.maintenanceNote ?? '');
    } else {
      setMaintenanceNoteInput('');
    }
  }, [selectedInstance?.id, selectedInstance?.maintenanceNote]);

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
            <span style={{ fontSize: '12px', color: 'var(--da-text-secondary)' }}>No floors available</span>
          )}

          {publishedMap && (
            <span style={{ fontSize: '11px', fontWeight: 700, padding: '3px 8px', borderRadius: '9999px', background: 'var(--da-info)', color: 'var(--da-brand-dark)' }}>
              v{publishedMap.version?.versionNumber} Live
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button onClick={handleZoomOut} style={{ width: '36px', height: '36px', borderRadius: '8px', border: '1px solid var(--da-border)', background: '#fff', cursor: 'pointer', fontSize: '15px', fontWeight: 700 }}>−</button>
          <span style={{ fontSize: '12px', fontFamily: 'var(--da-font-family)', width: '40px', textAlign: 'center' }}>{Math.round(builderZoom * 100)}%</span>
          <button onClick={handleZoomIn} style={{ width: '36px', height: '36px', borderRadius: '8px', border: '1px solid var(--da-border)', background: '#fff', cursor: 'pointer', fontSize: '15px', fontWeight: 700 }}>+</button>
          <button onClick={handleFitView} style={{ border: '1px solid var(--da-border)', background: '#fff', borderRadius: '6px', padding: '6px 10px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}>Fit View</button>

          <Link
            href="/manage/map"
            style={{ textDecoration: 'none', border: '1px solid var(--da-border)', background: 'var(--da-canvas)', borderRadius: '8px', padding: '8px 14px', fontSize: '12px', fontWeight: 700, color: 'var(--da-brand-dark)', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            ✏️ Edit in Map Builder
          </Link>
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
          {loading || loadingMap ? (
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
                <p style={{ fontSize: '13px', color: 'var(--da-text-secondary)', margin: '0 0 24px', lineHeight: 1.5, fontFamily: 'var(--da-font-family)' }}>
                  No published floor plan was found for this floor. Open the Map Builder to place desks, configure rooms, and publish your live workspace layout.
                </p>
                <button
                  onClick={() => router.push('/manage/map')}
                  style={{ background: 'var(--da-brand-dark)', color: '#fff', border: 'none', padding: '12px 24px', borderRadius: '8px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--da-font-family)', transition: 'opacity 0.2s' }}
                >
                  Open Map Builder
                </button>
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
                  overflow: 'hidden'
                }}
              >
                {elements.map((el: any) => {
                  const isWorkspace = el.elementRole === 'WORKSPACE';
                  const isWall = !isWorkspace && (el.elementType?.toLowerCase().includes('wall') || el.elementType?.toLowerCase().includes('thin_wall') || el.elementType?.toLowerCase().includes('glass') || el.elementType?.toLowerCase().includes('separator'));
                  const isWindow = !isWorkspace && (el.elementType === 'window' || el.elementType?.toLowerCase().includes('window') || el.label?.toLowerCase() === 'window');
                  const isStairs = !isWorkspace && (el.elementType === 'stairs' || el.elementType?.toLowerCase().includes('stairs') || el.elementType?.toLowerCase().includes('staircase') || el.label?.toLowerCase() === 'stairs');
                  const inst = isWorkspace ? instances.find(ins => ins.id === el.workspaceInstanceId) : null;
                  const tmpl = inst ? (inst.template || templates.find(t => t.id === inst.templateId)) : null;
                  const status = inst?.operationalStatus || 'ACTIVE';
                  const isSelected = selectedObjId === el.id;

                  const isRestroom = el.elementType?.toLowerCase().includes('restroom') || el.label?.toLowerCase().includes('restroom');
                  const isPantry = el.elementType?.toLowerCase().includes('pantry') || el.label?.toLowerCase().includes('pantry');
                  const isEmergencyExit = el.elementType?.toLowerCase().includes('exit') || el.elementType?.toLowerCase().includes('emergency') || el.label?.toLowerCase().includes('exit') || el.label?.toLowerCase().includes('emergency');
                  const isAmenity = el.elementRole === 'AMENITY' || isRestroom || isPantry || isEmergencyExit;
                  const isKioskMarker =
                    el.elementType === 'KIOSK_YOU_ARE_HERE' ||
                    el.elementType === 'kiosk' ||
                    el.elementRole === 'INFORMATION' ||
                    el.properties?.markerType === 'KIOSK_YOU_ARE_HERE' ||
                    el.label?.toLowerCase() === 'you are here' ||
                    el.label?.toLowerCase() === 'kiosk';

                  let defaultAmenityColor = '#F3F7F4';
                  if (isRestroom) defaultAmenityColor = '#E0F2FE';
                  else if (isPantry) defaultAmenityColor = '#FEF3C7';
                  else if (isEmergencyExit) defaultAmenityColor = '#DCFCE7';

                  const defaultStructureColor = isWindow ? 'rgba(56, 189, 248, 0.25)' : (isStairs ? '#E2E8F0' : (isWall ? '#334155' : '#F3F7F4'));
                  const displayName = inst?.displayName || el.label || (isKioskMarker ? 'Kiosk' : (tmpl?.name || formatStructureLabel(el.elementType)));
                  const itemColor = el.properties?.color || tmpl?.defaultColor || (isWorkspace ? '#009689' : (isKioskMarker ? '#DC2626' : (isAmenity ? defaultAmenityColor : defaultStructureColor)));

                  const occupancy = isWorkspace && el.workspaceInstanceId ? occupancyByInstanceId.get(el.workspaceInstanceId) : null;
                  const isOccupied = Boolean(occupancy);

                  const isInactive = isWorkspace && status === 'INACTIVE';
                  let bg = el.properties?.color || itemColor;
                  let textColor = isKioskMarker ? '#ffffff' : getContrastColor(bg);
                  let border = isSelected
                    ? '3px solid var(--da-brand-dark)'
                    : (isKioskMarker
                        ? '2px solid #fff'
                        : (isWindow
                            ? '1.5px solid #38BDF8'
                            : (isStairs
                                ? '1.5px solid #94A3B8'
                                : '1px solid rgba(0, 0, 0, 0.15)')));

                  const borderStyle = el.properties?.borderStyle || el.style?.borderStyle || (el.style as any)?.borderStyle;

                  if (isWorkspace) {
                    if (status === 'MAINTENANCE') {
                      border = `2px dashed ${statusColors.maintenance}`;
                      bg = statusColors.maintenance;
                      textColor = getContrastColor(bg);
                    } else if (status === 'INACTIVE') {
                      border = `2px dashed ${statusColors.unavailable}`;
                      bg = statusColors.unavailable;
                      textColor = getContrastColor(bg);
                    } else if (isOccupied) {
                      border = isSelected ? '3px solid var(--da-brand-dark)' : `2px solid ${statusColors.occupied}`;
                      bg = statusColors.occupied;
                      textColor = getContrastColor(bg);
                    } else {
                      border = isSelected ? '3px solid var(--da-brand-dark)' : '1px solid rgba(0, 0, 0, 0.15)';
                      bg = statusColors.available;
                      textColor = getContrastColor(bg);
                    }
                  } else if (isWindow) {
                    border = isSelected ? '3px solid var(--da-brand-dark)' : '1.5px solid #38BDF8';
                  } else if (isStairs) {
                    border = isSelected ? '3px solid var(--da-brand-dark)' : '1.5px solid #94A3B8';
                  } else if (borderStyle === 'dashed') {
                    border = isSelected ? '3px solid var(--da-brand-dark)' : '1.5px dashed var(--da-border, #CBD5E1)';
                  } else if (borderStyle === 'none') {
                    border = isSelected ? '3px solid var(--da-brand-dark)' : 'none';
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
                        zIndex: el.zIndex || 1,
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
                          borderRadius: isKioskMarker ? '14px' : ((isWall || isWindow) ? '2px' : '8px'),
                          boxShadow: isKioskMarker ? '0 4px 12px rgba(220, 38, 38, 0.35)' : (isSelected ? '0 0 0 2px var(--da-brand-dark)' : 'none'),
                          color: textColor,
                          opacity: isInactive ? (isSelected ? 0.6 : 0.25) : 1,
                          position: 'relative',
                          overflow: 'hidden',
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
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="Kiosk">
                              <path d="M12 2a8 8 0 0 0-8 8c0 5.25 8 12 8 12s8-6.75 8-12a8 8 0 0 0-8-8z" fill="#ffffff" stroke="#DC2626" strokeWidth="1.5" />
                              <circle cx="12" cy="10" r="3" fill="#DC2626" />
                            </svg>
                            <span style={{ fontSize: '10px', fontWeight: 800, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#ffffff', textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}>
                              {displayName}
                            </span>
                          </div>
                        ) : isWindow ? (
                          <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                            <div style={{ position: 'absolute', inset: '1px', border: '1px solid rgba(56, 189, 248, 0.4)', borderRadius: '1px', pointerEvents: 'none' }} />
                            <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: '1px', background: 'rgba(56, 189, 248, 0.7)', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
                            <div style={{ position: 'absolute', top: 0, bottom: 0, left: '33.3%', width: '1px', background: 'rgba(56, 189, 248, 0.6)', pointerEvents: 'none' }} />
                            <div style={{ position: 'absolute', top: 0, bottom: 0, left: '66.6%', width: '1px', background: 'rgba(56, 189, 248, 0.6)', pointerEvents: 'none' }} />
                            <span
                              style={{
                                position: 'relative',
                                zIndex: 1,
                                fontSize: '9px',
                                fontWeight: 800,
                                color: '#0284C7',
                                letterSpacing: '0.05em',
                                textTransform: 'uppercase',
                                pointerEvents: 'none',
                                padding: '0 4px',
                                lineHeight: 1,
                                maxWidth: '100%',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {displayName}
                            </span>
                          </div>
                        ) : isStairs ? (
                          <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', padding: '4px' }}>
                            <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', opacity: 0.75 }} xmlns="http://www.w3.org/2000/svg">
                              <defs>
                                <pattern id={`stairs-pattern-admin-${el.id}`} width="100%" height="16" patternUnits="userSpaceOnUse">
                                  <line x1="0" y1="16" x2="100%" y2="16" stroke="#94A3B8" strokeWidth="1.5" />
                                </pattern>
                              </defs>
                              <rect width="100%" height="100%" fill={`url(#stairs-pattern-admin-${el.id})`} />
                              <line x1="50%" y1="85%" x2="50%" y2="20%" stroke="#64748B" strokeWidth="2" strokeLinecap="round" />
                              <polyline points="calc(50% - 6px),30% 50%,18% calc(50% + 6px),30%" fill="none" stroke="#64748B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                            <div style={{ position: 'relative', zIndex: 1, background: 'rgba(255, 255, 255, 0.9)', padding: '2px 6px', borderRadius: '4px', border: '1px solid #CBD5E1', display: 'flex', alignItems: 'center', gap: '4px', maxWidth: '90%' }}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M19 5h-4v4h-4v4H7v4H3v2h18V5z" />
                              </svg>
                              <span style={{ fontSize: '10px', fontWeight: 800, color: '#334155', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {displayName}
                              </span>
                            </div>
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

        {/* Inspector Sidebar */}
        {selectedElement && (
          <aside style={{ width: '280px', background: '#fff', borderLeft: '1px solid var(--da-border)', padding: '20px', flexShrink: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--da-text-secondary)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                  {selectedElement.elementRole}
                </span>
                <h3 style={{ fontSize: '16px', fontWeight: 800, color: 'var(--da-brand-dark)', margin: '3px 0 0' }}>
                  {selectedInstance?.displayName || selectedElement.label || selectedElement.elementType}
                </h3>
              </div>
              <button onClick={() => setSelectedObjId(null)} style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: 'var(--da-text-secondary)' }}>&times;</button>
            </div>

            {selectedInstance ? (
              <>
                {selectedInstance.id && occupancyByInstanceId.get(selectedInstance.id) && (
                  <div style={{ padding: '12px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 800, color: '#991B1B', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                        Occupied Spot
                      </span>
                      <WorkspaceCountdownBadge
                        bookingEndAt={occupancyByInstanceId.get(selectedInstance.id).bookingEndAt}
                        nowMs={currentTick}
                      />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#7F1D1D' }}>Customer:</span>
                      <span style={{ fontWeight: 700, color: '#991B1B' }}>
                        {occupancyByInstanceId.get(selectedInstance.id).customerFirstName} {occupancyByInstanceId.get(selectedInstance.id).customerLastName}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#7F1D1D' }}>Reference:</span>
                      <span style={{ fontWeight: 700, color: '#991B1B', fontFamily: 'monospace' }}>
                        {occupancyByInstanceId.get(selectedInstance.id).referenceCode}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#7F1D1D' }}>Status:</span>
                      <span style={{ fontWeight: 700, color: '#991B1B' }}>
                        {occupancyByInstanceId.get(selectedInstance.id).reservationStatus === 'CHECKED_IN' ? 'Checked In' : 'Confirmed'}
                      </span>
                    </div>
                    {occupancyByInstanceId.get(selectedInstance.id).bookingStartAt && occupancyByInstanceId.get(selectedInstance.id).bookingEndAt && (
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: '#7F1D1D' }}>Window:</span>
                        <span style={{ fontWeight: 600, color: '#991B1B' }}>
                          {new Date(occupancyByInstanceId.get(selectedInstance.id).bookingStartAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - {new Date(occupancyByInstanceId.get(selectedInstance.id).bookingEndAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    )}
                    <button
                      data-testid="map-extend-booking-button"
                      onClick={() => {
                        const occ = occupancyByInstanceId.get(selectedInstance.id);
                        if (occ) {
                          setExtendModalData({
                            reservationId: occ.reservationId || occ.id,
                            referenceCode: occ.referenceCode,
                            customerName: `${occ.customerFirstName} ${occ.customerLastName}`.trim(),
                            spotDisplayName: selectedInstance.displayName || selectedInstance.instanceCode,
                            templateName: selectedTemplate?.name,
                            currentSchedule: occ.bookingStartAt && occ.bookingEndAt
                              ? `${new Date(occ.bookingStartAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${new Date(occ.bookingEndAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                              : undefined,
                            currentEndAt: occ.bookingEndAt || undefined,
                            hourlyRate: selectedTemplate?.rateAmount ?? 150,
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
                    <span style={{ fontWeight: 700, color: 'var(--da-text-primary)' }}>{selectedTemplate?.name || 'Standard'}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--da-text-secondary)' }}>Code:</span>
                    <span style={{ fontWeight: 700, color: 'var(--da-text-primary)' }}>{selectedInstance.instanceCode}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--da-text-secondary)' }}>Rate:</span>
                    <span style={{ fontWeight: 700, color: 'var(--da-text-primary)' }}>₱{selectedTemplate?.rateAmount ?? 0}/hr</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--da-text-secondary)' }}>Capacity:</span>
                    <span style={{ fontWeight: 700, color: 'var(--da-text-primary)' }}>{selectedTemplate?.capacity ?? 1} Person(s)</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--da-text-secondary)' }}>Floor:</span>
                    <span style={{ fontWeight: 700, color: 'var(--da-text-primary)' }}>{publishedMap?.floor?.name || 'Ground Floor'}</span>
                  </div>
                </div>

                {(() => {
                  const tags: string[] = Array.isArray(selectedElement?.properties?.recommendationTags)
                    ? selectedElement.properties.recommendationTags
                    : Array.isArray(selectedElement?.properties?.tags)
                    ? selectedElement.properties.tags
                    : Array.isArray(selectedElement?.properties?.recommendations)
                    ? selectedElement.properties.recommendations
                    : [];
                  if (tags.length === 0) return null;
                  return (
                    <div>
                      <div style={{ fontSize: '11px', fontWeight: 800, color: 'var(--da-text-secondary)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '6px' }}>
                        Amenities & Recommendations
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                        {tags.map((t) => (
                          <span
                            key={t}
                            style={{
                              fontSize: '11px',
                              fontWeight: 600,
                              padding: '2px 8px',
                              borderRadius: '12px',
                              background: 'rgba(0,150,137,0.08)',
                              border: '1px solid rgba(0,150,137,0.2)',
                              color: 'var(--da-brand-dark)',
                            }}
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: 'var(--da-text-primary)', marginBottom: '6px' }}>
                    Operational Status
                  </label>
                  <select
                    disabled={actionLoading}
                    value={selectedInstance.operationalStatus || 'ACTIVE'}
                    onChange={(e) => handleUpdateInstanceStatus(selectedInstance.id, e.target.value)}
                    style={{ width: '100%', border: '1px solid var(--da-border)', borderRadius: '8px', padding: '9px 12px', fontSize: '13px', fontFamily: 'var(--da-font-family)', background: '#fff', fontWeight: 600 }}
                  >
                    <option value="ACTIVE">Active (Bookable)</option>
                    <option value="MAINTENANCE">Maintenance (Blocked)</option>
                    <option value="INACTIVE">Inactive (Hidden)</option>
                  </select>

                  {selectedInstance.operationalStatus === 'MAINTENANCE' && (
                    <div style={{ marginTop: '10px' }}>
                      <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: 'var(--da-text-primary)', marginBottom: '6px' }}>
                        Reason / Note (optional)
                      </label>
                      <textarea
                        data-testid="maintenance-note-input"
                        disabled={actionLoading}
                        maxLength={300}
                        value={maintenanceNoteInput}
                        onChange={(e) => setMaintenanceNoteInput(e.target.value)}
                        placeholder="e.g. Broken chair, AC leak, Wi-Fi outage"
                        rows={2}
                        style={{
                          width: '100%',
                          border: '1px solid var(--da-border)',
                          borderRadius: '8px',
                          padding: '8px 10px',
                          fontSize: '12px',
                          fontFamily: 'var(--da-font-family)',
                          background: '#fff',
                          resize: 'vertical',
                          boxSizing: 'border-box',
                        }}
                      />
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
                        <span style={{ fontSize: '10px', color: 'var(--da-text-secondary)' }}>
                          {maintenanceNoteInput.length}/300 chars
                        </span>
                        <button
                          type="button"
                          data-testid="save-maintenance-note-btn"
                          disabled={actionLoading}
                          onClick={() => handleUpdateInstanceNote(selectedInstance.id, maintenanceNoteInput)}
                          style={{
                            fontSize: '11px',
                            fontWeight: 700,
                            color: 'var(--da-brand-dark)',
                            background: 'transparent',
                            border: 'none',
                            cursor: actionLoading ? 'not-allowed' : 'pointer',
                            padding: '2px 6px',
                          }}
                        >
                          Save Note
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {occupancyByInstanceId.get(selectedInstance.id) && (selectedInstance.operationalStatus === 'MAINTENANCE' || selectedInstance.operationalStatus === 'INACTIVE') && (
                  <div
                    data-testid="relocation-warning-badge"
                    style={{
                      padding: '10px 12px',
                      background: '#FEF2F2',
                      border: '1px solid #FECACA',
                      borderRadius: '8px',
                      fontSize: '12px',
                      color: '#991B1B',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                    }}
                  >
                    <div style={{ fontWeight: 700 }}>⚠️ Reservation needs relocation</div>
                    <div style={{ fontSize: '11px', color: '#7F1D1D' }}>
                      Spot is marked {selectedInstance.operationalStatus}, but has an active/confirmed booking (#{occupancyByInstanceId.get(selectedInstance.id).referenceCode}).
                    </div>
                    <Link
                      href={`/manage/reservations/${occupancyByInstanceId.get(selectedInstance.id).reservationId || occupancyByInstanceId.get(selectedInstance.id).id}`}
                      style={{
                        display: 'inline-block',
                        fontSize: '11px',
                        fontWeight: 700,
                        color: '#991B1B',
                        textDecoration: 'underline',
                      }}
                    >
                      Relocate Reservation &rarr;
                    </Link>
                  </div>
                )}
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
          apiPrefix="/api/admin/reservations"
          actorRole={user?.isSuperAdmin ? "SUPERADMIN" : "ADMIN"}
          actorUserId={user?.id || undefined}
        />
      )}
    </main>
  );
}

