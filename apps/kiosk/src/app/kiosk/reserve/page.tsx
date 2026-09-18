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
} from "@deskatlas/domain";
import {
  SpotDetailModal,
  type WorkspaceMapViewModel,
  getWorkspacePhotoObjectPosition,
} from "../../features/reservation/SpotDetailModal";
import { fetchTemplateAvailability, fetchOccupiedInstances, fetchNextUpcomingBooking } from "../../lib/availabilityApi";
import { handleNumericKeyDown, WorkspaceCountdownBadge, useLiveCountdownClock } from "@deskatlas/ui";

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

function mapPublishedFloorToWorkspaceCards(
  published: PublishedFloorMap,
  occupiedInstanceIds: Set<string> = new Set()
): WorkspaceMapViewModel[] {
  return published.elements
    .filter((element) => element.elementRole === "WORKSPACE" && element.workspace)
    .map((element) => {
      const workspace = element.workspace!;
      const isOccupied = occupiedInstanceIds.has(workspace.workspaceInstanceId);
      const isMaintenance = workspace.operationalStatus === "MAINTENANCE";
      const isAvailable = workspace.isBookable && workspace.operationalStatus === "ACTIVE" && !isOccupied;
      const status = isOccupied
        ? "occupied"
        : isMaintenance
        ? "maintenance"
        : isAvailable
        ? "available"
        : "unavailable";
      const statusLabel = isOccupied
        ? "Occupied"
        : isMaintenance
        ? "Maintenance"
        : isAvailable
        ? "Available"
        : "Unavailable";
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

function getNowWithLeewayDate(): Date {
  const now = new Date();
  return new Date(now.getTime() + 5 * 60 * 1000);
}

function getTodayManila(): string {
  const now = getNowWithLeewayDate();
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

function getCurrentTimeManila(): string {
  const now = getNowWithLeewayDate();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const h = parts.find((p) => p.type === "hour")?.value ?? "09";
  const m = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${h}:${m}`;
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

  return null;
}

export default function KioskReservePage() {
  const router = useRouter();

  // Dual Discovery Mode: "map" vs "category"
  const MAX_KIOSK_DURATION_HOURS = 24;
  const [discoveryMode, setDiscoveryMode] = useState<"map" | "category">("map");

  // Step state: "discovery" | "duration" | "category-instances" | "details" | "code"
  const [step, setStep] = useState<"discovery" | "duration" | "category-instances" | "details" | "code">("discovery");

  // Workspace & Template Selection
  const [selectedWorkspace, setSelectedWorkspace] = useState<WorkspaceMapViewModel | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<WorkspaceTemplateSummary | null>(null);
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

  useEffect(() => {
    const updateTime = () => {
      setTodayDate(getTodayManila());
      setNowTime(getCurrentTimeManila());
    };
    updateTime();
    const interval = setInterval(updateTime, 15000);
    return () => clearInterval(interval);
  }, [step]);

  const endTimeStr = useMemo(() => {
    const [h, m] = nowTime.split(":").map(Number);
    const totalMinutes = h * 60 + m + durationHours * 60;
    const endH = Math.floor(totalMinutes / 60) % 24;
    const endM = totalMinutes % 60;
    return `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;
  }, [nowTime, durationHours]);

  // Form Fields
  const [customerFirstName, setCustomerFirstName] = useState("");
  const [customerLastName, setCustomerLastName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
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
  const [mapLoading, setMapLoading] = useState(true);
  const [mapError, setMapError] = useState<string | null>(null);
  const [occupiedInstanceIds, setOccupiedInstanceIds] = useState<Set<string>>(new Set());
  const [occupiedDetailsMap, setOccupiedDetailsMap] = useState<Map<string, string | null>>(new Map());

  // Real-time instances for category flow
  const [categoryInstances, setCategoryInstances] = useState<AvailableInstanceSummary[]>([]);
  const [loadingCategoryInstances, setLoadingCategoryInstances] = useState(false);
  const [categoryInstanceError, setCategoryInstanceError] = useState<string | null>(null);

  // Zoom controls
  const [zoom, setZoom] = useState(1);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  const fetchOccupiedData = async (durMin?: number) => {
    try {
      const minutes = durMin ?? Math.max(durationHours || 1, 1) * 60;
      const res = await fetchOccupiedInstances({
        durationMinutes: minutes,
        nowIso: getNowWithLeewayDate().toISOString(),
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
    } catch {
      // Keep existing occupied list on fetch error
    }
  };

  useEffect(() => {
    fetchOccupiedData(Math.max(durationHours || 1, 1) * 60);
    const interval = setInterval(() => fetchOccupiedData(Math.max(durationHours || 1, 1) * 60), 15000);
    return () => clearInterval(interval);
  }, [durationHours]);

  // Upcoming booking & availability limits for selected workspace
  const [upcomingBooking, setUpcomingBooking] = useState<NextUpcomingBookingResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadUpcoming = async () => {
      try {
        const res = await fetchNextUpcomingBooking({
          workspaceInstanceId: selectedWorkspace?.workspaceInstanceId || "",
          nowIso: getNowWithLeewayDate().toISOString(),
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
    const interval = setInterval(loadUpcoming, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [selectedWorkspace?.workspaceInstanceId, step]);

  // Fetch published map
  const fetchMapData = async (targetFloorId?: string) => {
    try {
      setMapLoading(true);
      setMapError(null);
      fetchOccupiedData();
      const url = targetFloorId
        ? `/api/published-map?floorId=${encodeURIComponent(targetFloorId)}`
        : "/api/published-map";
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load published floor map.");
      const data = await res.json();
      const floorList: Floor[] = data.floors || [];
      setFloors(floorList);
      setPublished(data.published || null);
      if (data.published?.floor?.id) {
        setFloorId(data.published.floor.id);
      } else if (floorList.length > 0 && !targetFloorId) {
        setFloorId(floorList[0].id);
      }

      if (floorList.length > 0) {
        const results = await Promise.all(
          floorList.map(async (f) => {
            try {
              const r = await fetch(`/api/published-map?floorId=${encodeURIComponent(f.id)}`, {
                cache: "no-store",
              });
              if (!r.ok) return null;
              const resData = await r.json();
              return (resData.published as PublishedFloorMap) || null;
            } catch {
              return null;
            }
          })
        );
        const validFloors = results.filter((p): p is PublishedFloorMap => Boolean(p));
        setPublishedFloors(validFloors);
      } else if (data.published) {
        setPublishedFloors([data.published]);
      }
    } catch (err: any) {
      setMapError(err.message || "Failed to load floor map.");
    } finally {
      setMapLoading(false);
    }
  };

  const allFloorWorkspaces = useMemo(() => {
    return publishedFloors.flatMap((pub) => mapPublishedFloorToWorkspaceCards(pub, occupiedInstanceIds));
  }, [publishedFloors, occupiedInstanceIds]);

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
    () => (published ? mapPublishedFloorToWorkspaceCards(published, occupiedInstanceIds) : []),
    [published, occupiedInstanceIds]
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

    const currentNow = new Date();
    fetchTemplateAvailability({
      templateId: selectedTemplate.id,
      date: todayDate,
      durationMinutes: durationHours * 60,
      startTime: nowTime,
      nowIso: currentNow.toISOString(),
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
  }, [selectedTemplate, durationHours, step, todayDate, nowTime]);

  // Spot click on map
  const handleSpotClick = (workspace: WorkspaceMapViewModel) => {
    if (occupiedInstanceIds.has(workspace.workspaceInstanceId)) return;
    setSelectedWorkspace(workspace);
    const tpl = availableTemplates.find((t) => t.id === workspace.templateId);
    if (tpl) setSelectedTemplate(tpl);
    setModalWorkspace(workspace);
    setIsModalOpen(true);
  };

  // Category select
  const handleSelectTemplate = (template: WorkspaceTemplateSummary) => {
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
    setDurationHours(2);
    setPaymentMethod("CASH");
    setCustomerFirstName("");
    setCustomerLastName("");
    setCustomerEmail("");
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
          workspaceInstanceId: selectedWorkspace.workspaceInstanceId,
          durationHours,
          durationMinutes: durationHours * 60,
          date: todayDate,
          startTime: nowTime,
          startAt: getNowWithLeewayDate().toISOString(),
          paymentMethod,
        }),
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || "Failed to create kiosk reservation.");
      }

      setReferenceCode(result.referenceCode || "DA-REF");
      setStep("code");
    } catch (err: any) {
      setSubmitError(err.message || "An unexpected error occurred. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const currentRate = selectedWorkspace?.rateAmount || selectedTemplate?.rateAmount || 0;
  const totalAmount = currentRate * durationHours;

  return (
    <SessionManager onReset={handleReset} onTimeoutWarning={() => { }}>
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
                          <span className="h-3 w-3 rounded bg-[#E0EFE4] border border-[#22c55e]" /> Available
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <span className="h-3 w-3 rounded bg-[#E2E8F0] border border-[#94a3b8]" /> Occupied
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <span className="h-3 w-3 rounded bg-[#FCF060] border border-[#f59e0b]" /> Maintenance
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <span className="h-3 w-3 rounded bg-[#F3F7F4] border border-[#94a3b8]" /> Unavailable
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
                            const isWall =
                              !isWorkspace &&
                              (el.elementRole === "STRUCTURE" ||
                                el.elementType?.toLowerCase().includes("wall") ||
                                el.elementType?.toLowerCase().includes("thin_wall") ||
                                el.elementType?.toLowerCase().includes("glass") ||
                                el.elementType?.toLowerCase().includes("separator"));

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
                                    : "#F3F7F4");

                            let bg = String(itemColor);
                            let textColor = getContrastColor(bg);

                            if (isWorkspace) {
                              const isSelected =
                                el.workspace?.workspaceInstanceId === selectedWorkspace?.workspaceInstanceId;
                              const status = el.workspace?.operationalStatus || "ACTIVE";
                              const isBookable = el.workspace?.isBookable ?? true;
                              const isOccupied = occupiedInstanceIds.has(el.workspace?.workspaceInstanceId || "");
                              const isAvailable = isBookable && status === "ACTIVE" && !isOccupied;

                              let borderColor = isSelected ? "var(--da-accent)" : "#DCE6DF";
                              let borderWidth = isSelected ? "3px" : "1.5px";
                              let borderStyle = "solid";

                              if (status === "MAINTENANCE") {
                                borderStyle = "dashed";
                                borderColor = "#f59e0b";
                                bg = "#FCF060";
                                textColor = "#92400e";
                              } else if (isOccupied) {
                                borderStyle = "solid";
                                borderColor = "#94a3b8";
                                bg = "#E2E8F0";
                                textColor = "#64748b";
                              } else if (!isAvailable) {
                                borderStyle = "dashed";
                                borderColor = "#94a3b8";
                                bg = "#F3F7F4";
                                textColor = "#64748b";
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
                                    disabled={!isAvailable}
                                    onClick={() => {
                                      if (!isAvailable) return;
                                      if (wsModel) handleSpotClick(wsModel);
                                    }}
                                    className={`group h-full w-full flex flex-col items-center justify-center p-1 text-center transition-all duration-150 relative ${
                                      isAvailable ? "hover:scale-[1.03]" : ""
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
                                    <span className="max-w-full truncate text-[11px] font-bold leading-tight">
                                      {displayName}
                                    </span>
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
                                  borderRadius: "6px",
                                  border: "1px solid rgba(0, 0, 0, 0.1)",
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
                          disabled={occupiedInstanceIds.has(selectedWorkspace.workspaceInstanceId)}
                          onClick={() => {
                            if (occupiedInstanceIds.has(selectedWorkspace.workspaceInstanceId)) return;
                            setStep("duration");
                          }}
                          className={`da-primary-button text-xs font-bold px-4 py-2 ${
                            occupiedInstanceIds.has(selectedWorkspace.workspaceInstanceId)
                              ? "opacity-50 cursor-not-allowed"
                              : ""
                          }`}
                        >
                          {occupiedInstanceIds.has(selectedWorkspace.workspaceInstanceId)
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
                    <span className="rounded-full bg-[var(--da-info)] px-3.5 py-1 text-xs font-extrabold text-[var(--da-primary)]">
                      {availableTemplates.length} Categories Available
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {availableTemplates.map((tpl) => (
                      <div
                        key={tpl.id}
                        onClick={() => handleSelectTemplate(tpl)}
                        className="group relative flex flex-col justify-between rounded-[24px] border-2 border-[var(--da-border-light)] bg-white hover:border-[var(--da-primary)] hover:shadow-lg transition-all duration-200 cursor-pointer overflow-hidden p-5"
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
                          <div className="absolute top-3 right-3">
                            <span className="rounded-full bg-white/95 backdrop-blur px-3 py-1 text-xs font-extrabold text-[var(--da-brand-dark)] shadow-sm border border-slate-200">
                              ₱{tpl.rateAmount.toFixed(2)}/hr
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
                              {tpl.instanceCount} {tpl.instanceCount === 1 ? "spot" : "spots"}
                            </span>
                          </div>
                        </div>

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
                      {selectedWorkspace?.templateName || selectedTemplate?.name} • ₱{currentRate.toFixed(2)}/hr
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

              {/* Duration Selector Card */}
              <div className="rounded-[28px] border border-[var(--da-border)] bg-white p-6 sm:p-8 shadow-[var(--da-shadow-lg)]">
                <div className="border-b border-[var(--da-border-light)] pb-4 mb-6">
                  <span className="text-xs font-bold uppercase tracking-wider text-[var(--da-primary)]">
                    Step 2 of 3 • Walk-In Duration
                  </span>
                  <h3 className="text-2xl font-extrabold text-[var(--da-brand-dark)]">
                    How many hours will you stay today?
                  </h3>
                  <p className="text-xs text-[var(--da-text-secondary)] mt-1">
                    Walk-in bookings start right now at <strong>{formatTime12Hour(nowTime)}</strong>. No backup selection required.
                  </p>
                </div>

                {/* Duration Hour Buttons */}
                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-8 gap-3">
                  {DURATION_OPTIONS.map((hours) => {
                    const isSelected = durationHours === hours;
                    const durMinutes = hours * 60;
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
                          setDurationHours(parsed > 0 ? parsed : 0);
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

                {/* Custom Hour Input Warning if Exceeds Availability, 24h Limit, or Spot Unavailable */}
                {(durationHours > MAX_KIOSK_DURATION_HOURS ||
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
                {durationHours > 0 ? (
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
                          {formatTime12Hour(nowTime)} – {formatTime12Hour(endTimeStr)} ({durationHours} {durationHours === 1 ? "hour" : "hours"})
                        </p>
                      </div>
                    </div>

                    <div className="text-right">
                      <span className="text-xs font-bold text-[var(--da-text-secondary)] block">
                        Estimated Total:
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
                      This desk has an upcoming reservation and cannot accommodate a {durationHours} {durationHours === 1 ? "hour" : "hours"} stay. Please select a shorter duration or pick another desk.
                    </span>
                  </div>
                )}

                {/* Continue Button */}
                <div className="mt-6 flex justify-end">
                  <button
                    type="button"
                    disabled={
                      !durationHours ||
                      durationHours <= 0 ||
                      durationHours > MAX_KIOSK_DURATION_HOURS ||
                      Boolean(selectedWorkspace && occupiedInstanceIds.has(selectedWorkspace.workspaceInstanceId)) ||
                      Boolean(
                        upcomingBooking?.maxAvailableMinutes !== null &&
                          upcomingBooking?.maxAvailableMinutes !== undefined &&
                          (durationHours * 60 > upcomingBooking.maxAvailableMinutes || upcomingBooking.maxAvailableMinutes < 60)
                      )
                    }
                    onClick={() => {
                      if (!durationHours || durationHours <= 0) return;
                      if (durationHours > MAX_KIOSK_DURATION_HOURS) return;
                      if (selectedWorkspace && occupiedInstanceIds.has(selectedWorkspace.workspaceInstanceId)) return;
                      if (
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
                      !durationHours ||
                      durationHours <= 0 ||
                      durationHours > MAX_KIOSK_DURATION_HOURS ||
                      Boolean(selectedWorkspace && occupiedInstanceIds.has(selectedWorkspace.workspaceInstanceId)) ||
                      Boolean(
                        upcomingBooking?.maxAvailableMinutes !== null &&
                          upcomingBooking?.maxAvailableMinutes !== undefined &&
                          (durationHours * 60 > upcomingBooking.maxAvailableMinutes || upcomingBooking.maxAvailableMinutes < 60)
                      )
                        ? "opacity-50 cursor-not-allowed"
                        : ""
                    }`}
                  >
                    {durationHours > MAX_KIOSK_DURATION_HOURS
                      ? `Duration Exceeds Maximum (Max ${MAX_KIOSK_DURATION_HOURS}h)`
                      : upcomingBooking?.maxAvailableMinutes !== null &&
                        upcomingBooking?.maxAvailableMinutes !== undefined &&
                        upcomingBooking.maxAvailableMinutes < 60
                      ? upcomingBooking.nextBooking
                        ? upcomingBooking.nextBooking.type === "SCHEDULE_BLOCK"
                          ? `Facility Closed in ${upcomingBooking.maxAvailableMinutes} mins`
                          : `Desk Unavailable: Upcoming Reservation in ${upcomingBooking.maxAvailableMinutes} mins`
                        : `Desk Unavailable: Closing in ${upcomingBooking.maxAvailableMinutes} mins`
                      : upcomingBooking?.maxAvailableMinutes !== null &&
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
                      Showing desks available right now from {formatTime12Hour(nowTime)} to {formatTime12Hour(endTimeStr)} ({durationHours}h).
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
                          </div>

                          <div className="mt-4 pt-3 border-t border-[var(--da-border-light)] flex items-center justify-between">
                            <span className="text-xs font-extrabold text-[var(--da-brand-dark)]">
                              ₱{totalAmount.toFixed(2)}{" "}
                              <span className="text-[10px] font-normal text-[var(--da-text-secondary)]">
                                ({durationHours}h)
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
                      {formatTime12Hour(nowTime)} – {formatTime12Hour(endTimeStr)}
                    </p>
                    <p className="text-[var(--da-text-secondary)]">{durationHours} {durationHours === 1 ? "Hour" : "Hours"} (Starting Now)</p>
                  </div>

                  <div className="text-left sm:text-right">
                    <span className="text-[var(--da-text-secondary)] font-bold block">Amount Due at Counter:</span>
                    <p className="text-xl font-extrabold text-[var(--da-primary)] mt-0.5">
                      ₱{totalAmount.toFixed(2)}
                    </p>
                    <p className="text-[10px] text-[var(--da-text-secondary)]">₱{selectedWorkspace.rateAmount.toFixed(2)}/hr</p>
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

                  {/* Payment Method Selection */}
                  <div>
                    <label className="block text-xs font-bold text-[var(--da-brand-dark)] mb-1.5">
                      Counter Payment Method <span className="text-red-500">*</span>
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => setPaymentMethod("CASH")}
                        className={`flex items-center gap-3 rounded-2xl border p-3.5 text-left transition-all ${
                          paymentMethod === "CASH"
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
                        className={`flex items-center gap-3 rounded-2xl border p-3.5 text-left transition-all ${
                          paymentMethod === "COUNTER_QR"
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
          isOccupied={Boolean(modalWorkspace && occupiedInstanceIds.has(modalWorkspace.workspaceInstanceId))}
          open={isModalOpen}
          onOpenChange={setIsModalOpen}
          onProceed={(ws) => {
            if (occupiedInstanceIds.has(ws.workspaceInstanceId)) return;
            setSelectedWorkspace(ws);
            setIsModalOpen(false);
            setStep("duration");
          }}
        />
      </main>
    </SessionManager>
  );
}
