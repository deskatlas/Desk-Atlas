"use client";

import { useMemo, useState, useRef, useEffect } from "react";
import {
  usePublishedMap,
  mapPublishedFloorToWorkspaceCards,
  getWorkspacePhotoObjectPosition,
} from "@/features/workspace-discovery";
import type { WorkspaceMapViewModel } from "@/features/workspace-discovery";
import {
  computeFitViewZoom,
  clampMapZoom,
  getSavedMapZoom,
  saveMapZoom,
  DEFAULT_MAP_CANVAS_WIDTH,
  DEFAULT_MAP_CANVAS_HEIGHT,
  DEFAULT_MAP_GRID_SIZE,
  type PublishedMapElement,
  type AvailableInstanceSummary,
  type AvailableTimeSlot,
  type AvailableDate,
  zonedDateTimeToUtc,
  formatSessionCountdown,
  calculateRemainingSessionSeconds,
  isSessionWarning,
  isSessionExpired,
  getOrCreateSessionExpiry,
  clearSessionExpiry,
  getCustomerSessionTimeoutSeconds,
  CUSTOMER_RESERVATION_SESSION_TIMEOUT_SECONDS,
  CUSTOMER_RESERVATION_SESSION_WARNING_SECONDS,
  validatePersonName,
  DEFAULT_WORKSPACE_STATUS_COLORS,
  normalizeWorkspaceStatusColors,
  type WorkspaceStatusColors,
} from "@deskatlas/domain";
import { useRouter } from "next/navigation";
import { SpotDetailModal } from "./SpotDetailModal";
import { ScheduleCalendarStep } from "./ScheduleCalendarStep";
import { EmailConfirmationModal } from "./EmailConfirmationModal";
import {
  fetchDateAvailability,
  fetchTimeAvailability,
  fetchTemplateAvailability,
} from "@/app/lib/availabilityApi";
import { handleNumericKeyDown } from "@deskatlas/ui";

export interface SelectedCandidate {
  rank: 0 | 1 | 2;
  workspace: WorkspaceMapViewModel;
  date: string;
  durationHours: number;
  startTime: string;
  endTime: string;
}

export interface WorkspaceTemplateSummary {
  id: string;
  name: string;
  description: string | null;
  photoPath: string | null;
  photoPosition?: { x: number; y: number };
  capacity: number;
  rateAmount: number;
  pricingLabel: string;
  tags?: string[];
  instanceCount: number;
  floors: string[];
  representativeWorkspace: WorkspaceMapViewModel;
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
  if (hour === 24) hour = 0;
  const period = hour >= 12 ? "PM" : "AM";
  if (hour === 0) hour = 12;
  else if (hour > 12) hour -= 12;
  return `${hour}:${minute} ${period}`;
}

function formatTimeRangeDisplay(startTime: string, endTime: string, durationHours?: number): string {
  if (!startTime || !endTime) return "";
  const [sh, sm] = startTime.split(":").map(Number);
  const dur = durationHours ?? 0;
  const isNextDay = dur > 0 ? sh * 60 + sm + dur * 60 >= 1440 : false;
  const endDisplay = formatTime12Hour(endTime);
  return `${formatTime12Hour(startTime)} – ${endDisplay}${isNextDay ? " (Next Day)" : ""}`;
}

function formatDateDisplay(dateStr: string): string {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-").map(Number);
  const dateObj = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return dateObj.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function getTodayManila(): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = parts.find((p) => p.type === "year")?.value ?? "2026";
  const month = parts.find((p) => p.type === "month")?.value ?? "08";
  const day = parts.find((p) => p.type === "day")?.value ?? "31";
  return `${year}-${month}-${day}`;
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

  if (norm.includes("door")) {
    return (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke={iconColor}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-label="Doorway"
      >
        <path d="M18 20V6a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v14" />
        <path d="M2 20h20" />
        <circle cx="14" cy="12" r="1" fill={iconColor} />
      </svg>
    );
  }

  if (norm.includes("window")) {
    return (
      <svg
        width="18"
        height="18"
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
        width="18"
        height="18"
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

export function ReservationPage() {
  const router = useRouter();

  // Dual Discovery Mode: "map" (Default interactive floor map) vs "category" (Template-first flow)
  const [discoveryMode, setDiscoveryMode] = useState<"map" | "category">("map");

  // Step state: "map" | "schedule" | "category-schedule" | "category-instances" | "backup-prompt" | "summary" | "email-handoff"
  const [step, setStep] = useState<
    "map" | "schedule" | "category-schedule" | "category-instances" | "backup-prompt" | "summary" | "email-handoff"
  >("map");

  const [activeRank, setActiveRank] = useState<0 | 1 | 2>(0);
  const [candidates, setCandidates] = useState<SelectedCandidate[]>([]);

  // Selected workspace for Map flow
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [modalWorkspace, setModalWorkspace] = useState<WorkspaceMapViewModel | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [templateMismatchWarning, setTemplateMismatchWarning] = useState<string | null>(null);

  // Selected template & schedule for Category flow
  const [selectedTemplate, setSelectedTemplate] = useState<WorkspaceTemplateSummary | null>(null);
  const [catDate, setCatDate] = useState<string>(getTodayManila());
  const [catDurationHours, setCatDurationHours] = useState<number>(2);
  const [catDurationInput, setCatDurationInput] = useState<string>("2");
  const [catStartTime, setCatStartTime] = useState<string | null>(null);

  // Month navigation state for Category flow
  const todayStr = useMemo(() => getTodayManila(), []);
  const [todayYear, todayMonth] = useMemo(() => todayStr.split("-").map(Number), [todayStr]);
  const [viewYear, setViewYear] = useState<number>(todayYear);
  const [viewMonth, setViewMonth] = useState<number>(todayMonth);

  const [catMonthAvailability, setCatMonthAvailability] = useState<Record<string, AvailableDate>>({});
  const [loadingCatDates, setLoadingCatDates] = useState(false);
  const [catTimeSlots, setCatTimeSlots] = useState<AvailableTimeSlot[]>([]);
  const [loadingCatTimes, setLoadingCatTimes] = useState(false);
  const [catTimeError, setCatTimeError] = useState<string | null>(null);

  // Physical instances for Category flow
  const [instanceAvailabilityList, setInstanceAvailabilityList] = useState<AvailableInstanceSummary[]>([]);
  const [loadingInstances, setLoadingInstances] = useState(false);
  const [instanceError, setInstanceError] = useState<string | null>(null);

  // Guest customer detail fields (MF-23 & MF-35)
  const [customerFirstName, setCustomerFirstName] = useState("");
  const [customerLastName, setCustomerLastName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [formErrors, setFormErrors] = useState<{
    firstName?: string;
    lastName?: string;
    email?: string;
  }>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isEmailConfirmOpen, setIsEmailConfirmOpen] = useState(false);
  const [submittedReservation, setSubmittedReservation] = useState<{
    referenceCode: string;
    customerEmail: string;
  } | null>(null);
  const [submitErrorMessage, setSubmitErrorMessage] = useState<string | null>(null);
  const [candidateImageErrors, setCandidateImageErrors] = useState<Record<string, boolean>>({});

  // MF-70 / MF-115: Configurable client-side session timeout state (default 20 mins / 1200 seconds)
  const [sessionSecondsLeft, setSessionSecondsLeft] = useState<number | null>(null);
  const [isSessionTimedOut, setIsSessionTimedOut] = useState<boolean>(false);
  const [timeoutRedirectCountdown, setTimeoutRedirectCountdown] = useState<number>(5);
  const [configuredTimeoutSeconds, setConfiguredTimeoutSeconds] = useState<number>(
    CUSTOMER_RESERVATION_SESSION_TIMEOUT_SECONDS
  );
  const [statusColors, setStatusColors] = useState<WorkspaceStatusColors>(
    DEFAULT_WORKSPACE_STATUS_COLORS
  );

  useEffect(() => {
    let isMounted = true;
    fetch("/api/settings")
      .then((res) => res.json())
      .then((data) => {
        if (isMounted) {
          if (data?.customerSessionTimeoutMinutes) {
            const secs = getCustomerSessionTimeoutSeconds(data.customerSessionTimeoutMinutes);
            setConfiguredTimeoutSeconds(secs);
          }
          if (data?.statusColors) {
            setStatusColors(normalizeWorkspaceStatusColors(data.statusColors));
          }
        }
      })
      .catch(() => {
        // Fallback to default
      });
    return () => {
      isMounted = false;
    };
  }, []);

  // MF-70 / MF-115: Reservation session timer lifecycle
  useEffect(() => {
    // If we have transitioned to email-handoff, clear session timer
    if (step === "email-handoff") {
      if (typeof window !== "undefined") {
        clearSessionExpiry(window.sessionStorage);
      }
      return;
    }

    if (typeof window === "undefined") return;

    const expiryMs = getOrCreateSessionExpiry(window.sessionStorage, Date.now(), configuredTimeoutSeconds);
    const initialRemaining = calculateRemainingSessionSeconds(expiryMs);

    if (initialRemaining <= 0) {
      setIsSessionTimedOut(true);
      clearSessionExpiry(window.sessionStorage);
      setSessionSecondsLeft(0);
      return;
    }

    setSessionSecondsLeft(initialRemaining);

    const intervalId = setInterval(() => {
      const remaining = calculateRemainingSessionSeconds(expiryMs);
      if (remaining <= 0) {
        clearInterval(intervalId);
        setSessionSecondsLeft(0);
        setIsSessionTimedOut(true);
        clearSessionExpiry(window.sessionStorage);
        // Clear draft selections and close modals
        setCandidates([]);
        setSelectedWorkspaceId(null);
        setModalWorkspace(null);
        setIsModalOpen(false);
        setIsEmailConfirmOpen(false);
        setSelectedTemplate(null);
        setCatStartTime(null);
        setCustomerFirstName("");
        setCustomerLastName("");
        setCustomerEmail("");
        setFormErrors({});
      } else {
        setSessionSecondsLeft(remaining);
      }
    }, 1000);

    return () => {
      clearInterval(intervalId);
    };
  }, [step, configuredTimeoutSeconds]);

  // MF-70: Auto-redirect countdown when session expires
  useEffect(() => {
    if (!isSessionTimedOut) return;

    const interval = setInterval(() => {
      setTimeoutRedirectCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          router.push("/");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isSessionTimedOut, router]);

  const handleReturnToHome = () => {
    if (typeof window !== "undefined") {
      clearSessionExpiry(window.sessionStorage);
    }
    router.push("/");
  };

  // Published map & all workspaces across floors
  const [allFloorWorkspaces, setAllFloorWorkspaces] = useState<WorkspaceMapViewModel[]>([]);

  const [zoom, setZoom] = useState(1);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  const {
    floorId,
    floors,
    published,
    loading: mapLoading,
    error: mapError,
    setFloorId,
    refetch,
  } = usePublishedMap();

  const canvasDimensions = useMemo(() => {
    return {
      width: Number(published?.version?.canvasWidth) || DEFAULT_MAP_CANVAS_WIDTH,
      height: Number(published?.version?.canvasHeight) || DEFAULT_MAP_CANVAS_HEIGHT,
      gridSize: Number(published?.version?.gridSize) || DEFAULT_MAP_GRID_SIZE,
    };
  }, [published]);

  const workspaces = useMemo(
    () => (published ? mapPublishedFloorToWorkspaceCards(published) : []),
    [published]
  );

  const mainCandidate = useMemo(
    () => candidates.find((c) => c.rank === 0) ?? null,
    [candidates]
  );

  const backup1Candidate = useMemo(
    () => candidates.find((c) => c.rank === 1) ?? null,
    [candidates]
  );

  const backup2Candidate = useMemo(
    () => candidates.find((c) => c.rank === 2) ?? null,
    [candidates]
  );

  const selectedWorkspace = useMemo(
    () => workspaces.find((w) => w.workspaceInstanceId === selectedWorkspaceId) ?? null,
    [workspaces, selectedWorkspaceId]
  );

  const elements = published?.elements || [];

  // Parity with customer viewports: default to 100% zoom (1.0) or restore saved zoom
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
    setSelectedWorkspaceId(null);
    setTemplateMismatchWarning(null);
    setFloorId(newFloorId);
  };

  // Fetch all workspaces across all published floors for complete template coverage
  useEffect(() => {
    if (floors.length === 0) return;

    let cancelled = false;
    Promise.all(
      floors.map(async (floor) => {
        try {
          const res = await fetch(`/api/published-map?floorId=${encodeURIComponent(floor.id)}`, {
            cache: "no-store",
          });
          if (!res.ok) return [];
          const data = await res.json();
          return data.published ? mapPublishedFloorToWorkspaceCards(data.published) : [];
        } catch {
          return [];
        }
      })
    ).then((results) => {
      if (cancelled) return;
      setAllFloorWorkspaces(results.flat());
    });

    return () => {
      cancelled = true;
    };
  }, [floors]);

  // Aggregate published workspaces into unique workspace templates
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

  // Category Flow: Month range and availability
  const startDateOfMonth = `${viewYear}-${String(viewMonth).padStart(2, "0")}-01`;
  const daysInViewMonth = new Date(Date.UTC(viewYear, viewMonth, 0)).getUTCDate();
  const endDateOfMonth = `${viewYear}-${String(viewMonth).padStart(2, "0")}-${String(
    daysInViewMonth
  ).padStart(2, "0")}`;
  const firstDayOfWeek = new Date(Date.UTC(viewYear, viewMonth - 1, 1)).getUTCDay();
  const isCurrentOrPastMonth =
    viewYear < todayYear || (viewYear === todayYear && viewMonth <= todayMonth);

  useEffect(() => {
    if (!selectedTemplate) return;
    const representative = selectedTemplate.representativeWorkspace;
    if (!representative) return;

    let cancelled = false;
    setLoadingCatDates(true);

    fetchDateAvailability({
      workspaceInstanceId: representative.workspaceInstanceId,
      startDate: startDateOfMonth,
      endDate: endDateOfMonth,
      durationMinutes: catDurationHours * 60,
    })
      .then((res) => {
        if (cancelled) return;
        const dateMap: Record<string, AvailableDate> = {};
        for (const item of res.dates) {
          dateMap[item.date] = item;
        }
        setCatMonthAvailability(dateMap);
      })
      .catch(() => {
        if (!cancelled) setCatMonthAvailability({});
      })
      .finally(() => {
        if (!cancelled) setLoadingCatDates(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedTemplate, startDateOfMonth, endDateOfMonth, catDurationHours]);

  useEffect(() => {
    if (!selectedTemplate || !catDate || catDurationHours <= 0) {
      setCatTimeSlots([]);
      setCatStartTime(null);
      return;
    }

    const representative = selectedTemplate.representativeWorkspace;
    if (!representative) return;

    let cancelled = false;
    setLoadingCatTimes(true);
    setCatTimeError(null);

    fetchTimeAvailability({
      workspaceInstanceId: representative.workspaceInstanceId,
      date: catDate,
      durationMinutes: catDurationHours * 60,
    })
      .then((res) => {
        if (cancelled) return;
        setCatTimeSlots(res.slots || []);
        setCatStartTime((curr) => {
          if (!curr) return null;
          const found = res.slots?.find((s) => s.startTime === curr && s.isAvailable);
          return found ? curr : null;
        });
      })
      .catch((err) => {
        if (!cancelled) {
          setCatTimeError(err instanceof Error ? err.message : "Unable to load times.");
          setCatTimeSlots([]);
          setCatStartTime(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingCatTimes(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedTemplate, catDate, catDurationHours]);

  useEffect(() => {
    if (!selectedTemplate || !catDate || !catStartTime || catDurationHours <= 0) {
      setInstanceAvailabilityList([]);
      return;
    }

    let cancelled = false;
    setLoadingInstances(true);
    setInstanceError(null);

    fetchTemplateAvailability({
      templateId: selectedTemplate.id,
      date: catDate,
      durationMinutes: catDurationHours * 60,
      startTime: catStartTime,
    })
      .then((res) => {
        if (cancelled) return;
        setInstanceAvailabilityList(res.allInstances || []);
      })
      .catch((err) => {
        if (!cancelled) {
          setInstanceError(err instanceof Error ? err.message : "Unable to load spots.");
          setInstanceAvailabilityList([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingInstances(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedTemplate, catDate, catDurationHours, catStartTime]);

  const catMonthLabel = useMemo(() => {
    const d = new Date(Date.UTC(viewYear, viewMonth - 1, 1));
    return d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  }, [viewYear, viewMonth]);

  const catEndTime = useMemo(() => {
    if (!catStartTime) return null;
    const [h, m] = catStartTime.split(":").map(Number);
    const endMinutes = h * 60 + m + catDurationHours * 60;
    const endH = Math.floor(endMinutes / 60) % 24;
    const endM = endMinutes % 60;
    return `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;
  }, [catStartTime, catDurationHours]);


  // Spot click in Map Flow
  const handleSpotClick = (workspace: WorkspaceMapViewModel) => {
    if (activeRank > 0 && mainCandidate) {
      if (workspace.templateId !== mainCandidate.workspace.templateId) {
        setTemplateMismatchWarning(
          `You selected "${workspace.displayName}" which belongs to "${workspace.templateName}", but your Main Choice is "${mainCandidate.workspace.templateName}". Backups must use the exact same category and rate.`
        );
        return;
      }
    }

    setTemplateMismatchWarning(null);
    setSelectedWorkspaceId(workspace.workspaceInstanceId);
    setModalWorkspace(workspace);
    setIsModalOpen(true);
  };

  // Category selection in Category Flow
  const handleSelectTemplate = (template: WorkspaceTemplateSummary) => {
    setSelectedTemplate(template);
    setCatStartTime(null);
    setStep("category-schedule");
  };

  // Select instance in Category Flow
  const handleSelectInstance = (instanceSummary: AvailableInstanceSummary) => {
    if (!selectedTemplate || !catDate || !catStartTime || !catEndTime) return;

    const isDuplicate = candidates.some(
      (c) =>
        c.workspace.workspaceInstanceId === instanceSummary.workspaceInstanceId &&
        c.startTime === catStartTime &&
        c.rank !== activeRank
    );
    if (isDuplicate) {
      alert(`⚠️ You have already selected ${instanceSummary.displayName} for ${formatTime12Hour(catStartTime)}. Backups on the same spot must use a different time.`);
      return;
    }

    const sourceWorkspaces = allFloorWorkspaces.length > 0 ? allFloorWorkspaces : workspaces;
    let card = sourceWorkspaces.find(
      (w) => w.workspaceInstanceId === instanceSummary.workspaceInstanceId
    );

    if (!card) {
      card = {
        id: instanceSummary.workspaceInstanceId,
        workspaceInstanceId: instanceSummary.workspaceInstanceId,
        templateId: instanceSummary.templateId,
        floorId: instanceSummary.floorId,
        floorName: instanceSummary.floorName,
        instanceCode: instanceSummary.instanceCode,
        displayName: instanceSummary.displayName,
        templateName: instanceSummary.templateName,
        description: selectedTemplate.description || "Workspace details",
        rateAmount: instanceSummary.rateAmount,
        pricingLabel: `PHP ${instanceSummary.rateAmount}/hour`,
        photoPath: instanceSummary.photoPath,
        photoPosition: instanceSummary.photoPosition,
        capacity: instanceSummary.capacity,
        tags: selectedTemplate.tags,
        status: "available",
        statusLabel: "Available",
        statusGlyph: "✓",
        statusTone: "success",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        shape: "desk",
      };
    }

    const newCandidate: SelectedCandidate = {
      rank: activeRank,
      workspace: card,
      date: catDate,
      durationHours: catDurationHours,
      startTime: catStartTime,
      endTime: catEndTime,
    };

    setCandidates((prev) => {
      const filtered = prev.filter((c) => c.rank !== activeRank);
      return [...filtered, newCandidate].sort((a, b) => a.rank - b.rank);
    });

    setStep("backup-prompt");
  };

  // Continue from ScheduleCalendarStep (Map Flow)
  const handleContinueSchedule = (schedule: {
    date: string;
    durationHours: number;
    startTime: string;
    endTime: string;
  }) => {
    if (!selectedWorkspace) return;

    const newCandidate: SelectedCandidate = {
      rank: activeRank,
      workspace: selectedWorkspace,
      date: schedule.date,
      durationHours: schedule.durationHours,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
    };

    setCandidates((prev) => {
      const filtered = prev.filter((c) => c.rank !== activeRank);
      return [...filtered, newCandidate].sort((a, b) => a.rank - b.rank);
    });

    setStep("backup-prompt");
  };

  // Start adding a backup (Rank 1 or 2)
  const handleStartAddBackup = (rank: 1 | 2) => {
    if (!mainCandidate) return;
    setActiveRank(rank);
    setSelectedWorkspaceId(null);
    setTemplateMismatchWarning(null);

    // Sync Category flow locks
    const mainTpl = availableTemplates.find((t) => t.id === mainCandidate.workspace.templateId);
    if (mainTpl) {
      setSelectedTemplate(mainTpl);
    }
    setCatDate(mainCandidate.date);
    setCatDurationHours(mainCandidate.durationHours);
    setCatDurationInput(String(mainCandidate.durationHours));
    setCatStartTime(mainCandidate.startTime);

    if (discoveryMode === "category") {
      setStep("category-schedule");
    } else {
      setStep("map");
    }
  };

  // Remove backup candidate
  const handleRemoveCandidate = (rankToRemove: 1 | 2) => {
    setCandidates((prev) => {
      if (rankToRemove === 2) {
        return prev.filter((c) => c.rank !== 2);
      }
      const main = prev.find((c) => c.rank === 0);
      const b2 = prev.find((c) => c.rank === 2);
      const result: SelectedCandidate[] = [];
      if (main) result.push(main);
      if (b2) {
        result.push({ ...b2, rank: 1 });
      }
      return result;
    });
  };

  // Submit reservation
  const handleSubmitReservation = (e?: React.FormEvent) => {
    if (e) e.preventDefault();

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
    setSubmitErrorMessage(null);
    setIsEmailConfirmOpen(true);
  };

  const handleConfirmSubmit = async () => {
    setIsSubmitting(true);
    setSubmitErrorMessage(null);

    try {
      const candidatesPayload = candidates.map((c) => {
        const startUtc = zonedDateTimeToUtc(c.date, c.startTime, "Asia/Manila");
        const endUtc = new Date(startUtc.getTime() + c.durationHours * 60 * 60 * 1000);
        return {
          rank: c.rank,
          workspaceInstanceId: c.workspace.workspaceInstanceId,
          startAt: startUtc.toISOString(),
          endAt: endUtc.toISOString(),
        };
      });

      const response = await fetch("/api/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "WEB",
          customerFirstName: customerFirstName.trim(),
          customerLastName: customerLastName.trim(),
          customerEmail: customerEmail.trim().toLowerCase(),
          candidates: candidatesPayload,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to create reservation. Please try again.");
      }

      setSubmittedReservation({
        referenceCode: result.referenceCode || "DA-REF",
        customerEmail: customerEmail.trim().toLowerCase(),
      });
      if (typeof window !== "undefined") {
        clearSessionExpiry(window.sessionStorage);
      }
      setIsEmailConfirmOpen(false);
      setIsSubmitting(false);
      setStep("email-handoff");
    } catch (err: any) {
      setSubmitErrorMessage(err.message || "An unexpected error occurred. Please try again.");
      setIsEmailConfirmOpen(false);
      setIsSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-[var(--da-canvas)] px-3 sm:px-6 md:px-8 py-5 sm:py-6 text-[var(--da-text-primary)] w-full">
      <div className="mx-auto flex max-w-[1800px] w-full flex-col gap-6">
        {/* Top Header & Breadcrumbs */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs font-bold uppercase tracking-[0.18em]">
              <button
                type="button"
                onClick={() => {
                  if (step !== "email-handoff") {
                    setActiveRank(0);
                    if (discoveryMode === "category") setStep("map");
                    else setStep("map");
                  }
                }}
                className={`hover:underline ${step === "map" || step === "schedule" || step === "category-schedule" || step === "category-instances"
                  ? "text-[var(--da-primary)] font-extrabold"
                  : mainCandidate
                    ? "text-emerald-700 font-extrabold"
                    : "text-[var(--da-text-secondary)]"
                  }`}
              >
                1. Main Spot {mainCandidate ? `(✓ ${mainCandidate.workspace.displayName})` : ""}
              </button>
              <span className="text-[var(--da-text-secondary)]">/</span>
              <button
                type="button"
                disabled={!mainCandidate || step === "email-handoff"}
                onClick={() => {
                  if (mainCandidate && step !== "email-handoff") setStep("backup-prompt");
                }}
                className={`hover:underline ${step === "backup-prompt"
                  ? "text-[var(--da-primary)] font-extrabold"
                  : candidates.length > 1
                    ? "text-emerald-700 font-extrabold"
                    : "text-[var(--da-text-secondary)]"
                  }`}
              >
                2. Backups (Optional) {candidates.length > 1 ? `(✓ ${candidates.length - 1} Added)` : ""}
              </button>
              <span className="text-[var(--da-text-secondary)]">/</span>
              <button
                type="button"
                disabled={!mainCandidate || step === "email-handoff"}
                onClick={() => {
                  if (mainCandidate && step !== "email-handoff") setStep("summary");
                }}
                className={`hover:underline ${step === "summary"
                  ? "text-[var(--da-primary)] font-extrabold"
                  : step === "email-handoff"
                    ? "text-emerald-700 font-extrabold"
                    : "text-[var(--da-text-secondary)]"
                  }`}
              >
                3. Review & Details
              </button>
              {step === "email-handoff" ? (
                <>
                  <span className="text-[var(--da-text-secondary)]">/</span>
                  <span className="text-[var(--da-primary)] font-extrabold">
                    4. Check Email (✓)
                  </span>
                </>
              ) : null}
            </div>

            <h1 className="mt-1 text-3xl sm:text-4xl font-extrabold tracking-[-0.03em] text-[var(--da-brand-dark)]">
              {step === "email-handoff"
                ? "Check Your Email"
                : step === "summary"
                  ? "Review Your Ranked Candidates"
                  : step === "backup-prompt"
                    ? "Add Optional Backup Spots"
                    : activeRank > 0
                      ? `Choose Backup Spot ${activeRank} (Optional)`
                      : step === "category-schedule"
                        ? "Select Date, Duration & Time"
                        : step === "category-instances"
                          ? "Select Your Preferred Spot"
                          : step === "schedule"
                            ? "Select Date & Time for Spot"
                            : discoveryMode === "category"
                              ? "Browse by Workspace Category"
                              : "Choose Your Workspace on the Map"}
            </h1>

            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--da-text-secondary)]">
              {step === "email-handoff"
                ? "Your reservation request has been created. Follow the instructions in the email sent to you to complete payment."
                : step === "summary"
                  ? "Review your selected Main and backup workspaces. Ranked candidates are allocated atomically when payment is approved."
                  : step === "backup-prompt"
                    ? "Increase your chance of getting a spot by adding up to 2 alternative workspaces of the same type and price."
                    : activeRank > 0
                      ? `Pick an alternative spot for Backup ${activeRank}. Category, date, and duration match your Main selection.`
                      : step === "category-schedule"
                        ? `Choose your date, duration in hours, and start time for ${selectedTemplate?.name || "your workspace"}.`
                        : step === "category-instances"
                          ? `Choose an available ${selectedTemplate?.name || "workspace"} for ${formatDateDisplay(catDate)}.`
                          : step === "schedule"
                            ? `Choose your booking date, duration, and time for ${selectedWorkspace?.displayName || "your spot"}.`
                            : discoveryMode === "category"
                              ? "Select a workspace category to view available time slots and physical spots."
                              : "Explore our interactive floor layout and click on any available spot to book."}
            </p>
          </div>

          {/* MF-70: Session Timeout Pill */}
          {step !== "email-handoff" && sessionSecondsLeft !== null && !isSessionTimedOut && (
            <div
              className={`inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-bold transition-all shadow-sm ${sessionSecondsLeft <= 120
                  ? "border-2 border-amber-500 bg-amber-50 text-amber-900 animate-pulse"
                  : "border border-[var(--da-border)] bg-white text-[var(--da-text-secondary)]"
                }`}
              title="Your reservation session lasts 20 minutes to ensure real-time inventory availability."
            >
              <span className="text-sm">{sessionSecondsLeft <= 120 ? "⚠️" : "⏱️"}</span>
              <span>
                Time remaining:{" "}
                <span
                  className={`font-mono font-extrabold ${sessionSecondsLeft <= 120 ? "text-amber-900 text-sm" : "text-[var(--da-brand-dark)]"
                    }`}
                >
                  {formatSessionCountdown(sessionSecondsLeft)}
                </span>
              </span>
            </div>
          )}
        </div>

        {/* MF-70: 2-Minute Expiry Warning Banner */}
        {sessionSecondsLeft !== null &&
          sessionSecondsLeft <= 120 &&
          sessionSecondsLeft > 0 &&
          step !== "email-handoff" &&
          !isSessionTimedOut && (
            <div
              role="alert"
              className="flex items-center justify-between gap-3 rounded-2xl border-2 border-amber-400 bg-amber-50/95 p-4 text-amber-950 shadow-sm animate-pulse"
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">⚠️</span>
                <div>
                  <p className="font-extrabold text-sm sm:text-base">
                    Session Expiring Soon: Less than 2 minutes remaining!
                  </p>
                  <p className="text-xs sm:text-sm text-amber-900 mt-0.5">
                    Please finalize your reservation details and submit within{" "}
                    <span className="font-mono font-extrabold">{formatSessionCountdown(sessionSecondsLeft)}</span> before your draft session resets.
                  </p>
                </div>
              </div>
            </div>
          )}

        {/* 0. Post-Submit Email Handoff Screen */}
        {step === "email-handoff" ? (
          <section className="flex flex-col gap-6">
            <div className="mx-auto w-full max-w-3xl rounded-[28px] border border-[var(--da-border)] bg-white p-6 sm:p-10 shadow-[var(--da-shadow-lg)] text-center flex flex-col items-center">
              <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-3xl bg-[var(--da-canvas)] border-2 border-[var(--da-primary)] text-3xl sm:text-4xl shadow-sm">
                ✉️
              </div>

              <span className="rounded-full bg-emerald-100 text-emerald-800 text-xs font-extrabold px-3.5 py-1 uppercase tracking-wider mb-2">
                Reservation Submitted • Action Required
              </span>

              <h2 className="text-2xl sm:text-3xl font-extrabold text-[var(--da-brand-dark)]">
                Check Your Email to Complete Payment
              </h2>

              <p className="mt-2 text-sm text-[var(--da-text-secondary)] max-w-lg leading-relaxed">
                We have dispatched a private, secure 1-hour payment session link directly to your inbox.
              </p>

              <div className="mt-6 w-full rounded-2xl border-2 border-[var(--da-primary)] bg-[var(--da-canvas)] p-5 text-center shadow-sm">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--da-primary)] block mb-1">
                  Payment Link Sent To
                </span>
                <p className="text-lg sm:text-xl font-extrabold text-[var(--da-brand-dark)] break-all select-all">
                  {submittedReservation?.customerEmail || customerEmail.trim().toLowerCase()}
                </p>
                <p className="mt-1 text-xs text-[var(--da-text-secondary)]">
                  Please open this email to view your payment QR and upload your payment proof.
                </p>
              </div>

              {submittedReservation?.referenceCode ? (
                <div className="mt-4 flex items-center gap-2 rounded-xl bg-slate-100 border border-slate-200 px-4 py-2 text-xs text-slate-700">
                  <span className="text-slate-500 font-medium">Reservation Reference:</span>
                  <span className="font-mono font-extrabold text-sm text-[var(--da-brand-dark)]">
                    #{submittedReservation.referenceCode}
                  </span>
                </div>
              ) : null}

              <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4 text-left w-full">
                <div className="rounded-2xl bg-amber-50/70 border border-amber-200 p-4 text-xs text-amber-900 flex flex-col gap-1.5">
                  <div className="font-bold text-amber-950 flex items-center gap-1.5">
                    <span>📁</span> Check Spam / Junk Folder
                  </div>
                  <p className="leading-relaxed">
                    If you don&apos;t see the message in your main inbox within 1–2 minutes, please check your <strong>Spam, Junk, or Promotions folder</strong>.
                  </p>
                </div>

                <div className="rounded-2xl bg-emerald-50/70 border border-emerald-200 p-4 text-xs text-emerald-950 flex flex-col gap-1.5">
                  <div className="font-bold flex items-center gap-1.5">
                    <span>⏱️</span> 1-Hour Payment Window
                  </div>
                  <p className="leading-relaxed">
                    Your online payment session expires in <strong>1 hour</strong>. Once your proof of payment is submitted and approved by admin, your spot will be locked.
                  </p>
                </div>
              </div>

              <div className="mt-4 rounded-xl bg-slate-50 border border-slate-200 p-3.5 text-xs text-slate-600 text-left w-full leading-relaxed">
                <span className="font-bold text-slate-800">🔒 DeskAtlas No-Hold Policy:</span> Submitting a guest reservation does not hold physical inventory until payment proof is approved. Payment approval atomically locks your Main choice or your next available backup.
              </div>

              <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4 w-full pt-4 border-t border-[var(--da-border-light)]">
                <button
                  type="button"
                  onClick={() => router.push("/")}
                  className="da-primary-button w-full sm:w-auto text-sm font-extrabold px-8 py-3.5 shadow-md flex items-center justify-center gap-2"
                >
                  <span>Return to Home</span>
                  <span>→</span>
                </button>

                {submittedReservation?.referenceCode ? (
                  <button
                    type="button"
                    onClick={() => {
                      const emailParam = (submittedReservation.customerEmail || customerEmail.trim().toLowerCase());
                      router.push(
                        `/track?code=${encodeURIComponent(submittedReservation.referenceCode)}${emailParam ? `&email=${encodeURIComponent(emailParam)}` : ""
                        }`
                      );
                    }}
                    className="da-secondary-button w-full sm:w-auto text-sm font-bold px-6 py-3.5"
                  >
                    Track Reservation Status
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => router.push("/track")}
                    className="da-secondary-button w-full sm:w-auto text-sm font-bold px-6 py-3.5"
                  >
                    Track Reservation
                  </button>
                )}
              </div>
            </div>
          </section>
        ) : step === "map" ? (
          /* 1. Step 1: Dual Choice Discovery (Interactive Map or Category View) */
          <section className="flex flex-col gap-6">
            {/* Flow Mode Switcher Bar */}
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-[24px] border border-[var(--da-border)] bg-white p-4 sm:p-5 shadow-[var(--da-shadow-md)]">
              <div>
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-[var(--da-primary)] block">
                  Discovery Mode
                </span>
                <p className="text-xs text-[var(--da-text-secondary)] font-medium mt-0.5">
                  Choose how you would like to explore and select your workspace:
                </p>
              </div>

              {/* Segmented Switcher */}
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

            {/* FLOW A: Original Interactive Map View (Identical to before MF-41) */}
            {discoveryMode === "map" ? (
              <>
                {/* Template Mismatch or Guidance Alert */}
                {templateMismatchWarning ? (
                  <div className="rounded-[22px] border border-amber-300 bg-amber-50 p-4 text-xs text-amber-900 flex flex-wrap items-center justify-between gap-3 shadow-sm">
                    <div className="flex items-center gap-2">
                      <span className="text-base">⚠️</span>
                      <div>
                        <span className="font-bold">Template Constraint: </span>
                        {templateMismatchWarning}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setTemplateMismatchWarning(null)}
                      className="da-inline-button font-bold text-amber-900"
                    >
                      Dismiss
                    </button>
                  </div>
                ) : activeRank > 0 && mainCandidate ? (
                  <div className="rounded-[22px] border border-[var(--da-primary)] bg-[var(--da-canvas)] p-4 text-xs text-[var(--da-brand-dark)] flex flex-wrap items-center justify-between gap-3 shadow-sm">
                    <div>
                      <span className="font-extrabold uppercase tracking-wider text-[var(--da-primary)]">
                        Selecting Backup Spot {activeRank} (Optional):
                      </span>{" "}
                      Please choose another <span className="font-bold">{mainCandidate.workspace.templateName}</span> spot on the map. Date ({formatDateDisplay(mainCandidate.date)}) and duration ({mainCandidate.durationHours} hrs) will be matched to Main.
                    </div>
                    <button
                      type="button"
                      onClick={() => setStep("backup-prompt")}
                      className="da-secondary-button text-xs font-bold py-1.5 px-3"
                    >
                      Cancel Backup Selection
                    </button>
                  </div>
                ) : null}

                {/* Map Error Alert */}
                {mapError ? (
                  <div className="rounded-[22px] border border-red-200 bg-red-50 p-4 text-sm text-red-700 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="font-semibold text-red-900">Published map unavailable</div>
                      <p className="mt-1">{mapError}</p>
                    </div>
                    <button type="button" className="da-inline-button" onClick={refetch}>
                      Retry map
                    </button>
                  </div>
                ) : null}

                {/* Workspace Map Card */}
                <section className="w-full rounded-[28px] border border-[var(--da-border)] bg-white p-4 sm:p-6 shadow-[var(--da-shadow-lg)]">
                  {/* Controls Bar */}
                  <div className="mb-5 flex flex-wrap items-center justify-between gap-4 border-b border-[var(--da-border-light)] pb-4">
                    {/* Floor Selector */}
                    <div className="flex flex-wrap items-center gap-3">
                      <label htmlFor="floor-select" className="text-sm font-bold text-[var(--da-text-primary)]">
                        Floor:
                      </label>
                      {floors.length > 0 ? (
                        <select
                          id="floor-select"
                          value={floorId}
                          onChange={(e) => handleFloorChange(e.target.value)}
                          className="da-input max-w-xs text-sm font-semibold py-2"
                        >
                          {floors.map((floor) => (
                            <option key={floor.id} value={floor.id}>
                              {floor.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-sm text-[var(--da-text-secondary)]">
                          {mapLoading ? "Loading floors..." : "No published floors"}
                        </span>
                      )}
                    </div>

                    {/* Map Controls & Status Legend */}
                    <div className="flex flex-wrap items-center gap-3">
                      {/* Status Legend */}
                      <div className="hidden sm:flex items-center gap-3 text-xs font-semibold text-[var(--da-text-secondary)] border-r border-[var(--da-border-light)] pr-3">
                        <span className="inline-flex items-center gap-1">
                          <span className="h-3 w-3 rounded border" style={{ backgroundColor: statusColors.available, borderColor: statusColors.available }} /> Available
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <span className="h-3 w-3 rounded border" style={{ backgroundColor: statusColors.maintenance, borderColor: statusColors.maintenance }} /> Maintenance
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <span className="h-3 w-3 rounded border" style={{ backgroundColor: statusColors.unavailable, borderColor: statusColors.unavailable }} /> Unavailable
                        </span>
                      </div>

                      {/* Zoom Controls */}
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={handleZoomOut}
                          className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--da-border)] bg-white text-base font-bold text-[var(--da-text-primary)] hover:bg-slate-50 transition"
                          aria-label="Zoom out"
                        >
                          −
                        </button>
                        <span className="w-12 text-center text-xs font-bold text-[var(--da-text-secondary)]">
                          {Math.round(zoom * 100)}%
                        </span>
                        <button
                          type="button"
                          onClick={handleZoomIn}
                          className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--da-border)] bg-white text-base font-bold text-[var(--da-text-primary)] hover:bg-slate-50 transition"
                          aria-label="Zoom in"
                        >
                          +
                        </button>
                        <button
                          type="button"
                          onClick={handleFitView}
                          className="rounded-xl border border-[var(--da-border)] bg-white px-3 py-2 text-xs font-bold text-[var(--da-brand-dark)] hover:bg-slate-50 transition"
                        >
                          Fit View
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Map Viewport Area */}
                  <div
                    ref={mapContainerRef}
                    className="relative w-full rounded-none border border-[var(--da-border-light)] bg-white overflow-auto min-h-[500px] sm:min-h-[580px] max-h-[75vh]"
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
                        <div className="rounded-2xl border border-[var(--da-border)] bg-white p-8 max-w-md shadow-[var(--da-shadow-md)]">
                          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[var(--da-info)] text-2xl">
                            🗺️
                          </div>
                          <h2 className="mt-4 text-lg font-extrabold text-[var(--da-brand-dark)]">
                            No workspaces published on this floor
                          </h2>
                          <p className="mt-2 text-xs leading-5 text-[var(--da-text-secondary)]">
                            Please select another floor or check back once the layout is published.
                          </p>
                        </div>
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
                            borderRadius: "0px",
                            boxShadow: "0 4px 20px rgba(0,0,0,0.06)",
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
                                    <span style={{ fontSize: "10px", fontWeight: 800, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#ffffff", textShadow: "0 1px 2px rgba(0,0,0,0.5)" }}>
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
                                el.workspace?.workspaceInstanceId === selectedWorkspaceId;
                              const status = el.workspace?.operationalStatus || "ACTIVE";
                              const isBookable = el.workspace?.isBookable ?? true;
                              const isAvailable = isBookable && status === "ACTIVE";
                              const isMatchingTemplate =
                                !mainCandidate ||
                                el.workspace?.templateId === mainCandidate.workspace.templateId;

                              let borderColor = isSelected ? "var(--da-accent)" : "#DCE6DF";
                              let borderWidth = isSelected ? "3px" : "1.5px";
                              let borderStyle = "solid";

                              if (status === "MAINTENANCE") {
                                borderStyle = "dashed";
                                borderColor = statusColors.maintenance;
                                bg = statusColors.maintenance;
                                textColor = getContrastColor(bg);
                              } else if (!isAvailable) {
                                borderStyle = "dashed";
                                borderColor = statusColors.unavailable;
                                bg = statusColors.unavailable;
                                textColor = getContrastColor(bg);
                              } else if (activeRank > 0 && !isMatchingTemplate) {
                                borderStyle = "dashed";
                                borderColor = "#cbd5e1";
                                bg = "#f8fafc";
                                textColor = "#94a3b8";
                              }

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
                                    onClick={() => {
                                      if (wsModel) handleSpotClick(wsModel);
                                    }}
                                    className="group h-full w-full flex flex-col items-center justify-center p-1 text-center transition-all duration-150 relative hover:scale-[1.03] active:scale-[0.98]"
                                    style={{
                                      backgroundColor: bg,
                                      borderWidth,
                                      borderStyle,
                                      borderColor,
                                      borderRadius: el.elementType === "meeting-room" ? "16px" : "10px",
                                      color: textColor,
                                      cursor: isAvailable ? "pointer" : "not-allowed",
                                      opacity: isAvailable ? (activeRank > 0 && !isMatchingTemplate ? 0.6 : 1) : 0.75,
                                      boxShadow: isSelected
                                        ? "0 0 0 4px rgba(200, 244, 81, 0.4), 0 4px 12px rgba(12, 59, 39, 0.15)"
                                        : "0 1px 3px rgba(0, 0, 0, 0.05)",
                                    }}
                                  >
                                    <span className="max-w-full truncate text-[11px] font-bold leading-tight">
                                      {displayName}
                                    </span>
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
                                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "3px", maxWidth: "100%", maxHeight: "100%", textAlign: "center" }}>
                                    <AmenityIcon type={el.elementType} name={displayName} color={textColor} />
                                    <span style={{ fontSize: "10px", fontWeight: 700, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", opacity: 0.9, textAlign: "center" }}>
                                      {displayName}
                                    </span>
                                  </div>
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
                                      <pattern id={`stairs-pattern-cust-${el.id}`} width="100%" height="16" patternUnits="userSpaceOnUse">
                                        <line x1="0" y1="16" x2="100%" y2="16" stroke="#94A3B8" strokeWidth="1.5" />
                                      </pattern>
                                    </defs>
                                    <rect width="100%" height="100%" fill={`url(#stairs-pattern-cust-${el.id})`} />
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

                  {/* Selected Workspace Indicator / Legend Footer */}
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--da-text-secondary)]">
                    <p className="font-medium">
                      {activeRank > 0 && mainCandidate
                        ? `Showing ${mainCandidate.workspace.templateName} spots for Backup ${activeRank}. Click an available spot to proceed.`
                        : "Click an available workspace to select it. (Guest reservations do not hold inventory until approved and allocated)."}
                    </p>
                    {selectedWorkspace ? (
                      <div className="flex flex-wrap items-center gap-2 rounded-full bg-[var(--da-canvas)] border border-[var(--da-border-light)] px-3.5 py-1.5">
                        <span className="h-2 w-2 rounded-full bg-[var(--da-primary)]" />
                        <span className="font-bold text-[var(--da-brand-dark)]">
                          Selected: {selectedWorkspace.displayName}
                        </span>
                        <span className="text-[var(--da-text-secondary)]">• {selectedWorkspace.pricingLabel}</span>
                        <button
                          type="button"
                          onClick={() => {
                            setModalWorkspace(selectedWorkspace);
                            setIsModalOpen(true);
                          }}
                          className="ml-1 font-bold text-[var(--da-primary)] hover:underline"
                        >
                          View Details
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setStep("schedule");
                          }}
                          className="ml-2 rounded-full bg-[var(--da-primary)] text-white px-3 py-1 text-xs font-bold hover:opacity-90 transition"
                        >
                          Proceed to Schedule →
                        </button>
                      </div>
                    ) : null}
                  </div>
                </section>
              </>
            ) : (
              /* FLOW B: Browse by Category Cards View */
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
                  <span className="rounded-full bg-[var(--da-info)] px-3.5 py-1 text-xs font-extrabold text-[var(--da-primary)]">
                    {availableTemplates.length} Categories Available
                  </span>
                </div>

                {availableTemplates.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <div className="h-8 w-8 animate-spin rounded-full border-3 border-[var(--da-primary)] border-t-transparent mb-3" />
                    <p className="text-sm font-semibold text-[var(--da-text-secondary)]">
                      Loading workspace categories...
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {availableTemplates.map((tpl) => (
                      <div
                        key={tpl.id}
                        onClick={() => handleSelectTemplate(tpl)}
                        className="group relative flex flex-col justify-between rounded-[24px] border-2 border-[var(--da-border-light)] bg-white hover:border-[var(--da-primary)] hover:shadow-lg transition-all duration-200 cursor-pointer overflow-hidden p-5"
                      >
                        {/* Photo / Visual Area */}
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
                          <div className="absolute top-3 right-3">
                            <span className="rounded-full bg-white/95 backdrop-blur px-3 py-1 text-xs font-extrabold text-[var(--da-brand-dark)] shadow-sm border border-slate-200">
                              ₱{tpl.rateAmount.toFixed(2)}/hr
                            </span>
                          </div>
                        </div>

                        {/* Info Area */}
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
                            {tpl.description || "Fully equipped workspace with high-speed WiFi, power outlets, and ergonomic seating."}
                          </p>

                          <div className="mt-4 pt-3 border-t border-[var(--da-border-light)] flex items-center justify-between text-xs text-[var(--da-text-secondary)]">
                            <span className="font-semibold text-slate-600">
                              📍 {tpl.floors.join(", ")}
                            </span>
                            <span className="font-bold text-[var(--da-brand-dark)]">
                              {tpl.instanceCount} {tpl.instanceCount === 1 ? "spot" : "spots"}
                            </span>
                          </div>
                        </div>

                        {/* CTA Button */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSelectTemplate(tpl);
                          }}
                          className="mt-4 da-primary-button w-full justify-center py-2.5 text-xs font-extrabold"
                        >
                          Select {tpl.name} →
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        ) : step === "schedule" && selectedWorkspace ? (
          /* 2a. Map Flow Schedule Step (Using ScheduleCalendarStep) */
          <ScheduleCalendarStep
            workspace={selectedWorkspace}
            candidateRank={activeRank}
            onBackToMap={() => {
              setStep("map");
            }}
            onContinue={handleContinueSchedule}
            lockedSchedule={
              activeRank > 0 && mainCandidate
                ? {
                  date: mainCandidate.date,
                  durationHours: mainCandidate.durationHours,
                  initialStartTime: mainCandidate.startTime,
                  excludedStartTimes: candidates
                    .filter(
                      (c) =>
                        c.workspace.workspaceInstanceId === selectedWorkspace.workspaceInstanceId &&
                        c.rank !== activeRank
                    )
                    .map((c) => c.startTime),
                }
                : undefined
            }
          />
        ) : step === "category-schedule" && selectedTemplate ? (
          /* 2b. Category Flow Schedule Step */
          <section className="flex flex-col gap-6">
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-[24px] border border-[var(--da-border)] bg-white p-4 sm:p-6 shadow-[var(--da-shadow-md)]">
              <div className="flex items-center gap-4">
                {selectedTemplate.photoPath ? (
                  <img
                    src={selectedTemplate.photoPath}
                    alt={selectedTemplate.name}
                    className="h-16 w-16 rounded-2xl object-cover border border-[var(--da-border-light)]"
                    style={{
                      objectPosition: getWorkspacePhotoObjectPosition(selectedTemplate.photoPosition),
                    }}
                  />
                ) : (
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--da-canvas)] border border-[var(--da-border-light)] text-2xl">
                    🏢
                  </div>
                )}
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-[var(--da-primary)]">
                    {activeRank === 0 ? "Selected Category" : `Backup ${activeRank} Category (Locked)`}
                  </span>
                  <h2 className="text-xl sm:text-2xl font-extrabold text-[var(--da-brand-dark)]">
                    {selectedTemplate.name}
                  </h2>
                  <p className="text-xs font-medium text-[var(--da-text-secondary)] mt-0.5">
                    Capacity: {selectedTemplate.capacity} seat(s) •{" "}
                    <span className="font-bold text-[var(--da-brand-dark)]">
                      ₱{selectedTemplate.rateAmount.toFixed(2)}/hr
                    </span>
                  </p>
                </div>
              </div>

              {activeRank === 0 ? (
                <button
                  type="button"
                  onClick={() => setStep("map")}
                  className="da-secondary-button px-4 py-2 text-xs font-bold shrink-0"
                >
                  ← Change Category
                </button>
              ) : (
                <span className="text-xs font-bold text-[var(--da-primary)] bg-[var(--da-info)] px-3 py-1 rounded-full">
                  Locked to Main Category
                </span>
              )}
            </div>

            {/* Category Scheduling Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Left Column: Calendar & Duration Selector */}
              <div className="lg:col-span-7 flex flex-col gap-6">
                <div className="rounded-[24px] border border-[var(--da-border)] bg-white p-5 sm:p-6 shadow-[var(--da-shadow-md)]">
                  <div className="flex items-center justify-between border-b border-[var(--da-border-light)] pb-4 mb-4">
                    <div>
                      <h3 className="text-base font-extrabold text-[var(--da-brand-dark)]">
                        1. {activeRank > 0 ? "Booking Date (Locked to Main)" : "Select Date"}
                      </h3>
                      {activeRank > 0 && mainCandidate ? (
                        <p className="text-xs text-[var(--da-text-secondary)]">
                          Backups must use the exact same date ({formatDateDisplay(mainCandidate.date)}) as Main.
                        </p>
                      ) : null}
                    </div>

                    {activeRank === 0 ? (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            if (isCurrentOrPastMonth) return;
                            if (viewMonth === 1) {
                              setViewYear((y) => y - 1);
                              setViewMonth(12);
                            } else setViewMonth((m) => m - 1);
                          }}
                          disabled={isCurrentOrPastMonth}
                          className={`flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--da-border)] bg-white text-sm font-bold transition ${isCurrentOrPastMonth
                            ? "opacity-30 cursor-not-allowed bg-slate-50"
                            : "hover:bg-slate-50 text-[var(--da-brand-dark)]"
                            }`}
                        >
                          ←
                        </button>
                        <span className="min-w-[130px] text-center text-xs font-bold text-[var(--da-brand-dark)]">
                          {catMonthLabel}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            if (viewMonth === 12) {
                              setViewYear((y) => y + 1);
                              setViewMonth(1);
                            } else setViewMonth((m) => m + 1);
                          }}
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--da-border)] bg-white text-sm font-bold hover:bg-slate-50 text-[var(--da-brand-dark)] transition"
                        >
                          →
                        </button>
                      </div>
                    ) : null}
                  </div>

                  <div className="grid grid-cols-7 gap-1 text-center mb-2 text-[11px] font-bold uppercase tracking-wider text-[var(--da-text-secondary)]">
                    <span>Sun</span><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span>
                  </div>

                  <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
                    {Array.from({ length: firstDayOfWeek }).map((_, idx) => (
                      <div key={`empty-${idx}`} className="h-10 sm:h-12" />
                    ))}

                    {Array.from({ length: daysInViewMonth }).map((_, idx) => {
                      const dayNum = idx + 1;
                      const dateStr = `${viewYear}-${String(viewMonth).padStart(2, "0")}-${String(
                        dayNum
                      ).padStart(2, "0")}`;

                      const isPast = dateStr < todayStr;
                      const isToday = dateStr === todayStr;
                      const isSelected = dateStr === catDate;
                      const dayAvail = catMonthAvailability[dateStr];
                      const isClosed = dayAvail && !dayAvail.isAvailable && dayAvail.reason === "BUSINESS_CLOSED";
                      const isBlocked = dayAvail && !dayAvail.isAvailable && dayAvail.reason === "BLOCKED";
                      const isUnavailable = isPast || isClosed || isBlocked || (activeRank > 0 && !isSelected);

                      return (
                        <button
                          key={dateStr}
                          type="button"
                          disabled={isUnavailable}
                          onClick={() => {
                            if (activeRank === 0) setCatDate(dateStr);
                          }}
                          className={`group relative flex h-10 sm:h-12 flex-col items-center justify-center rounded-xl text-xs font-bold transition-all ${isSelected
                            ? "bg-[var(--da-primary)] text-white shadow-md ring-2 ring-[var(--da-accent)]"
                            : isPast
                              ? "opacity-30 cursor-not-allowed bg-slate-50 text-slate-400"
                              : isClosed || isBlocked || activeRank > 0
                                ? "opacity-45 cursor-not-allowed bg-slate-50 text-slate-400 border border-slate-100"
                                : "bg-[var(--da-canvas)] text-[var(--da-brand-dark)] hover:bg-[var(--da-info)] hover:border-[var(--da-primary)] border border-transparent"
                            }`}
                        >
                          <span>{dayNum}</span>
                          {isToday && !isSelected ? (
                            <span className="h-1 w-1 rounded-full bg-[var(--da-primary)] mt-0.5" />
                          ) : null}
                        </button>
                      );
                    })}
                  </div>

                  {loadingCatDates ? (
                    <p className="mt-3 text-center text-xs text-[var(--da-text-secondary)] italic">
                      Refreshing calendar availability...
                    </p>
                  ) : null}
                </div>

                {/* Duration Selector */}
                <div className="rounded-[24px] border border-[var(--da-border)] bg-white p-5 sm:p-6 shadow-[var(--da-shadow-md)]">
                  <div className="flex items-center justify-between border-b border-[var(--da-border-light)] pb-3 mb-4">
                    <div>
                      <h3 className="text-base font-extrabold text-[var(--da-brand-dark)]">
                        2. {activeRank > 0 ? "Duration (Locked to Main)" : "Choose Duration (Hours)"}
                      </h3>
                      <p className="text-xs text-[var(--da-text-secondary)]">
                        {activeRank > 0
                          ? `Backups must use the exact same duration (${catDurationHours} hrs) as Main.`
                          : "Choose how many hours you need before selecting start time."}
                      </p>
                    </div>
                    <span className="rounded-full bg-[var(--da-info)] px-3 py-1 text-xs font-extrabold text-[var(--da-primary)]">
                      {catDurationHours > 0 ? `${catDurationHours} ${catDurationHours === 1 ? "Hour" : "Hours"}` : "Select Duration"}
                    </span>
                  </div>

                  <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
                    {DURATION_OPTIONS.map((hours) => {
                      const isSelected = catDurationHours === hours;
                      const isDisabled = activeRank > 0 && !isSelected;
                      return (
                        <button
                          key={hours}
                          type="button"
                          disabled={isDisabled}
                          onClick={() => {
                            if (activeRank === 0) {
                              setCatDurationHours(hours);
                              setCatDurationInput(String(hours));
                            }
                          }}
                          className={`flex flex-col items-center justify-center py-2.5 px-2 rounded-xl text-xs font-bold transition ${isSelected
                            ? "bg-[var(--da-primary)] text-white shadow-sm ring-2 ring-[var(--da-accent)]"
                            : isDisabled
                              ? "opacity-30 cursor-not-allowed bg-slate-50 text-slate-400 border border-slate-200"
                              : "bg-[var(--da-canvas)] text-[var(--da-brand-dark)] hover:bg-slate-100 border border-[var(--da-border-light)]"
                            }`}
                        >
                          <span className="text-sm font-extrabold">{hours}</span>
                          <span className="text-[10px] font-semibold opacity-85">
                            {hours === 1 ? "hr" : "hrs"}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Custom Duration Input */}
                  <div className="mt-4 pt-3 border-t border-[var(--da-border-light)] flex flex-wrap items-center justify-between gap-3">
                    <span className="text-xs font-bold text-[var(--da-text-secondary)]">
                      {activeRank > 0 ? "Custom duration locked to Main" : "Or enter custom duration:"}
                    </span>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        aria-label="Custom duration in hours"
                        disabled={activeRank > 0}
                        value={catDurationInput}
                        onChange={(e) => {
                          if (activeRank > 0) return;
                          const raw = e.target.value;
                          const sanitized = raw.replace(/\D/g, "").replace(/^0+/, "");
                          setCatDurationInput(sanitized);
                          if (sanitized === "") {
                            setCatDurationHours(0);
                          } else {
                            const parsed = parseInt(sanitized, 10);
                            setCatDurationHours(parsed > 0 ? parsed : 0);
                          }
                        }}
                        onKeyDown={handleNumericKeyDown}
                        placeholder="Hours"
                        className="w-20 rounded-xl border border-[var(--da-border)] bg-white px-3 py-1.5 text-center text-sm font-extrabold text-[var(--da-brand-dark)] placeholder:text-slate-400 focus:border-[var(--da-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--da-primary)]/20 disabled:opacity-40 disabled:bg-slate-100"
                      />
                      <span className="text-xs font-bold text-[var(--da-brand-dark)]">
                        {catDurationHours === 1 ? "hr" : "hrs"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column: Start Time & Summary */}
              <div className="lg:col-span-5 flex flex-col gap-6">
                <div className="rounded-[24px] border border-[var(--da-border)] bg-white p-5 sm:p-6 shadow-[var(--da-shadow-md)]">
                  <div className="border-b border-[var(--da-border-light)] pb-3 mb-4">
                    <h3 className="text-base font-extrabold text-[var(--da-brand-dark)]">
                      3. Choose Start Time
                    </h3>
                    <p className="text-xs text-[var(--da-text-secondary)] mt-0.5">
                      {formatDateDisplay(catDate)} • {catDurationHours} hr{catDurationHours > 1 ? "s" : ""}
                    </p>
                  </div>

                  {loadingCatTimes ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <div className="h-7 w-7 animate-spin rounded-full border-2 border-[var(--da-primary)] border-t-transparent mb-2" />
                      <p className="text-xs font-semibold text-[var(--da-text-secondary)]">
                        Computing available start times...
                      </p>
                    </div>
                  ) : catTimeError ? (
                    <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-700">
                      <p className="font-bold">Unable to load times</p>
                      <p className="mt-0.5">{catTimeError}</p>
                    </div>
                  ) : catTimeSlots.length === 0 ? (
                    <div className="rounded-xl bg-[var(--da-canvas)] border border-[var(--da-border-light)] p-6 text-center">
                      <p className="text-xs font-bold text-[var(--da-brand-dark)]">
                        No slots available on this date
                      </p>
                      <p className="mt-1 text-[11px] text-[var(--da-text-secondary)]">
                        The business may be closed or operating hours do not accommodate a {catDurationHours}-hour booking.
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3">
                      <div className="rounded-xl bg-amber-50/80 border border-amber-200/80 p-3 text-[11px] leading-relaxed text-amber-900 flex items-center gap-2">
                        <span className="shrink-0 text-sm">💡</span>
                        <span>For immediate bookings (within 30 minutes), please proceed to walk in using our in-house kiosk.</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 max-h-[240px] overflow-y-auto pr-1">
                        {catTimeSlots.map((slot) => {
                          const isSelected = catStartTime === slot.startTime;

                          const isWithin30Mins = (() => {
                            if (catDate !== todayStr) return false;
                            const [sh, sm] = slot.startTime.split(":").map(Number);
                            if (isNaN(sh) || isNaN(sm)) return false;
                            const now = new Date();
                            const slotDate = new Date();
                            slotDate.setHours(sh, sm, 0, 0);
                            return slotDate.getTime() - now.getTime() < 30 * 60 * 1000;
                          })();

                          const isImmediateWalkIn =
                            slot.blockingReason === "IMMEDIATE_WALK_IN_ONLY" ||
                            (catDate === todayStr && isWithin30Mins && slot.blockingReason !== "PAST_TIME");
                          const isAvailable = slot.isAvailable && !isImmediateWalkIn;

                          let reasonLabel = "Reserved";
                          if (slot.blockingReason === "PAST_TIME") reasonLabel = "Past";
                          else if (isImmediateWalkIn) reasonLabel = "Walk-in Only";
                          else if (slot.blockingReason === "BUSINESS_CLOSED") reasonLabel = "Closed";
                          else if (slot.blockingReason === "SCHEDULE_BLOCKED") reasonLabel = "Blocked";

                          return (
                            <button
                              key={slot.startTime}
                              type="button"
                              disabled={!isAvailable}
                              title={isImmediateWalkIn ? "For immediate bookings (within 30 minutes), please proceed to walk in using our in-house kiosk." : undefined}
                              onClick={() => {
                                setCatStartTime(slot.startTime);
                              }}
                              className={`flex flex-col items-start p-2.5 rounded-xl border text-left transition-all ${isSelected
                                ? "bg-[var(--da-primary)] text-white border-[var(--da-accent)] shadow-sm ring-2 ring-[var(--da-accent)]"
                                : isAvailable
                                  ? "bg-[var(--da-canvas)] text-[var(--da-brand-dark)] border-[var(--da-border-light)] hover:border-[var(--da-primary)] hover:bg-white"
                                  : "opacity-40 cursor-not-allowed bg-slate-50 text-slate-400 border-dashed border-slate-200"
                                }`}
                            >
                              <div className="flex w-full items-center justify-between">
                                <span className="text-xs font-bold">
                                  {formatTime12Hour(slot.startTime)}
                                </span>
                                {!isAvailable ? (
                                  <span className="text-[9px] font-bold uppercase tracking-wider text-red-600 bg-red-50 px-1.5 py-0.5 rounded">
                                    {reasonLabel}
                                  </span>
                                ) : null}
                              </div>
                              <span className="text-[10px] opacity-80 mt-0.5">
                                to {formatTime12Hour(slot.endTime)}
                                {(() => {
                                  const [sh, sm] = slot.startTime.split(":").map(Number);
                                  return sh * 60 + sm + catDurationHours * 60 >= 1440 ? " (Next Day)" : "";
                                })()}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* Summary Card */}
                <div className="rounded-[24px] border border-[var(--da-border)] bg-white p-5 sm:p-6 shadow-[var(--da-shadow-md)] flex flex-col gap-4">
                  <div className="rounded-2xl bg-[var(--da-canvas)] border border-[var(--da-border-light)] p-4 flex flex-col gap-2.5 text-xs text-[var(--da-text-secondary)]">
                    <div className="flex justify-between items-center">
                      <span>Category:</span>
                      <span className="font-bold text-[var(--da-brand-dark)]">{selectedTemplate.name}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span>Date:</span>
                      <span className="font-bold text-[var(--da-brand-dark)]">{formatDateDisplay(catDate)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span>Duration:</span>
                      <span className="font-bold text-[var(--da-brand-dark)]">{catDurationHours} Hours</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span>Time Range:</span>
                      <span className="font-bold text-[var(--da-brand-dark)]">
                        {catStartTime && catEndTime
                          ? formatTimeRangeDisplay(catStartTime, catEndTime, catDurationHours)
                          : "Please select start time"}
                      </span>
                    </div>
                    <div className="border-t border-[var(--da-border-light)] pt-2 flex justify-between items-center">
                      <span className="font-extrabold text-sm text-[var(--da-brand-dark)]">Total Amount:</span>
                      <span className="font-extrabold text-base text-[var(--da-primary)]">
                        ₱{(selectedTemplate.rateAmount * catDurationHours).toFixed(2)}
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={!catDate || !catStartTime || !catDurationHours || catDurationHours <= 0}
                    onClick={() => {
                      if (!catDurationHours || catDurationHours <= 0) return;
                      setStep("category-instances");
                    }}
                    className={`da-primary-button w-full justify-center py-3 text-sm font-bold ${!catDate || !catStartTime || !catDurationHours || catDurationHours <= 0 ? "opacity-50 cursor-not-allowed" : ""
                      }`}
                  >
                    {catStartTime ? "Find Available Spots →" : "Select a Start Time to Proceed"}
                  </button>
                </div>
              </div>
            </div>
          </section>
        ) : step === "category-instances" && selectedTemplate && catStartTime ? (
          /* 2c. Category Flow Available Spots Grid */
          <section className="flex flex-col gap-6">
            <div className="rounded-[28px] border border-[var(--da-border)] bg-white p-6 sm:p-8 shadow-[var(--da-shadow-lg)]">
              <div className="flex flex-wrap items-center justify-between border-b border-[var(--da-border-light)] pb-4 mb-6 gap-4">
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-[var(--da-primary)]">
                    Available Spots
                  </span>
                  <h2 className="text-2xl font-extrabold text-[var(--da-brand-dark)]">
                    Available {selectedTemplate.name} Desks
                  </h2>
                  <p className="mt-1 text-xs text-[var(--da-text-secondary)]">
                    Showing real-time availability for <strong>{formatDateDisplay(catDate)}</strong> from <strong>{formatTimeRangeDisplay(catStartTime, catEndTime || "", catDurationHours)}</strong> ({catDurationHours} hrs).
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setStep("category-schedule")}
                  className="da-secondary-button text-xs font-bold py-2 px-3"
                >
                  ← Change Schedule
                </button>
              </div>

              {loadingInstances ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="h-8 w-8 animate-spin rounded-full border-3 border-[var(--da-primary)] border-t-transparent mb-3" />
                  <p className="text-sm font-semibold text-[var(--da-text-secondary)]">
                    Checking available desks for your schedule...
                  </p>
                </div>
              ) : instanceError ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-xs text-red-700 text-center">
                  <p className="font-bold text-sm">Failed to check desk availability</p>
                  <p className="mt-1">{instanceError}</p>
                </div>
              ) : instanceAvailabilityList.length === 0 ? (
                <div className="rounded-2xl bg-[var(--da-canvas)] border border-[var(--da-border-light)] p-10 text-center">
                  <span className="text-4xl">🏢</span>
                  <h3 className="mt-3 text-lg font-extrabold text-[var(--da-brand-dark)]">
                    No physical spots found
                  </h3>
                  <button
                    type="button"
                    onClick={() => setStep("map")}
                    className="mt-4 da-primary-button text-xs font-bold"
                  >
                    ← Browse Categories
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                  {instanceAvailabilityList.map((inst) => {
                    const isExcludedDuplicate = candidates.some(
                      (c) =>
                        c.workspace.workspaceInstanceId === inst.workspaceInstanceId &&
                        c.startTime === catStartTime &&
                        c.rank !== activeRank
                    );
                    const isAvailable = inst.isAvailable && !isExcludedDuplicate;

                    return (
                      <div
                        key={inst.workspaceInstanceId}
                        className={`rounded-2xl border-2 p-5 flex flex-col justify-between transition-all ${isAvailable
                          ? "border-[var(--da-border-light)] bg-white hover:border-[var(--da-primary)] hover:shadow-md cursor-pointer"
                          : "border-slate-200 bg-slate-50/60 opacity-60 cursor-not-allowed"
                          }`}
                        onClick={() => {
                          if (isAvailable) handleSelectInstance(inst);
                        }}
                      >
                        <div>
                          <div className="relative aspect-[16/10] w-full overflow-hidden rounded-xl border border-[var(--da-border-light)] bg-slate-100 mb-3">
                            {inst.photoPath ? (
                              <img
                                src={inst.photoPath}
                                alt={inst.displayName}
                                className="h-full w-full object-cover"
                                style={{
                                  objectPosition: getWorkspacePhotoObjectPosition(inst.photoPosition),
                                }}
                              />
                            ) : (
                              <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-[#E0EFE4]/60 to-[#F3F7F4]">
                                <span className="text-3xl">🏢</span>
                              </div>
                            )}
                            <div className="absolute top-2 right-2">
                              <span
                                className={`rounded-full border px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider ${isAvailable
                                  ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                                  : "bg-slate-100 text-slate-600 border-slate-200"
                                  }`}
                              >
                                {isAvailable ? "Available" : "Unavailable"}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center justify-between gap-2">
                            <h3 className="text-base font-extrabold text-[var(--da-brand-dark)]">
                              {inst.displayName}
                            </h3>
                            <span className="text-xs font-bold text-slate-500 font-mono">
                              #{inst.instanceCode}
                            </span>
                          </div>

                          <p className="text-xs text-[var(--da-text-secondary)] mt-1">
                            📍 {inst.floorName} • Capacity: {inst.capacity} seat(s)
                          </p>
                        </div>

                        <div className="mt-4 pt-3 border-t border-[var(--da-border-light)] flex items-center justify-between">
                          <span className="text-xs font-extrabold text-[var(--da-brand-dark)]">
                            ₱{(inst.rateAmount * catDurationHours).toFixed(2)}{" "}
                            <span className="text-[10px] font-normal text-[var(--da-text-secondary)]">total</span>
                          </span>

                          <button
                            type="button"
                            disabled={!isAvailable}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (isAvailable) handleSelectInstance(inst);
                            }}
                            className={`rounded-xl px-3.5 py-1.5 text-xs font-extrabold transition ${isAvailable
                              ? "bg-[var(--da-primary)] text-white hover:opacity-90 shadow-sm"
                              : "bg-slate-200 text-slate-400 cursor-not-allowed"
                              }`}
                          >
                            {isAvailable
                              ? activeRank === 0
                                ? "Select Main Spot →"
                                : `Select Backup ${activeRank} →`
                              : "Unavailable"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        ) : step === "backup-prompt" && mainCandidate ? (
          /* 3. Step 3: Linear Backup Offer Prompt */
          <section className="flex flex-col gap-6">
            <div className="rounded-[28px] border border-[var(--da-border)] bg-white p-6 sm:p-8 shadow-[var(--da-shadow-lg)]">
              <div className="flex items-center justify-between border-b border-[var(--da-border-light)] pb-4 mb-6">
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-[var(--da-primary)]">
                    Progress Summary
                  </span>
                  <h2 className="text-2xl font-extrabold text-[var(--da-brand-dark)]">
                    {candidates.length === 1
                      ? "Main Workspace Selected"
                      : `${candidates.length} Spots Configured (Main + ${candidates.length - 1} Backup)`}
                  </h2>
                </div>
                <span className="rounded-full bg-emerald-50 border border-emerald-200 px-3.5 py-1 text-xs font-extrabold text-emerald-800">
                  {candidates.length} / 3 Candidates
                </span>
              </div>

              {/* Candidate Cards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Main Card */}
                <div className="rounded-2xl border-2 border-[var(--da-primary)] bg-[var(--da-canvas)] p-5 relative shadow-sm">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="rounded-full bg-[var(--da-primary)] text-white px-2.5 py-0.5 text-xs font-extrabold">
                      👑 Main Choice
                    </span>
                    <span className="text-xs font-bold text-[var(--da-text-secondary)]">
                      {mainCandidate.workspace.floorName}
                    </span>
                  </div>
                  <h3 className="text-lg font-extrabold text-[var(--da-brand-dark)]">
                    {mainCandidate.workspace.displayName}
                  </h3>
                  <p className="text-xs text-[var(--da-text-secondary)] mt-0.5 font-medium">
                    {mainCandidate.workspace.templateName} • ₱{mainCandidate.workspace.rateAmount}/hr
                  </p>
                  <div className="mt-3 rounded-xl bg-white border border-[var(--da-border-light)] p-3 text-xs flex flex-col gap-1">
                    <div className="flex justify-between">
                      <span className="text-[var(--da-text-secondary)]">Date:</span>
                      <span className="font-bold">{formatDateDisplay(mainCandidate.date)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--da-text-secondary)]">Duration:</span>
                      <span className="font-bold">{mainCandidate.durationHours} hrs</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--da-text-secondary)]">Time:</span>
                      <span className="font-bold">
                        {formatTime12Hour(mainCandidate.startTime)} – {formatTime12Hour(mainCandidate.endTime)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Backup 1 Card */}
                {backup1Candidate ? (
                  <div className="rounded-2xl border border-amber-300 bg-amber-50/40 p-5 relative shadow-sm">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="rounded-full bg-amber-500 text-white px-2.5 py-0.5 text-xs font-extrabold">
                        🥈 Backup 1
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRemoveCandidate(1)}
                        className="text-xs font-bold text-red-600 hover:underline"
                      >
                        Remove
                      </button>
                    </div>
                    <h3 className="text-lg font-extrabold text-[var(--da-brand-dark)]">
                      {backup1Candidate.workspace.displayName}
                    </h3>
                    <p className="text-xs text-[var(--da-text-secondary)] mt-0.5 font-medium">
                      {backup1Candidate.workspace.templateName} • ₱{backup1Candidate.workspace.rateAmount}/hr
                    </p>
                    <div className="mt-3 rounded-xl bg-white border border-[var(--da-border-light)] p-3 text-xs flex flex-col gap-1">
                      <div className="flex justify-between">
                        <span className="text-[var(--da-text-secondary)]">Date:</span>
                        <span className="font-bold">{formatDateDisplay(backup1Candidate.date)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[var(--da-text-secondary)]">Duration:</span>
                        <span className="font-bold">{backup1Candidate.durationHours} hrs</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[var(--da-text-secondary)]">Time:</span>
                        <span className="font-bold">
                          {formatTimeRangeDisplay(backup1Candidate.startTime, backup1Candidate.endTime, backup1Candidate.durationHours)}
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 p-6 flex flex-col items-center justify-center text-center">
                    <span className="text-2xl mb-2">🥈</span>
                    <h4 className="text-sm font-bold text-slate-700">Backup Spot 1 (Optional)</h4>
                    <p className="text-xs text-slate-500 mt-1">
                      Alternative spot of same type in case Main is taken.
                    </p>
                    <button
                      type="button"
                      onClick={() => handleStartAddBackup(1)}
                      className="mt-4 rounded-full bg-[var(--da-primary)] text-white px-4 py-1.5 text-xs font-bold hover:opacity-90 transition shadow-sm"
                    >
                      + Add Backup 1
                    </button>
                  </div>
                )}

                {/* Backup 2 Card */}
                {backup2Candidate ? (
                  <div className="rounded-2xl border border-amber-300 bg-amber-50/40 p-5 relative shadow-sm">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="rounded-full bg-amber-600 text-white px-2.5 py-0.5 text-xs font-extrabold">
                        🥉 Backup 2
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRemoveCandidate(2)}
                        className="text-xs font-bold text-red-600 hover:underline"
                      >
                        Remove
                      </button>
                    </div>
                    <h3 className="text-lg font-extrabold text-[var(--da-brand-dark)]">
                      {backup2Candidate.workspace.displayName}
                    </h3>
                    <p className="text-xs text-[var(--da-text-secondary)] mt-0.5 font-medium">
                      {backup2Candidate.workspace.templateName} • ₱{backup2Candidate.workspace.rateAmount}/hr
                    </p>
                    <div className="mt-3 rounded-xl bg-white border border-[var(--da-border-light)] p-3 text-xs flex flex-col gap-1">
                      <div className="flex justify-between">
                        <span className="text-[var(--da-text-secondary)]">Date:</span>
                        <span className="font-bold">{formatDateDisplay(backup2Candidate.date)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[var(--da-text-secondary)]">Duration:</span>
                        <span className="font-bold">{backup2Candidate.durationHours} hrs</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[var(--da-text-secondary)]">Time:</span>
                        <span className="font-bold">
                          {formatTimeRangeDisplay(backup2Candidate.startTime, backup2Candidate.endTime, backup2Candidate.durationHours)}
                        </span>
                      </div>
                    </div>
                  </div>
                ) : backup1Candidate ? (
                  <div className="rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 p-6 flex flex-col items-center justify-center text-center">
                    <span className="text-2xl mb-2">🥉</span>
                    <h4 className="text-sm font-bold text-slate-700">Backup Spot 2 (Optional)</h4>
                    <p className="text-xs text-slate-500 mt-1">
                      Second fallback option for guaranteed allocation.
                    </p>
                    <button
                      type="button"
                      onClick={() => handleStartAddBackup(2)}
                      className="mt-4 rounded-full bg-[var(--da-primary)] text-white px-4 py-1.5 text-xs font-bold hover:opacity-90 transition shadow-sm"
                    >
                      + Add Backup 2
                    </button>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 p-6 flex flex-col items-center justify-center text-center opacity-60">
                    <span className="text-2xl mb-2 text-slate-400">🥉</span>
                    <h4 className="text-xs font-bold text-slate-500">Backup Spot 2 (Optional)</h4>
                    <p className="text-[11px] text-slate-400 mt-1">
                      Available after adding Backup 1.
                    </p>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-[var(--da-border-light)] pt-6">
                <button
                  type="button"
                  onClick={() => {
                    setActiveRank(0);
                    setSelectedWorkspaceId(null);
                    setStep("map");
                  }}
                  className="da-secondary-button text-xs font-bold"
                >
                  ← Restart Spot Selection
                </button>

                <div className="flex flex-wrap items-center gap-3">
                  {!backup1Candidate ? (
                    <>
                      <button
                        type="button"
                        onClick={() => handleStartAddBackup(1)}
                        className="da-secondary-button text-xs font-bold px-4 py-2.5"
                      >
                        + Add Backup Spot 1 (Optional)
                      </button>
                      <button
                        type="button"
                        onClick={() => setStep("summary")}
                        className="da-primary-button text-xs font-bold px-5 py-2.5"
                      >
                        Skip Backups & Proceed to Review →
                      </button>
                    </>
                  ) : !backup2Candidate ? (
                    <>
                      <button
                        type="button"
                        onClick={() => handleStartAddBackup(2)}
                        className="da-secondary-button text-xs font-bold px-4 py-2.5"
                      >
                        + Add Backup Spot 2 (Optional)
                      </button>
                      <button
                        type="button"
                        onClick={() => setStep("summary")}
                        className="da-primary-button text-xs font-bold px-5 py-2.5"
                      >
                        Finish Backups & Proceed to Review →
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setStep("summary")}
                      className="da-primary-button text-xs font-bold px-5 py-2.5"
                    >
                      Proceed to Review Summary →
                    </button>
                  )}
                </div>
              </div>
            </div>
          </section>
        ) : step === "summary" && mainCandidate ? (
          /* 4. Step 4: Review Summary & Guest Customer Details */
          <section className="flex flex-col gap-6">
            <div className="rounded-[28px] border border-[var(--da-border)] bg-white p-6 sm:p-8 shadow-[var(--da-shadow-lg)]">
              <div className="flex items-center justify-between border-b border-[var(--da-border-light)] pb-4 mb-6">
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-[var(--da-primary)]">
                    Step 3 of Reservation
                  </span>
                  <h2 className="text-2xl font-extrabold text-[var(--da-brand-dark)]">
                    Reservation Summary & Details
                  </h2>
                </div>
                <span className="rounded-full bg-[var(--da-info)] px-3.5 py-1 text-xs font-extrabold text-[var(--da-primary)]">
                  {candidates.length} {candidates.length === 1 ? "Ranked Spot" : "Ranked Spots"}
                </span>
              </div>

              {/* Candidate Cards List */}
              <div className="flex flex-col gap-4">
                {candidates.map((cand) => {
                  const isMain = cand.rank === 0;
                  const hasCustomPhoto = Boolean(
                    cand.workspace.photoPath && !candidateImageErrors[cand.workspace.workspaceInstanceId]
                  );

                  return (
                    <div
                      key={`${cand.workspace.workspaceInstanceId}-${cand.rank}-${cand.startTime}`}
                      className={`rounded-2xl border p-4 sm:p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-5 transition ${isMain
                        ? "border-[var(--da-primary)] bg-[var(--da-canvas)] shadow-sm"
                        : "border-slate-200 bg-white"
                        }`}
                    >
                      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 w-full md:w-auto">
                        <div className="relative aspect-[16/10] w-full sm:w-44 sm:h-28 shrink-0 overflow-hidden rounded-xl border border-[var(--da-border-light)] bg-slate-100 shadow-sm">
                          {hasCustomPhoto ? (
                            <img
                              src={cand.workspace.photoPath!}
                              alt={cand.workspace.displayName}
                              onError={() =>
                                setCandidateImageErrors((prev) => ({
                                  ...prev,
                                  [cand.workspace.workspaceInstanceId]: true,
                                }))
                              }
                              className="h-full w-full object-cover"
                              style={{
                                objectPosition: getWorkspacePhotoObjectPosition(cand.workspace.photoPosition),
                              }}
                            />
                          ) : (
                            <div className="flex h-full w-full flex-col items-center justify-center p-3 text-center bg-gradient-to-br from-[#E0EFE4]/60 to-[#F3F7F4]">
                              <span className="text-2xl">🏢</span>
                              <span className="mt-1 text-[11px] font-bold text-[var(--da-brand-dark)] line-clamp-1">
                                {cand.workspace.templateName}
                              </span>
                              <span className="text-[9px] text-[var(--da-text-secondary)] font-medium">
                                DeskAtlas Space
                              </span>
                            </div>
                          )}
                          <div className="absolute top-2 left-2">
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold shadow-sm ${isMain
                                ? "bg-[var(--da-primary)] text-white"
                                : cand.rank === 1
                                  ? "bg-amber-500 text-white"
                                  : "bg-amber-600 text-white"
                                }`}
                            >
                              {isMain ? "👑 Main" : cand.rank === 1 ? "🥈 Backup 1" : "🥉 Backup 2"}
                            </span>
                          </div>
                        </div>

                        <div className="flex flex-col gap-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`rounded-full px-2.5 py-0.5 text-[11px] font-extrabold uppercase tracking-wider ${isMain
                                ? "bg-[var(--da-primary)] text-white"
                                : "bg-amber-100 text-amber-800 border border-amber-200"
                                }`}
                            >
                              {isMain ? "Main Choice" : `Backup ${cand.rank}`}
                            </span>
                            <span className="text-xs font-semibold text-[var(--da-text-secondary)]">
                              {cand.workspace.floorName}
                            </span>
                          </div>

                          <h3 className="mt-1 text-lg font-extrabold text-[var(--da-brand-dark)]">
                            {cand.workspace.displayName}
                          </h3>
                          <p className="text-xs text-[var(--da-text-secondary)]">
                            {cand.workspace.templateName} •{" "}
                            <span className="font-bold text-[var(--da-brand-dark)]">
                              ₱{cand.workspace.rateAmount.toFixed(2)}/hr
                            </span>
                          </p>

                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--da-text-secondary)]">
                            <span className="font-bold text-[var(--da-brand-dark)]">
                              📅 {formatDateDisplay(cand.date)}
                            </span>
                            <span>•</span>
                            <span className="font-medium">
                              🕒 {formatTimeRangeDisplay(cand.startTime, cand.endTime, cand.durationHours)} ({cand.durationHours} hr{cand.durationHours > 1 ? "s" : ""})
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex md:flex-col items-center md:items-end justify-between w-full md:w-auto gap-3 border-t md:border-t-0 border-[var(--da-border-light)] pt-3 md:pt-0">
                        <div className="text-left md:text-right">
                          <span className="text-[11px] font-bold text-[var(--da-text-secondary)] block">
                            Candidate Total:
                          </span>
                          <span className="text-base font-extrabold text-[var(--da-brand-dark)]">
                            ₱{(cand.workspace.rateAmount * cand.durationHours).toFixed(2)}
                          </span>
                        </div>

                        {!isMain ? (
                          <button
                            type="button"
                            onClick={() => handleRemoveCandidate(cand.rank as 1 | 2)}
                            className="rounded-lg border border-red-200 bg-red-50 px-3 py-1 text-xs font-bold text-red-700 hover:bg-red-100 transition"
                          >
                            Remove Backup
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>

              {candidates.length < 3 ? (
                <div className="mt-4 flex items-center justify-between rounded-xl bg-slate-50 border border-dashed border-slate-200 p-4">
                  <div className="text-xs text-slate-600">
                    <span className="font-bold">Want to add another fallback spot?</span> You can select up to 2 backups.
                  </div>
                  <button
                    type="button"
                    onClick={() => handleStartAddBackup(candidates.length === 1 ? 1 : 2)}
                    className="da-secondary-button text-xs font-bold py-1.5 px-3"
                  >
                    + Add Backup {candidates.length === 1 ? "1" : "2"}
                  </button>
                </div>
              ) : null}

              {/* Pricing & Guarantee Summary */}
              <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-2xl bg-[var(--da-canvas)] border border-[var(--da-border-light)] p-4 text-xs text-[var(--da-text-secondary)] flex flex-col justify-between gap-3">
                  <div>
                    <div className="font-bold text-[var(--da-brand-dark)] mb-1">
                      🔒 No-Hold & Atomic Allocation Guarantee
                    </div>
                    <p className="leading-5">
                      Your rate of ₱{mainCandidate.workspace.rateAmount.toFixed(2)}/hr for {mainCandidate.durationHours} hours is locked. No upfront payment is charged right now. When proof is approved by admin, the first available candidate (Main → Backup 1 → Backup 2) will be permanently allocated.
                    </p>
                  </div>
                  <span className="text-[11px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-3 py-1 rounded-full w-fit">
                    ✓ All {candidates.length} candidates use equal rates & duration
                  </span>
                </div>

                <div className="rounded-2xl bg-[var(--da-canvas)] border border-[var(--da-border-light)] p-4 flex flex-col justify-between gap-3 text-xs">
                  <div className="flex flex-col gap-2 text-[var(--da-text-secondary)]">
                    <div className="flex justify-between">
                      <span>Rate per Hour:</span>
                      <span className="font-bold text-[var(--da-brand-dark)]">
                        ₱{mainCandidate.workspace.rateAmount.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Duration:</span>
                      <span className="font-bold text-[var(--da-brand-dark)]">
                        {mainCandidate.durationHours} Hours
                      </span>
                    </div>
                    <div className="border-t border-[var(--da-border-light)] pt-2 flex justify-between items-center">
                      <span className="font-extrabold text-sm text-[var(--da-brand-dark)]">
                        Amount Due on Confirmation:
                      </span>
                      <span className="font-extrabold text-lg text-[var(--da-primary)]">
                        ₱{(mainCandidate.workspace.rateAmount * mainCandidate.durationHours).toFixed(2)}
                      </span>
                    </div>
                  </div>

                  <div className="text-[11px] text-[var(--da-text-secondary)] italic text-right">
                    * Guest reservation created with no upfront hold
                  </div>
                </div>
              </div>

              {/* Guest Customer Details Form */}
              <div className="mt-8 border-t border-[var(--da-border-light)] pt-6">
                <div className="mb-4">
                  <span className="text-xs font-bold uppercase tracking-wider text-[var(--da-primary)]">
                    Final Step • Guest Customer Information
                  </span>
                  <h3 className="text-xl font-extrabold text-[var(--da-brand-dark)]">
                    Customer Details
                  </h3>
                  <p className="mt-1 text-xs text-[var(--da-text-secondary)]">
                    Please provide your contact information to receive your reservation tracking and payment link. DeskAtlas is guest-first — no password, membership, or account registration required.
                  </p>
                </div>

                {submitErrorMessage ? (
                  <div className="mb-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-xs font-bold text-red-700 flex items-center gap-2 shadow-sm">
                    <span>⚠️</span>
                    <span>{submitErrorMessage}</span>
                  </div>
                ) : null}

                <form onSubmit={handleSubmitReservation} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="customer-first-name" className="block text-xs font-bold text-[var(--da-brand-dark)] mb-1">
                        First Name <span className="text-red-500">*</span>
                      </label>
                      <input
                        id="customer-first-name"
                        type="text"
                        value={customerFirstName}
                        onChange={(e) => {
                          setCustomerFirstName(e.target.value);
                          if (formErrors.firstName) {
                            setFormErrors((prev) => ({ ...prev, firstName: undefined }));
                          }
                        }}
                        placeholder="e.g. Maria"
                        disabled={isSubmitting}
                        className={`da-input w-full text-sm font-medium ${formErrors.firstName ? "border-red-500 focus:border-red-500 ring-red-200" : ""
                          }`}
                      />
                      {formErrors.firstName ? (
                        <p className="mt-1 text-[11px] font-bold text-red-600">
                          {formErrors.firstName}
                        </p>
                      ) : null}
                    </div>

                    <div>
                      <label htmlFor="customer-last-name" className="block text-xs font-bold text-[var(--da-brand-dark)] mb-1">
                        Last Name <span className="text-red-500">*</span>
                      </label>
                      <input
                        id="customer-last-name"
                        type="text"
                        value={customerLastName}
                        onChange={(e) => {
                          setCustomerLastName(e.target.value);
                          if (formErrors.lastName) {
                            setFormErrors((prev) => ({ ...prev, lastName: undefined }));
                          }
                        }}
                        placeholder="e.g. Santos"
                        disabled={isSubmitting}
                        className={`da-input w-full text-sm font-medium ${formErrors.lastName ? "border-red-500 focus:border-red-500 ring-red-200" : ""
                          }`}
                      />
                      {formErrors.lastName ? (
                        <p className="mt-1 text-[11px] font-bold text-red-600">
                          {formErrors.lastName}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <div>
                    <label htmlFor="customer-email" className="block text-xs font-bold text-[var(--da-brand-dark)] mb-1">
                      Email Address <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="customer-email"
                      type="email"
                      value={customerEmail}
                      onChange={(e) => {
                        setCustomerEmail(e.target.value);
                        if (formErrors.email) {
                          setFormErrors((prev) => ({ ...prev, email: undefined }));
                        }
                      }}
                      placeholder="e.g. maria.santos@example.com"
                      disabled={isSubmitting}
                      className={`da-input w-full text-sm font-medium ${formErrors.email ? "border-red-500 focus:border-red-500 ring-red-200" : ""
                        }`}
                    />
                    {formErrors.email ? (
                      <p className="mt-1 text-[11px] font-bold text-red-600">
                        {formErrors.email}
                      </p>
                    ) : (
                      <p className="mt-1 text-[11px] text-[var(--da-text-secondary)]">
                        Your payment session and booking access pass will be sent to this email address.
                      </p>
                    )}
                  </div>

                  <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-[11px] leading-relaxed text-slate-600">
                    <span className="font-bold text-slate-800">Please Note:</span> Submitting creates a pending reservation and opens a 1-hour online payment session. The selected workspace is not guaranteed until payment proof is approved and the reservation is confirmed.
                  </div>

                  <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-[var(--da-border-light)] pt-5">
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => setStep("backup-prompt")}
                      className="da-secondary-button text-xs font-bold"
                    >
                      ← Back to Backup Management
                    </button>

                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="da-primary-button text-sm font-extrabold px-6 py-3 min-w-[240px] flex items-center justify-center gap-2"
                    >
                      {isSubmitting ? (
                        <>
                          <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                          <span>Submitting Reservation...</span>
                        </>
                      ) : (
                        <span>
                          Submit Reservation & Pay (₱
                          {(mainCandidate.workspace.rateAmount * mainCandidate.durationHours).toFixed(2)}) →
                        </span>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </section>
        ) : null}
      </div>

      {/* Spot Detail Modal */}
      <SpotDetailModal
        workspace={modalWorkspace}
        open={isModalOpen}
        candidateRank={activeRank}
        mainTemplateName={mainCandidate?.workspace.templateName}
        onOpenChange={setIsModalOpen}
        onProceed={(ws) => {
          setSelectedWorkspaceId(ws.workspaceInstanceId);
          setModalWorkspace(ws);
          setIsModalOpen(false);
          setStep("schedule");
        }}
      />

      {/* Email Confirmation Modal */}
      {mainCandidate ? (
        <EmailConfirmationModal
          open={isEmailConfirmOpen}
          onOpenChange={setIsEmailConfirmOpen}
          email={customerEmail.trim()}
          customerName={`${customerFirstName.trim()} ${customerLastName.trim()}`}
          mainSpotName={mainCandidate.workspace.displayName}
          templateName={mainCandidate.workspace.templateName}
          durationHours={mainCandidate.durationHours}
          date={mainCandidate.date}
          totalAmount={mainCandidate.workspace.rateAmount * mainCandidate.durationHours}
          isSubmitting={isSubmitting}
          onConfirm={handleConfirmSubmit}
        />
      ) : null}

      {/* MF-70: Session Expired Modal */}
      {isSessionTimedOut && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="session-expired-title"
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-200"
        >
          <div className="relative w-full max-w-md rounded-[28px] border border-[var(--da-border)] bg-white p-6 sm:p-8 text-center shadow-[var(--da-shadow-lg)] flex flex-col items-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-50 border-2 border-amber-300 text-3xl shadow-sm">
              ⏳
            </div>

            <span className="rounded-full bg-amber-100 text-amber-900 text-xs font-extrabold px-3 py-1 uppercase tracking-wider mb-2">
              Time Limit Reached
            </span>

            <h2
              id="session-expired-title"
              className="text-2xl font-extrabold text-[var(--da-brand-dark)] tracking-tight"
            >
              Session Expired
            </h2>

            <p className="mt-3 text-sm text-[var(--da-text-secondary)] leading-relaxed">
              Your 20-minute reservation session has ended. To ensure accurate real-time availability, please begin a new booking.
            </p>

            <div className="mt-4 rounded-xl bg-slate-50 border border-slate-200 px-4 py-2 text-xs text-slate-600 font-medium">
              Redirecting to home in <span className="font-bold text-[var(--da-brand-dark)] font-mono">{timeoutRedirectCountdown}s</span>...
            </div>

            <div className="mt-6 w-full flex flex-col gap-2.5">
              <button
                type="button"
                onClick={handleReturnToHome}
                className="w-full rounded-2xl bg-[var(--da-brand-dark)] px-5 py-3.5 text-sm font-bold text-white shadow hover:opacity-90 transition-all cursor-pointer"
              >
                Return to Home
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
