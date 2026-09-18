"use client";

import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/features/auth/components/AuthProvider';
import {
  computeFitViewZoom,
  clampMapZoom,
  clampRotatedElementToBounds,
  isRotatedElementWithinBounds,
  getSavedMapZoom,
  saveMapZoom,
  DEFAULT_MAP_CANVAS_WIDTH,
  DEFAULT_MAP_CANVAS_HEIGHT,
  DEFAULT_MAP_GRID_SIZE,
  MapUndoRedoManager,
  type MapCommand,
  serializeMapElementsForSnapshot,
  isMapDraftDirty,
  createAutosaveDebouncer,
  AUTOSAVE_DEBOUNCE_MS,
  NAVIGATION_WARNING_MESSAGE,
  WORKSPACE_AMENITY_CATEGORIES,
  type CustomStructureTemplate,
} from '@deskatlas/domain';
import { useNavigationGuard } from '../hooks/useNavigationGuard';

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

export function MapEditor() {
  const { user } = useAuth();
  const gridOn = true;
  const snapOn = true;
  const [showInspector, setShowInspector] = useState(true);
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [showFloorModal, setShowFloorModal] = useState(false);
  const [newFloorName, setNewFloorName] = useState('');
  const [builderZoom, setBuilderZoom] = useState(1);
  const [saveState, setSaveState] = useState('Saved');
  const [selectedObjId, setSelectedObjId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Database entities
  const [floors, setFloors] = useState<any[]>([]);
  const [selectedFloorId, setSelectedFloorId] = useState<string | null>(null);
  const [applyColorToSimilar, setApplyColorToSimilar] = useState(false);
  const [templates, setTemplates] = useState<any[]>([]);
  const [instances, setInstances] = useState<any[]>([]);
  const [builderObjects, setBuilderObjects] = useState<any[]>([]);
  const [customStructures, setCustomStructures] = useState<CustomStructureTemplate[]>([]);
  const [showCustomStructureModal, setShowCustomStructureModal] = useState(false);
  const [editingCustomStructure, setEditingCustomStructure] = useState<CustomStructureTemplate | null>(null);
  const [customFormName, setCustomFormName] = useState('');
  const [customFormWidth, setCustomFormWidth] = useState('120');
  const [customFormHeight, setCustomFormHeight] = useState('60');
  const [customFormColor, setCustomFormColor] = useState('#CBD5E1');
  const [customFormBorderStyle, setCustomFormBorderStyle] = useState<'solid' | 'dashed' | 'none'>('solid');
  const [customFormCategory, setCustomFormCategory] = useState('ARCHITECTURAL');
  const [customFormDescription, setCustomFormDescription] = useState('');
  const [customStructureLoading, setCustomStructureLoading] = useState(false);

  const canvasRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasDimensions, setCanvasDimensions] = useState({
    width: DEFAULT_MAP_CANVAS_WIDTH,
    height: DEFAULT_MAP_CANVAS_HEIGHT,
    gridSize: DEFAULT_MAP_GRID_SIZE,
  });
  const [dragState, setDragState] = useState<{ id: string; startX: number; startY: number; startObjX: number; startObjY: number } | null>(null);
  const [resizeState, setResizeState] = useState<{ id: string; startX: number; startY: number; startObjW: number; startObjH: number; startObjX: number; startObjY: number } | null>(null);

  const builderObjectsRef = useRef(builderObjects);
  builderObjectsRef.current = builderObjects;

  const selectedFloorIdRef = useRef(selectedFloorId);
  selectedFloorIdRef.current = selectedFloorId;

  const canvasDimensionsRef = useRef(canvasDimensions);
  canvasDimensionsRef.current = canvasDimensions;

  const savedSnapshotRef = useRef<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  useNavigationGuard({ isDirty });

  const autosaveDebouncerRef = useRef<ReturnType<typeof createAutosaveDebouncer> | null>(null);

  const undoManagerRef = useRef<MapUndoRedoManager>(new MapUndoRedoManager(50));
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const initialNameRef = useRef<string>('');

  const syncUndoRedoState = (floorId: string | null = selectedFloorId) => {
    if (!floorId) {
      setCanUndo(false);
      setCanRedo(false);
      return;
    }
    setCanUndo(undoManagerRef.current.canUndo(floorId));
    setCanRedo(undoManagerRef.current.canRedo(floorId));
  };

  useEffect(() => {
    syncUndoRedoState(selectedFloorId);
  }, [selectedFloorId]);

  const handleUndo = () => {
    if (!selectedFloorId || !undoManagerRef.current.canUndo(selectedFloorId)) return;
    const res = undoManagerRef.current.undo(selectedFloorId, builderObjectsRef.current);
    setBuilderObjects(res.updatedObjects);
    setCanUndo(res.canUndo);
    setCanRedo(res.canRedo);
    setSaveState('Unsaved changes');
    if (selectedObjId && !res.updatedObjects.some(o => o.id === selectedObjId)) {
      setSelectedObjId(null);
    }
  };

  const handleRedo = () => {
    if (!selectedFloorId || !undoManagerRef.current.canRedo(selectedFloorId)) return;
    const res = undoManagerRef.current.redo(selectedFloorId, builderObjectsRef.current);
    setBuilderObjects(res.updatedObjects);
    setCanUndo(res.canUndo);
    setCanRedo(res.canRedo);
    setSaveState('Unsaved changes');
    if (selectedObjId && !res.updatedObjects.some(o => o.id === selectedObjId)) {
      setSelectedObjId(null);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      const isCtrlOrCmd = e.ctrlKey || e.metaKey;
      if (!isCtrlOrCmd) return;

      const key = e.key.toLowerCase();
      if (key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      } else if (key === 'y') {
        e.preventDefault();
        handleRedo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedFloorId, canUndo, canRedo, selectedObjId]);

  // Load floors & workspace catalog
  const loadInitialData = async () => {
    try {
      setLoading(true);
      setErrorMsg(null);

      const [wsRes, floorsRes, structuresRes] = await Promise.all([
        fetch('/api/admin/workspaces'),
        fetch('/api/admin/workspaces/floors'),
        fetch('/api/admin/structures'),
      ]);

      const wsData = wsRes.ok ? await wsRes.json() : {};
      const floorsData = floorsRes.ok ? await floorsRes.json() : {};
      const structuresData = structuresRes.ok ? await structuresRes.json() : {};

      const loadedFloors = floorsData.floors || wsData.floors || [];
      const loadedTemplates = wsData.templates || [];
      const loadedInstances = wsData.instances || [];
      const loadedCustomStructures = structuresData.templates || [];

      setFloors(loadedFloors);
      setTemplates(loadedTemplates);
      setInstances(loadedInstances);
      setCustomStructures(loadedCustomStructures);

      if (loadedFloors.length > 0) {
        const firstFloorId = loadedFloors[0].id;
        setSelectedFloorId(firstFloorId);
        await loadDraftForFloor(firstFloorId, loadedInstances, loadedTemplates);
      } else {
        setBuilderObjects([]);
        savedSnapshotRef.current = serializeMapElementsForSnapshot([]);
        setIsDirty(false);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to load initial map data');
    } finally {
      setLoading(false);
    }
  };

  const loadDraftForFloor = async (floorId: string, currentInstances = instances, currentTemplates = templates) => {
    try {
      setSaveState('Loading map...');
      // 1. Try draft map first
      const draftRes = await fetch(`/api/admin/maps/draft?floorId=${encodeURIComponent(floorId)}`);
      let mapData: any = null;
      let isDraft = false;

      if (draftRes.ok) {
        const data = await draftRes.json();
        const draftObj = data.draft;
        if (draftObj && Array.isArray(draftObj.elements) && draftObj.elements.length > 0) {
          mapData = draftObj;
          isDraft = true;
        }
      }

      // 2. If no draft found, fallback to published map
      if (!mapData) {
        const pubRes = await fetch(`/api/admin/maps/published?floorId=${encodeURIComponent(floorId)}`);
        if (pubRes.ok) {
          const pubData = await pubRes.json();
          const pubObj = pubData.published;
          if (pubObj && Array.isArray(pubObj.elements) && pubObj.elements.length > 0) {
            mapData = pubObj;
            isDraft = false;
          }
        }
      }

      const canvasW = Number(mapData?.version?.canvasWidth) || DEFAULT_MAP_CANVAS_WIDTH;
      const canvasH = Number(mapData?.version?.canvasHeight) || DEFAULT_MAP_CANVAS_HEIGHT;
      const grid = Number(mapData?.version?.gridSize) || DEFAULT_MAP_GRID_SIZE;
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

      if (!mapData || !mapData.elements || mapData.elements.length === 0) {
        setBuilderObjects([]);
        setSelectedObjId(null);
        savedSnapshotRef.current = serializeMapElementsForSnapshot([]);
        setIsDirty(false);
        setSaveState('Saved');
        return;
      }

      const rawElements = mapData.elements || [];

      const mapped = rawElements.map((el: any) => {
        const inst = el.workspaceInstanceId
          ? currentInstances.find((i: any) => i.id === el.workspaceInstanceId)
          : null;
        const tmpl = inst
          ? (inst.template || currentTemplates.find((t: any) => t.id === inst.templateId))
          : currentTemplates.find((t: any) => t.id === el.properties?.templateId || t.name === el.properties?.template);

        const isWorkspace = el.elementRole === 'WORKSPACE' || Boolean(el.workspaceInstanceId) || Boolean(inst);
        const isRestroom = !isWorkspace && (el.elementType?.toLowerCase().includes('restroom') || el.label?.toLowerCase().includes('restroom'));
        const isPantry = !isWorkspace && (el.elementType?.toLowerCase().includes('pantry') || el.label?.toLowerCase().includes('pantry'));
        const isEmergencyExit = !isWorkspace && (el.elementType?.toLowerCase().includes('exit') || el.elementType?.toLowerCase().includes('emergency') || el.label?.toLowerCase().includes('exit') || el.label?.toLowerCase().includes('emergency'));
        const isAmenity = !isWorkspace && (el.elementRole === 'AMENITY' || isRestroom || isPantry || isEmergencyExit);
        const isKioskMarker =
          !isWorkspace &&
          (el.elementType === 'KIOSK_YOU_ARE_HERE' ||
            el.elementType === 'kiosk_marker' ||
            el.elementRole === 'INFORMATION' ||
            el.properties?.markerType === 'KIOSK_YOU_ARE_HERE' ||
            el.label?.toLowerCase() === 'you are here');

        let defaultAmenityColor = '#F3F7F4';
        if (isRestroom) defaultAmenityColor = '#E0F2FE';
        else if (isPantry) defaultAmenityColor = '#FEF3C7';
        else if (isEmergencyExit) defaultAmenityColor = '#DCFCE7';

        const color = el.properties?.color || tmpl?.defaultColor || (isWorkspace ? '#009689' : (isKioskMarker ? '#DC2626' : (isAmenity ? defaultAmenityColor : '#F3F7F4')));
        const displayName = el.label || (isKioskMarker ? 'You Are Here' : (inst?.displayName || tmpl?.name || el.elementType));

        const isThinWall = !isWorkspace && (el.elementType === 'thin_wall' || el.elementType === 'thin' || el.elementType?.toLowerCase().includes('thin_wall') || el.label?.toLowerCase() === 'thin wall' || el.elementType?.toLowerCase().includes('separator') || el.label?.toLowerCase().includes('separator'));
        const isGlass = !isWorkspace && (el.elementType?.toLowerCase().includes('glass') || el.label?.toLowerCase().includes('glass'));
        const isWall = !isWorkspace && (el.elementType === 'wall' || el.elementType?.toLowerCase().includes('wall') || el.label?.toLowerCase() === 'wall' || isThinWall || isGlass);
        const isRect = isWorkspace
          ? (el.elementType?.toLowerCase() === 'rectangle' || el.elementType?.toLowerCase() === 'rect' || tmpl?.defaultShape?.toLowerCase() === 'rectangle' || tmpl?.defaultShape?.toLowerCase() === 'rect')
          : (el.elementType?.toLowerCase() === 'rectangle' || el.elementType?.toLowerCase() === 'rect');
        const defaultW = isKioskMarker ? 80 : (isWorkspace ? (isRect ? 120 : 80) : (isWall ? 160 : (isAmenity ? 100 : 80)));
        const defaultH = isKioskMarker ? 80 : (isWorkspace ? 80 : (isThinWall ? 10 : (isWall ? 20 : (isAmenity ? 80 : 80))));

        let normType = el.elementType;
        if (isKioskMarker) {
          normType = 'KIOSK_YOU_ARE_HERE';
        } else if (!normType || normType === 'generic') {
          if (isWorkspace) normType = tmpl?.defaultShape || 'desk';
          else if (isRestroom) normType = 'restroom';
          else if (isPantry) normType = 'pantry';
          else if (isEmergencyExit) normType = 'emergency_exit';
          else if (isThinWall) normType = 'thin_wall';
          else if (isGlass) normType = 'glass';
          else if (isWall) normType = 'wall';
          else normType = 'generic';
        }

        const recommendationTags = Array.isArray(el.properties?.recommendationTags)
          ? el.properties.recommendationTags
          : Array.isArray(el.properties?.tags)
            ? el.properties.tags
            : Array.isArray(el.properties?.recommendations)
              ? el.properties.recommendations
              : [];

        return {
          id: el.id,
          name: displayName,
          x: Number(el.x) || 0,
          y: Number(el.y) || 0,
          w: el.width !== undefined && el.width !== null ? Number(el.width) : defaultW,
          h: isKioskMarker ? 80 : (isWorkspace ? (el.height !== undefined && el.height !== null ? Number(el.height) : defaultH) : (isThinWall ? 10 : (isWall ? 20 : (el.height !== undefined && el.height !== null ? Number(el.height) : defaultH)))),
          rotation: el.rotation || 0,
          bookable: isWorkspace,
          template: tmpl?.name || el.properties?.template || null,
          status: inst?.operationalStatus || (isWorkspace ? 'ACTIVE' : null),
          workspaceInstanceId: el.workspaceInstanceId || null,
          elementRole: isWorkspace ? 'WORKSPACE' : (isKioskMarker ? 'INFORMATION' : (isAmenity ? 'AMENITY' : (el.elementRole || 'STRUCTURE'))),
          elementType: normType,
          color,
          borderStyle: el.properties?.borderStyle || 'solid',
          properties: el.properties || {},
          recommendationTags,
        };
      });

      setBuilderObjects(mapped);
      savedSnapshotRef.current = serializeMapElementsForSnapshot(mapped);
      setIsDirty(false);
      if (mapped.length > 0) {
        setSelectedObjId(mapped[0].id);
      } else {
        setSelectedObjId(null);
      }
      setSaveState(isDraft ? 'Draft loaded' : 'Published map loaded');
    } catch (err: any) {
      setSaveState('Load failed');
      setErrorMsg(err.message || 'Failed to load map data');
    }
  };

  useEffect(() => {
    loadInitialData();
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

  const handleFloorChange = async (floorId: string) => {
    if (floorId === selectedFloorId) return;

    if (isDirty) {
      const confirmed = window.confirm(NAVIGATION_WARNING_MESSAGE);
      if (!confirmed) {
        return;
      }
    }

    autosaveDebouncerRef.current?.cancel();
    setSelectedFloorId(floorId);
    syncUndoRedoState(floorId);
    await loadDraftForFloor(floorId);
  };

  const handleCreateFloor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFloorName.trim()) return;

    try {
      setActionLoading(true);
      setErrorMsg(null);

      const res = await fetch('/api/admin/workspaces/floors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newFloorName.trim() }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to create floor');
      }

      const createdFloor = await res.json();
      const updatedFloors = [...floors, createdFloor];
      setFloors(updatedFloors);
      setSelectedFloorId(createdFloor.id);
      setNewFloorName('');
      setShowFloorModal(false);
      await loadDraftForFloor(createdFloor.id);
    } catch (err: any) {
      setErrorMsg(err.message || 'Error creating floor');
    } finally {
      setActionLoading(false);
    }
  };

  // Add workspace instance / element to canvas
  const handleAddWorkspace = async (tpl: any) => {
    if (!selectedFloorId) {
      setShowFloorModal(true);
      return;
    }

    try {
      setActionLoading(true);
      const floor = floors.find(f => f.id === selectedFloorId);
      const codeSuffix = String(Math.floor(1000 + Math.random() * 9000));
      const instanceCode = `${tpl.name.substring(0, 3).toUpperCase()}-${codeSuffix}`;
      const displayName = `${tpl.name} ${builderObjects.filter(o => o.template === tpl.name).length + 1}`;

      // Create instance in DB
      const res = await fetch('/api/admin/workspaces/instances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId: tpl.id,
          floorId: selectedFloorId,
          instanceCode,
          displayName,
          operationalStatus: 'ACTIVE',
        }),
      });

      let instanceId: string | null = null;
      if (res.ok) {
        const instData = await res.json();
        instanceId = instData.instance?.id || instData.id;
      }

      const shape = tpl.defaultShape || 'desk';
      const isRect = shape.toLowerCase() === 'rectangle' || shape.toLowerCase() === 'rect';
      const initialW = isRect ? 120 : 80;
      const initialH = 80;

      const newObj = {
        id: 'el-' + Date.now(),
        name: displayName,
        x: 100,
        y: 100,
        w: initialW,
        h: initialH,
        rotation: 0,
        bookable: true,
        template: tpl.name,
        status: 'ACTIVE',
        workspaceInstanceId: instanceId,
        elementRole: 'WORKSPACE',
        elementType: shape,
        color: tpl.defaultColor || 'rgba(200, 244, 81, 0.4)',
        recommendationTags: [],
      };

      setBuilderObjects(prev => [...prev, newObj]);
      setSelectedObjId(newObj.id);
      setShowInspector(true);
      setSaveState('Unsaved changes');

      undoManagerRef.current.push(selectedFloorId, {
        type: 'ADD_OBJECT',
        object: newObj,
      });
      syncUndoRedoState(selectedFloorId);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to place workspace');
    } finally {
      setActionLoading(false);
    }
  };

  // Add structural element
  const handleAddStructure = (type: string) => {
    if (!selectedFloorId) {
      setShowFloorModal(true);
      return;
    }

    const isRestroom = type.toLowerCase().includes('restroom');
    const isPantry = type.toLowerCase().includes('pantry');
    const isEmergencyExit = type.toLowerCase().includes('emergency') || type.toLowerCase().includes('exit');
    const isAmenity = isRestroom || isPantry || isEmergencyExit;

    let role: 'STRUCTURE' | 'AMENITY' = 'STRUCTURE';
    let defaultColor = '#F3F7F4';
    let elementType = type.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    let initialW = 100;
    let initialH = 80;

    if (isAmenity) {
      role = 'AMENITY';
      if (isRestroom) {
        defaultColor = '#E0F2FE';
        elementType = 'restroom';
        initialW = 100;
        initialH = 80;
      } else if (isPantry) {
        defaultColor = '#FEF3C7';
        elementType = 'pantry';
        initialW = 100;
        initialH = 80;
      } else if (isEmergencyExit) {
        defaultColor = '#DCFCE7';
        elementType = 'emergency_exit';
        initialW = 100;
        initialH = 80;
      }
    } else {
      const isThinWall = type.toLowerCase().includes('thin') || type.toLowerCase().includes('separator');
      const isGlass = type.toLowerCase().includes('glass');
      const isWall = type.toLowerCase().includes('wall') || isThinWall || isGlass;
      const initialThickness = isThinWall ? 10 : (isWall ? 20 : 80);
      initialW = isWall ? 160 : 100;
      initialH = initialThickness;
      defaultColor = isThinWall ? '#94A3B8' : (isGlass ? 'rgba(59, 130, 246, 0.15)' : '#F3F7F4');
    }

    const newObj = {
      id: (isAmenity ? 'amn-' : 'str-') + Date.now(),
      name: type,
      x: 140,
      y: 140,
      w: initialW,
      h: initialH,
      rotation: 0,
      bookable: false,
      template: null,
      status: null,
      workspaceInstanceId: null,
      elementRole: role,
      elementType,
      color: defaultColor,
    };

    setBuilderObjects(prev => [...prev, newObj]);
    setSelectedObjId(newObj.id);
    setShowInspector(true);
    setSaveState('Unsaved changes');

    undoManagerRef.current.push(selectedFloorId, {
      type: 'ADD_OBJECT',
      object: newObj,
    });
    syncUndoRedoState(selectedFloorId);
  };

  // Add Custom Structure from template
  const handleAddCustomStructure = (cst: CustomStructureTemplate) => {
    if (!selectedFloorId) {
      setShowFloorModal(true);
      return;
    }

    const initialW = cst.defaultWidth || 120;
    const initialH = cst.defaultHeight || 60;
    const defaultColor = cst.defaultColor || '#CBD5E1';
    const borderStyle = cst.borderStyle || 'solid';
    const elementType = cst.name.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'custom_structure';

    const newObj = {
      id: 'cstr-' + Date.now(),
      name: cst.name,
      x: 140,
      y: 140,
      w: initialW,
      h: initialH,
      rotation: 0,
      bookable: false,
      template: null,
      status: null,
      workspaceInstanceId: null,
      elementRole: 'STRUCTURE',
      elementType,
      color: defaultColor,
      borderStyle,
      properties: {
        isCustomStructure: true,
        templateId: cst.id,
        borderStyle,
        category: cst.category || 'ARCHITECTURAL',
      },
    };

    setBuilderObjects(prev => [...prev, newObj]);
    setSelectedObjId(newObj.id);
    setShowInspector(true);
    setSaveState('Unsaved changes');

    undoManagerRef.current.push(selectedFloorId, {
      type: 'ADD_OBJECT',
      object: newObj,
    });
    syncUndoRedoState(selectedFloorId);
  };

  const handleOpenCreateCustomStructure = () => {
    setEditingCustomStructure(null);
    setCustomFormName('');
    setCustomFormWidth('120');
    setCustomFormHeight('60');
    setCustomFormColor('#CBD5E1');
    setCustomFormBorderStyle('solid');
    setCustomFormCategory('ARCHITECTURAL');
    setCustomFormDescription('');
    setShowCustomStructureModal(true);
  };

  const handleOpenEditCustomStructure = (cst: CustomStructureTemplate, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setEditingCustomStructure(cst);
    setCustomFormName(cst.name);
    setCustomFormWidth(String(cst.defaultWidth || 120));
    setCustomFormHeight(String(cst.defaultHeight || 60));
    setCustomFormColor(cst.defaultColor || '#CBD5E1');
    setCustomFormBorderStyle(cst.borderStyle || 'solid');
    setCustomFormCategory(cst.category || 'ARCHITECTURAL');
    setCustomFormDescription(cst.description || '');
    setShowCustomStructureModal(true);
  };

  const handleSaveCustomStructure = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customFormName.trim()) {
      setErrorMsg('Structure name is required');
      return;
    }
    const widthNum = parseInt(customFormWidth, 10);
    const heightNum = parseInt(customFormHeight, 10);
    if (isNaN(widthNum) || widthNum < 20 || widthNum > 2000) {
      setErrorMsg('Width must be between 20 and 2000 px');
      return;
    }
    if (isNaN(heightNum) || heightNum < 20 || heightNum > 2000) {
      setErrorMsg('Height must be between 20 and 2000 px');
      return;
    }

    try {
      setCustomStructureLoading(true);
      setErrorMsg(null);

      const payload = {
        name: customFormName.trim(),
        description: customFormDescription.trim() || null,
        defaultWidth: widthNum,
        defaultHeight: heightNum,
        defaultColor: customFormColor || '#CBD5E1',
        borderStyle: customFormBorderStyle,
        category: customFormCategory || 'ARCHITECTURAL',
        isActive: true,
      };

      if (editingCustomStructure) {
        const res = await fetch(`/api/admin/structures/${editingCustomStructure.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Failed to update custom structure');
        }
        const data = await res.json();
        setCustomStructures(prev =>
          prev.map(item => (item.id === editingCustomStructure.id ? data.template : item))
        );
        setSuccessMsg(`Structure "${data.template.name}" updated successfully`);
      } else {
        const res = await fetch('/api/admin/structures', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Failed to create custom structure');
        }
        const data = await res.json();
        setCustomStructures(prev => [...prev, data.template]);
        setSuccessMsg(`Custom structure "${data.template.name}" created and added to palette`);
      }

      setShowCustomStructureModal(false);
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err: any) {
      setErrorMsg(err.message || 'Error saving custom structure');
    } finally {
      setCustomStructureLoading(false);
    }
  };

  const handleDeleteCustomStructure = async (id: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Are you sure you want to delete custom structure template "${name}"? Existing placed structures on maps will not be removed.`)) {
      return;
    }
    try {
      setErrorMsg(null);
      const res = await fetch(`/api/admin/structures/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to delete custom structure');
      }
      setCustomStructures(prev => prev.filter(item => item.id !== id));
      setSuccessMsg(`Custom structure "${name}" deleted`);
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to delete custom structure');
    }
  };

  // Add Kiosk "You Are Here" Marker (enforce at most 1 per floor)
  const handleAddKioskMarker = () => {
    if (!selectedFloorId) {
      setShowFloorModal(true);
      return;
    }

    const existingIndex = builderObjects.findIndex(
      (o) => o.elementType === 'KIOSK_YOU_ARE_HERE' || o.elementRole === 'INFORMATION'
    );

    if (existingIndex >= 0) {
      const existing = builderObjects[existingIndex];
      setSelectedObjId(existing.id);
      setShowInspector(true);
      setSuccessMsg('Kiosk marker already exists on this floor. Selected existing marker.');
      setTimeout(() => setSuccessMsg(null), 3000);
      return;
    }

    const newObj = {
      id: 'kiosk-marker-' + Date.now(),
      name: 'You Are Here',
      x: 100,
      y: 100,
      w: 80,
      h: 80,
      rotation: 0,
      bookable: false,
      template: null,
      status: null,
      workspaceInstanceId: null,
      elementRole: 'INFORMATION',
      elementType: 'KIOSK_YOU_ARE_HERE',
      color: '#DC2626',
    };

    setBuilderObjects(prev => [...prev, newObj]);
    setSelectedObjId(newObj.id);
    setShowInspector(true);
    setSaveState('Unsaved changes');

    undoManagerRef.current.push(selectedFloorId, {
      type: 'ADD_OBJECT',
      object: newObj,
    });
    syncUndoRedoState(selectedFloorId);
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

  // Drag and Resize handlers
  useEffect(() => {
    if (dragState) {
      const handlePointerMove = (e: PointerEvent) => {
        const dx = (e.clientX - dragState.startX) / builderZoom;
        const dy = (e.clientY - dragState.startY) / builderZoom;

        let newX = dragState.startObjX + dx;
        let newY = dragState.startObjY + dy;

        if (snapOn) {
          newX = Math.round(newX / 20) * 20;
          newY = Math.round(newY / 20) * 20;
        }

        const obj = builderObjects.find(o => o.id === dragState.id);
        const objW = obj?.w || 0;
        const objH = obj?.h || 0;

        const canvasW = canvasDimensions.width;
        const canvasH = canvasDimensions.height;

        const clamped = clampRotatedElementToBounds(
          { x: newX, y: newY, width: objW, height: objH, rotation: obj?.rotation || 0 },
          canvasW,
          canvasH
        );
        newX = clamped.x;
        newY = clamped.y;

        setBuilderObjects(prev => prev.map(o => (o.id === dragState.id ? { ...o, x: newX, y: newY } : o)));
        setSaveState('Unsaved changes');
      };

      const handlePointerUp = () => {
        const finalObj = builderObjectsRef.current.find(o => o.id === dragState.id);
        if (
          finalObj &&
          selectedFloorId &&
          (finalObj.x !== dragState.startObjX || finalObj.y !== dragState.startObjY)
        ) {
          undoManagerRef.current.push(selectedFloorId, {
            type: 'MOVE_OBJECT',
            id: dragState.id,
            before: { x: dragState.startObjX, y: dragState.startObjY },
            after: { x: finalObj.x, y: finalObj.y },
          });
          syncUndoRedoState(selectedFloorId);
        }
        setDragState(null);
      };

      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerUp);
      return () => {
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
      };
    } else if (resizeState) {
      const handlePointerMove = (e: PointerEvent) => {
        const dx = (e.clientX - resizeState.startX) / builderZoom;
        const dy = (e.clientY - resizeState.startY) / builderZoom;

        const obj = builderObjects.find(o => o.id === resizeState.id);
        const isWorkspace = Boolean(obj && (obj.bookable || obj.elementRole === 'WORKSPACE' || obj.workspaceInstanceId));
        const isThinWall = !isWorkspace && Boolean(obj && (
          obj.elementType === 'thin_wall' ||
          obj.elementType === 'thin' ||
          obj.elementType?.toLowerCase().includes('thin_wall') ||
          obj.elementType?.toLowerCase().includes('separator') ||
          obj.name?.toLowerCase() === 'thin wall' ||
          obj.name?.toLowerCase().includes('separator')
        ));
        const isGlass = !isWorkspace && Boolean(obj && (
          obj.elementType?.toLowerCase().includes('glass') ||
          obj.name?.toLowerCase().includes('glass')
        ));
        const isWall = !isWorkspace && Boolean(obj && (
          obj.elementType === 'wall' ||
          obj.elementType?.toLowerCase().includes('wall') ||
          obj.name?.toLowerCase() === 'wall' ||
          isThinWall ||
          isGlass
        ));
        const fixedThickness = isThinWall ? 10 : 20;

        if (!isWorkspace && isWall && obj) {
          const rot = ((obj.rotation || 0) % 360 + 360) % 360;
          let dLength = dx;
          if (rot === 90) {
            dLength = dy;
          } else if (rot === 180) {
            dLength = -dx;
          } else if (rot === 270) {
            dLength = -dy;
          }

          let newW = Math.max(20, resizeState.startObjW + dLength);
          if (snapOn) {
            newW = Math.round(newW / 20) * 20;
          }

          const dw = newW - resizeState.startObjW;
          let newX = resizeState.startObjX;
          let newY = resizeState.startObjY;

          if (rot === 90) {
            // Keep visual left static and visual top static, extend downwards
            newX = resizeState.startObjX - dw / 2;
            newY = resizeState.startObjY + dw / 2;
          } else if (rot === 270) {
            // Keep visual left static and visual bottom static, extend upwards
            newX = resizeState.startObjX - dw / 2;
            newY = resizeState.startObjY - dw / 2;
          } else if (rot === 180) {
            // Keep visual top static and visual right static, extend leftwards
            newX = resizeState.startObjX - dw;
            newY = resizeState.startObjY;
          } else {
            // rot === 0: default horizontal, extends rightwards
            newX = resizeState.startObjX;
            newY = resizeState.startObjY;
          }

          setBuilderObjects(prev => prev.map(o => (o.id === resizeState.id ? { ...o, x: newX, y: newY, w: newW, h: fixedThickness } : o)));
          setSaveState('Unsaved changes');
        } else {
          let newW = Math.max(20, resizeState.startObjW + dx);
          let newH = Math.max(20, resizeState.startObjH + dy);

          if (snapOn) {
            newW = Math.round(newW / 20) * 20;
            newH = Math.round(newH / 20) * 20;
          }

          const objX = obj?.x || 0;
          const objY = obj?.y || 0;

          const canvasW = canvasDimensions.width;
          const canvasH = canvasDimensions.height;

          newW = Math.min(newW, canvasW - objX);
          newH = Math.min(newH, canvasH - objY);

          setBuilderObjects(prev => prev.map(o => (o.id === resizeState.id ? { ...o, w: newW, h: newH } : o)));
          setSaveState('Unsaved changes');
        }
      };

      const handlePointerUp = () => {
        const finalObj = builderObjectsRef.current.find(o => o.id === resizeState.id);
        if (
          finalObj &&
          selectedFloorId &&
          (finalObj.w !== resizeState.startObjW ||
            finalObj.h !== resizeState.startObjH ||
            finalObj.x !== resizeState.startObjX ||
            finalObj.y !== resizeState.startObjY)
        ) {
          undoManagerRef.current.push(selectedFloorId, {
            type: 'RESIZE_OBJECT',
            id: resizeState.id,
            before: {
              w: resizeState.startObjW,
              h: resizeState.startObjH,
              x: resizeState.startObjX,
              y: resizeState.startObjY,
            },
            after: {
              w: finalObj.w,
              h: finalObj.h,
              x: finalObj.x,
              y: finalObj.y,
            },
          });
          syncUndoRedoState(selectedFloorId);
        }
        setResizeState(null);
      };

      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerUp);
      return () => {
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
      };
    }
  }, [dragState, resizeState, builderZoom, snapOn, builderObjects, canvasDimensions]);

  // Save draft
  const handleSaveDraft = async (isAutosave = false) => {
    const floorId = selectedFloorIdRef.current;
    if (!floorId) return;

    try {
      setSaveState(isAutosave ? 'Saving...' : 'Saving draft...');
      if (!isAutosave) {
        setErrorMsg(null);
        autosaveDebouncerRef.current?.cancel();
      }

      const currentObjects = builderObjectsRef.current;
      const elementsPayload = currentObjects.map((obj, index) => {
        const isWorkspace = Boolean(obj.bookable || obj.elementRole === 'WORKSPACE' || obj.workspaceInstanceId);
        const isThinWall = !isWorkspace && (
          obj.elementType === 'thin_wall' ||
          obj.elementType === 'thin' ||
          obj.elementType?.toLowerCase().includes('thin_wall') ||
          obj.elementType?.toLowerCase().includes('separator') ||
          obj.name?.toLowerCase() === 'thin wall' ||
          obj.name?.toLowerCase().includes('separator')
        );
        const isGlass = !isWorkspace && (obj.elementType?.toLowerCase().includes('glass') || obj.name?.toLowerCase().includes('glass'));
        const isWall = !isWorkspace && (
          obj.elementType === 'wall' ||
          obj.elementType?.toLowerCase().includes('wall') ||
          obj.name?.toLowerCase() === 'wall' ||
          isThinWall ||
          isGlass
        );
        const isRestroom = !isWorkspace && (obj.elementType?.toLowerCase().includes('restroom') || obj.name?.toLowerCase().includes('restroom'));
        const isPantry = !isWorkspace && (obj.elementType?.toLowerCase().includes('pantry') || obj.name?.toLowerCase().includes('pantry'));
        const isEmergencyExit = !isWorkspace && (obj.elementType?.toLowerCase().includes('exit') || obj.elementType?.toLowerCase().includes('emergency') || obj.name?.toLowerCase().includes('exit') || obj.name?.toLowerCase().includes('emergency'));
        const isAmenity = !isWorkspace && (obj.elementRole === 'AMENITY' || isRestroom || isPantry || isEmergencyExit);
        const isKioskMarker = !isWorkspace && (
          obj.elementType === 'KIOSK_YOU_ARE_HERE' ||
          obj.elementRole === 'INFORMATION' ||
          obj.name?.toLowerCase() === 'you are here'
        );
        const fixedThickness = isThinWall ? 10 : 20;

        let role: 'WORKSPACE' | 'STRUCTURE' | 'AMENITY' | 'INFORMATION' = isWorkspace
          ? 'WORKSPACE'
          : (isKioskMarker ? 'INFORMATION' : (isAmenity ? 'AMENITY' : (obj.elementRole || 'STRUCTURE')));
        let normType = obj.elementType;
        if (isKioskMarker) {
          normType = 'KIOSK_YOU_ARE_HERE';
        } else if (!normType || normType === 'generic') {
          if (isWorkspace) normType = 'desk';
          else if (isRestroom) normType = 'restroom';
          else if (isPantry) normType = 'pantry';
          else if (isEmergencyExit) normType = 'emergency_exit';
          else if (isThinWall) normType = 'thin_wall';
          else if (isGlass) normType = 'glass';
          else if (isWall) normType = 'wall';
          else normType = 'generic';
        }

        return {
          elementRole: role,
          elementType: normType,
          workspaceInstanceId: obj.workspaceInstanceId || null,
          x: Math.round(obj.x),
          y: Math.round(obj.y),
          width: Math.max(20, Math.round(obj.w)),
          height: isKioskMarker ? 80 : (isWall ? fixedThickness : Math.max(20, Math.round(obj.h))),
          rotation: (obj.rotation || 0) as 0 | 90 | 180 | 270,
          zIndex: index + 1,
          label: obj.name || (isKioskMarker ? 'You Are Here' : null),
          properties: {
            color: obj.color,
            recommendationTags: obj.recommendationTags || [],
            ...(obj.borderStyle ? { borderStyle: obj.borderStyle } : {}),
            ...(obj.properties || {}),
            ...(isKioskMarker ? { markerType: 'KIOSK_YOU_ARE_HERE' } : {}),
          },
          isLocked: false,
        };
      });

      const res = await fetch('/api/admin/maps/draft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          floorId,
          canvasWidth: canvasDimensionsRef.current.width,
          canvasHeight: canvasDimensionsRef.current.height,
          gridSize: canvasDimensionsRef.current.gridSize,
          elements: elementsPayload,
          actorUserId: user?.id ?? null,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to save draft map');
      }

      const snapshotAfterSave = serializeMapElementsForSnapshot(currentObjects);
      savedSnapshotRef.current = snapshotAfterSave;

      if (!isMapDraftDirty(snapshotAfterSave, builderObjectsRef.current)) {
        setIsDirty(false);
        setSaveState(`Saved at ${new Date().toLocaleTimeString()}`);
      } else {
        setSaveState('Unsaved changes');
      }
    } catch (err: any) {
      setSaveState('Unsaved changes');
      setErrorMsg(isAutosave ? `Autosave warning: ${err.message || 'Failed to save draft map'}` : (err.message || 'Failed to save draft map'));
    }
  };

  useEffect(() => {
    autosaveDebouncerRef.current = createAutosaveDebouncer(() => handleSaveDraft(true), AUTOSAVE_DEBOUNCE_MS);
    return () => {
      autosaveDebouncerRef.current?.cancel();
    };
  }, []);

  useEffect(() => {
    if (savedSnapshotRef.current === null || loading) return;

    const dirty = isMapDraftDirty(savedSnapshotRef.current, builderObjects);
    setIsDirty(dirty);

    if (dirty) {
      setSaveState((prev) => (prev === 'Saving...' ? prev : 'Unsaved changes'));
      autosaveDebouncerRef.current?.schedule();
    } else {
      autosaveDebouncerRef.current?.cancel();
      setSaveState((prev) => (prev === 'Unsaved changes' ? 'Saved' : prev));
    }
  }, [builderObjects, loading]);

  // Publish map
  const handlePublish = async () => {
    if (!selectedFloorId) return;

    try {
      setActionLoading(true);
      setErrorMsg(null);

      // Save draft first before publishing
      await handleSaveDraft();

      const res = await fetch('/api/admin/maps/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          floorId: selectedFloorId,
          actorUserId: user?.id ?? null,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Publish failed validation');
      }

      setShowPublishModal(false);
      setSuccessMsg('Map published successfully! Live customer & kiosk maps updated.');
      setTimeout(() => setSuccessMsg(null), 5000);
      setSaveState('Published');
    } catch (err: any) {
      setErrorMsg(err.message || 'Publishing error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRemoveObject = (id: string) => {
    const targetIndex = builderObjects.findIndex(o => o.id === id);
    const targetObj = builderObjects[targetIndex];
    if (targetObj && selectedFloorId) {
      undoManagerRef.current.push(selectedFloorId, {
        type: 'REMOVE_OBJECT',
        object: targetObj,
        index: targetIndex,
      });
      syncUndoRedoState(selectedFloorId);
    }
    setBuilderObjects(prev => prev.filter(o => o.id !== id));
    if (selectedObjId === id) setSelectedObjId(null);
    setSaveState('Unsaved changes');
  };

  const handleRotate = (id: string) => {
    const obj = builderObjects.find(o => o.id === id);
    if (!obj) return;
    const prevRot = obj.rotation || 0;
    const nextRot = ((prevRot + 90) % 360);

    const clamped = clampRotatedElementToBounds(
      { x: obj.x, y: obj.y, width: obj.w, height: obj.h, rotation: nextRot },
      canvasDimensions.width,
      canvasDimensions.height
    );

    if (selectedFloorId) {
      if (clamped.wasAdjusted) {
        undoManagerRef.current.push(selectedFloorId, {
          type: 'BATCH',
          commands: [
            { type: 'ROTATE_OBJECT', id, before: prevRot, after: nextRot },
            { type: 'MOVE_OBJECT', id, before: { x: obj.x, y: obj.y }, after: { x: clamped.x, y: clamped.y } },
          ],
        });
      } else {
        undoManagerRef.current.push(selectedFloorId, {
          type: 'ROTATE_OBJECT',
          id,
          before: prevRot,
          after: nextRot,
        });
      }
      syncUndoRedoState(selectedFloorId);
    }

    setBuilderObjects(prev =>
      prev.map(o => {
        if (o.id !== id) return o;
        return { ...o, rotation: nextRot, x: clamped.x, y: clamped.y };
      })
    );
    setSaveState('Unsaved changes');
  };

  const handleDuplicateObject = (id: string) => {
    const target = builderObjects.find(o => o.id === id);
    if (!target || target.bookable || target.elementRole === 'WORKSPACE') return;

    const canvasW = canvasDimensions.width;
    const canvasH = canvasDimensions.height;

    const clamped = clampRotatedElementToBounds(
      { x: target.x + 20, y: target.y + 20, width: target.w, height: target.h, rotation: target.rotation || 0 },
      canvasW,
      canvasH
    );

    const newObj = {
      ...target,
      id: 'str-' + Date.now(),
      name: target.name,
      x: clamped.x,
      y: clamped.y,
      w: target.w,
      h: target.h,
      rotation: target.rotation || 0,
      workspaceInstanceId: null,
      bookable: false,
      elementRole: 'STRUCTURE',
    };

    setBuilderObjects(prev => [...prev, newObj]);
    setSelectedObjId(newObj.id);
    setSaveState('Unsaved changes');

    if (selectedFloorId) {
      undoManagerRef.current.push(selectedFloorId, {
        type: 'ADD_OBJECT',
        object: newObj,
      });
      syncUndoRedoState(selectedFloorId);
    }
  };

  const handleColorChange = (newColor: string) => {
    if (!selectedObj || !selectedFloorId) return;
    const prevColor = selectedObj.color;
    if (prevColor === newColor) return;

    if (applyColorToSimilar && !selectedObj.bookable) {
      const matching = builderObjects.filter(
        o => !o.bookable && (o.elementType === selectedObj.elementType || (o.name && o.name === selectedObj.name))
      );
      const batchCommands: MapCommand[] = matching.map(o => ({
        type: 'UPDATE_PROPERTIES',
        id: o.id,
        before: { color: o.color },
        after: { color: newColor },
      }));
      undoManagerRef.current.push(selectedFloorId, {
        type: 'BATCH',
        commands: batchCommands,
      });
    } else {
      undoManagerRef.current.push(selectedFloorId, {
        type: 'UPDATE_PROPERTIES',
        id: selectedObj.id,
        before: { color: prevColor },
        after: { color: newColor },
      });
    }
    syncUndoRedoState(selectedFloorId);

    setBuilderObjects(prev =>
      prev.map(o => {
        if (o.id === selectedObj.id) {
          return { ...o, color: newColor };
        }
        if (
          applyColorToSimilar &&
          !selectedObj.bookable &&
          !o.bookable &&
          (o.elementType === selectedObj.elementType || (o.name && o.name === selectedObj.name))
        ) {
          return { ...o, color: newColor };
        }
        return o;
      })
    );
    setSaveState('Unsaved changes');
  };

  const selectedObj = builderObjects.find(o => o.id === selectedObjId);
  const currentFloor = floors.find(f => f.id === selectedFloorId);

  const paletteStructure = ['Wall', 'Glass', 'Thin Wall', 'Doorway', 'Restroom', 'Pantry', 'Emergency Exit'];

  const publishChecks = [
    { text: 'All workspaces inside canvas bounds', color: 'var(--da-success)', icon: '✓' },
    { text: 'No overlapping bookable workspaces', color: 'var(--da-success)', icon: '✓' },
    { text: `${builderObjects.filter(o => o.bookable).length} instances configured on floor`, color: 'var(--da-text-secondary)', icon: 'ℹ' },
    { text: 'Draft map saved to database', color: 'var(--da-success)', icon: '✓' },
  ];

  return (
    <main data-screen-label="Map Builder" style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <style>{`
        @keyframes da-pulse-red-glow {
          0% {
            box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.75), 0 0 10px 2px rgba(239, 68, 68, 0.55);
            border-color: #EF4444;
          }
          50% {
            box-shadow: 0 0 0 8px rgba(239, 68, 68, 0), 0 0 22px 6px rgba(239, 68, 68, 0.9);
            border-color: #DC2626;
          }
          100% {
            box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.75), 0 0 10px 2px rgba(239, 68, 68, 0.55);
            border-color: #EF4444;
          }
        }
      `}</style>
      {/* Notifications */}
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
          {floors.length > 0 ? (
            <select
              value={selectedFloorId || ''}
              onChange={(e) => handleFloorChange(e.target.value)}
              style={{ border: '1px solid var(--da-border)', borderRadius: '8px', padding: '7px 10px', fontSize: '12px', fontFamily: 'var(--da-font-family)', background: '#fff', fontWeight: 700 }}
            >
              {floors.map(f => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          ) : (
            <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--da-text-secondary)' }}>No Floors Available</span>
          )}

          <button
            onClick={() => setShowFloorModal(true)}
            style={{ border: '1px solid var(--da-border)', background: 'var(--da-canvas)', borderRadius: '8px', padding: '7px 12px', fontSize: '12px', fontWeight: 700, color: 'var(--da-brand-dark)', cursor: 'pointer' }}
          >
            + Add Floor
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button onClick={handleZoomOut} style={{ width: '36px', height: '36px', borderRadius: '8px', border: '1px solid var(--da-border)', background: '#fff', cursor: 'pointer', fontSize: '15px', fontWeight: 700 }}>−</button>
          <span style={{ fontSize: '12px', fontFamily: 'var(--da-font-family)', width: '40px', textAlign: 'center' }}>{Math.round(builderZoom * 100)}%</span>
          <button onClick={handleZoomIn} style={{ width: '36px', height: '36px', borderRadius: '8px', border: '1px solid var(--da-border)', background: '#fff', cursor: 'pointer', fontSize: '15px', fontWeight: 700 }}>+</button>
          <button onClick={handleFitView} style={{ border: '1px solid var(--da-border)', background: '#fff', borderRadius: '6px', padding: '6px 10px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}>Fit View</button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={handleUndo}
            disabled={!canUndo}
            title="Undo (Ctrl+Z)"
            aria-label="Undo"
            style={{
              border: '1px solid var(--da-border)',
              background: '#fff',
              borderRadius: '8px',
              padding: '7px 12px',
              fontSize: '12px',
              fontWeight: 700,
              cursor: canUndo ? 'pointer' : 'not-allowed',
              opacity: canUndo ? 1 : 0.45,
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              color: 'var(--da-text-primary)',
            }}
          >
            <span>↺</span> Undo
          </button>
          <button
            onClick={handleRedo}
            disabled={!canRedo}
            title="Redo (Ctrl+Shift+Z / Ctrl+Y)"
            aria-label="Redo"
            style={{
              border: '1px solid var(--da-border)',
              background: '#fff',
              borderRadius: '8px',
              padding: '7px 12px',
              fontSize: '12px',
              fontWeight: 700,
              cursor: canRedo ? 'pointer' : 'not-allowed',
              opacity: canRedo ? 1 : 0.45,
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              color: 'var(--da-text-primary)',
            }}
          >
            <span>↻</span> Redo
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '11px', fontFamily: 'var(--da-font-family)', color: 'var(--da-text-secondary)' }}>{saveState}</span>
          <button
            onClick={() => handleSaveDraft(false)}
            disabled={floors.length === 0}
            style={{ border: '1px solid var(--da-border)', background: '#fff', borderRadius: '8px', padding: '8px 14px', fontSize: '12px', fontWeight: 700, cursor: floors.length === 0 ? 'not-allowed' : 'pointer' }}
          >
            Save Draft
          </button>
          <button
            onClick={() => setShowPublishModal(true)}
            disabled={floors.length === 0 || builderObjects.length === 0}
            style={{ background: 'linear-gradient(0deg, var(--da-brand-dark) 70%, #154A32)', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: (floors.length === 0 || builderObjects.length === 0) ? 'not-allowed' : 'pointer', opacity: (floors.length === 0 || builderObjects.length === 0) ? 0.6 : 1 }}
          >
            Publish
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minWidth: 0, minHeight: 0, width: '100%' }}>
        {/* Palette */}
        <aside style={{ width: '200px', background: '#fff', borderRight: '1px solid var(--da-border)', padding: '14px', overflowY: 'auto', flexShrink: 0 }}>
          <div style={{ fontSize: '11px', fontWeight: 800, color: 'var(--da-text-secondary)', letterSpacing: '.05em', marginBottom: '8px', fontFamily: 'var(--da-font-family)' }}>WORKSPACES</div>
          {templates.length === 0 ? (
            <div style={{ fontSize: '11px', color: 'var(--da-text-secondary)', padding: '6px 0' }}>No templates yet</div>
          ) : (
            templates.map((pw, i) => (
              <div key={pw.id || i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderTop: '1px solid var(--da-border-light)' }}>
                <span style={{ fontSize: '12px', color: 'var(--da-text-primary)', fontFamily: 'var(--da-font-family)', maxWidth: '110px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {pw.name}
                </span>
                <button
                  onClick={() => handleAddWorkspace(pw)}
                  style={{ border: '1px solid var(--da-border)', background: 'var(--da-canvas)', borderRadius: '6px', padding: '3px 8px', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}
                >
                  + Add
                </button>
              </div>
            ))
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '16px 0 8px' }}>
            <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--da-text-secondary)', letterSpacing: '.05em', fontFamily: 'var(--da-font-family)' }}>STRUCTURE</span>
            <button
              onClick={handleOpenCreateCustomStructure}
              title="Create Custom Structure Template"
              style={{
                border: '1px solid var(--da-border)',
                background: 'var(--da-canvas)',
                borderRadius: '6px',
                padding: '2px 6px',
                fontSize: '10px',
                fontWeight: 700,
                color: 'var(--da-brand-dark)',
                cursor: 'pointer',
              }}
            >
              + Custom
            </button>
          </div>
          {paletteStructure.map((ps, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderTop: '1px solid var(--da-border-light)' }}>
              <span style={{ fontSize: '12px', color: 'var(--da-text-secondary)', fontFamily: 'var(--da-font-family)' }}>{ps}</span>
              <button
                onClick={() => handleAddStructure(ps)}
                style={{ border: '1px solid var(--da-border)', background: 'var(--da-canvas)', borderRadius: '6px', padding: '3px 8px', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}
              >
                + Add
              </button>
            </div>
          ))}

          {customStructures.length > 0 && (
            <div style={{ margin: '12px 0 4px', fontSize: '10px', fontWeight: 800, color: 'var(--da-brand-dark)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
              Custom Structures
            </div>
          )}
          {customStructures.map((cst) => (
            <div
              key={cst.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '7px 0',
                borderTop: '1px solid var(--da-border-light)',
                gap: '4px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    width: '10px',
                    height: '10px',
                    borderRadius: '2px',
                    background: cst.defaultColor || '#CBD5E1',
                    border: cst.borderStyle === 'dashed' ? '1px dashed #94a3b8' : (cst.borderStyle === 'none' ? 'none' : '1px solid #cbd5e1'),
                    flexShrink: 0,
                  }}
                />
                <span
                  title={cst.name}
                  style={{
                    fontSize: '12px',
                    color: 'var(--da-text-primary)',
                    fontFamily: 'var(--da-font-family)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {cst.name}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '3px', flexShrink: 0 }}>
                <button
                  onClick={(e) => handleOpenEditCustomStructure(cst, e)}
                  title="Edit custom structure"
                  style={{
                    border: 'none',
                    background: 'none',
                    padding: '2px',
                    fontSize: '11px',
                    cursor: 'pointer',
                    opacity: 0.65,
                  }}
                >
                  ✏️
                </button>
                <button
                  onClick={(e) => handleDeleteCustomStructure(cst.id, cst.name, e)}
                  title="Delete custom structure"
                  style={{
                    border: 'none',
                    background: 'none',
                    padding: '2px',
                    fontSize: '11px',
                    cursor: 'pointer',
                    opacity: 0.65,
                  }}
                >
                  🗑️
                </button>
                <button
                  onClick={() => handleAddCustomStructure(cst)}
                  style={{
                    border: '1px solid var(--da-border)',
                    background: 'var(--da-canvas)',
                    borderRadius: '6px',
                    padding: '3px 8px',
                    fontSize: '11px',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  + Add
                </button>
              </div>
            </div>
          ))}

          <div style={{ marginTop: '8px', paddingBottom: '4px' }}>
            <button
              onClick={handleOpenCreateCustomStructure}
              style={{
                width: '100%',
                border: '1px dashed var(--da-brand-dark)',
                background: 'rgba(0, 150, 137, 0.04)',
                color: 'var(--da-brand-dark)',
                borderRadius: '6px',
                padding: '6px 8px',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              + Add Custom Structure
            </button>
          </div>

          <div style={{ fontSize: '11px', fontWeight: 800, color: 'var(--da-text-secondary)', letterSpacing: '.05em', margin: '16px 0 8px', fontFamily: 'var(--da-font-family)' }}>KIOSK ORIENTATION</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderTop: '1px solid var(--da-border-light)' }}>
            <span style={{ fontSize: '12px', color: 'var(--da-text-secondary)', fontFamily: 'var(--da-font-family)', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span>📍</span> You Are Here
            </span>
            <button
              onClick={handleAddKioskMarker}
              style={{ border: '1px solid var(--da-border)', background: 'var(--da-canvas)', borderRadius: '6px', padding: '3px 8px', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}
            >
              {builderObjects.some(o => o.elementType === 'KIOSK_YOU_ARE_HERE' || o.elementRole === 'INFORMATION') ? 'Select' : '+ Add'}
            </button>
          </div>
        </aside>

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
          {floors.length === 0 ? (
            /* Empty state when no floor is in the database */
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px', textAlign: 'center' }}>
              <div style={{ background: '#fff', border: '1px solid var(--da-border)', borderRadius: '16px', padding: '36px', maxWidth: '440px', boxShadow: 'var(--da-shadow-md)' }}>
                <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'var(--da-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: '20px' }}>
                  🏢
                </div>
                <h2 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--da-brand-dark)', margin: '0 0 8px' }}>
                  Add a floor first in the canvas
                </h2>
                <p style={{ fontSize: '13px', color: 'var(--da-text-secondary)', margin: '0 0 20px', lineHeight: 1.5, fontFamily: 'var(--da-font-family)' }}>
                  No floor was found in the database. Please create a floor first to place workspaces, build layouts, save drafts, and publish your live floor map.
                </p>
                <button
                  onClick={() => setShowFloorModal(true)}
                  style={{ background: 'var(--da-brand-dark)', color: '#fff', border: 'none', padding: '11px 22px', borderRadius: '8px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--da-font-family)' }}
                >
                  + Add Floor Now
                </button>
              </div>
            </div>
          ) : (
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
                  transform: `scale(${builderZoom})`,
                  transformOrigin: 'top left',
                  backgroundImage: gridOn ? 'radial-gradient(var(--da-border) 1px, transparent 1px)' : 'none',
                  backgroundSize: `${canvasDimensions.gridSize}px ${canvasDimensions.gridSize}px`,
                  overflow: 'hidden',
                }}
              >
              {builderObjects.map((obj) => {
                const isWorkspace = Boolean(obj.bookable || obj.elementRole === 'WORKSPACE' || obj.workspaceInstanceId);
                const isRestroom = !isWorkspace && (obj.elementType?.toLowerCase().includes('restroom') || obj.name?.toLowerCase().includes('restroom'));
                const isPantry = !isWorkspace && (obj.elementType?.toLowerCase().includes('pantry') || obj.name?.toLowerCase().includes('pantry'));
                const isEmergencyExit = !isWorkspace && (obj.elementType?.toLowerCase().includes('exit') || obj.elementType?.toLowerCase().includes('emergency') || obj.name?.toLowerCase().includes('exit') || obj.name?.toLowerCase().includes('emergency'));
                const isAmenity = !isWorkspace && (obj.elementRole === 'AMENITY' || isRestroom || isPantry || isEmergencyExit);
                const isKioskMarker =
                  !isWorkspace &&
                  (obj.elementType === 'KIOSK_YOU_ARE_HERE' ||
                    obj.elementRole === 'INFORMATION' ||
                    obj.name?.toLowerCase() === 'you are here');
                const isWall = !isWorkspace && (obj.elementType?.toLowerCase().includes('wall') || obj.name?.toLowerCase().includes('wall'));
                const contrastColor = getContrastColor(obj.color);
                const isOutOfBounds = !isRotatedElementWithinBounds(
                  { x: obj.x, y: obj.y, width: obj.w, height: obj.h, rotation: obj.rotation || 0 },
                  canvasDimensions.width,
                  canvasDimensions.height
                );

                return (
                  <div
                    key={obj.id}
                    style={{
                      position: 'absolute',
                      left: obj.x,
                      top: obj.y,
                      width: obj.w,
                      height: obj.h,
                      transform: `rotate(${obj.rotation}deg)`,
                      zIndex: isOutOfBounds ? 60 : (selectedObjId === obj.id ? 40 : (obj.zIndex || 1)),
                    }}
                  >
                    <button
                      onPointerDown={(e) => {
                        e.preventDefault();
                        if (e.button !== 0) return;
                        setSelectedObjId(obj.id);
                        setShowInspector(true);
                        setDragState({
                          id: obj.id,
                          startX: e.clientX,
                          startY: e.clientY,
                          startObjX: obj.x,
                          startObjY: obj.y
                        });
                      }}
                      onClick={() => { setSelectedObjId(obj.id); setShowInspector(true); }}
                      aria-pressed={selectedObjId === obj.id}
                      title={isOutOfBounds ? `${obj.name || 'This element'} is out of bounds!` : undefined}
                      style={{
                        width: '100%', height: '100%',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                        fontSize: '11px', fontWeight: 700, textAlign: 'center', cursor: 'pointer',
                        fontFamily: 'var(--da-font-family)', padding: '4px', lineHeight: 1.2,
                        background: isOutOfBounds
                          ? 'rgba(239, 68, 68, 0.15)'
                          : (isKioskMarker ? (obj.color || '#DC2626') : (obj.color || (obj.bookable ? 'rgba(200, 244, 81, 0.4)' : '#F3F7F4'))),
                        border: isOutOfBounds
                          ? '2.5px solid #EF4444'
                          : (selectedObjId === obj.id
                              ? '2px solid var(--da-brand-dark)'
                              : (isKioskMarker
                                  ? '2px solid #fff'
                                  : (obj.borderStyle === 'dashed' || obj.properties?.borderStyle === 'dashed'
                                      ? '1.5px dashed var(--da-border)'
                                      : (obj.borderStyle === 'none' || obj.properties?.borderStyle === 'none'
                                          ? 'none'
                                          : '1px solid var(--da-border)')))),
                        borderRadius: isKioskMarker ? '14px' : (isWall ? '2px' : '8px'),
                        boxShadow: isOutOfBounds
                          ? '0 0 16px rgba(239, 68, 68, 0.85)'
                          : (isKioskMarker ? '0 4px 12px rgba(220, 38, 38, 0.35)' : 'none'),
                        animation: isOutOfBounds ? 'da-pulse-red-glow 1.2s infinite ease-in-out' : 'none',
                        color: isOutOfBounds ? '#DC2626' : (isKioskMarker ? '#ffffff' : contrastColor),
                        boxSizing: 'border-box',
                        overflow: 'hidden',
                        position: 'relative'
                      }}
                    >
                      {isWorkspace ? (
                        <span style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {obj.name}
                        </span>
                      ) : isKioskMarker ? (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '2px', pointerEvents: 'none', maxWidth: '100%', maxHeight: '100%' }}>
                          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="You Are Here">
                            <path d="M12 2a8 8 0 0 0-8 8c0 5.25 8 12 8 12s8-6.75 8-12a8 8 0 0 0-8-8z" fill="#ffffff" stroke="#DC2626" strokeWidth="1.5" />
                            <circle cx="12" cy="10" r="3" fill="#DC2626" />
                          </svg>
                          <span style={{ fontSize: '10px', fontWeight: 800, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#ffffff', textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}>
                            {obj.name || 'You Are Here'}
                          </span>
                        </div>
                      ) : isAmenity ? (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '3px', pointerEvents: 'none', maxWidth: '100%', maxHeight: '100%' }}>
                          <AmenityIcon type={obj.elementType} name={obj.name} color={contrastColor} />
                          <span style={{ fontSize: '10px', fontWeight: 700, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: 0.9 }}>
                            {obj.name}
                          </span>
                        </div>
                      ) : (
                        <span
                          style={{
                            maxWidth: '100%',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            fontSize: obj.h <= 20 ? '9px' : '11px',
                            fontWeight: obj.h <= 20 ? 800 : 700,
                            letterSpacing: obj.h <= 20 ? '0.05em' : 'normal',
                            textTransform: obj.h <= 20 ? 'uppercase' : 'none',
                            padding: '0 4px',
                            lineHeight: 1,
                            pointerEvents: 'none',
                          }}
                        >
                          {obj.name || formatStructureLabel(obj.elementType)}
                        </span>
                      )}
                    </button>
                  {selectedObjId === obj.id && (
                    <div
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (e.button !== 0) return;
                        setResizeState({
                          id: obj.id,
                          startX: e.clientX,
                          startY: e.clientY,
                          startObjW: obj.w,
                          startObjH: obj.h,
                          startObjX: obj.x,
                          startObjY: obj.y,
                        });
                      }}
                      style={{
                        position: 'absolute',
                        right: '-4px',
                        bottom: (obj.elementType?.toLowerCase().includes('wall') || obj.name?.toLowerCase().includes('wall')) ? 'calc(50% - 6px)' : '-4px',
                        width: '12px',
                        height: '12px',
                        background: 'var(--da-brand-dark)',
                        borderRadius: '50%',
                        cursor: (obj.elementType?.toLowerCase().includes('wall') || obj.name?.toLowerCase().includes('wall'))
                          ? ((obj.rotation === 90 || obj.rotation === 270) ? 'ns-resize' : 'ew-resize')
                          : 'nwse-resize',
                        border: '2px solid #fff'
                      }}
                    />
                  )}
                </div>
              );
            })}
              </div>
            </div>
          )}
        </div>

        {/* Inspector */}
        {showInspector && selectedObj && (
          <aside style={{ width: '250px', background: '#fff', borderLeft: '1px solid var(--da-border)', padding: '18px', flexShrink: 0, overflowY: 'auto' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 800, color: 'var(--da-brand-dark)', margin: '0 0 14px' }}>{selectedObj.name}</h3>

            {selectedObj.bookable && selectedObj.template && (
              <>
                <div style={{ fontSize: '11px', color: 'var(--da-text-secondary)', fontFamily: 'var(--da-font-family)', marginBottom: '2px' }}>Template</div>
                <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--da-text-primary)', marginBottom: '14px' }}>{selectedObj.template}</div>
              </>
            )}

            <div style={{ fontSize: '11px', color: 'var(--da-text-secondary)', fontFamily: 'var(--da-font-family)', marginBottom: '4px' }}>Display Name</div>
            <input
              value={selectedObj.name}
              onFocus={() => {
                initialNameRef.current = selectedObj.name;
              }}
              onBlur={() => {
                if (
                  selectedFloorId &&
                  initialNameRef.current !== undefined &&
                  initialNameRef.current !== selectedObj.name
                ) {
                  undoManagerRef.current.push(selectedFloorId, {
                    type: 'UPDATE_PROPERTIES',
                    id: selectedObj.id,
                    before: { name: initialNameRef.current },
                    after: { name: selectedObj.name },
                  });
                  syncUndoRedoState(selectedFloorId);
                  initialNameRef.current = selectedObj.name;
                }
              }}
              onChange={(e) => {
                const val = e.target.value;
                setBuilderObjects(prev => prev.map(o => o.id === selectedObj.id ? { ...o, name: val } : o));
                setSaveState('Unsaved changes');
              }}
              style={{ width: '100%', border: '1px solid var(--da-border)', borderRadius: '8px', padding: '8px 10px', fontSize: '13px', marginBottom: '14px', fontFamily: 'var(--da-font-family)', boxSizing: 'border-box' }}
            />

            {selectedObj.bookable && (
              <>
                <div style={{ fontSize: '11px', color: 'var(--da-text-secondary)', fontFamily: 'var(--da-font-family)', marginBottom: '4px' }}>Status</div>
                <select
                  value={selectedObj.status || 'ACTIVE'}
                  onChange={async (e) => {
                    const val = e.target.value;
                    const prevStatus = selectedObj.status || 'ACTIVE';
                    if (val !== prevStatus && selectedFloorId) {
                      undoManagerRef.current.push(selectedFloorId, {
                        type: 'UPDATE_PROPERTIES',
                        id: selectedObj.id,
                        before: { status: prevStatus },
                        after: { status: val },
                      });
                      syncUndoRedoState(selectedFloorId);
                    }
                    setBuilderObjects(prev => prev.map(o => o.id === selectedObj.id ? { ...o, status: val } : o));
                    setSaveState('Unsaved changes');

                    if (selectedObj.workspaceInstanceId) {
                      try {
                        await fetch(`/api/admin/workspaces/instances/${selectedObj.workspaceInstanceId}`, {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ operationalStatus: val }),
                        });
                        setInstances(prev =>
                          prev.map(i => (i.id === selectedObj.workspaceInstanceId ? { ...i, operationalStatus: val } : i))
                        );
                      } catch {
                        // ignore network error
                      }
                    }
                  }}
                  style={{ width: '100%', border: '1px solid var(--da-border)', borderRadius: '8px', padding: '8px 10px', fontSize: '13px', marginBottom: '14px', fontFamily: 'var(--da-font-family)', boxSizing: 'border-box', background: '#fff' }}
                >
                  <option value="ACTIVE">Active</option>
                  <option value="MAINTENANCE">Maintenance</option>
                  <option value="UNAVAILABLE">Unavailable</option>
                  <option value="INACTIVE">Inactive (Hidden)</option>
                </select>

                <div style={{ marginBottom: '16px', borderTop: '1px solid var(--da-border-light)', paddingTop: '14px' }}>
                  <div style={{ fontSize: '13px', fontWeight: 800, color: 'var(--da-brand-dark)', marginBottom: '3px' }}>
                    Workspace Amenities & Recommendations
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--da-text-secondary)', marginBottom: '12px', lineHeight: 1.4 }}>
                    Configure individual desk features & environmental attributes
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {WORKSPACE_AMENITY_CATEGORIES.map((cat) => {
                      const currentTags: string[] = selectedObj.recommendationTags || [];
                      return (
                        <div key={cat.id} style={{ background: 'var(--da-canvas)', padding: '10px 11px', borderRadius: '8px', border: '1px solid var(--da-border-light)' }}>
                          <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--da-text-primary)', marginBottom: '2px' }}>
                            {cat.name}
                          </div>
                          <div style={{ fontSize: '10px', color: 'var(--da-text-secondary)', marginBottom: '8px', lineHeight: 1.3 }}>
                            {cat.description}
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                            {cat.tags.map((tag) => {
                              const isSelected = currentTags.includes(tag);
                              return (
                                <button
                                  key={tag}
                                  type="button"
                                  onClick={() => {
                                    const nextTags = isSelected
                                      ? currentTags.filter((t) => t !== tag)
                                      : [...currentTags, tag];

                                    if (selectedFloorId) {
                                      undoManagerRef.current.push(selectedFloorId, {
                                        type: 'UPDATE_PROPERTIES',
                                        id: selectedObj.id,
                                        before: { recommendationTags: currentTags },
                                        after: { recommendationTags: nextTags },
                                      });
                                      syncUndoRedoState(selectedFloorId);
                                    }

                                    setBuilderObjects((prev) =>
                                      prev.map((o) =>
                                        o.id === selectedObj.id ? { ...o, recommendationTags: nextTags } : o
                                      )
                                    );
                                    setSaveState('Unsaved changes');
                                  }}
                                  style={{
                                    border: isSelected ? '1px solid var(--da-brand-dark)' : '1px solid var(--da-border)',
                                    background: isSelected ? 'var(--da-brand-dark)' : '#fff',
                                    color: isSelected ? '#fff' : 'var(--da-text-primary)',
                                    borderRadius: '16px',
                                    padding: '4px 9px',
                                    fontSize: '11px',
                                    fontWeight: isSelected ? 700 : 500,
                                    cursor: 'pointer',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    transition: 'all 0.15s ease',
                                  }}
                                >
                                  {isSelected && <span style={{ fontSize: '9px' }}>✓</span>}
                                  {tag}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}

            <div style={{ marginBottom: '14px' }}>
              <div style={{ fontSize: '11px', color: 'var(--da-text-secondary)', fontFamily: 'var(--da-font-family)', marginBottom: '4px' }}>Color</div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <input
                  type="color"
                  value={selectedObj.color && selectedObj.color.startsWith('#') && selectedObj.color.length === 7 ? selectedObj.color : '#009689'}
                  onInput={(e) => handleColorChange((e.target as HTMLInputElement).value)}
                  onChange={(e) => handleColorChange(e.target.value)}
                  style={{ width: '38px', height: '38px', border: '1px solid var(--da-border)', borderRadius: '8px', cursor: 'pointer', padding: '2px', background: '#fff' }}
                />
                <input
                  type="text"
                  value={selectedObj.color || ''}
                  placeholder="#009689"
                  onChange={(e) => handleColorChange(e.target.value)}
                  style={{ flex: 1, border: '1px solid var(--da-border)', borderRadius: '8px', padding: '8px 10px', fontSize: '13px', fontFamily: 'var(--da-font-family)', boxSizing: 'border-box' }}
                />
              </div>
              {!selectedObj.bookable && (
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--da-text-secondary)', cursor: 'pointer', marginTop: '6px' }}>
                  <input
                    type="checkbox"
                    checked={applyColorToSimilar}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setApplyColorToSimilar(checked);
                      if (checked && selectedObj.color) {
                        handleColorChange(selectedObj.color);
                      }
                    }}
                    style={{ cursor: 'pointer' }}
                  />
                  Apply color to all similar structures
                </label>
              )}
            </div>

            <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
              <button
                onClick={() => handleRotate(selectedObj.id)}
                style={{ flex: 1, border: '1px solid var(--da-border)', background: 'var(--da-canvas)', color: 'var(--da-brand-dark)', borderRadius: '8px', padding: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
              >
                Rotate ({selectedObj.rotation || 0}°)
              </button>
              {(!selectedObj.bookable && selectedObj.elementRole !== 'WORKSPACE' && selectedObj.elementType !== 'KIOSK_YOU_ARE_HERE' && selectedObj.elementRole !== 'INFORMATION') && (
                <button
                  onClick={() => handleDuplicateObject(selectedObj.id)}
                  style={{ flex: 1, border: '1px solid var(--da-border)', background: 'var(--da-canvas)', color: 'var(--da-brand-dark)', borderRadius: '8px', padding: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
                >
                  Duplicate
                </button>
              )}
            </div>

            <button
              onClick={() => handleRemoveObject(selectedObj.id)}
              style={{ width: '100%', border: '1px solid var(--da-brand-dark)', background: '#fff', color: 'var(--da-brand-dark)', borderRadius: '8px', padding: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
            >
              Remove from Map
            </button>
          </aside>
        )}
      </div>

      {/* Add Floor Modal */}
      {showFloorModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(12,59,39,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: '#fff', borderRadius: '14px', padding: '26px', maxWidth: '400px', width: '90%' }}>
            <h3 style={{ fontSize: '17px', fontWeight: 800, color: 'var(--da-brand-dark)', margin: '0 0 12px' }}>Add New Floor</h3>
            <form onSubmit={handleCreateFloor}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: 'var(--da-text-primary)', marginBottom: '6px' }}>Floor Name</label>
              <input
                type="text"
                value={newFloorName}
                onChange={(e) => setNewFloorName(e.target.value)}
                placeholder="e.g. Ground Floor, 2nd Floor"
                required
                style={{ width: '100%', border: '1px solid var(--da-border)', borderRadius: '8px', padding: '10px 12px', fontSize: '14px', marginBottom: '20px', fontFamily: 'var(--da-font-family)', boxSizing: 'border-box' }}
              />
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => setShowFloorModal(false)}
                  style={{ background: 'transparent', border: '1px solid var(--da-border)', padding: '9px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  style={{ background: 'var(--da-brand-dark)', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 700, cursor: actionLoading ? 'not-allowed' : 'pointer' }}
                >
                  {actionLoading ? 'Creating...' : 'Create Floor'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Publish Confirmation Modal */}
      {showPublishModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(12,59,39,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: '#fff', borderRadius: '14px', padding: '26px', maxWidth: '440px', width: '90%' }}>
            <h3 style={{ fontSize: '17px', fontWeight: 800, color: 'var(--da-brand-dark)', margin: '0 0 8px' }}>Publish map?</h3>
            <p style={{ fontSize: '13px', color: 'var(--da-text-primary)', margin: '0 0 16px' }}>
              This will immediately replace the live map shown to customers and kiosk users on {currentFloor?.name || 'this floor'}.
            </p>
            <div style={{ fontSize: '11px', fontWeight: 800, color: 'var(--da-text-secondary)', letterSpacing: '.04em', marginBottom: '8px', fontFamily: 'var(--da-font-family)' }}>VALIDATION</div>
            {publishChecks.map((pc, i) => (
              <div key={i} style={{ fontSize: '13px', color: pc.color, marginBottom: '6px' }}>{pc.icon} {pc.text}</div>
            ))}
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '16px' }}>
              <button
                type="button"
                disabled={actionLoading}
                onClick={() => setShowPublishModal(false)}
                style={{ background: 'transparent', border: '1px solid var(--da-border)', padding: '9px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actionLoading}
                onClick={handlePublish}
                style={{ background: 'var(--da-brand-dark)', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 700, cursor: actionLoading ? 'not-allowed' : 'pointer' }}
              >
                {actionLoading ? 'Publishing...' : 'Confirm Publish'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create / Edit Custom Structure Modal */}
      {showCustomStructureModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(12,59,39,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: '#fff', borderRadius: '14px', padding: '26px', maxWidth: '440px', width: '90%', maxHeight: '90vh', overflowY: 'auto' }}>
            <h3 style={{ fontSize: '17px', fontWeight: 800, color: 'var(--da-brand-dark)', margin: '0 0 12px' }}>
              {editingCustomStructure ? 'Edit Custom Structure' : 'Create Custom Structure'}
            </h3>
            <form onSubmit={handleSaveCustomStructure}>
              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: 'var(--da-text-primary)', marginBottom: '4px' }}>
                  Structure Name *
                </label>
                <input
                  type="text"
                  value={customFormName}
                  onChange={(e) => setCustomFormName(e.target.value)}
                  placeholder="e.g. Reception Counter, Acoustic Divider, Pillar"
                  required
                  style={{ width: '100%', border: '1px solid var(--da-border)', borderRadius: '8px', padding: '9px 12px', fontSize: '13px', fontFamily: 'var(--da-font-family)', boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ display: 'flex', gap: '10px', marginBottom: '14px' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: 'var(--da-text-primary)', marginBottom: '4px' }}>
                    Default Width (px) *
                  </label>
                  <input
                    type="number"
                    min={20}
                    max={2000}
                    value={customFormWidth}
                    onChange={(e) => setCustomFormWidth(e.target.value)}
                    required
                    style={{ width: '100%', border: '1px solid var(--da-border)', borderRadius: '8px', padding: '9px 12px', fontSize: '13px', fontFamily: 'var(--da-font-family)', boxSizing: 'border-box' }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: 'var(--da-text-primary)', marginBottom: '4px' }}>
                    Default Height (px) *
                  </label>
                  <input
                    type="number"
                    min={20}
                    max={2000}
                    value={customFormHeight}
                    onChange={(e) => setCustomFormHeight(e.target.value)}
                    required
                    style={{ width: '100%', border: '1px solid var(--da-border)', borderRadius: '8px', padding: '9px 12px', fontSize: '13px', fontFamily: 'var(--da-font-family)', boxSizing: 'border-box' }}
                  />
                </div>
              </div>

              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: 'var(--da-text-primary)', marginBottom: '4px' }}>
                  Default Color
                </label>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input
                    type="color"
                    value={customFormColor && customFormColor.startsWith('#') && customFormColor.length === 7 ? customFormColor : '#CBD5E1'}
                    onChange={(e) => setCustomFormColor(e.target.value)}
                    style={{ width: '38px', height: '38px', border: '1px solid var(--da-border)', borderRadius: '8px', cursor: 'pointer', padding: '2px', background: '#fff' }}
                  />
                  <input
                    type="text"
                    value={customFormColor}
                    onChange={(e) => setCustomFormColor(e.target.value)}
                    placeholder="#CBD5E1"
                    style={{ flex: 1, border: '1px solid var(--da-border)', borderRadius: '8px', padding: '8px 10px', fontSize: '13px', fontFamily: 'var(--da-font-family)', boxSizing: 'border-box' }}
                  />
                </div>
                {/* Preset colors */}
                <div style={{ display: 'flex', gap: '6px', marginTop: '6px', flexWrap: 'wrap' }}>
                  {['#CBD5E1', '#94A3B8', '#F3F7F4', '#E2E8F0', '#FEF3C7', '#E0F2FE', '#DCFCE7', '#FEE2E2', '#334155'].map(color => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setCustomFormColor(color)}
                      style={{
                        width: '20px',
                        height: '20px',
                        borderRadius: '4px',
                        background: color,
                        border: customFormColor === color ? '2px solid var(--da-brand-dark)' : '1px solid var(--da-border)',
                        cursor: 'pointer',
                        padding: 0,
                      }}
                    />
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '10px', marginBottom: '14px' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: 'var(--da-text-primary)', marginBottom: '4px' }}>
                    Border Style
                  </label>
                  <select
                    value={customFormBorderStyle}
                    onChange={(e) => setCustomFormBorderStyle(e.target.value as any)}
                    style={{ width: '100%', border: '1px solid var(--da-border)', borderRadius: '8px', padding: '9px 12px', fontSize: '13px', fontFamily: 'var(--da-font-family)', boxSizing: 'border-box', background: '#fff' }}
                  >
                    <option value="solid">Solid Border</option>
                    <option value="dashed">Dashed Border</option>
                    <option value="none">Borderless</option>
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: 'var(--da-text-primary)', marginBottom: '4px' }}>
                    Category
                  </label>
                  <select
                    value={customFormCategory}
                    onChange={(e) => setCustomFormCategory(e.target.value)}
                    style={{ width: '100%', border: '1px solid var(--da-border)', borderRadius: '8px', padding: '9px 12px', fontSize: '13px', fontFamily: 'var(--da-font-family)', boxSizing: 'border-box', background: '#fff' }}
                  >
                    <option value="ARCHITECTURAL">Architectural</option>
                    <option value="BARRIER">Barrier / Partition</option>
                    <option value="FURNITURE">Counter / Island</option>
                    <option value="UTILITY">Utility / Storage</option>
                  </select>
                </div>
              </div>

              <div style={{ marginBottom: '18px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: 'var(--da-text-primary)', marginBottom: '4px' }}>
                  Description (Optional)
                </label>
                <input
                  type="text"
                  value={customFormDescription}
                  onChange={(e) => setCustomFormDescription(e.target.value)}
                  placeholder="Notes or architectural purpose"
                  style={{ width: '100%', border: '1px solid var(--da-border)', borderRadius: '8px', padding: '9px 12px', fontSize: '13px', fontFamily: 'var(--da-font-family)', boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => setShowCustomStructureModal(false)}
                  style={{ background: 'transparent', border: '1px solid var(--da-border)', padding: '9px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={customStructureLoading}
                  style={{ background: 'var(--da-brand-dark)', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 700, cursor: customStructureLoading ? 'not-allowed' : 'pointer' }}
                >
                  {customStructureLoading ? 'Saving...' : (editingCustomStructure ? 'Save Changes' : 'Create Structure')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
