"use client";

import { useMemo, useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { SessionManager } from "../../features/session/SessionManager";
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
  type PublishedMapElement,
  type AvailableInstanceSummary,
  type NextUpcomingBookingResult,
  validatePersonName,
  DEFAULT_WORKSPACE_STATUS_COLORS,
  normalizeWorkspaceStatusColors,
  type WorkspaceStatusColors,
  type PromotionalRate,
  type RateType,
  resolveEffectivePrice,
  getPhtNow,
  getPhtDateString,
  getPhtTimeString,
  setServerTimeSync,
  resolveTimeBasedHourlyRate,
  isDayTime,
  isDayPassEligibleAtTime,
  isNightPassEligibleAtTime,
} from "@deskatlas/domain";
import {
  SpotDetailModal,
  type WorkspaceMapViewModel,
  getWorkspacePhotoObjectPosition,
} from "../../features/reservation/SpotDetailModal";
import { fetchTemplateAvailability, fetchOccupiedInstances, fetchNextUpcomingBooking } from "../../lib/availabilityApi";
import { handleNumericKeyDown, WorkspaceCountdownBadge, useLiveCountdownClock, useActiveTabPolling, MarqueeLabel } from "@deskatlas/ui";
import { useKioskSettings } from "../../../hooks/useKioskSettings";

export interface WorkspaceTemplateSummary {
  id: string;
  name: string;
  description: string | null;
  photoPath: string | null;
  photoPosition?: { x: number; y: number };
  capacity: number;
  rateAmount: number;
  pricingLabel: string;
  hasDayPass?: boolean;
  dayPassPrice?: number | null;
  hasNightPass?: boolean;
  nightPassPrice?: number | null;
  hasWholeDayPass?: boolean;
  wholeDayPassPrice?: number | null;
  hasHalfDayPass?: boolean;
  halfDayPassPrice?: number | null;
  tags?: string[];
  instanceCount: number;
  floors: string[];
  representativeWorkspace: WorkspaceMapViewModel;
}

function mapPublishedFloorToWorkspaceCards(
  published: PublishedFloorMap,
  occupiedInstanceIds: Set<string> = new Set(),
  occupiedDetailsMap: Map<string, string | null> = new Map(),
  isVenueClosed: boolean = false
): WorkspaceMapViewModel[] {
  return published.elements
    .filter(
      (element) =>
        element.elementRole === "WORKSPACE" &&
        element.workspace &&
        element.workspace.operationalStatus !== "INACTIVE"
    )
    .map((element) => {
      const workspace = element.workspace!;
      const isOccupied = occupiedInstanceIds.has(workspace.workspaceInstanceId);
      const hasActiveSession = isOccupied && occupiedDetailsMap.has(workspace.workspaceInstanceId);
      const isMaintenance = workspace.operationalStatus === "MAINTENANCE";

      let isAvailable = false;
      let status = "unavailable";
      let statusLabel = "Unavailable";

      if (isVenueClosed) {
        status = "unavailable";
        statusLabel = "Unavailable";
        isAvailable = false;
      } else {
        if (isMaintenance) {
          status = "maintenance";
          statusLabel = "Maintenance";
          isAvailable = false;
        } else if (isOccupied) {
          status = "occupied";
          statusLabel = "Occupied";
          isAvailable = false;
        } else if (workspace.isBookable && workspace.operationalStatus === "ACTIVE") {
          status = "available";
          statusLabel = "Available";
          isAvailable = true;
        } else {
          status = "unavailable";
          statusLabel = "Unavailable";
          isAvailable = false;
        }
      }

      return {
        id: element.id,
        workspaceInstanceId: workspace.workspaceInstanceId,
        templateId: workspace.templateId,
        floorId: workspace.floorId,
        floorName: published.floor?.name || "Floor",
        instanceCode: workspace.instanceCode,
        displayName: workspace.displayName,
        templateName: workspace.templateName,
        description: workspace.description ?? "Workspace details",
        rateAmount: workspace.rateAmount,
        pricingLabel: `PHP ${workspace.rateAmount}/hour`,
        hasDayPass: workspace.hasDayPass,
        dayPassPrice: workspace.dayPassPrice,
        hasNightPass: workspace.hasNightPass,
        nightPassPrice: workspace.nightPassPrice,
        hasWholeDayPass: workspace.hasWholeDayPass,
        wholeDayPassPrice: workspace.wholeDayPassPrice,
        hasHalfDayPass: workspace.hasHalfDayPass,
        halfDayPassPrice: workspace.halfDayPassPrice,
        photoPath: workspace.photoPath,
        photoPosition: workspace.photoPosition,
        capacity: workspace.capacity,
        tags: workspace.tags,
        status,
        statusLabel,
        statusGlyph: isAvailable ? "✓" : "×",
        statusTone: isAvailable ? "success" : "muted",
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
        shape: element.elementType,
      };
    });
}

function getContrastColor(hexColor?: string): string {
  if (!hexColor || !hexColor.startsWith("#") || hexColor.length < 7) return "#111827";
  const r = parseInt(hexColor.slice(1, 3), 16);
  const g = parseInt(hexColor.slice(3, 5), 16);
  const b = parseInt(hexColor.slice(5, 7), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 150 ? "#111827" : "#ffffff";
}

function formatStructureLabel(raw?: string | null): string {
  if (!raw || !raw.trim()) return "Structure";
  const cleaned = raw.replace(/[_-]+/g, " ").trim();
  if (!cleaned) return "Structure";
  return cleaned
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function formatTime12Hour(time24: string): string {
  if (!time24) return "";
  const [hStr, mStr] = time24.split(":");
  let hour = parseInt(hStr, 10);
  const minute = mStr || "00";
  const period = hour >= 12 ? "PM" : "AM";
  if (hour === 0) hour = 12;
  else if (hour > 12) hour -= 12;
  return `${hour}:${minute} ${period}`;
}

function getNowWithLeewayDate(allowanceMinutes: number = 5): Date {
  const phtNow = getPhtNow();
  return new Date(phtNow.getTime() + allowanceMinutes * 60 * 1000);
}

function getTodayManila(allowanceMinutes: number = 5): string {
  const dateWithLeeway = getNowWithLeewayDate(allowanceMinutes);
  return getPhtDateString(dateWithLeeway);
}

function getCurrentTimeManila(allowanceMinutes: number = 5): string {
  const dateWithLeeway = getNowWithLeewayDate(allowanceMinutes);
  return getPhtTimeString(dateWithLeeway);
}

const DURATION_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8];

function AmenityIcon({ type, name, color }: { type?: string; name?: string; color?: string }) {
  const norm = (type || name || "").toLowerCase();
  const iconColor = color || "#1e293b";

  if (
    norm.includes("restroom") ||
    norm.includes("toilet") ||
    norm.includes("bath") ||
    norm.includes("cr") ||
    norm.includes("washroom")
  ) {
    return (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke={iconColor}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-label="Restroom"
      >
        <circle cx="8" cy="5" r="2" fill={iconColor} stroke="none" />
        <path d="M8 8v6M6 10h4M7 14v6M9 14v6" stroke={iconColor} strokeWidth="1.75" />
        <circle cx="16" cy="5" r="2" fill={iconColor} stroke="none" />
        <path d="M14 10l2-2 2 2M16 8v3M14 14l1-3h2l1 3M15 14v6M17 14v6" stroke={iconColor} strokeWidth="1.75" />
      </svg>
    );
  }

  if (
    norm.includes("pantry") ||
    norm.includes("kitchen") ||
    norm.includes("dining") ||
    norm.includes("cafe") ||
    norm.includes("coffee") ||
    norm.includes("snack")
  ) {
    return (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke={iconColor}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-label="Pantry"
      >
        <path d="M18 8h1a4 4 0 0 1 0 8h-1" />
        <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" />
        <line x1="6" y1="1" x2="6" y2="4" />
        <line x1="10" y1="1" x2="10" y2="4" />
        <line x1="14" y1="1" x2="14" y2="4" />
      </svg>
    );
  }

  if (norm.includes("exit") || norm.includes("emergency")) {
    return (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke={iconColor}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-label="Emergency Exit"
      >
        <path d="M13 4h6a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6" />
        <path d="M3 12h11" />
        <path d="M10 8l4 4-4 4" />
        <circle cx="6" cy="7" r="1.5" fill={iconColor} stroke="none" />
        <path d="M6 9v3l-2 2" stroke={iconColor} strokeWidth="1.75" />
      </svg>
    );
  }

  if (norm.includes("window")) {
    return (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke={iconColor}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-label="Window"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <line x1="3" y1="12" x2="21" y2="12" />
        <line x1="12" y1="3" x2="12" y2="21" />
      </svg>
    );
  }

  if (norm.includes("stair")) {
    return (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke={iconColor}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-label="Stairs"
      >
        <path d="M19 5h-4v4h-4v4H7v4H3v2h18V5z" />
      </svg>
    );
  }

  return null;
}

export default function KioskReservePage() {
  const router = useRouter();
  const { kioskTimeoutMs, warningTimeoutMs } = useKioskSettings();

  // Dual Discovery Mode: "map" vs "category"
  const MAX_KIOSK_DURATION_HOURS = 24;
  const [discoveryMode, setDiscoveryMode] = useState<"map" | "category">("map");

  // Step state: "discovery" | "duration" | "category-instances" | "details" | "code"
  const [step, setStep] = useState<"discovery" | "duration" | "category-instances" | "details" | "code">("discovery");

  // Workspace & Template Selection
  const [selectedWorkspace, setSelectedWorkspace] = useState<WorkspaceMapViewModel | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<WorkspaceTemplateSummary | null>(null);
  const [selectedRateType, setSelectedRateType] = useState<RateType>("HOURLY");
  const [durationHours, setDurationHours] = useState<number>(2);
  const [durationInputStr, setDurationInputStr] = useState<string>("2");

  // Payment method selection
  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "COUNTER_QR">("CASH");

  // Modal Workspace
  const [modalWorkspace, setModalWorkspace] = useState<WorkspaceMapViewModel | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Time calculations (Now)
  const [todayDate, setTodayDate] = useState(() => getTodayManila());
  const [nowTime, setNowTime] = useState(() => getCurrentTimeManila());
  const [statusColors, setStatusColors] = useState<WorkspaceStatusColors>(
    DEFAULT_WORKSPACE_STATUS_COLORS
  );
  const [kioskAllowanceMinutes, setKioskAllowanceMinutes] = useState<number>(5);
  const [dayPassWindow, setDayPassWindow] = useState<{ start: string; end: string }>({
    start: "07:00",
    end: "23:30",
  });
  const [nightPassWindow, setNightPassWindow] = useState<{ start: string; end: string }>({
    start: "20:00",
    end: "07:00",
  });
  const [activePromotions, setActivePromotions] = useState<PromotionalRate[]>([]);

  // Sync server clock on mount to prevent client clock tampering
  useEffect(() => {
    fetch("/api/time")
      .then((res) => res.json())
      .then((data) => {
        if (data?.serverTimestamp) {
          setServerTimeSync(data.serverTimestamp);
          setTodayDate(getTodayManila(kioskAllowanceMinutes));
          setNowTime(getCurrentTimeManila(kioskAllowanceMinutes));
        }
      })
      .catch(() => {});
  }, [kioskAllowanceMinutes]);

  useEffect(() => {
    let isMounted = true;
    fetch("/api/settings")
      .then((res) => res.json())
      .then((data) => {
        if (isMounted) {
          if (data?.statusColors) {
            setStatusColors(normalizeWorkspaceStatusColors(data.statusColors));
          }
          if (data?.kioskAllowanceMinutes !== undefined && data.kioskAllowanceMinutes !== null) {
            setKioskAllowanceMinutes(Number(data.kioskAllowanceMinutes));
          }
          if (data?.dayPassStartTime || data?.dayPassWindow) {
            setDayPassWindow({
              start: data.dayPassStartTime || data.dayPassWindow?.startTime || data.dayPassWindow?.start || "07:00",
              end: data.dayPassEndTime || data.dayPassWindow?.endTime || data.dayPassWindow?.end || "23:30",
            });
          }
          if (data?.nightPassStartTime || data?.nightPassWindow) {
            setNightPassWindow({
              start: data.nightPassStartTime || data.nightPassWindow?.startTime || data.nightPassWindow?.start || "20:00",
              end: data.nightPassEndTime || data.nightPassWindow?.endTime || data.nightPassWindow?.end || "07:00",
            });
          }
        }
      })
      .catch(() => {});

    fetch("/api/public/promotions")
      .then((res) => res.json())
      .then((data) => {
        if (isMounted && data?.data) {
          setActivePromotions(data.data);
        }
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const updateTime = () => {
      setTodayDate(getTodayManila(kioskAllowanceMinutes));
      setNowTime(getCurrentTimeManila(kioskAllowanceMinutes));
    };
    updateTime();
    const interval = setInterval(updateTime, 15000);
    return () => clearInterval(interval);
  }, [step, kioskAllowanceMinutes]);

  const { effectiveDurationHours, endTimeStr, isNextDay } = useMemo(() => {
    const [h, m] = nowTime.split(":").map(Number);
    const nowTotalMinutes = h * 60 + m;

    if (selectedRateType === "DAY_PASS") {
      const [endH, endM] = dayPassWindow.end.split(":").map(Number);
      const dayPassEndMinutes = endH * 60 + endM;
      let durMins = dayPassEndMinutes - nowTotalMinutes;
      if (durMins <= 0) {
        const [startH, startM] = dayPassWindow.start.split(":").map(Number);
        durMins = Math.max(60, dayPassEndMinutes - (startH * 60 + startM));
      }
      const durHours = Math.max(1, Math.round((durMins / 60) * 10) / 10);
      return {
        effectiveDurationHours: durHours,
        endTimeStr: dayPassWindow.end,
        isNextDay: false,
      };
    }

    if (selectedRateType === "NIGHT_PASS") {
      const [endH, endM] = nightPassWindow.end.split(":").map(Number);
      const nightPassEndMinutes = endH * 60 + endM;
      let durMins = (nightPassEndMinutes + 1440) - nowTotalMinutes;
      if (durMins > 1440) durMins -= 1440;
      if (durMins <= 0) {
        const [startH, startM] = nightPassWindow.start.split(":").map(Number);
        durMins = (nightPassEndMinutes + 1440) - (startH * 60 + startM);
      }
      const durHours = Math.max(1, Math.round((durMins / 60) * 10) / 10);
      return {
        effectiveDurationHours: durHours,
        endTimeStr: nightPassWindow.end,
        isNextDay: true,
      };
    }

    if (selectedRateType === "WHOLE_DAY_PASS") {
      return {
        effectiveDurationHours: 24,
        endTimeStr: nowTime,
        isNextDay: true,
      };
    }

    if (selectedRateType === "HALF_DAY_PASS") {
      const totalMinutes = nowTotalMinutes + 12 * 60;
      const endH = Math.floor(totalMinutes / 60) % 24;
      const endM = totalMinutes % 60;
      return {
        effectiveDurationHours: 12,
        endTimeStr: `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`,
        isNextDay: totalMinutes >= 1440,
      };
    }

    // HOURLY
    const totalMinutes = nowTotalMinutes + durationHours * 60;
    const endH = Math.floor(totalMinutes / 60) % 24;
    const endM = totalMinutes % 60;
    return {
      effectiveDurationHours: durationHours,
      endTimeStr: `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`,
      isNextDay: durationHours > 0 && totalMinutes >= 1440,
    };
  }, [nowTime, durationHours, selectedRateType, dayPassWindow, nightPassWindow]);

  // Form Fields
  const [customerFirstName, setCustomerFirstName] = useState("");
  const [customerLastName, setCustomerLastName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerContactNumber, setCustomerContactNumber] = useState("");
  const [formErrors, setFormErrors] = useState<{
    firstName?: string;
    lastName?: string;
    email?: string;
  }>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [referenceCode, setReferenceCode] = useState<string | null>(null);

  // Map & Catalog states
  const currentTick = useLiveCountdownClock(1000);
  const [floors, setFloors] = useState<Floor[]>([]);
  const [floorId, setFloorId] = useState<string>("");
  const [published, setPublished] = useState<PublishedFloorMap | null>(null);
  const [publishedFloors, setPublishedFloors] = useState<PublishedFloorMap[]>([]);
  const floorMapCacheRef = useRef<Map<string, PublishedFloorMap>>(new Map());
  const [mapLoading, setMapLoading] = useState(true);
  const [mapError, setMapError] = useState<string | null>(null);
  const [occupiedInstanceIds, setOccupiedInstanceIds] = useState<Set<string>>(new Set());
  const [occupiedDetailsMap, setOccupiedDetailsMap] = useState<Map<string, string | null>>(new Map());
  const [isVenueClosed, setIsVenueClosed] = useState<boolean>(false);
  const [closureReason, setClosureReason] = useState<string | null>(null);

  // Real-time instances for category flow
  const [categoryInstances, setCategoryInstances] = useState<AvailableInstanceSummary[]>([]);
  const [loadingCategoryInstances, setLoadingCategoryInstances] = useState(false);
  const [categoryInstanceError, setCategoryInstanceError] = useState<string | null>(null);

  // Zoom controls
  const [zoom, setZoom] = useState(1);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  const fetchOccupiedData = async () => {
    try {
      const res = await fetchOccupiedInstances({
        durationMinutes: 0,
        nowIso: getNowWithLeewayDate(kioskAllowanceMinutes).toISOString(),
      });
      if (res?.occupiedInstanceIds) {
        setOccupiedInstanceIds(new Set(res.occupiedInstanceIds));
      }
      if (res?.occupiedDetails) {
        const detailMap = new Map<string, string | null>();
        for (const d of res.occupiedDetails) {
          detailMap.set(d.workspaceInstanceId, d.bookingEndAt);
        }
        setOccupiedDetailsMap(detailMap);
      }
      if (res?.isVenueClosed !== undefined) {
        setIsVenueClosed(Boolean(res.isVenueClosed));
        setClosureReason(res.closureReason ?? null);
      }
    } catch {
      // Keep existing occupied list on fetch error
    }
  };

  useEffect(() => {
    fetchOccupiedData();
  }, [kioskAllowanceMinutes]);

  useActiveTabPolling(fetchOccupiedData, 25000, { immediate: false });

  // Upcoming booking & availability limits for selected workspace
  const [upcomingBooking, setUpcomingBooking] = useState<NextUpcomingBookingResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadUpcoming = async () => {
      try {
        const res = await fetchNextUpcomingBooking({
          workspaceInstanceId: selectedWorkspace?.workspaceInstanceId || "",
          nowIso: getNowWithLeewayDate(kioskAllowanceMinutes).toISOString(),
        });
        if (!cancelled) {
          setUpcomingBooking(res);
          // If current duration exceeds maxAvailableHours, clamp down to max available hours if >= 1
          if (
            res.maxAvailableHours !== null &&
            res.maxAvailableHours !== undefined &&
            res.maxAvailableHours >= 1 &&
            durationHours > res.maxAvailableHours
          ) {
            setDurationHours(res.maxAvailableHours);
            setDurationInputStr(String(res.maxAvailableHours));
          } else if (
            res.maxAvailableHours === 0 ||
            (res.maxAvailableMinutes !== null && res.maxAvailableMinutes !== undefined && res.maxAvailableMinutes < 60)
          ) {
            setDurationHours(0);
            setDurationInputStr("0");
          }
        }
      } catch {
        // Silently preserve state on fetch error
      }
    };

    loadUpcoming();
    const interval = setInterval(loadUpcoming, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [selectedWorkspace?.workspaceInstanceId, step]);

  // Fetch published map with on-demand lazy loading and memory caching (Phase 4)
  const fetchMapData = async (targetFloorId?: string) => {
    try {
      fetchOccupiedData();

      // Return cached floor map immediately if available (0ms network latency)
      if (targetFloorId && floorMapCacheRef.current.has(targetFloorId)) {
        const cached = floorMapCacheRef.current.get(targetFloorId)!;
        setPublished(cached);
        setFloorId(cached.floor.id);
        setMapLoading(false);
        setMapError(null);
        return;
      }

      setMapLoading(true);
      setMapError(null);
      const url = targetFloorId
        ? `/api/published-map?floorId=${encodeURIComponent(targetFloorId)}`
        : "/api/published-map";
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error("Failed to load published floor map.");
      const data = await res.json();
      const floorList: Floor[] = data.floors || [];
      setFloors(floorList);
      const pub: PublishedFloorMap | null = data.published || null;
      setPublished(pub);

      if (pub?.floor?.id) {
        setFloorId(pub.floor.id);
        floorMapCacheRef.current.set(pub.floor.id, pub);
        setPublishedFloors(Array.from(floorMapCacheRef.current.values()));
      } else if (floorList.length > 0 && !targetFloorId) {
        setFloorId(floorList[0].id);
      }
    } catch (err: unknown) {
      setMapError(err instanceof Error ? err.message : "Failed to load floor map.");
    } finally {
      setMapLoading(false);
    }
  };

  const allFloorWorkspaces = useMemo(() => {
    return publishedFloors.flatMap((pub) =>
      mapPublishedFloorToWorkspaceCards(pub, occupiedInstanceIds, occupiedDetailsMap, isVenueClosed)
    );
  }, [publishedFloors, occupiedInstanceIds, occupiedDetailsMap, isVenueClosed]);

  useEffect(() => {
    fetchMapData();
  }, []);

  const canvasDimensions = useMemo(() => {
    return {
      width: Number(published?.version?.canvasWidth) || DEFAULT_MAP_CANVAS_WIDTH,
      height: Number(published?.version?.canvasHeight) || DEFAULT_MAP_CANVAS_HEIGHT,
      gridSize: Number(published?.version?.gridSize) || DEFAULT_MAP_GRID_SIZE,
    };
  }, [published]);

  const workspaces = useMemo(
    () => (published ? mapPublishedFloorToWorkspaceCards(published, occupiedInstanceIds, occupiedDetailsMap, isVenueClosed) : []),
    [published, occupiedInstanceIds, occupiedDetailsMap, isVenueClosed]
  );

  const elements = published?.elements || [];

  // Parity with kiosk viewports: default to 100% zoom (1.0) or restore saved zoom
  useEffect(() => {
    if (!published?.version?.id) return;
    const saved = getSavedMapZoom(published.version.id);
    if (saved !== null) {
      setZoom(saved);
      return;
    }
    setZoom(1);
  }, [published?.version?.id]);

  const handleZoomIn = () => {
    setZoom((z) => {
      const next = clampMapZoom(Number((z + 0.15).toFixed(2)));
      if (published?.version?.id) saveMapZoom(published.version.id, next);
      return next;
    });
  };

  const handleZoomOut = () => {
    setZoom((z) => {
      const next = clampMapZoom(Number((z - 0.15).toFixed(2)));
      if (published?.version?.id) saveMapZoom(published.version.id, next);
      return next;
    });
  };

  const handleFitView = () => {
    setZoom(1);
    if (published?.version?.id) saveMapZoom(published.version.id, 1);
  };

  const handleFloorChange = (newFloorId: string) => {
    setSelectedWorkspace(null);
    setFloorId(newFloorId);
    fetchMapData(newFloorId);
  };

  // Group workspaces by template/type
  const availableTemplates: WorkspaceTemplateSummary[] = useMemo(() => {
    const sourceWorkspaces = allFloorWorkspaces.length > 0 ? allFloorWorkspaces : workspaces;
    const templateMap = new Map<string, WorkspaceTemplateSummary>();

    for (const ws of sourceWorkspaces) {
      const existing = templateMap.get(ws.templateId);
      if (!existing) {
        templateMap.set(ws.templateId, {
          id: ws.templateId,
          name: ws.templateName,
          description: ws.description,
          photoPath: ws.photoPath,
          photoPosition: ws.photoPosition,
          capacity: ws.capacity,
          rateAmount: ws.rateAmount,
          pricingLabel: ws.pricingLabel,
          hasDayPass: ws.hasDayPass,
          dayPassPrice: ws.dayPassPrice,
          hasNightPass: ws.hasNightPass,
          nightPassPrice: ws.nightPassPrice,
          hasWholeDayPass: ws.hasWholeDayPass,
          wholeDayPassPrice: ws.wholeDayPassPrice,
          hasHalfDayPass: ws.hasHalfDayPass,
          halfDayPassPrice: ws.halfDayPassPrice,
          tags: ws.tags,
          instanceCount: 1,
          floors: [ws.floorName],
          representativeWorkspace: ws,
        });
      } else {
        existing.instanceCount += 1;
        if (!existing.floors.includes(ws.floorName)) {
          existing.floors.push(ws.floorName);
        }
        if (!existing.photoPath && ws.photoPath) {
          existing.photoPath = ws.photoPath;
          existing.photoPosition = ws.photoPosition;
        }
      }
    }

    return Array.from(templateMap.values());
  }, [allFloorWorkspaces, workspaces]);

  // Load instances for category flow
  useEffect(() => {
    if (!selectedTemplate || step !== "category-instances") return;

    let cancelled = false;
    setLoadingCategoryInstances(true);
    setCategoryInstanceError(null);

    fetchTemplateAvailability({
      templateId: selectedTemplate.id,
      date: todayDate,
      durationMinutes: Math.round(effectiveDurationHours * 60),
      startTime: nowTime,
      nowIso: getNowWithLeewayDate(kioskAllowanceMinutes).toISOString(),
    })
      .then((res) => {
        if (cancelled) return;
        setCategoryInstances(res.allInstances || []);
      })
      .catch((err) => {
        if (!cancelled) {
          setCategoryInstanceError(err instanceof Error ? err.message : "Unable to load spots for now.");
          setCategoryInstances([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingCategoryInstances(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedTemplate, effectiveDurationHours, step, todayDate, nowTime, kioskAllowanceMinutes]);

  // Spot click on map
  const handleSpotClick = (workspace: WorkspaceMapViewModel) => {
    if (isVenueClosed || occupiedInstanceIds.has(workspace.workspaceInstanceId) || workspace.status === "unavailable" || workspace.status === "maintenance") return;
    if (isVenueClosed) return;
    if (occupiedInstanceIds.has(workspace.workspaceInstanceId)) return;
    setSelectedWorkspace(workspace);
    const tpl = availableTemplates.find((t) => t.id === workspace.templateId);
    if (tpl) setSelectedTemplate(tpl);
    setModalWorkspace(workspace);
    setIsModalOpen(true);
  };

  // Category select
  const handleSelectTemplate = (template: WorkspaceTemplateSummary) => {
    if (isVenueClosed) return;
    setSelectedTemplate(template);
    setSelectedWorkspace(null);
    setStep("duration");
  };

  // Reset
  const handleReset = () => {
    setStep("discovery");
    setDiscoveryMode("map");
    setSelectedWorkspace(null);
    setSelectedTemplate(null);
    setSelectedRateType("HOURLY");
    setDurationHours(2);
    setPaymentMethod("CASH");
    setCustomerFirstName("");
    setCustomerLastName("");
    setCustomerEmail("");
    setCustomerContactNumber("");
    setFormErrors({});
    setIsSubmitting(false);
    setSubmitError(null);
    setReferenceCode(null);
    setUpcomingBooking(null);
  };

  const handleCancel = () => {
    handleReset();
    router.push("/kiosk");
  };

  // Submit reservation
  const handleSubmitReservation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedWorkspace) return;

    const errors: { firstName?: string; lastName?: string; email?: string } = {};
    const firstNameValidation = validatePersonName(customerFirstName, "First name");
    if (!firstNameValidation.isValid) {
      errors.firstName = firstNameValidation.error;
    }
    const lastNameValidation = validatePersonName(customerLastName, "Last name");
    if (!lastNameValidation.isValid) {
      errors.lastName = lastNameValidation.error;
    }
    const emailVal = customerEmail.trim();
    if (!emailVal) {
      errors.email = "Email address is required.";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) {
      errors.email = "Please enter a valid email address.";
    }

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    setFormErrors({});
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const response = await fetch("/api/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "KIOSK",
          customerFirstName: customerFirstName.trim(),
          customerLastName: customerLastName.trim(),
          customerEmail: emailVal.toLowerCase(),
          customerContactNumber: customerContactNumber.trim() || undefined,
          workspaceInstanceId: selectedWorkspace.workspaceInstanceId,
          rateType: selectedRateType,
          durationHours: effectiveDurationHours,
          durationMinutes: Math.round(effectiveDurationHours * 60),
          date: todayDate,
          startTime: nowTime,
          startAt: getNowWithLeewayDate(kioskAllowanceMinutes).toISOString(),
          paymentMethod,
          bookedRatePerHour: resolvedPricing.effectivePrice,
          rateSnapshot: resolvedPricing.effectivePrice,
          amountDue: resolvedPricing.estimatedTotal,
        }),
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || "Failed to create kiosk reservation.");
      }

      setReferenceCode(result.referenceCode || "DA-REF");
      setStep("code");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "An unexpected error occurred. Please try again.";
      setSubmitError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedTemplateId = selectedWorkspace?.templateId || selectedTemplate?.id || "";
  const targetBookingTime = useMemo(() => getNowWithLeewayDate(kioskAllowanceMinutes), [kioskAllowanceMinutes]);

  const targetWorkspace = selectedWorkspace;
  const targetTemplate = selectedTemplate;
  const targetWorkspaceOrTemplate = targetWorkspace || targetTemplate;

  const regularRate = targetWorkspace?.rateAmount ?? targetTemplate?.rateAmount ?? 0;

  const baseRateForTier = useMemo(() => {
    if (selectedRateType === "DAY_PASS") {
      return targetWorkspace?.dayPassPrice ?? targetTemplate?.dayPassPrice ?? regularRate;
    }
    if (selectedRateType === "NIGHT_PASS") {
      return targetWorkspace?.nightPassPrice ?? targetTemplate?.nightPassPrice ?? regularRate;
    }
    if (selectedRateType === "WHOLE_DAY_PASS") {
      return targetWorkspace?.wholeDayPassPrice ?? targetTemplate?.wholeDayPassPrice ?? (regularRate * 24);
    }
    if (selectedRateType === "HALF_DAY_PASS") {
      return targetWorkspace?.halfDayPassPrice ?? targetTemplate?.halfDayPassPrice ?? (regularRate * 12);
    }
    return regularRate;
  }, [selectedRateType, targetWorkspace, targetTemplate, regularRate]);

  const isPassType = selectedRateType !== "HOURLY";
  const pricingDuration = isPassType ? 1 : durationHours;

  const resolvedPricing = useMemo(() => {
    if (!selectedTemplateId) {
      const isFlat = selectedRateType !== "HOURLY";
      const total = isFlat ? baseRateForTier : baseRateForTier * durationHours;
      return {
        regularPrice: baseRateForTier,
        effectivePrice: baseRateForTier,
        isPromotional: false,
        rateType: selectedRateType,
        estimatedTotal: total,
      };
    }
    return resolveEffectivePrice(
      selectedTemplateId,
      selectedRateType,
      baseRateForTier,
      targetBookingTime,
      activePromotions,
      pricingDuration
    );
  }, [selectedTemplateId, selectedRateType, baseRateForTier, targetBookingTime, activePromotions, pricingDuration, durationHours]);

  const currentRate = resolvedPricing.effectivePrice;
  const totalAmount = resolvedPricing.estimatedTotal;

  return (
    <SessionManager
      timeoutMs={kioskTimeoutMs}
      warningTimeoutMs={warningTimeoutMs}
      onReset={handleReset}
      onTimeoutWarning={() => { }}
    >
      <main className="min-h-screen bg-[var(--da-canvas)] px-3 sm:px-6 md:px-8 py-5 sm:py-6 text-[var(--da-text-primary)] w-full">
        <div className="mx-auto flex max-w-[1800px] w-full flex-col gap-6">
          {/* Header Bar & Breadcrumbs */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--da-border-light)] pb-4">
            <div>
              <div className="flex flex-wrap items-center gap-2 text-xs font-extrabold uppercase tracking-wider">
                <button
                  type="button"
                  onClick={() => {
                    if (step !== "code") setStep("discovery");
                  }}
                  className={`hover:underline ${step === "discovery"
                    ? "text-[var(--da-primary)]"
                    : selectedWorkspace || selectedTemplate
                      ? "text-emerald-700"
                      : "text-[var(--da-text-secondary)]"
                    }`}
                >
                  1. Select Spot {selectedWorkspace ? `(✓ ${selectedWorkspace.displayName})` : selectedTemplate ? `(✓ ${selectedTemplate.name})` : ""}
                </button>
                <span className="text-[var(--da-text-secondary)]">/</span>

                <button
                  type="button"
                  disabled={(!selectedWorkspace && !selectedTemplate) || step === "code"}
                  onClick={() => {
                    if ((selectedWorkspace || selectedTemplate) && step !== "code") setStep("duration");
                  }}
                  className={`hover:underline ${step === "duration"
                    ? "text-[var(--da-primary)]"
                    : step === "details"
                      ? "text-emerald-700"
                      : "text-[var(--da-text-secondary)]"
                    }`}
                >
                  2. Duration (Now) {durationHours ? `(✓ ${durationHours}h)` : ""}
                </button>
                <span className="text-[var(--da-text-secondary)]">/</span>

                <span
                  className={`${step === "details"
                    ? "text-[var(--da-primary)]"
                    : step === "code"
                      ? "text-emerald-700"
                      : "text-[var(--da-text-secondary)]"
                    }`}
                >
                  3. Your Details
                </span>

                {step === "code" ? (
                  <>
                    <span className="text-[var(--da-text-secondary)]">/</span>
                    <span className="text-[var(--da-primary)]">4. Check-In Code (✓)</span>
                  </>
                ) : null}
              </div>

              <h1 className="mt-1 text-3xl sm:text-4xl font-extrabold tracking-[-0.03em] text-[var(--da-brand-dark)]">
                {step === "discovery"
                  ? discoveryMode === "map"
                    ? "Choose Your Workspace on the Map"
                    : "Browse by Workspace Category"
                  : step === "duration"
                    ? "Select Duration (Starting Now)"
                    : step === "category-instances"
                      ? "Select Your Preferred Desk"
                      : step === "details"
                        ? "Guest Details & Confirmation"
                        : "Pending Counter Confirmation"}
              </h1>

              <p className="mt-1 text-sm text-[var(--da-text-secondary)]">
                {step === "discovery"
                  ? discoveryMode === "map"
                    ? "Explore our interactive floor layout and click on any available spot to reserve for now."
                    : "Select a workspace category to book your immediate walk-in stay."
                  : step === "duration"
                    ? `Choose how many hours you need starting right now at ${formatTime12Hour(nowTime)}.`
                    : step === "category-instances"
                      ? `Choose an available ${selectedTemplate?.name || "workspace"} for immediate use.`
                      : step === "details"
                        ? "Enter your name and email to receive your booking QR access pass."
                        : "Present your check-in code at the counter to confirm payment and receive your pass."}
              </p>
            </div>

            {step !== "code" && (
              <button
                type="button"
                onClick={handleCancel}
                className="da-secondary-button text-sm font-extrabold px-6 py-2.5 rounded-full"
              >
                ✕ Cancel Walk-In
              </button>
            )}
          </div>

          {/* STEP 1: Discovery (Interactive Floor Map vs Browse by Category) */}
          {step === "discovery" && (
            <section className="flex flex-col gap-6">
              {/* Discovery Mode Switcher */}
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-[24px] border border-[var(--da-border)] bg-white p-4 sm:p-5 shadow-[var(--da-shadow-md)]">
                <div>
                  <span className="text-[11px] font-extrabold uppercase tracking-wider text-[var(--da-primary)] block">
                    Discovery Mode
                  </span>
                  <p className="text-xs text-[var(--da-text-secondary)] font-medium mt-0.5">
                    Choose how you would like to explore and select your workspace:
                  </p>
                </div>

                <div className="flex items-center rounded-2xl bg-[var(--da-canvas)] p-1.5 border border-[var(--da-border-light)]">
                  <button
                    type="button"
                    onClick={() => setDiscoveryMode("map")}
                    className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-extrabold transition-all ${discoveryMode === "map"
                      ? "bg-[var(--da-primary)] text-white shadow-sm"
                      : "text-[var(--da-text-secondary)] hover:text-[var(--da-brand-dark)]"
                      }`}
                  >
                    <span>🗺️</span>
                    <span>Interactive Floor Map</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setDiscoveryMode("category")}
                    className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-extrabold transition-all ${discoveryMode === "category"
                      ? "bg-[var(--da-primary)] text-white shadow-sm"
                      : "text-[var(--da-text-secondary)] hover:text-[var(--da-brand-dark)]"
                      }`}
                  >
                    <span>🏢</span>
                    <span>Browse by Category</span>
                  </button>
                </div>
              </div>

              {/* FLOW A: Interactive Floor Map */}
              {discoveryMode === "map" ? (
                <div className="w-full rounded-[28px] border border-[var(--da-border)] bg-white p-4 sm:p-6 shadow-[var(--da-shadow-lg)]">
                  {/* Controls Bar */}
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-4 border-b border-[var(--da-border-light)] pb-4">
                    {/* Floor Selector */}
                    <div className="flex items-center gap-3">
                      <label htmlFor="floor-select" className="text-sm font-bold text-[var(--da-text-primary)]">
                        Floor:
                      </label>
                      <select
                        id="floor-select"
                        value={floorId}
                        onChange={(e) => handleFloorChange(e.target.value)}
                        className="da-input max-w-xs text-sm font-semibold py-1.5"
                      >
                        {floors.map((floor) => (
                          <option key={floor.id} value={floor.id}>
                            {floor.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Status Legend & Zoom */}
                    <div className="flex items-center gap-3">
                      <div className="hidden sm:flex items-center gap-3 text-xs font-semibold text-[var(--da-text-secondary)] border-r border-[var(--da-border-light)] pr-3">
                        <span className="inline-flex items-center gap-1">
                          <span className="h-3 w-3 rounded border" style={{ backgroundColor: statusColors.available, borderColor: statusColors.available }} /> Available
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <span className="h-3 w-3 rounded border" style={{ backgroundColor: statusColors.occupied, borderColor: statusColors.occupied }} /> Occupied
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <span className="h-3 w-3 rounded border" style={{ backgroundColor: statusColors.maintenance, borderColor: statusColors.maintenance }} /> Maintenance
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <span className="h-3 w-3 rounded border" style={{ backgroundColor: statusColors.unavailable, borderColor: statusColors.unavailable }} /> Unavailable
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={handleZoomOut}
                          className="flex h-8 w-8 items-center justify-center rounded-xl border border-[var(--da-border)] bg-white text-base font-bold hover:bg-slate-50 transition"
                        >
                          −
                        </button>
                        <span className="w-12 text-center text-xs font-bold text-[var(--da-text-secondary)]">
                          {Math.round(zoom * 100)}%
                        </span>
                        <button
                          type="button"
                          onClick={handleZoomIn}
                          className="flex h-8 w-8 items-center justify-center rounded-xl border border-[var(--da-border)] bg-white text-base font-bold hover:bg-slate-50 transition"
                        >
                          +
                        </button>
                        <button
                          type="button"
                          onClick={handleFitView}
                          className="rounded-xl border border-[var(--da-border)] bg-white px-3 py-1.5 text-xs font-bold hover:bg-slate-50 transition"
                        >
                          Fit View
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Map Viewport */}
                  <div
                    ref={mapContainerRef}
                    className="relative w-full border border-[var(--da-border-light)] bg-white overflow-auto min-h-[480px] max-h-[70vh]"
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      justifyContent: "flex-start",
                      position: "relative",
                      padding: 0,
                    }}
                  >
                    {mapLoading ? (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-8 text-center bg-white z-10">
                        <div className="h-8 w-8 animate-spin rounded-full border-3 border-[var(--da-primary)] border-t-transparent" />
                        <p className="text-sm font-semibold text-[var(--da-text-secondary)]">
                          Loading published floor map...
                        </p>
                      </div>
                    ) : !published || elements.length === 0 ? (
                      <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center bg-white z-10">
                        <p className="text-sm font-bold text-[var(--da-text-secondary)]">
                          No map published for this floor.
                        </p>
                      </div>
                    ) : (
                      <div
                        style={{
                          width: `${canvasDimensions.width * zoom}px`,
                          height: `${canvasDimensions.height * zoom}px`,
                          minWidth: "100%",
                          minHeight: "100%",
                          position: "relative",
                          flexShrink: 0,
                          background: "#fff",
                        }}
                      >
                        <div
                          ref={canvasRef}
                          style={{
                            width: `${canvasDimensions.width}px`,
                            height: `${canvasDimensions.height}px`,
                            position: "absolute",
                            top: 0,
                            left: 0,
                            background: "#fff",
                            transform: `scale(${zoom})`,
                            transformOrigin: "top left",
                            backgroundImage: "radial-gradient(var(--da-border) 1px, transparent 1px)",
                            backgroundSize: `${canvasDimensions.gridSize}px ${canvasDimensions.gridSize}px`,
                            overflow: "hidden",
                          }}
                        >
                          {elements.map((el: PublishedMapElement) => {
                            const isWorkspace = el.elementRole === "WORKSPACE" || Boolean(el.workspace);
                            if (isWorkspace && el.workspace?.operationalStatus === "INACTIVE") {
                              return null;
                            }
                            const isWall =
                              !isWorkspace &&
                              (el.elementType?.toLowerCase().includes("wall") ||
                                el.elementType?.toLowerCase().includes("thin_wall") ||
                                el.elementType?.toLowerCase().includes("glass") ||
                                el.elementType?.toLowerCase().includes("separator") ||
                                el.label?.toLowerCase().includes("wall") ||
                                el.label?.toLowerCase().includes("separator"));

                            const isWindow =
                              !isWorkspace &&
                              (el.elementType?.toLowerCase().includes("window") ||
                                el.label?.toLowerCase().includes("window"));
                            const isStairs =
                              !isWorkspace &&
                              (el.elementType?.toLowerCase().includes("stairs") ||
                                el.elementType?.toLowerCase().includes("stair") ||
                                el.label?.toLowerCase().includes("stairs"));

                            const isRestroom =
                              el.elementType?.toLowerCase().includes("restroom") ||
                              el.label?.toLowerCase().includes("restroom");
                            const isPantry =
                              el.elementType?.toLowerCase().includes("pantry") ||
                              el.label?.toLowerCase().includes("pantry");
                            const isEmergencyExit =
                              el.elementType?.toLowerCase().includes("exit") ||
                              el.elementType?.toLowerCase().includes("emergency") ||
                              el.label?.toLowerCase().includes("exit") ||
                              el.label?.toLowerCase().includes("emergency");
                            const isAmenity =
                              el.elementRole === "AMENITY" || isRestroom || isPantry || isEmergencyExit;
                            const isKioskMarker =
                              el.elementType === "KIOSK_YOU_ARE_HERE" ||
                              (el.style as any)?.markerType === "KIOSK_YOU_ARE_HERE" ||
                              el.label?.toLowerCase() === "you are here" ||
                              el.label?.toLowerCase().includes("kiosk");

                            if (isKioskMarker) {
                              return (
                                <div
                                  key={el.id}
                                  style={{
                                    position: "absolute",
                                    left: el.x,
                                    top: el.y,
                                    width: el.width,
                                    height: el.height,
                                    transform: `rotate(${el.rotation || 0}deg)`,
                                    zIndex: el.zIndex || 20,
                                    pointerEvents: "none",
                                  }}
                                >
                                  <div
                                    style={{
                                      width: "100%",
                                      height: "100%",
                                      display: "flex",
                                      flexDirection: "column",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      gap: "2px",
                                      background: "#DC2626",
                                      color: "#ffffff",
                                      borderRadius: "14px",
                                      border: "2px solid #ffffff",
                                      boxShadow: "0 4px 12px rgba(220, 38, 38, 0.35)",
                                      padding: "4px",
                                      textAlign: "center",
                                    }}
                                  >
                                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="You Are Here">
                                      <path d="M12 2a8 8 0 0 0-8 8c0 5.25 8 12 8 12s8-6.75 8-12a8 8 0 0 0-8-8z" fill="#ffffff" stroke="#DC2626" strokeWidth="1.5" />
                                      <circle cx="12" cy="10" r="3" fill="#DC2626" />
                                    </svg>
                                    <span style={{ fontSize: "10px", fontWeight: 800, color: "#ffffff" }}>
                                      {el.label || "You Are Here"}
                                    </span>
                                  </div>
                                </div>
                              );
                            }

                            let defaultAmenityColor = "#F3F7F4";
                            if (isRestroom) defaultAmenityColor = "#E0F2FE";
                            else if (isPantry) defaultAmenityColor = "#FEF3C7";
                            else if (isEmergencyExit) defaultAmenityColor = "#DCFCE7";

                            const displayName =
                              el.workspace?.displayName ||
                              el.label ||
                              el.workspace?.templateName ||
                              formatStructureLabel(el.elementType);
                            const itemColor =
                              el.style?.color ||
                              (el.style as any)?.fillColor ||
                              (isWorkspace
                                ? "#E0EFE4"
                                : isAmenity
                                  ? defaultAmenityColor
                                  : isWall
                                    ? "#334155"
                                    : isWindow
                                      ? "rgba(56, 189, 248, 0.25)"
                                      : isStairs
                                        ? "#E2E8F0"
                                        : "#F3F7F4");

                            let bg = String(itemColor);
                            let textColor = isWindow ? "#0284C7" : isStairs ? "#334155" : getContrastColor(bg);

                            if (isWorkspace) {
                              const isSelected =
                                el.workspace?.workspaceInstanceId === selectedWorkspace?.workspaceInstanceId;
                              const status = el.workspace?.operationalStatus || "ACTIVE";
                              const isBookable = el.workspace?.isBookable ?? true;
                              const isOccupied = occupiedInstanceIds.has(el.workspace?.workspaceInstanceId || "");
                              const hasActiveSession = isOccupied && occupiedDetailsMap.has(el.workspace?.workspaceInstanceId || "");

                              let isAvailable = false;
                              let borderColor = isSelected ? "var(--da-accent)" : "#DCE6DF";
                              let borderWidth = isSelected ? "3px" : "1.5px";
                              let borderStyle = "solid";

                              if (isVenueClosed) {
                                borderStyle = "dashed";
                                borderColor = statusColors.unavailable;
                                bg = statusColors.unavailable;
                                isAvailable = false;
                              } else {
                                if (status === "MAINTENANCE") {
                                  borderStyle = "dashed";
                                  borderColor = statusColors.maintenance;
                                  bg = statusColors.maintenance;
                                } else if (isOccupied) {
                                  borderStyle = "solid";
                                  borderColor = statusColors.occupied;
                                  bg = statusColors.occupied;
                                } else if (status === "ACTIVE" && isBookable) {
                                  isAvailable = true;
                                  bg = statusColors.available;
                                } else {
                                  borderStyle = "dashed";
                                  borderColor = statusColors.unavailable;
                                  bg = statusColors.unavailable;
                                }
                              }

                              textColor = getContrastColor(bg);

                              const wsModel = workspaces.find(
                                (w) => w.workspaceInstanceId === el.workspace?.workspaceInstanceId
                              );

                              return (
                                <div
                                  key={el.id}
                                  style={{
                                    position: "absolute",
                                    left: el.x,
                                    top: el.y,
                                    width: el.width,
                                    height: el.height,
                                    transform: `rotate(${el.rotation || 0}deg)`,
                                    zIndex: isSelected ? 15 : el.zIndex || 5,
                                  }}
                                >
                                  <button
                                    type="button"
                                    disabled={!isAvailable}
                                    onClick={() => {
                                      if (!isAvailable) return;
                                      if (wsModel) handleSpotClick(wsModel);
                                    }}
                                    className={`group h-full w-full flex flex-col items-center justify-center p-1 text-center transition-all duration-150 relative ${isAvailable ? "hover:scale-[1.03]" : ""
                                      }`}
                                    style={{
                                      backgroundColor: bg,
                                      borderWidth,
                                      borderStyle,
                                      borderColor,
                                      borderRadius: el.elementType === "meeting-room" ? "16px" : "10px",
                                      color: textColor,
                                      cursor: isAvailable ? "pointer" : "not-allowed",
                                      opacity: isAvailable ? 1 : 0.6,
                                      boxShadow: isSelected
                                        ? "0 0 0 4px rgba(200, 244, 81, 0.4), 0 4px 12px rgba(12, 59, 39, 0.15)"
                                        : "0 1px 3px rgba(0, 0, 0, 0.05)",
                                    }}
                                  >
                                    <MarqueeLabel
                                      text={displayName}
                                      style={{ fontSize: "11px", fontWeight: 700, lineHeight: 1.2, maxWidth: "100%" }}
                                    />
                                    {wsModel?.tags && wsModel.tags.length > 0 && (
                                      <div className="flex flex-wrap items-center justify-center gap-0.5 mt-0.5 max-w-full overflow-hidden">
                                        {wsModel.tags.slice(0, 2).map((tag) => (
                                          <span
                                            key={tag}
                                            className="inline-block truncate rounded-full px-1.5 py-0.2 text-[8px] font-bold"
                                            style={{
                                              backgroundColor: 'rgba(0, 150, 137, 0.12)',
                                              color: 'var(--da-brand-dark)',
                                              border: '0.5px solid rgba(0, 150, 137, 0.25)',
                                              maxWidth: '85px',
                                            }}
                                            title={tag}
                                          >
                                            {tag}
                                          </span>
                                        ))}
                                        {wsModel.tags.length > 2 && (
                                          <span
                                            className="text-[8px] font-bold text-[var(--da-text-secondary)]"
                                            title={wsModel.tags.slice(2).join(', ')}
                                          >
                                            +{wsModel.tags.length - 2}
                                          </span>
                                        )}
                                      </div>
                                    )}
                                    {isOccupied && (
                                      <WorkspaceCountdownBadge
                                        bookingEndAt={occupiedDetailsMap.get(el.workspace?.workspaceInstanceId || "")}
                                        nowMs={currentTick}
                                        style={{ marginTop: '2px' }}
                                      />
                                    )}
                                  </button>
                                </div>
                              );
                            }

                            if (isWall) {
                              return (
                                <div
                                  key={el.id}
                                  style={{
                                    position: "absolute",
                                    left: el.x,
                                    top: el.y,
                                    width: el.width,
                                    height: el.height,
                                    transform: `rotate(${el.rotation || 0}deg)`,
                                    zIndex: el.zIndex || 1,
                                    backgroundColor: bg,
                                    borderRadius: "2px",
                                    pointerEvents: "none",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    overflow: "hidden",
                                    color: textColor,
                                    boxSizing: "border-box",
                                  }}
                                >
                                  <span
                                    style={{
                                      maxWidth: "100%",
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                      whiteSpace: "nowrap",
                                      fontSize: el.height <= 20 ? "9px" : "11px",
                                      fontWeight: el.height <= 20 ? 800 : 700,
                                      letterSpacing: el.height <= 20 ? "0.05em" : "normal",
                                      textTransform: el.height <= 20 ? "uppercase" : "none",
                                      padding: "0 4px",
                                      lineHeight: 1,
                                    }}
                                  >
                                    {displayName}
                                  </span>
                                </div>
                              );
                            }

                            if (isAmenity) {
                              return (
                                <div
                                  key={el.id}
                                  style={{
                                    position: "absolute",
                                    left: el.x,
                                    top: el.y,
                                    width: el.width,
                                    height: el.height,
                                    transform: `rotate(${el.rotation || 0}deg)`,
                                    zIndex: el.zIndex || 2,
                                    backgroundColor: bg,
                                    borderRadius: "8px",
                                    border: "1px solid rgba(0, 0, 0, 0.1)",
                                    display: "flex",
                                    flexDirection: "column",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    textAlign: "center",
                                    padding: "4px",
                                    pointerEvents: "none",
                                    color: textColor,
                                  }}
                                >
                                  <AmenityIcon type={el.elementType} name={displayName} color={textColor} />
                                  <span style={{ fontSize: "10px", fontWeight: 700, opacity: 0.9 }}>
                                    {displayName}
                                  </span>
                                </div>
                              );
                            }

                            if (isWindow) {
                              return (
                                <div
                                  key={el.id}
                                  style={{
                                    position: "absolute",
                                    left: el.x,
                                    top: el.y,
                                    width: el.width,
                                    height: el.height,
                                    transform: `rotate(${el.rotation || 0}deg)`,
                                    zIndex: el.zIndex || 1,
                                    backgroundColor: bg,
                                    borderRadius: "2px",
                                    border: "1.5px solid #38BDF8",
                                    pointerEvents: "none",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    overflow: "hidden",
                                    boxSizing: "border-box",
                                  }}
                                >
                                  <div style={{ position: "absolute", inset: "1px", border: "1px solid rgba(56, 189, 248, 0.4)", borderRadius: "1px", pointerEvents: "none" }} />
                                  <div style={{ position: "absolute", top: "50%", left: 0, right: 0, height: "1px", background: "rgba(56, 189, 248, 0.7)", transform: "translateY(-50%)", pointerEvents: "none" }} />
                                  <div style={{ position: "absolute", top: 0, bottom: 0, left: "33.3%", width: "1px", background: "rgba(56, 189, 248, 0.6)", pointerEvents: "none" }} />
                                  <div style={{ position: "absolute", top: 0, bottom: 0, left: "66.6%", width: "1px", background: "rgba(56, 189, 248, 0.6)", pointerEvents: "none" }} />
                                  <span
                                    style={{
                                      position: "relative",
                                      zIndex: 1,
                                      fontSize: "9px",
                                      fontWeight: 800,
                                      color: "#0284C7",
                                      letterSpacing: "0.05em",
                                      textTransform: "uppercase",
                                      pointerEvents: "none",
                                      padding: "0 4px",
                                      lineHeight: 1,
                                      maxWidth: "100%",
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                      whiteSpace: "nowrap",
                                    }}
                                  >
                                    {displayName}
                                  </span>
                                </div>
                              );
                            }

                            if (isStairs) {
                              return (
                                <div
                                  key={el.id}
                                  style={{
                                    position: "absolute",
                                    left: el.x,
                                    top: el.y,
                                    width: el.width,
                                    height: el.height,
                                    transform: `rotate(${el.rotation || 0}deg)`,
                                    zIndex: el.zIndex || 1,
                                    backgroundColor: bg,
                                    borderRadius: "4px",
                                    border: "1.5px solid #94A3B8",
                                    pointerEvents: "none",
                                    display: "flex",
                                    flexDirection: "column",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    overflow: "hidden",
                                    padding: "4px",
                                    boxSizing: "border-box",
                                  }}
                                >
                                  <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", opacity: 0.75 }} xmlns="http://www.w3.org/2000/svg">
                                    <defs>
                                      <pattern id={`stairs-pattern-kiosk-${el.id}`} width="100%" height="16" patternUnits="userSpaceOnUse">
                                        <line x1="0" y1="16" x2="100%" y2="16" stroke="#94A3B8" strokeWidth="1.5" />
                                      </pattern>
                                    </defs>
                                    <rect width="100%" height="100%" fill={`url(#stairs-pattern-kiosk-${el.id})`} />
                                    <line x1="50%" y1="85%" x2="50%" y2="20%" stroke="#64748B" strokeWidth="2" strokeLinecap="round" />
                                    <polyline points="calc(50% - 6px),30% 50%,18% calc(50% + 6px),30%" fill="none" stroke="#64748B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                  </svg>
                                  <div style={{ position: "relative", zIndex: 1, background: "rgba(255, 255, 255, 0.9)", padding: "2px 6px", borderRadius: "4px", border: "1px solid #CBD5E1", display: "flex", alignItems: "center", gap: "4px", maxWidth: "90%" }}>
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      <path d="M19 5h-4v4h-4v4H7v4H3v2h18V5z" />
                                    </svg>
                                    <span style={{ fontSize: "10px", fontWeight: 800, color: "#334155", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                      {displayName}
                                    </span>
                                  </div>
                                </div>
                              );
                            }

                            const borderStyle = el.style?.borderStyle || (el.style as any)?.borderStyle || (el as any).properties?.borderStyle;
                            let structureBorder = "1px solid rgba(0, 0, 0, 0.15)";
                            if (borderStyle === "dashed") {
                              structureBorder = "1.5px dashed var(--da-border, #CBD5E1)";
                            } else if (borderStyle === "none") {
                              structureBorder = "none";
                            } else if (el.elementType?.toLowerCase().includes("door")) {
                              structureBorder = "2px dashed var(--da-brand-dark, #0C3B27)";
                            }

                            return (
                              <div
                                key={el.id}
                                style={{
                                  position: "absolute",
                                  left: el.x,
                                  top: el.y,
                                  width: el.width,
                                  height: el.height,
                                  transform: `rotate(${el.rotation || 0}deg)`,
                                  zIndex: el.zIndex || 1,
                                  backgroundColor: bg,
                                  borderRadius: "8px",
                                  border: structureBorder,
                                  pointerEvents: "none",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  overflow: "hidden",
                                  color: textColor,
                                  boxSizing: "border-box",
                                }}
                              >
                                <span
                                  style={{
                                    maxWidth: "100%",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                    fontSize: el.height <= 20 ? "9px" : "11px",
                                    fontWeight: el.height <= 20 ? 800 : 700,
                                    letterSpacing: el.height <= 20 ? "0.05em" : "normal",
                                    textTransform: el.height <= 20 ? "uppercase" : "none",
                                    padding: "0 4px",
                                    lineHeight: 1,
                                  }}
                                >
                                  {displayName}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Selected Spot Footer */}
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--da-text-secondary)]">
                    <p className="font-medium">
                      Click an available workspace to select it. (Guest reservations do not hold inventory until confirmed).
                    </p>
                    {selectedWorkspace && (
                      <div className="flex items-center gap-3">
                        <span className="font-bold text-[var(--da-brand-dark)]">
                          Selected: {selectedWorkspace.displayName} ({selectedWorkspace.floorName})
                        </span>
                        <button
                          type="button"
                          disabled={isVenueClosed || occupiedInstanceIds.has(selectedWorkspace.workspaceInstanceId)}
                          onClick={() => {
                            if (isVenueClosed || occupiedInstanceIds.has(selectedWorkspace.workspaceInstanceId)) return;
                            setStep("duration");
                          }}
                          className={`da-primary-button text-xs font-bold px-4 py-2 ${
                            isVenueClosed || occupiedInstanceIds.has(selectedWorkspace.workspaceInstanceId)
                              ? "opacity-50 cursor-not-allowed bg-slate-300 border-slate-300 text-slate-600"
                              : ""
                          }`}
                        >
                          {isVenueClosed
                            ? "Facility Closed"
                            : occupiedInstanceIds.has(selectedWorkspace.workspaceInstanceId)
                            ? "Spot Occupied"
                            : "Proceed to Duration →"}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                /* FLOW B: Browse by Category */
                <div className="rounded-[28px] border border-[var(--da-border)] bg-white p-6 sm:p-8 shadow-[var(--da-shadow-lg)]">
                  <div className="flex items-center justify-between border-b border-[var(--da-border-light)] pb-4 mb-6">
                    <div>
                      <span className="text-xs font-bold uppercase tracking-wider text-[var(--da-primary)]">
                        Workspace Categories
                      </span>
                      <h2 className="text-2xl font-extrabold text-[var(--da-brand-dark)]">
                        Select Workspace Type
                      </h2>
                    </div>
                    <span className={`rounded-full px-3.5 py-1 text-xs font-extrabold ${isVenueClosed ? "bg-amber-100 text-amber-800" : "bg-[var(--da-info)] text-[var(--da-primary)]"}`}>
                      {isVenueClosed ? "Facility Closed" : `${availableTemplates.length} Categories Available`}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {availableTemplates.map((tpl) => {
                      const tplPricing = resolveEffectivePrice(
                        tpl.id,
                        "HOURLY",
                        tpl.rateAmount,
                        targetBookingTime,
                        activePromotions,
                        1
                      );

                      return (
                        <div
                          key={tpl.id}
                          onClick={() => {
                            if (isVenueClosed) return;
                            handleSelectTemplate(tpl);
                          }}
                          className={`group relative flex flex-col justify-between rounded-[24px] border-2 border-[var(--da-border-light)] bg-white transition-all duration-200 overflow-hidden p-5 ${
                            isVenueClosed ? "opacity-60 cursor-not-allowed" : "hover:border-[var(--da-primary)] hover:shadow-lg cursor-pointer"
                          }`}
                        >
                          <div className="relative aspect-[16/10] w-full overflow-hidden rounded-2xl border border-[var(--da-border-light)] bg-slate-100 mb-4">
                            {tpl.photoPath ? (
                              <img
                                src={tpl.photoPath}
                                alt={tpl.name}
                                className="h-full w-full object-cover group-hover:scale-105 transition duration-300"
                                style={{
                                  objectPosition: getWorkspacePhotoObjectPosition(tpl.photoPosition),
                                }}
                              />
                            ) : (
                              <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-[#E0EFE4]/60 to-[#F3F7F4]">
                                <span className="text-4xl">🏢</span>
                                <span className="mt-2 text-xs font-bold text-[var(--da-brand-dark)]">
                                  DeskAtlas Space
                                </span>
                              </div>
                            )}
                            <div className="absolute top-3 right-3 flex flex-col items-end gap-1">
                              {tplPricing.isPromotional && (
                                <span className="rounded-full bg-amber-500 text-white px-2.5 py-0.5 text-[10px] font-extrabold shadow-sm">
                                  {tplPricing.promoName || "Holiday Promo"}
                                </span>
                              )}
                              <span className="rounded-full bg-white/95 backdrop-blur px-3 py-1 text-xs font-extrabold text-[var(--da-brand-dark)] shadow-sm border border-slate-200">
                                {tplPricing.isPromotional ? (
                                  <>
                                    <span className="line-through text-slate-400 font-normal mr-1.5">₱{tpl.rateAmount.toFixed(2)}/hr</span>
                                    <span className="text-[var(--da-primary)] font-extrabold">₱{tplPricing.effectivePrice.toFixed(2)}/hr</span>
                                  </>
                                ) : (
                                  `₱${tpl.rateAmount.toFixed(2)}/hr`
                                )}
                              </span>
                            </div>
                          </div>

                        <div className="flex flex-col flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <h3 className="text-lg font-extrabold text-[var(--da-brand-dark)] group-hover:text-[var(--da-primary)] transition">
                              {tpl.name}
                            </h3>
                            <span className="rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-[11px] font-bold text-emerald-800 shrink-0">
                              👤 {tpl.capacity} {tpl.capacity === 1 ? "seat" : "seats"}
                            </span>
                          </div>

                          <p className="mt-2 text-xs text-[var(--da-text-secondary)] line-clamp-2 leading-relaxed">
                            {tpl.description || "Equipped workspace with high-speed WiFi, power outlets, and ergonomic seating."}
                          </p>

                          <div className="mt-4 pt-3 border-t border-[var(--da-border-light)] flex items-center justify-between text-xs text-[var(--da-text-secondary)]">
                            <span className="font-semibold text-slate-600">
                              📍 {tpl.floors.join(", ")}
                            </span>
                            <span className="font-bold text-[var(--da-brand-dark)]">
                              {isVenueClosed ? "Unavailable (Closed)" : `${tpl.instanceCount} ${tpl.instanceCount === 1 ? "spot" : "spots"}`}
                            </span>
                          </div>
                        </div>

                        <button
                          type="button"
                          disabled={isVenueClosed}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isVenueClosed) return;
                            handleSelectTemplate(tpl);
                          }}
                          className={`mt-4 da-primary-button w-full justify-center py-2.5 text-xs font-extrabold ${
                            isVenueClosed ? "opacity-50 cursor-not-allowed bg-slate-200 text-slate-500 border-slate-300" : ""
                          }`}
                        >
                          {isVenueClosed ? "Facility Closed" : `Select ${tpl.name} →`}
                        </button>
                      </div>
                    );
                  })}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* STEP 2: Choose Duration (Hours starting NOW) */}
          {step === "duration" && (selectedWorkspace || selectedTemplate) && (
            <section className="flex flex-col gap-6">
              {/* Selected Workspace / Category Banner */}
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-[24px] border border-[var(--da-border)] bg-white p-5 sm:p-6 shadow-[var(--da-shadow-md)]">
                <div className="flex items-center gap-4">
                  {(selectedWorkspace?.photoPath || selectedTemplate?.photoPath) ? (
                    <img
                      src={selectedWorkspace?.photoPath || selectedTemplate?.photoPath!}
                      alt={selectedWorkspace?.displayName || selectedTemplate?.name!}
                      className="h-16 w-16 rounded-2xl object-cover border border-[var(--da-border-light)]"
                    />
                  ) : (
                    <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--da-canvas)] border border-[var(--da-border-light)] text-2xl">
                      🏢
                    </div>
                  )}
                  <div>
                    <span className="text-xs font-bold uppercase tracking-wider text-[var(--da-primary)]">
                      {selectedWorkspace ? "Selected Desk" : "Selected Category"}
                    </span>
                    <h2 className="text-xl sm:text-2xl font-extrabold text-[var(--da-brand-dark)]">
                      {selectedWorkspace?.displayName || selectedTemplate?.name}
                    </h2>
                    <p className="text-xs text-[var(--da-text-secondary)] mt-0.5">
                      {selectedWorkspace?.templateName || selectedTemplate?.name} •{" "}
                      {selectedRateType === "DAY_PASS"
                        ? `☀️ Day Pass (₱${currentRate.toFixed(2)} flat)`
                        : selectedRateType === "NIGHT_PASS"
                        ? `🌙 Night Pass (₱${currentRate.toFixed(2)} flat)`
                        : selectedRateType === "WHOLE_DAY_PASS"
                        ? `⏳ 24-Hour Pass (₱${currentRate.toFixed(2)} flat)`
                        : selectedRateType === "HALF_DAY_PASS"
                        ? `🌓 12-Hour Pass (₱${currentRate.toFixed(2)} flat)`
                        : `₱${currentRate.toFixed(2)}/hr`}
                      {selectedWorkspace ? ` • ${selectedWorkspace.floorName}` : ""}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setStep("discovery")}
                  className="da-secondary-button text-xs font-bold py-2 px-4"
                >
                  ← Change Spot
                </button>
              </div>

              {/* Duration & Tier Selector Card */}
              <div className="rounded-[28px] border border-[var(--da-border)] bg-white p-6 sm:p-8 shadow-[var(--da-shadow-lg)]">
                <div className="border-b border-[var(--da-border-light)] pb-4 mb-6">
                  <span className="text-xs font-bold uppercase tracking-wider text-[var(--da-primary)]">
                    Step 2 of 3 • Booking Tier & Duration
                  </span>
                  <h3 className="text-2xl font-extrabold text-[var(--da-brand-dark)]">
                    {selectedRateType === "DAY_PASS"
                      ? `☀️ Day Pass • Active until ${formatTime12Hour(dayPassWindow.end)} today`
                      : selectedRateType === "NIGHT_PASS"
                      ? `🌙 Night Pass • Concludes Tomorrow at ${formatTime12Hour(nightPassWindow.end)} (Overnight)`
                      : selectedRateType === "WHOLE_DAY_PASS"
                      ? `⏳ 24-Hour Pass • Full 24 Hours until tomorrow at ${formatTime12Hour(nowTime)}`
                      : selectedRateType === "HALF_DAY_PASS"
                      ? `🌓 12-Hour Pass • Full 12 Hours until ${formatTime12Hour(endTimeStr)}${isNextDay ? " (Next Day)" : ""}`
                      : isNextDay
                      ? `Walk-in Stay • Concludes Tomorrow at ${formatTime12Hour(endTimeStr)} (Next Day)`
                      : "Choose your booking tier or stay duration"}
                  </h3>
                  <p className="text-xs text-[var(--da-text-secondary)] mt-1">
                    Walk-in bookings start right now at <strong>{formatTime12Hour(nowTime)}</strong> (Philippine Standard Time). No backup selection required.
                  </p>
                </div>

                {/* Rate Tier Selector Pills (Only if passes are configured) */}
                {((selectedWorkspace?.hasDayPass || selectedTemplate?.hasDayPass) ||
                  (selectedWorkspace?.hasNightPass || selectedTemplate?.hasNightPass) ||
                  (selectedWorkspace?.hasWholeDayPass || selectedTemplate?.hasWholeDayPass) ||
                  (selectedWorkspace?.hasHalfDayPass || selectedTemplate?.hasHalfDayPass)) && (
                  <div className="mb-6">
                    <span className="text-xs font-extrabold text-[var(--da-brand-dark)] uppercase tracking-wider block mb-2.5">
                      Select Booking Tier
                    </span>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2.5">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedRateType("HOURLY");
                          setDurationHours(2);
                          setDurationInputStr("2");
                        }}
                        className={`flex flex-col items-center justify-center p-3.5 rounded-2xl border text-center transition ${
                          selectedRateType === "HOURLY"
                            ? "bg-[var(--da-primary)] text-white border-[var(--da-accent)] shadow-sm ring-2 ring-[var(--da-accent)]"
                            : "bg-[var(--da-canvas)] text-[var(--da-brand-dark)] border-[var(--da-border-light)] hover:bg-slate-50"
                        }`}
                      >
                        <span className="text-xs font-extrabold">🕒 Hourly</span>
                        <span className="text-[11px] font-bold mt-0.5 opacity-90">
                          ₱{regularRate.toFixed(2)}/hr
                        </span>
                      </button>

                      {(selectedWorkspace?.hasDayPass || selectedTemplate?.hasDayPass) && (selectedWorkspace?.dayPassPrice != null || selectedTemplate?.dayPassPrice != null) && (
                        <button
                          type="button"
                          onClick={() => setSelectedRateType("DAY_PASS")}
                          className={`flex flex-col items-center justify-center p-3.5 rounded-2xl border text-center transition ${
                            selectedRateType === "DAY_PASS"
                              ? "bg-[var(--da-primary)] text-white border-[var(--da-accent)] shadow-sm ring-2 ring-[var(--da-accent)]"
                              : "bg-[var(--da-canvas)] text-[var(--da-brand-dark)] border-[var(--da-border-light)] hover:bg-slate-50"
                          }`}
                        >
                          <span className="text-xs font-extrabold">☀️ Day Pass</span>
                          <span className="text-[11px] font-bold mt-0.5 opacity-90">
                            ₱{(selectedWorkspace?.dayPassPrice ?? selectedTemplate?.dayPassPrice ?? 0).toFixed(2)} flat
                          </span>
                        </button>
                      )}

                      {(selectedWorkspace?.hasNightPass || selectedTemplate?.hasNightPass) && (selectedWorkspace?.nightPassPrice != null || selectedTemplate?.nightPassPrice != null) && (
                        <button
                          type="button"
                          onClick={() => setSelectedRateType("NIGHT_PASS")}
                          className={`flex flex-col items-center justify-center p-3.5 rounded-2xl border text-center transition ${
                            selectedRateType === "NIGHT_PASS"
                              ? "bg-[var(--da-primary)] text-white border-[var(--da-accent)] shadow-sm ring-2 ring-[var(--da-accent)]"
                              : "bg-[var(--da-canvas)] text-[var(--da-brand-dark)] border-[var(--da-border-light)] hover:bg-slate-50"
                          }`}
                        >
                          <span className="text-xs font-extrabold">🌙 Night Pass</span>
                          <span className="text-[11px] font-bold mt-0.5 opacity-90">
                            ₱{(selectedWorkspace?.nightPassPrice ?? selectedTemplate?.nightPassPrice ?? 0).toFixed(2)} flat
                          </span>
                        </button>
                      )}

                      {(selectedWorkspace?.hasWholeDayPass || selectedTemplate?.hasWholeDayPass) && (selectedWorkspace?.wholeDayPassPrice != null || selectedTemplate?.wholeDayPassPrice != null) && (
                        <button
                          type="button"
                          onClick={() => setSelectedRateType("WHOLE_DAY_PASS")}
                          className={`flex flex-col items-center justify-center p-3.5 rounded-2xl border text-center transition ${
                            selectedRateType === "WHOLE_DAY_PASS"
                              ? "bg-[var(--da-primary)] text-white border-[var(--da-accent)] shadow-sm ring-2 ring-[var(--da-accent)]"
                              : "bg-[var(--da-canvas)] text-[var(--da-brand-dark)] border-[var(--da-border-light)] hover:bg-slate-50"
                          }`}
                        >
                          <span className="text-xs font-extrabold">⏳ 24-Hour Pass</span>
                          <span className="text-[11px] font-bold mt-0.5 opacity-90">
                            ₱{(selectedWorkspace?.wholeDayPassPrice ?? selectedTemplate?.wholeDayPassPrice ?? (regularRate * 24)).toFixed(2)} flat
                          </span>
                        </button>
                      )}

                      {(selectedWorkspace?.hasHalfDayPass || selectedTemplate?.hasHalfDayPass) && (selectedWorkspace?.halfDayPassPrice != null || selectedTemplate?.halfDayPassPrice != null) && (
                        <button
                          type="button"
                          onClick={() => setSelectedRateType("HALF_DAY_PASS")}
                          className={`flex flex-col items-center justify-center p-3.5 rounded-2xl border text-center transition ${
                            selectedRateType === "HALF_DAY_PASS"
                              ? "bg-[var(--da-primary)] text-white border-[var(--da-accent)] shadow-sm ring-2 ring-[var(--da-accent)]"
                              : "bg-[var(--da-canvas)] text-[var(--da-brand-dark)] border-[var(--da-border-light)] hover:bg-slate-50"
                          }`}
                        >
                          <span className="text-xs font-extrabold">🌓 12-Hour Pass</span>
                          <span className="text-[11px] font-bold mt-0.5 opacity-90">
                            ₱{(selectedWorkspace?.halfDayPassPrice ?? selectedTemplate?.halfDayPassPrice ?? (regularRate * 12)).toFixed(2)} flat
                          </span>
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* HOURLY RATE CONTENT */}
                {selectedRateType === "HOURLY" ? (
                  <>
                    <div className="flex items-center justify-between mb-2.5">
                      <span className="text-xs font-extrabold text-[var(--da-brand-dark)] uppercase tracking-wider block">
                        Select Duration (Hours)
                      </span>
                      <span className="text-xs font-bold text-[var(--da-primary)] bg-[var(--da-canvas)] border border-[var(--da-border-light)] px-2.5 py-0.5 rounded-full">
                        Hourly Rate: ₱{regularRate.toFixed(2)}/hr
                      </span>
                    </div>
                    {/* Duration Hour Buttons */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-10 gap-3">
                      {DURATION_OPTIONS.map((hours) => {
                        const isSelected = durationHours === hours;
                        const durMinutes = hours * 60;
                        const [nowH, nowM] = nowTime.split(":").map(Number);
                        const tileTotalMinutes = nowH * 60 + nowM + hours * 60;
                        const tileIsNextDay = tileTotalMinutes >= 1440;
                        const isLocked = Boolean(
                          hours > MAX_KIOSK_DURATION_HOURS ||
                          (upcomingBooking?.maxAvailableMinutes !== null &&
                            upcomingBooking?.maxAvailableMinutes !== undefined &&
                            (durMinutes > upcomingBooking.maxAvailableMinutes || upcomingBooking.maxAvailableMinutes < 60))
                        );

                        return (
                          <button
                            key={hours}
                            type="button"
                            disabled={isLocked}
                            title={
                              isLocked
                                ? upcomingBooking?.nextBooking
                                  ? `Reserved at ${upcomingBooking.nextBooking.startTimeFormatted}`
                                  : upcomingBooking?.minutesUntilClosing !== null
                                    ? `Space closes at operating hours limit`
                                    : `Unavailable for ${hours} hours`
                                : undefined
                            }
                            onClick={() => {
                              if (isLocked) return;
                              setDurationHours(hours);
                              setDurationInputStr(String(hours));
                            }}
                            className={`flex flex-col items-center justify-center py-5 px-3 rounded-2xl border-2 transition-all relative ${
                              isLocked
                                ? "bg-slate-100/90 text-slate-400 border-slate-200 cursor-not-allowed opacity-60"
                                : isSelected
                                  ? "bg-[var(--da-primary)] text-white border-[var(--da-accent)] shadow-md ring-2 ring-[var(--da-accent)]"
                                  : "bg-[var(--da-canvas)] text-[var(--da-brand-dark)] border-[var(--da-border-light)] hover:border-[var(--da-primary)] hover:bg-white"
                            }`}
                          >
                            {isLocked && (
                              <span className="absolute top-1.5 right-1.5 text-xs" aria-hidden="true" title="Locked due to upcoming reservation">
                                🔒
                              </span>
                            )}
                            <span className={`text-2xl font-extrabold ${isLocked ? "line-through opacity-70" : ""}`}>
                              {hours}
                            </span>
                            <span className="text-xs font-semibold opacity-90">
                              {hours === 1 ? "Hour" : "Hours"}
                            </span>
                            {tileIsNextDay && !isLocked && (
                              <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100/80 px-1.5 py-0.5 rounded-full mt-0.5">
                                Next Day
                              </span>
                            )}
                            {isLocked ? (
                              <span className="mt-2 text-[9px] font-bold text-rose-600 truncate max-w-full px-1">
                                {upcomingBooking?.nextBooking
                                  ? `Booked ${upcomingBooking.nextBooking.startTimeFormatted}`
                                  : "Limit reached"}
                              </span>
                            ) : (
                              <span className="mt-2 text-[10px] font-bold opacity-75">
                                ₱{(currentRate * hours).toFixed(2)}
                              </span>
                            )}
                          </button>
                        );
                      })}

                      {(selectedWorkspace?.hasDayPass || selectedTemplate?.hasDayPass) && (selectedWorkspace?.dayPassPrice != null || selectedTemplate?.dayPassPrice != null) && (
                        <button
                          type="button"
                          onClick={() => setSelectedRateType("DAY_PASS")}
                          className="col-span-2 sm:col-span-2 md:col-span-1 flex flex-col items-center justify-center py-5 px-3 rounded-2xl border-2 transition-all bg-amber-50 text-amber-950 border-amber-300 hover:bg-amber-100"
                        >
                          <span className="text-2xl font-extrabold">☀️</span>
                          <span className="text-xs font-semibold opacity-90">Day Pass</span>
                          <span className="mt-2 text-[10px] font-bold text-amber-800">
                            ₱{(selectedWorkspace?.dayPassPrice ?? selectedTemplate?.dayPassPrice ?? 0).toFixed(2)} flat
                          </span>
                        </button>
                      )}

                      {(selectedWorkspace?.hasNightPass || selectedTemplate?.hasNightPass) && (selectedWorkspace?.nightPassPrice != null || selectedTemplate?.nightPassPrice != null) && (
                        <button
                          type="button"
                          onClick={() => setSelectedRateType("NIGHT_PASS")}
                          className="col-span-2 sm:col-span-2 md:col-span-1 flex flex-col items-center justify-center py-5 px-3 rounded-2xl border-2 transition-all bg-indigo-50 text-indigo-950 border-indigo-300 hover:bg-indigo-100"
                        >
                          <span className="text-2xl font-extrabold">🌙</span>
                          <span className="text-xs font-semibold opacity-90">Night Pass</span>
                          <span className="mt-2 text-[10px] font-bold text-indigo-800">
                            ₱{(selectedWorkspace?.nightPassPrice ?? selectedTemplate?.nightPassPrice ?? 0).toFixed(2)} flat
                          </span>
                        </button>
                      )}

                      {(selectedWorkspace?.hasHalfDayPass || selectedTemplate?.hasHalfDayPass) && (selectedWorkspace?.halfDayPassPrice != null || selectedTemplate?.halfDayPassPrice != null) && (
                        <button
                          type="button"
                          onClick={() => setSelectedRateType("HALF_DAY_PASS")}
                          className="col-span-2 sm:col-span-2 md:col-span-1 flex flex-col items-center justify-center py-5 px-3 rounded-2xl border-2 transition-all bg-teal-50 text-teal-950 border-teal-300 hover:bg-teal-100"
                        >
                          <span className="text-2xl font-extrabold">12h</span>
                          <span className="text-xs font-semibold opacity-90">Half Day Pass</span>
                          <span className="mt-2 text-[10px] font-bold text-teal-700">
                            ₱{(selectedWorkspace?.halfDayPassPrice ?? selectedTemplate?.halfDayPassPrice ?? 0).toFixed(2)} flat
                          </span>
                        </button>
                      )}

                      {(selectedWorkspace?.hasWholeDayPass || selectedTemplate?.hasWholeDayPass) && (selectedWorkspace?.wholeDayPassPrice != null || selectedTemplate?.wholeDayPassPrice != null) && (
                        <button
                          type="button"
                          onClick={() => setSelectedRateType("WHOLE_DAY_PASS")}
                          className="col-span-2 sm:col-span-2 md:col-span-1 flex flex-col items-center justify-center py-5 px-3 rounded-2xl border-2 transition-all bg-emerald-50 text-emerald-950 border-emerald-300 hover:bg-emerald-100"
                        >
                          <span className="text-2xl font-extrabold">24h</span>
                          <span className="text-xs font-semibold opacity-90">Whole Day Pass</span>
                          <span className="mt-2 text-[10px] font-bold text-emerald-700">
                            ₱{(selectedWorkspace?.wholeDayPassPrice ?? selectedTemplate?.wholeDayPassPrice ?? 0).toFixed(2)} flat
                          </span>
                        </button>
                      )}
                    </div>

                    {/* Custom Hour Input */}
                    <div className="mt-6 pt-4 border-t border-[var(--da-border-light)] flex flex-wrap items-center justify-between gap-4">
                      <div>
                        <span className="text-sm font-bold text-[var(--da-brand-dark)] block">
                          Custom Duration
                        </span>
                        <span className="text-xs text-[var(--da-text-secondary)]">
                          Or enter the exact number of hours you need:
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          aria-label="Custom duration in hours"
                          value={durationInputStr}
                          onChange={(e) => {
                            const raw = e.target.value;
                            const sanitized = raw.replace(/\D/g, "").replace(/^0+/, "");
                            setDurationInputStr(sanitized);
                            if (sanitized === "") {
                              setDurationHours(0);
                            } else {
                              const parsed = parseInt(sanitized, 10);
                              if (parsed === 12 && (selectedWorkspace?.hasHalfDayPass || selectedTemplate?.hasHalfDayPass)) {
                                setSelectedRateType("HALF_DAY_PASS");
                              } else if (parsed === 24 && (selectedWorkspace?.hasWholeDayPass || selectedTemplate?.hasWholeDayPass)) {
                                setSelectedRateType("WHOLE_DAY_PASS");
                              } else {
                                setDurationHours(parsed > 0 ? parsed : 0);
                              }
                            }
                          }}
                          onKeyDown={handleNumericKeyDown}
                          placeholder="Hours"
                          className="w-24 rounded-xl border border-[var(--da-border)] bg-white px-3 py-2 text-center text-base font-extrabold text-[var(--da-brand-dark)] placeholder:text-slate-400 focus:border-[var(--da-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--da-primary)]/20"
                        />
                        <span className="text-sm font-bold text-[var(--da-brand-dark)]">
                          {durationHours === 1 ? "Hour" : "Hours"}
                        </span>
                      </div>
                    </div>
                  </>
                ) : selectedRateType === "DAY_PASS" ? (
                  /* DAY PASS CARD */
                  <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-5">
                    <div className="flex items-center gap-3">
                      <span className="text-3xl">☀️</span>
                      <div>
                        <h4 className="text-base font-extrabold text-amber-950">
                          Day Pass Shift Package
                        </h4>
                        <p className="text-xs text-amber-900 mt-0.5">
                          Continuous daytime workspace access until {formatTime12Hour(dayPassWindow.end)} today.
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 pt-3 border-t border-amber-200/80 flex flex-wrap items-center justify-between gap-3 text-xs text-amber-950">
                      <div>
                        <span className="font-bold">Your Walk-In Window:</span> {formatTime12Hour(nowTime)} until {formatTime12Hour(dayPassWindow.end)} today
                      </div>
                      <div className="font-extrabold text-sm text-[var(--da-primary)]">
                        Flat Total: ₱{totalAmount.toFixed(2)}
                      </div>
                    </div>
                  </div>
                ) : selectedRateType === "NIGHT_PASS" ? (
                  /* NIGHT PASS CARD */
                  <div className="rounded-2xl border border-indigo-200 bg-indigo-50/80 p-5">
                    <div className="flex items-center gap-3">
                      <span className="text-3xl">🌙</span>
                      <div>
                        <h4 className="text-base font-extrabold text-indigo-950">
                          Night Pass Overnight Shift Package
                        </h4>
                        <p className="text-xs text-indigo-900 mt-0.5">
                          Continuous overnight workspace access until {formatTime12Hour(nightPassWindow.end)} tomorrow morning.
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 pt-3 border-t border-indigo-200/80 flex flex-wrap items-center justify-between gap-3 text-xs text-indigo-950">
                      <div>
                        <span className="font-bold">Your Walk-In Window:</span> {formatTime12Hour(nowTime)} until {formatTime12Hour(nightPassWindow.end)} tomorrow (Next Day • Overnight)
                      </div>
                      <div className="font-extrabold text-sm text-[var(--da-primary)]">
                        Flat Total: ₱{totalAmount.toFixed(2)}
                      </div>
                    </div>
                  </div>
                ) : selectedRateType === "WHOLE_DAY_PASS" ? (
                  /* 24-HOUR PASS CARD */
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5">
                    <div className="flex items-center gap-3">
                      <span className="text-3xl">⏳</span>
                      <div>
                        <h4 className="text-base font-extrabold text-emerald-950">
                          24-Hour Whole Day Pass Package
                        </h4>
                        <p className="text-xs text-emerald-900 mt-0.5">
                          Continuous 24-hour workspace access starting right now.
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 pt-3 border-t border-emerald-200/80 flex flex-wrap items-center justify-between gap-3 text-xs text-emerald-950">
                      <div>
                        <span className="font-bold">Your Walk-In Window:</span> {formatTime12Hour(nowTime)} today until {formatTime12Hour(nowTime)} tomorrow (Next Day • 24 Hours)
                      </div>
                      <div className="font-extrabold text-sm text-[var(--da-primary)]">
                        Flat Total: ₱{totalAmount.toFixed(2)}
                      </div>
                    </div>
                  </div>
                ) : (
                  /* 12-HOUR PASS CARD */
                  <div className="rounded-2xl border border-teal-200 bg-teal-50/60 p-5">
                    <div className="flex items-center gap-3">
                      <span className="text-3xl">🌓</span>
                      <div>
                        <h4 className="text-base font-extrabold text-teal-950">
                          12-Hour Half Day Pass Package
                        </h4>
                        <p className="text-xs text-teal-900 mt-0.5">
                          Continuous 12-hour workspace access starting right now.
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 pt-3 border-t border-teal-200/80 flex flex-wrap items-center justify-between gap-3 text-xs text-teal-950">
                      <div>
                        <span className="font-bold">Your Walk-In Window:</span> {formatTime12Hour(nowTime)} until {formatTime12Hour(endTimeStr)}{isNextDay ? " (Next Day)" : ""} (12 Hours)
                      </div>
                      <div className="font-extrabold text-sm text-[var(--da-primary)]">
                        Flat Total: ₱{totalAmount.toFixed(2)}
                      </div>
                    </div>
                  </div>
                )}

                {/* Custom Hour Input Warning if Exceeds Availability, 24h Limit, or Spot Unavailable */}
                {selectedRateType === "HOURLY" &&
                  (durationHours > MAX_KIOSK_DURATION_HOURS ||
                    (upcomingBooking?.maxAvailableMinutes !== null &&
                      upcomingBooking?.maxAvailableMinutes !== undefined &&
                      (upcomingBooking.maxAvailableMinutes < 60 || durationHours * 60 > upcomingBooking.maxAvailableMinutes))) && (
                    <div className="mt-4 text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-3.5 flex items-center gap-2">
                      <span className="text-base">⚠️</span>
                      <span>
                        {durationHours > MAX_KIOSK_DURATION_HOURS
                          ? `Walk-in reservations cannot exceed ${MAX_KIOSK_DURATION_HOURS} hours.`
                          : upcomingBooking?.maxAvailableMinutes !== null &&
                            upcomingBooking?.maxAvailableMinutes !== undefined &&
                            upcomingBooking.maxAvailableMinutes < 60
                            ? upcomingBooking.nextBooking
                              ? upcomingBooking.nextBooking.type === "SCHEDULE_BLOCK"
                                ? `Facility Closed: Scheduled closure starts in ${upcomingBooking.maxAvailableMinutes} mins (${upcomingBooking.nextBooking.startTimeFormatted}). Minimum stay is 1 hour.`
                                : `Desk Unavailable: Upcoming reservation starts in ${upcomingBooking.maxAvailableMinutes} mins (${upcomingBooking.nextBooking.startTimeFormatted}). Minimum stay is 1 hour.`
                              : `Desk Unavailable: The space closes in ${upcomingBooking.maxAvailableMinutes} mins.`
                            : upcomingBooking?.nextBooking
                              ? upcomingBooking.nextBooking.type === "SCHEDULE_BLOCK"
                                ? `The requested duration extends into a scheduled facility closure starting at ${upcomingBooking.nextBooking.startTimeFormatted}. Maximum available stay is ${upcomingBooking.maxAvailableHours ?? Math.floor(upcomingBooking.maxAvailableMinutes! / 60)} ${(upcomingBooking.maxAvailableHours ?? Math.floor(upcomingBooking.maxAvailableMinutes! / 60)) === 1 ? "hour" : "hours"}.`
                                : `This desk has an upcoming reservation starting at ${upcomingBooking.nextBooking.startTimeFormatted}. Maximum available stay is ${upcomingBooking.maxAvailableHours ?? Math.floor(upcomingBooking.maxAvailableMinutes! / 60)} ${(upcomingBooking.maxAvailableHours ?? Math.floor(upcomingBooking.maxAvailableMinutes! / 60)) === 1 ? "hour" : "hours"}.`
                              : `The requested duration exceeds today's remaining operating hours (Maximum ${upcomingBooking?.maxAvailableHours ?? Math.floor((upcomingBooking?.maxAvailableMinutes ?? 0) / 60)} ${(upcomingBooking?.maxAvailableHours ?? Math.floor((upcomingBooking?.maxAvailableMinutes ?? 0) / 60)) === 1 ? "hour" : "hours"}).`}
                      </span>
                    </div>
                  )}

                {/* Immediate Schedule Preview */}
                {effectiveDurationHours > 0 ? (
                  <div className="mt-6 rounded-2xl bg-[var(--da-canvas)] border border-[var(--da-border-light)] p-5 flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white border border-[var(--da-border-light)] text-xl">
                        ⏱️
                      </div>
                      <div>
                        <span className="text-xs font-bold text-[var(--da-text-secondary)] block">
                          Immediate Walk-In Window:
                        </span>
                        <p className="text-base font-extrabold text-[var(--da-brand-dark)]">
                          {formatTime12Hour(nowTime)} – {formatTime12Hour(endTimeStr)}{isNextDay ? " (Next Day)" : ""} ({effectiveDurationHours} {effectiveDurationHours === 1 ? "hour" : "hours"})
                        </p>
                      </div>
                    </div>

                    <div className="text-right flex flex-col items-end">
                      {resolvedPricing.isPromotional && (
                        <div className="flex items-center gap-2 mb-1">
                          <span className="rounded-full bg-amber-500 text-white px-2 py-0.5 text-[10px] font-extrabold shadow-sm">
                            {resolvedPricing.promoName || "Promo Rate"}
                          </span>
                          <span className="text-xs text-slate-400 line-through">
                            ₱{resolvedPricing.regularPrice.toFixed(2)}{selectedRateType === "HOURLY" ? "/hr" : " flat"}
                          </span>
                          <span className="text-xs font-extrabold text-[var(--da-primary)]">
                            ₱{resolvedPricing.effectivePrice.toFixed(2)}{selectedRateType === "HOURLY" ? "/hr" : " flat"}
                          </span>
                        </div>
                      )}
                      <span className="text-xs font-bold text-[var(--da-text-secondary)] block">
                        {selectedRateType === "HOURLY" ? "Estimated Total:" : "Flat Rate Total:"}
                      </span>
                      <p className="text-xl font-extrabold text-[var(--da-primary)]">
                        ₱{totalAmount.toFixed(2)}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="mt-6 rounded-2xl bg-amber-50 border border-amber-200 p-4 text-center text-xs font-bold text-amber-800">
                    {selectedWorkspace &&
                      upcomingBooking?.maxAvailableMinutes !== null &&
                      upcomingBooking?.maxAvailableMinutes !== undefined &&
                      upcomingBooking.maxAvailableMinutes < 60
                      ? upcomingBooking.nextBooking
                        ? `Desk is unavailable: An upcoming reservation starts at ${upcomingBooking.nextBooking.startTimeFormatted} (${upcomingBooking.maxAvailableMinutes} mins away).`
                        : `Desk is unavailable: The space closes in ${upcomingBooking.maxAvailableMinutes} mins.`
                      : "Please select or enter a duration of at least 1 hour to continue."}
                  </div>
                )}

                {/* Conflict Notice if Selected Workspace is Occupied for this Duration */}
                {selectedWorkspace && occupiedInstanceIds.has(selectedWorkspace.workspaceInstanceId) && (
                  <div className="mt-6 rounded-2xl bg-rose-50 border border-rose-200 p-4 text-xs font-bold text-rose-800 flex items-center gap-2">
                    <span className="text-base">⚠️</span>
                    <span>
                      This desk has an upcoming reservation and cannot accommodate this stay. Please select a shorter duration or pick another desk.
                    </span>
                  </div>
                )}

                {/* Continue Button */}
                <div className="mt-6 flex justify-end">
                  <button
                    type="button"
                    disabled={
                      !effectiveDurationHours ||
                      effectiveDurationHours <= 0 ||
                      (selectedRateType === "HOURLY" && durationHours > MAX_KIOSK_DURATION_HOURS) ||
                      Boolean(selectedWorkspace && occupiedInstanceIds.has(selectedWorkspace.workspaceInstanceId)) ||
                      Boolean(
                        selectedRateType === "HOURLY" &&
                        upcomingBooking?.maxAvailableMinutes !== null &&
                        upcomingBooking?.maxAvailableMinutes !== undefined &&
                        (durationHours * 60 > upcomingBooking.maxAvailableMinutes || upcomingBooking.maxAvailableMinutes < 60)
                      )
                    }
                    onClick={() => {
                      if (!effectiveDurationHours || effectiveDurationHours <= 0) return;
                      if (selectedRateType === "HOURLY" && durationHours > MAX_KIOSK_DURATION_HOURS) return;
                      if (selectedWorkspace && occupiedInstanceIds.has(selectedWorkspace.workspaceInstanceId)) return;
                      if (
                        selectedRateType === "HOURLY" &&
                        upcomingBooking?.maxAvailableMinutes !== null &&
                        upcomingBooking?.maxAvailableMinutes !== undefined &&
                        (durationHours * 60 > upcomingBooking.maxAvailableMinutes || upcomingBooking.maxAvailableMinutes < 60)
                      ) {
                        return;
                      }
                      if (selectedWorkspace) {
                        setStep("details");
                      } else {
                        setStep("category-instances");
                      }
                    }}
                    className={`da-primary-button text-sm font-extrabold px-8 py-3 ${
                      !effectiveDurationHours ||
                      effectiveDurationHours <= 0 ||
                      (selectedRateType === "HOURLY" && durationHours > MAX_KIOSK_DURATION_HOURS) ||
                      Boolean(selectedWorkspace && occupiedInstanceIds.has(selectedWorkspace.workspaceInstanceId)) ||
                      Boolean(
                        selectedRateType === "HOURLY" &&
                        upcomingBooking?.maxAvailableMinutes !== null &&
                        upcomingBooking?.maxAvailableMinutes !== undefined &&
                        (durationHours * 60 > upcomingBooking.maxAvailableMinutes || upcomingBooking.maxAvailableMinutes < 60)
                      )
                        ? "opacity-50 cursor-not-allowed"
                        : ""
                    }`}
                  >
                    {selectedRateType === "HOURLY" && durationHours > MAX_KIOSK_DURATION_HOURS
                      ? `Duration Exceeds Maximum (Max ${MAX_KIOSK_DURATION_HOURS}h)`
                      : selectedRateType === "HOURLY" &&
                        upcomingBooking?.maxAvailableMinutes !== null &&
                        upcomingBooking?.maxAvailableMinutes !== undefined &&
                        upcomingBooking.maxAvailableMinutes < 60
                        ? upcomingBooking.nextBooking
                          ? upcomingBooking.nextBooking.type === "SCHEDULE_BLOCK"
                            ? `Facility Closed in ${upcomingBooking.maxAvailableMinutes} mins`
                            : `Desk Unavailable: Upcoming Reservation in ${upcomingBooking.maxAvailableMinutes} mins`
                          : `Desk Unavailable: Closing in ${upcomingBooking.maxAvailableMinutes} mins`
                        : selectedRateType === "HOURLY" &&
                          upcomingBooking?.maxAvailableMinutes !== null &&
                          upcomingBooking?.maxAvailableMinutes !== undefined &&
                          durationHours * 60 > upcomingBooking.maxAvailableMinutes
                          ? `Duration Exceeds Availability (Max ${upcomingBooking.maxAvailableHours ?? Math.floor(upcomingBooking.maxAvailableMinutes / 60)}h)`
                          : selectedWorkspace && occupiedInstanceIds.has(selectedWorkspace.workspaceInstanceId)
                            ? "Desk Unavailable for Duration"
                            : selectedWorkspace
                              ? "Proceed to Customer Details →"
                              : "Select Available Desk for Now →"}
                  </button>
                </div>
              </div>
            </section>
          )}

          {/* STEP 2.5: Category Flow Physical Instance Picker (if user came through Category flow) */}
          {step === "category-instances" && selectedTemplate && (
            <section className="flex flex-col gap-6">
              <div className="rounded-[28px] border border-[var(--da-border)] bg-white p-6 sm:p-8 shadow-[var(--da-shadow-lg)]">
                <div className="flex justify-between items-center border-b border-[var(--da-border-light)] pb-4 mb-6">
                  <div>
                    <h3 className="text-2xl font-extrabold text-[var(--da-brand-dark)]">
                      Available {selectedTemplate.name} Desks (Starting Now)
                    </h3>
                    <p className="text-xs text-[var(--da-text-secondary)] mt-0.5">
                      Showing desks available right now from {formatTime12Hour(nowTime)} to {formatTime12Hour(endTimeStr)}{isNextDay ? " (Next Day)" : ""} ({effectiveDurationHours}h).
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setStep("duration")}
                    className="da-secondary-button text-xs font-bold py-2 px-3"
                  >
                    ← Change Duration
                  </button>
                </div>

                {loadingCategoryInstances ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <div className="h-8 w-8 animate-spin rounded-full border-3 border-[var(--da-primary)] border-t-transparent mb-3" />
                    <p className="text-sm font-semibold text-[var(--da-text-secondary)]">
                      Checking desk availability...
                    </p>
                  </div>
                ) : categoryInstances.filter((i) => i.isAvailable).length === 0 ? (
                  <div className="rounded-2xl bg-[var(--da-canvas)] border border-[var(--da-border-light)] p-10 text-center">
                    <span className="text-4xl">🏢</span>
                    <h4 className="mt-3 text-base font-extrabold text-[var(--da-brand-dark)]">
                      No desks available right now
                    </h4>
                    <p className="mt-1 text-xs text-[var(--da-text-secondary)]">
                      {categoryInstances.some((i) => i.blockingReason === "BUSINESS_CLOSED" || i.blockingReason === "OUTSIDE_OPERATING_HOURS")
                        ? "The space is currently closed outside operating hours. Please visit during open hours."
                        : categoryInstances.some((i) => i.blockingReason === "PAST_TIME")
                          ? "Selected time has elapsed. Please change duration or try again."
                          : "All desks in this category are occupied or in maintenance. Please try a shorter duration or pick another category."}
                    </p>
                    <button
                      type="button"
                      onClick={() => setStep("discovery")}
                      className="mt-4 da-primary-button text-xs font-bold"
                    >
                      ← Browse Other Categories
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                    {categoryInstances.map((inst) => {
                      const isAvailable = inst.isAvailable;
                      const isOccupied = !isAvailable && (inst.blockingReason === "RESERVATION_CONFLICT" || occupiedInstanceIds.has(inst.workspaceInstanceId));
                      const wsModel = allFloorWorkspaces.find(
                        (w) => w.workspaceInstanceId === inst.workspaceInstanceId
                      );
                      return (
                        <div
                          key={inst.workspaceInstanceId}
                          onClick={() => {
                            if (isAvailable) {
                              if (wsModel) {
                                setSelectedWorkspace(wsModel);
                                setStep("details");
                              } else {
                                setSelectedWorkspace({
                                  id: inst.workspaceInstanceId,
                                  workspaceInstanceId: inst.workspaceInstanceId,
                                  templateId: inst.templateId,
                                  floorId: inst.floorId,
                                  floorName: inst.floorName,
                                  instanceCode: inst.instanceCode,
                                  displayName: inst.displayName,
                                  templateName: inst.templateName,
                                  description: selectedTemplate.description || "Workspace details",
                                  rateAmount: inst.rateAmount,
                                  pricingLabel: `PHP ${inst.rateAmount}/hour`,
                                  hasDayPass: selectedTemplate.hasDayPass,
                                  dayPassPrice: selectedTemplate.dayPassPrice,
                                  hasNightPass: selectedTemplate.hasNightPass,
                                  nightPassPrice: selectedTemplate.nightPassPrice,
                                  hasWholeDayPass: selectedTemplate.hasWholeDayPass,
                                  wholeDayPassPrice: selectedTemplate.wholeDayPassPrice,
                                  hasHalfDayPass: selectedTemplate.hasHalfDayPass,
                                  halfDayPassPrice: selectedTemplate.halfDayPassPrice,
                                  photoPath: inst.photoPath,
                                  photoPosition: inst.photoPosition,
                                  capacity: inst.capacity,
                                  tags: selectedTemplate.tags,
                                  status: "available",
                                  statusLabel: "Available",
                                  statusGlyph: "✓",
                                  statusTone: "success",
                                  x: 0,
                                  y: 0,
                                  width: 80,
                                  height: 60,
                                  shape: "rectangle",
                                });
                                setStep("details");
                              }
                            }
                          }}
                          className={`rounded-2xl border-2 p-5 flex flex-col justify-between transition ${
                            isAvailable
                              ? "border-[var(--da-border-light)] hover:border-[var(--da-primary)] bg-white hover:shadow-md cursor-pointer"
                              : "border-slate-200 bg-slate-100/80 opacity-60 cursor-not-allowed"
                          }`}
                        >
                          <div>
                            <div className="flex items-center justify-between gap-2">
                              <h4 className={`text-base font-extrabold ${isAvailable ? "text-[var(--da-brand-dark)]" : "text-slate-500"}`}>
                                {inst.displayName}
                              </h4>
                              <span
                                className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold border ${
                                  isAvailable
                                    ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                                    : isOccupied
                                      ? "bg-slate-200 text-slate-700 border-slate-300"
                                      : "bg-amber-100 text-amber-800 border-amber-200"
                                }`}
                              >
                                {isAvailable ? "Available Now" : isOccupied ? "Occupied" : "Unavailable"}
                              </span>
                            </div>
                            <p className="text-xs text-[var(--da-text-secondary)] mt-1">
                              📍 {inst.floorName} • Capacity: {inst.capacity} seat(s)
                            </p>
                            {((inst.tags && inst.tags.length > 0) || (wsModel?.tags && wsModel.tags.length > 0) || (selectedTemplate.tags && selectedTemplate.tags.length > 0)) && (
                              <div className="mt-2 flex flex-wrap gap-1">
                                {(inst.tags || wsModel?.tags || selectedTemplate.tags || []).map((tag) => (
                                  <span
                                    key={tag}
                                    className="rounded-full bg-[rgba(0,150,137,0.08)] border border-[rgba(0,150,137,0.2)] px-2 py-0.5 text-[10px] font-bold text-[var(--da-brand-dark)]"
                                  >
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>

                          <div className="mt-4 pt-3 border-t border-[var(--da-border-light)] flex items-center justify-between">
                            <span className="text-xs font-extrabold text-[var(--da-brand-dark)]">
                              ₱{totalAmount.toFixed(2)}{" "}
                              <span className="text-[10px] font-normal text-[var(--da-text-secondary)]">
                                ({effectiveDurationHours}h)
                              </span>
                            </span>

                            <button
                              type="button"
                              disabled={!isAvailable}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (isAvailable && wsModel) {
                                  setSelectedWorkspace(wsModel);
                                  setStep("details");
                                }
                              }}
                              className={`da-primary-button text-xs font-bold py-1.5 px-3.5 ${
                                !isAvailable ? "opacity-50 cursor-not-allowed" : ""
                              }`}
                            >
                              {isAvailable ? "Select Desk →" : isOccupied ? "Occupied" : "Unavailable"}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>
          )}

          {/* STEP 3: Guest Customer Details Form */}
          {step === "details" && selectedWorkspace && (
            <section className="flex flex-col gap-6">
              <div className="rounded-[28px] border border-[var(--da-border)] bg-white p-6 sm:p-8 shadow-[var(--da-shadow-lg)]">
                <div className="border-b border-[var(--da-border-light)] pb-4 mb-6">
                  <span className="text-xs font-bold uppercase tracking-wider text-[var(--da-primary)]">
                    Final Step • Guest Contact Information
                  </span>
                  <h2 className="text-2xl font-extrabold text-[var(--da-brand-dark)]">
                    Customer Details
                  </h2>
                  <p className="text-xs text-[var(--da-text-secondary)] mt-0.5">
                    Enter your contact details to receive your booking QR access pass. DeskAtlas is guest-first — no password or registration required.
                  </p>
                </div>

                {/* Selected Desk Summary Box */}
                <div className="mb-6 rounded-2xl bg-[var(--da-canvas)] border border-[var(--da-border-light)] p-5 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                  <div>
                    <span className="text-[var(--da-text-secondary)] font-bold block">Selected Desk:</span>
                    <p className="text-base font-extrabold text-[var(--da-brand-dark)] mt-0.5">
                      {selectedWorkspace.displayName}
                    </p>
                    <p className="text-[var(--da-text-secondary)]">{selectedWorkspace.templateName} • {selectedWorkspace.floorName}</p>
                  </div>

                  <div>
                    <span className="text-[var(--da-text-secondary)] font-bold block">Immediate Schedule:</span>
                    <p className="text-base font-extrabold text-[var(--da-brand-dark)] mt-0.5">
                      {formatTime12Hour(nowTime)} – {formatTime12Hour(endTimeStr)}{isNextDay ? " (Next Day)" : ""}
                    </p>
                    <p className="text-[var(--da-text-secondary)]">
                      {selectedRateType === "DAY_PASS"
                        ? "☀️ Day Pass"
                        : selectedRateType === "NIGHT_PASS"
                        ? "🌙 Night Pass"
                        : selectedRateType === "WHOLE_DAY_PASS"
                        ? "⏳ 24-Hour Pass"
                        : selectedRateType === "HALF_DAY_PASS"
                        ? "🌓 12-Hour Pass"
                        : `${effectiveDurationHours} ${effectiveDurationHours === 1 ? "Hour" : "Hours"}`}{" "}
                      (Starting Now)
                    </p>
                  </div>

                  <div className="text-left sm:text-right">
                    <span className="text-[var(--da-text-secondary)] font-bold block">Amount Due at Counter:</span>
                    <p className="text-xl font-extrabold text-[var(--da-primary)] mt-0.5">
                      ₱{totalAmount.toFixed(2)}
                    </p>
                    <p className="text-[10px] text-[var(--da-text-secondary)]">
                      {selectedRateType === "HOURLY" ? `₱${regularRate.toFixed(2)}/hr` : "Flat Pass Rate"}
                    </p>
                  </div>
                </div>

                {submitError && (
                  <div className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-xs font-bold text-red-700">
                    ⚠️ {submitError}
                  </div>
                )}

                <form onSubmit={handleSubmitReservation} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="kiosk-first-name" className="block text-xs font-bold text-[var(--da-brand-dark)] mb-1">
                        First Name <span className="text-red-500">*</span>
                      </label>
                      <input
                        id="kiosk-first-name"
                        type="text"
                        value={customerFirstName}
                        onChange={(e) => {
                          setCustomerFirstName(e.target.value);
                          if (formErrors.firstName) setFormErrors((p) => ({ ...p, firstName: undefined }));
                        }}
                        placeholder="e.g. Maria"
                        disabled={isSubmitting}
                        className={`da-input text-sm font-medium ${formErrors.firstName ? "border-red-500 ring-red-200" : ""
                          }`}
                      />
                      {formErrors.firstName && (
                        <p className="mt-1 text-[11px] font-bold text-red-600">{formErrors.firstName}</p>
                      )}
                    </div>

                    <div>
                      <label htmlFor="kiosk-last-name" className="block text-xs font-bold text-[var(--da-brand-dark)] mb-1">
                        Last Name <span className="text-red-500">*</span>
                      </label>
                      <input
                        id="kiosk-last-name"
                        type="text"
                        value={customerLastName}
                        onChange={(e) => {
                          setCustomerLastName(e.target.value);
                          if (formErrors.lastName) setFormErrors((p) => ({ ...p, lastName: undefined }));
                        }}
                        placeholder="e.g. Santos"
                        disabled={isSubmitting}
                        className={`da-input text-sm font-medium ${formErrors.lastName ? "border-red-500 ring-red-200" : ""
                          }`}
                      />
                      {formErrors.lastName && (
                        <p className="mt-1 text-[11px] font-bold text-red-600">{formErrors.lastName}</p>
                      )}
                    </div>
                  </div>

                  <div>
                    <label htmlFor="kiosk-email" className="block text-xs font-bold text-[var(--da-brand-dark)] mb-1">
                      Email Address <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="kiosk-email"
                      type="email"
                      value={customerEmail}
                      onChange={(e) => {
                        setCustomerEmail(e.target.value);
                        if (formErrors.email) setFormErrors((p) => ({ ...p, email: undefined }));
                      }}
                      placeholder="e.g. maria.santos@example.com"
                      disabled={isSubmitting}
                      className={`da-input text-sm font-medium ${formErrors.email ? "border-red-500 ring-red-200" : ""
                        }`}
                    />
                    {formErrors.email ? (
                      <p className="mt-1 text-[11px] font-bold text-red-600">{formErrors.email}</p>
                    ) : (
                      <p className="mt-1 text-[11px] text-[var(--da-text-secondary)]">
                        Your booking QR pass will be sent directly to this email upon payment confirmation.
                      </p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="kiosk-contact-number" className="block text-xs font-bold text-[var(--da-brand-dark)] mb-1">
                      Contact Number <span className="text-gray-400 font-normal">(Optional)</span>
                    </label>
                    <input
                      id="kiosk-contact-number"
                      type="tel"
                      value={customerContactNumber}
                      onChange={(e) => setCustomerContactNumber(e.target.value)}
                      placeholder="e.g. 09171234567"
                      disabled={isSubmitting}
                      className="da-input text-sm font-medium"
                    />
                  </div>

                  {/* Payment Method Selection */}
                  <div>
                    <label className="block text-xs font-bold text-[var(--da-brand-dark)] mb-1.5">
                      Counter Payment Method <span className="text-red-500">*</span>
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => setPaymentMethod("CASH")}
                        className={`flex items-center gap-3 rounded-2xl border p-3.5 text-left transition-all ${paymentMethod === "CASH"
                            ? "border-[var(--da-primary)] bg-[var(--da-canvas)] ring-2 ring-[var(--da-primary)]"
                            : "border-[var(--da-border-light)] bg-white hover:border-[var(--da-border)]"
                          }`}
                      >
                        <span className="text-2xl">💵</span>
                        <div>
                          <div className="font-extrabold text-xs text-[var(--da-brand-dark)]">Pay Cash at Counter</div>
                          <div className="text-[11px] text-[var(--da-text-secondary)]">Pay exact cash to staff upon check-in</div>
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => setPaymentMethod("COUNTER_QR")}
                        className={`flex items-center gap-3 rounded-2xl border p-3.5 text-left transition-all ${paymentMethod === "COUNTER_QR"
                            ? "border-[var(--da-primary)] bg-[var(--da-canvas)] ring-2 ring-[var(--da-primary)]"
                            : "border-[var(--da-border-light)] bg-white hover:border-[var(--da-border)]"
                          }`}
                      >
                        <span className="text-2xl">📱</span>
                        <div>
                          <div className="font-extrabold text-xs text-[var(--da-brand-dark)]">Counter QR (GCash)</div>
                          <div className="text-[11px] text-[var(--da-text-secondary)]">Scan counter QR code via mobile wallet</div>
                        </div>
                      </button>
                    </div>
                  </div>

                  <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-[11px] text-slate-600 leading-relaxed">
                    <span className="font-bold text-slate-800">⚡ Walk-In Policy:</span> Submitting creates a pending reservation. Present your code to staff at the counter to confirm payment (cash or QR) and activate your booking pass.
                  </div>

                  <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-[var(--da-border-light)] pt-5">
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => setStep("duration")}
                      className="da-secondary-button text-xs font-bold"
                    >
                      ← Back to Duration
                    </button>

                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="da-primary-button text-sm font-extrabold px-8 py-3.5 flex items-center justify-center gap-2"
                    >
                      {isSubmitting ? (
                        <>
                          <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                          <span>Generating Check-In Code...</span>
                        </>
                      ) : (
                        <span>Submit & Get Check-In Code (₱{totalAmount.toFixed(2)}) →</span>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            </section>
          )}

          {/* STEP 4: Reference Check-In Code */}
          {step === "code" && (
            <section className="flex flex-col gap-6">
              <div className="mx-auto w-full max-w-3xl rounded-[28px] border border-[var(--da-border)] bg-white p-6 sm:p-10 shadow-[var(--da-shadow-lg)] text-center flex flex-col items-center">
                <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-3xl bg-[var(--da-canvas)] border-2 border-[var(--da-primary)] text-3xl sm:text-4xl shadow-sm">
                  ✓
                </div>

                <span className="rounded-full bg-emerald-100 text-emerald-800 text-xs font-extrabold px-3.5 py-1 uppercase tracking-wider mb-2">
                  Walk-In Created • Pending Counter Confirmation
                </span>

                <h2 className="text-2xl sm:text-3xl font-extrabold text-[var(--da-brand-dark)]">
                  Present Code at Counter to Confirm Payment
                </h2>

                <p className="mt-2 text-sm text-[var(--da-text-secondary)] max-w-lg leading-relaxed">
                  Please proceed to the staff counter desk and show this reference code to complete payment and claim your spot.
                </p>

                {/* Reference Code Box */}
                <div className="mt-6 w-full rounded-2xl border-2 border-[var(--da-primary)] bg-[var(--da-canvas)] p-6 text-center shadow-sm">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--da-primary)] block mb-1">
                    Your Check-In Reference Code
                  </span>
                  <p className="text-3xl sm:text-4xl font-mono font-extrabold text-[var(--da-brand-dark)] select-all">
                    #{referenceCode || "DA-REF"}
                  </p>
                  <p className="mt-2 text-xs text-[var(--da-text-secondary)]">
                    Pass Recipient: <strong>{customerEmail.trim().toLowerCase()}</strong>
                  </p>
                </div>

                <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4 text-left w-full">
                  <div className="rounded-2xl bg-emerald-50/70 border border-emerald-200 p-4 text-xs text-emerald-950 flex flex-col gap-1.5">
                    <div className="font-bold flex items-center gap-1.5">
                      <span>{paymentMethod === "CASH" ? "💵" : "📱"}</span>{" "}
                      {paymentMethod === "CASH" ? "Cash Payment at Counter" : "Counter GCash / Maya QR"}
                    </div>
                    <p className="leading-relaxed">
                      {paymentMethod === "CASH"
                        ? `Present your reference code and pay ₱${totalAmount.toFixed(2)} in cash to staff at the counter desk.`
                        : "Staff will confirm your payment at the counter desk and instantly allocate your reserved spot."}
                    </p>
                  </div>

                  <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4 text-xs text-slate-700 flex flex-col gap-1.5">
                    <div className="font-bold text-slate-900 flex items-center gap-1.5">
                      <span>✉️</span> Emailed Booking QR Pass
                    </div>
                    <p className="leading-relaxed">
                      Once confirmed by staff, your booking QR pass for scanning at the door will be dispatched directly to your inbox.
                    </p>
                  </div>
                </div>

                <div className="mt-8 flex justify-center w-full pt-4 border-t border-[var(--da-border-light)]">
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="da-primary-button w-full sm:w-auto text-sm font-extrabold px-8 py-3.5 shadow-md flex items-center justify-center gap-2"
                  >
                    <span>Done (Return to Welcome)</span>
                    <span>→</span>
                  </button>
                </div>
              </div>
            </section>
          )}
        </div>

        {/* Spot Detail Modal */}
        <SpotDetailModal
          workspace={modalWorkspace}
          isOccupied={Boolean(modalWorkspace && (isVenueClosed || occupiedInstanceIds.has(modalWorkspace.workspaceInstanceId)))}
          open={isModalOpen}
          onOpenChange={setIsModalOpen}
          onProceed={(ws) => {
            if (isVenueClosed || occupiedInstanceIds.has(ws.workspaceInstanceId)) return;
            setSelectedWorkspace(ws);
            setIsModalOpen(false);
            setStep("duration");
          }}
        />
      </main>
    </SessionManager>
  );
}
