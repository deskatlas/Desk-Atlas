import { useState, useEffect, useRef } from "react";
import { Link } from "react-router";
import { Filter, X, Calendar as CalendarIcon, ChevronDown } from "lucide-react";
import { WorkspaceMap } from "../components/WorkspaceMap";
import { WorkspaceDetailPanel } from "../components/WorkspaceDetailPanel";
import { DayPicker } from "react-day-picker";
import { fetchPublishedMap } from "../lib/publishedMapApi";
import {
  fetchDateAvailability,
  fetchTimeAvailability,
} from "../lib/availabilityApi";
import type { Floor } from "@deskatlas/domain";
import { handleNumericKeyDown } from "@deskatlas/ui";
import "react-day-picker/dist/style.css";

export interface Workspace {
  id: string;
  workspaceInstanceId: string;
  name: string;
  type: "zone-a" | "zone-b" | "meeting-room" | "booth";
  status: "available" | "reserved" | "occupied" | "unavailable";
  description: string;
  rate: string;
  image: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function WorkspaceDiscoveryPage() {
  const [floors, setFloors] = useState<Floor[]>([]);
  const [selectedFloorId, setSelectedFloorId] = useState("");
  const [selectedWorkspace, setSelectedWorkspace] = useState<Workspace | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [calendarMonth, setCalendarMonth] = useState<Date>(new Date());
  const [showCalendar, setShowCalendar] = useState(false);
  const [showTimeDropdown, setShowTimeDropdown] = useState(false);
  const [filters, setFilters] = useState({
    type: "all",
    time: "09:00",
    duration: "4",
    availableOnly: false,
  });
  const [showFilters, setShowFilters] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>(() => generateFallbackWorkspaces());
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [availableTimes, setAvailableTimes] = useState<string[]>([]);
  const [mapLoadState, setMapLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [mapError, setMapError] = useState("");
  const [mapReloadToken, setMapReloadToken] = useState(0);

  const calendarRef = useRef<HTMLDivElement>(null);
  const timeDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (calendarRef.current && !calendarRef.current.contains(event.target as Node)) {
        setShowCalendar(false);
      }
      if (timeDropdownRef.current && !timeDropdownRef.current.contains(event.target as Node)) {
        setShowTimeDropdown(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  useEffect(() => {
    if (!selectedWorkspace) {
      setAvailableDates([]);
      return;
    }

    const durationHours = Number(filters.duration);
    if (!Number.isFinite(durationHours) || durationHours <= 0) {
      setAvailableDates([]);
      return;
    }

    let isMounted = true;
    const monthStart = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
    const monthEnd = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0);

    fetchDateAvailability({
      workspaceInstanceId: selectedWorkspace.workspaceInstanceId,
      startDate: formatDate(monthStart),
      endDate: formatDate(monthEnd),
      durationMinutes: durationHours * 60,
    })
      .then((result) => {
        if (!isMounted) return;
        setAvailableDates(result.dates.filter((date) => date.isAvailable).map((date) => date.date));
      })
      .catch((error) => {
        console.warn("Unable to load customer date availability", error);
        if (isMounted) {
          setAvailableDates([]);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [calendarMonth, filters.duration, selectedWorkspace]);

  useEffect(() => {
    if (!selectedWorkspace) {
      setAvailableTimes([]);
      return;
    }

    const durationHours = Number(filters.duration);
    if (!Number.isFinite(durationHours) || durationHours <= 0) {
      setAvailableTimes([]);
      return;
    }

    let isMounted = true;
    fetchTimeAvailability({
      workspaceInstanceId: selectedWorkspace.workspaceInstanceId,
      date: formatDate(selectedDate),
      durationMinutes: durationHours * 60,
    })
      .then((result) => {
        if (!isMounted) return;
        const nextTimes = result.slots.filter((slot) => slot.isAvailable).map((slot) => slot.startTime);
        setAvailableTimes(nextTimes);
        if (nextTimes.length > 0 && !nextTimes.includes(filters.time)) {
          setFilters((current) => ({ ...current, time: nextTimes[0] }));
        }
      })
      .catch((error) => {
        console.warn("Unable to load customer time availability", error);
        if (isMounted) {
          setAvailableTimes([]);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [filters.duration, filters.time, selectedDate, selectedWorkspace]);

  useEffect(() => {
    let isMounted = true;
    setMapLoadState("loading");
    setMapError("");

    fetchPublishedMap(selectedFloorId || undefined)
      .then(({ floors: nextFloors, published }) => {
        if (!isMounted) return;
        setFloors(nextFloors);
        setSelectedFloorId((current) => current || published.floor.id);
        const publishedWorkspaces = mapPublishedFloorMapToWorkspaces(published);
        setWorkspaces(publishedWorkspaces);
        setSelectedWorkspace(null);
        setMapLoadState("ready");
      })
      .catch((error) => {
        if (!isMounted) return;
        console.warn("Unable to load published customer map", error);
        setMapLoadState("error");
        setMapError(error instanceof Error ? error.message : "Unable to load the workspace map.");
      });

    return () => {
      isMounted = false;
    };
  }, [mapReloadToken, selectedFloorId]);

  const timeSlots = [
    "07:00", "07:30", "08:00", "08:30", "09:00", "09:30",
    "10:00", "10:30", "11:00", "11:30", "12:00", "12:30",
    "13:00", "13:30", "14:00", "14:30", "15:00", "15:30",
    "16:00", "16:30", "17:00", "17:30", "18:00", "18:30",
    "19:00", "19:30", "20:00", "20:30", "21:00", "21:30"
  ];

  const filteredWorkspaces = workspaces.filter((workspace) => {
    if (filters.type !== "all" && workspace.type !== filters.type) return false;
    if (filters.availableOnly && workspace.status !== "available") return false;
    return true;
  });

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <h1 className="text-3xl font-semibold text-gray-900 mb-2">Discover Workspaces</h1>
          <p className="text-gray-600">
            Select a workspace from the interactive map to view details and reserve
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="md:hidden flex items-center gap-2 px-4 py-2 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors mb-4"
          >
            <Filter className="w-4 h-4" />
            Filters
          </button>

          <div
            className={`${
              showFilters ? "block" : "hidden"
            } md:flex flex-wrap gap-4 items-end`}
          >
            <div className="flex-1 min-w-[200px]">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Floor
              </label>
              <select
                value={selectedFloorId}
                onChange={(e) => setSelectedFloorId(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                disabled={floors.length === 0 || mapLoadState === "loading"}
              >
                {floors.length === 0 ? (
                  <option value="">Default Floor</option>
                ) : (
                  floors.map((floor) => (
                    <option key={floor.id} value={floor.id}>
                      {floor.name}
                    </option>
                  ))
                )}
              </select>
            </div>

            <div className="flex-1 min-w-[200px]">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Workspace Type
              </label>
              <select
                value={filters.type}
                onChange={(e) => setFilters({ ...filters, type: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              >
                <option value="all">All Types</option>
                <option value="zone-a">Zone A</option>
                <option value="zone-b">Zone B</option>
                <option value="meeting-room">Meeting Room</option>
                <option value="booth">Booth</option>
              </select>
            </div>

            <div className="flex-1 min-w-[200px] relative" ref={calendarRef}>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
              <button
                onClick={() => setShowCalendar(!showCalendar)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 flex items-center justify-between bg-white hover:bg-gray-50"
              >
                <span>{selectedDate.toLocaleDateString()}</span>
                <CalendarIcon className="w-4 h-4 text-gray-500" />
              </button>
              {showCalendar && (
                <div className="absolute top-full mt-2 z-50 bg-white border border-gray-300 rounded-lg shadow-lg p-4">
                  <DayPicker
                    mode="single"
                    month={calendarMonth}
                    onMonthChange={setCalendarMonth}
                    selected={selectedDate}
                    onSelect={(date) => {
                      if (date) {
                        setSelectedDate(date);
                        setShowCalendar(false);
                      }
                    }}
                    disabled={(date) => {
                      const today = new Date();
                      today.setHours(0, 0, 0, 0);
                      if (date < today) return true;
                      if (!selectedWorkspace) return false;
                      return !availableDates.includes(formatDate(date));
                    }}
                    className="rdp-custom"
                  />
                </div>
              )}
            </div>

            <div className="flex-1 min-w-[200px] relative" ref={timeDropdownRef}>
              <label className="block text-sm font-medium text-gray-700 mb-1">Time</label>
              <button
                onClick={() => setShowTimeDropdown(!showTimeDropdown)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 flex items-center justify-between bg-white hover:bg-gray-50"
              >
                <span>{filters.time}</span>
                <ChevronDown className="w-4 h-4 text-gray-500" />
              </button>
              {showTimeDropdown && (
                <div className="absolute top-full mt-2 z-50 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto w-full">
                  {timeSlots.map((time) => (
                    <button
                      key={time}
                      onClick={() => {
                        if (selectedWorkspace && !availableTimes.includes(time)) {
                          return;
                        }
                        setFilters({ ...filters, time });
                        setShowTimeDropdown(false);
                      }}
                      className={`w-full px-4 py-2 text-left hover:bg-gray-100 ${
                        filters.time === time ? "bg-teal-50 text-teal-600" : "text-gray-700"
                      }`}
                      disabled={Boolean(selectedWorkspace) && !availableTimes.includes(time)}
                    >
                      {time}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex-1 min-w-[200px]">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Duration (hours)
              </label>
              <input
                type="number"
                min="1"
                max="12"
                value={filters.duration}
                onChange={(e) => setFilters({ ...filters, duration: e.target.value })}
                onBlur={() => {
                  if (!filters.duration || Number(filters.duration) < 1) {
                    setFilters({ ...filters, duration: "1" });
                  }
                }}
                onKeyDown={(e) => handleNumericKeyDown(e)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              />
            </div>

            <div className="flex items-center gap-2 py-2">
              <input
                type="checkbox"
                id="available-only"
                checked={filters.availableOnly}
                onChange={(e) =>
                  setFilters({ ...filters, availableOnly: e.target.checked })
                }
                className="w-4 h-4 text-teal-600 rounded focus:ring-2 focus:ring-teal-500"
              />
              <label htmlFor="available-only" className="text-sm font-medium text-gray-700">
                Available Only
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* Map and Detail Panel */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {mapLoadState === "loading" && (
          <div className="mb-6 rounded-xl border border-teal-200 bg-teal-50 p-4">
            <p className="text-sm font-medium text-teal-900">Loading published workspace map...</p>
            <p className="text-sm text-teal-700 mt-1">DeskAtlas is fetching the latest published floor geometry.</p>
          </div>
        )}

        {mapLoadState === "error" && (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-medium text-red-900">Published map unavailable</p>
              <p className="text-sm text-red-700 mt-1">{mapError}</p>
            </div>
            <button
              onClick={() => setMapReloadToken((current) => current + 1)}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
            >
              Retry
            </button>
          </div>
        )}

        <div className="flex flex-col lg:flex-row gap-6">
          {/* Map */}
          <div className="flex-1">
            {mapLoadState === "error" ? (
              <div className="bg-white rounded-xl shadow-md border border-gray-200 p-10 text-center">
                <p className="text-lg font-semibold text-gray-900">No published map to display</p>
                <p className="text-sm text-gray-600 mt-2">
                  The current floor map could not be loaded. Try again or choose another floor when available.
                </p>
              </div>
            ) : filteredWorkspaces.length === 0 && mapLoadState === "ready" ? (
              <div className="bg-white rounded-xl shadow-md border border-gray-200 p-10 text-center">
                <p className="text-lg font-semibold text-gray-900">This floor has no published workspaces</p>
                <p className="text-sm text-gray-600 mt-2">
                  Select another floor or wait for Admin to publish workspace geometry for this floor.
                </p>
              </div>
            ) : (
              <WorkspaceMap
                workspaces={filteredWorkspaces}
                selectedWorkspace={selectedWorkspace}
                onSelectWorkspace={setSelectedWorkspace}
              />
            )}
          </div>

          {/* Detail Panel */}
          {selectedWorkspace && (
            <div className="lg:w-96">
              <WorkspaceDetailPanel
                workspace={selectedWorkspace}
                onClose={() => setSelectedWorkspace(null)}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function generateFallbackWorkspaces(): Workspace[] {
  const workspaces: Workspace[] = [];

  for (let i = 1; i <= 12; i++) {
    const column = (i - 1) % 4;
    const row = Math.floor((i - 1) / 4);
    workspaces.push({
      id: `A${i}`,
      workspaceInstanceId: `A${i}`,
      name: `Zone A - Desk ${i}`,
      type: "zone-a",
      status: i === 3 ? "unavailable" : i === 5 ? "reserved" : i === 8 ? "occupied" : i === 11 ? "unavailable" : "available",
      description: "Shared workspace with high-speed WiFi and power outlets",
      rate: "$15/day",
      image: "https://images.unsplash.com/photo-1562664348-2188b99b5157?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHw3fHxjb3dvcmtpbmclMjBzcGFjZSUyMG1vZGVybnxlbnwxfHx8fDE3Nzg4NTMzNzR8MA&ixlib=rb-4.1.0&q=80&w=1080",
      x: 180 + column * 88,
      y: 120 + row * 88,
      width: 72,
      height: 72,
    });
  }

  for (let i = 1; i <= 12; i++) {
    const column = (i - 1) % 4;
    const row = Math.floor((i - 1) / 4);
    workspaces.push({
      id: `B${i}`,
      workspaceInstanceId: `B${i}`,
      name: `Zone B - Desk ${i}`,
      type: "zone-b",
      status: i === 4 ? "reserved" : i === 10 ? "unavailable" : i === 11 ? "unavailable" : "available",
      description: "Shared workspace with high-speed WiFi and power outlets",
      rate: "$15/day",
      image: "https://images.unsplash.com/photo-1562664348-2188b99b5157?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHw3fHxjb3dvcmtpbmclMjBzcGFjZSUyMG1vZGVybnxlbnwxfHx8fDE3Nzg4NTMzNzR8MA&ixlib=rb-4.1.0&q=80&w=1080",
      x: 820 + column * 88,
      y: 120 + row * 88,
      width: 72,
      height: 72,
    });
  }

  workspaces.push(
    {
      id: "Meeting-1",
      workspaceInstanceId: "Meeting-1",
      name: "Meeting Room 1",
      type: "meeting-room",
      status: "available",
      description: "Private room for 4-8 people with AV equipment",
      rate: "$60/hour",
      image: "https://images.unsplash.com/photo-1600508774634-4e11d34730e2?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwzfHxjb3dvcmtpbmclMjBzcGFjZSUyMG1vZGVybnxlbnwxfHx8fDE3Nzg4NTMzNzR8MA&ixlib=rb-4.1.0&q=80&w=1080",
      x: 360,
      y: 420,
      width: 156,
      height: 100,
    },
    {
      id: "Meeting-2",
      workspaceInstanceId: "Meeting-2",
      name: "Meeting Room 2",
      type: "meeting-room",
      status: "reserved",
      description: "Private room for 4-8 people with AV equipment",
      rate: "$60/hour",
      image: "https://images.unsplash.com/photo-1600508774634-4e11d34730e2?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwzfHxjb3dvcmtpbmclMjBzcGFjZSUyMG1vZGVybnxlbnwxfHx8fDE3Nzg4NTMzNzR8MA&ixlib=rb-4.1.0&q=80&w=1080",
      x: 532,
      y: 420,
      width: 156,
      height: 100,
    },
    {
      id: "Meeting-3",
      workspaceInstanceId: "Meeting-3",
      name: "Meeting Room 3",
      type: "meeting-room",
      status: "available",
      description: "Private room for 4-8 people with AV equipment",
      rate: "$60/hour",
      image: "https://images.unsplash.com/photo-1600508774634-4e11d34730e2?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwzfHxjb3dvcmtpbmclMjBzcGFjZSUyMG1vZGVybnxlbnwxfHx8fDE3Nzg4NTMzNzR8MA&ixlib=rb-4.1.0&q=80&w=1080",
      x: 704,
      y: 420,
      width: 156,
      height: 100,
    },
    {
      id: "Booth-1",
      workspaceInstanceId: "Booth-1",
      name: "Booth 1",
      type: "booth",
      status: "available",
      description: "Private booth for focused work",
      rate: "$25/day",
      image: "https://images.unsplash.com/photo-1626187777040-ffb7cb2c5450?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxMHx8Y293b3JraW5nJTIwc3BhY2UlMjBtb2Rlcm58ZW58MXx8fHwxNzc4ODUzMzc0fDA&ixlib=rb-4.1.0&q=80&w=1080",
      x: 876,
      y: 420,
      width: 156,
      height: 100,
    },
    {
      id: "Booth-2",
      workspaceInstanceId: "Booth-2",
      name: "Booth 2",
      type: "booth",
      status: "available",
      description: "Private booth for focused work",
      rate: "$25/day",
      image: "https://images.unsplash.com/photo-1626187777040-ffb7cb2c5450?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxMHx8Y293b3JraW5nJTIwc3BhY2UlMjBtb2Rlcm58ZW58MXx8fHwxNzc4ODUzMzc0fDA&ixlib=rb-4.1.0&q=80&w=1080",
      x: 1048,
      y: 420,
      width: 156,
      height: 100,
    }
  );

  return workspaces;
}

function mapPublishedFloorMapToWorkspaces(
  published: Awaited<ReturnType<typeof fetchPublishedMap>>["published"]
): Workspace[] {
  return published.elements
    .filter((element) => element.elementRole === "WORKSPACE" && element.workspace)
    .map((element) => {
      const workspace = element.workspace!;
      return {
        id: workspace.instanceCode,
        workspaceInstanceId: workspace.workspaceInstanceId,
        name: workspace.displayName,
        type: mapCustomerWorkspaceType(element.elementType, element.style, workspace.instanceCode),
        status: workspace.isBookable ? "available" : "unavailable",
        description: workspace.description ?? "Workspace details coming soon",
        rate: formatRate(workspace.rateAmount, workspace.pricingUnit),
        image:
          workspace.photoPath && workspace.photoPath.length > 0
            ? workspace.photoPath
            : "https://images.unsplash.com/photo-1562664348-2188b99b5157?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHw3fHxjb3dvcmtpbmclMjBzcGFjZSUyMG1vZGVybnxlbnwxfHx8fDE3Nzg4NTMzNzR8MA&ixlib=rb-4.1.0&q=80&w=1080",
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
      };
    });
}

function formatDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

function mapCustomerWorkspaceType(
  elementType: string,
  style: Record<string, string | number | boolean | null>,
  instanceCode: string
): Workspace["type"] {
  if (elementType === "meeting-room") return "meeting-room";
  if (elementType === "phone-booth") return "booth";
  if (typeof style.zone === "string") {
    if (style.zone.toLowerCase().includes("zone b")) return "zone-b";
    if (style.zone.toLowerCase().includes("zone a")) return "zone-a";
  }
  return instanceCode.toUpperCase().startsWith("B") ? "zone-b" : "zone-a";
}

function formatRate(rateAmount: number, pricingUnit: "HOURLY"): string {
  return pricingUnit === "HOURLY" ? `$${rateAmount}/hour` : `$${rateAmount}`;
}
