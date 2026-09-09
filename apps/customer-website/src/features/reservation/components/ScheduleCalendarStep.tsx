"use client";

import { useEffect, useMemo, useState } from "react";
import {
  type WorkspaceMapViewModel,
  getWorkspacePhotoObjectPosition,
} from "@/features/workspace-discovery";
import type { AvailableTimeSlot, AvailableDate } from "@deskatlas/domain";
import { fetchDateAvailability, fetchTimeAvailability } from "@/app/lib/availabilityApi";

interface ScheduleCalendarStepProps {
  workspace: WorkspaceMapViewModel;
  onBackToMap: () => void;
  onContinue: (schedule: {
    date: string;
    durationHours: number;
    startTime: string;
    endTime: string;
  }) => void;
  candidateRank?: 0 | 1 | 2;
  lockedSchedule?: {
    date: string;
    durationHours: number;
    initialStartTime?: string;
    excludedStartTimes?: string[];
  };
}

// Format 24-hour HH:mm to friendly 12-hour (e.g. "09:00" -> "9:00 AM", "13:00" -> "1:00 PM")
function formatTime12Hour(time24: string): string {
  const [hStr, mStr] = time24.split(":");
  let hour = parseInt(hStr, 10);
  const minute = mStr || "00";
  const period = hour >= 12 ? "PM" : "AM";
  if (hour === 0) hour = 12;
  else if (hour > 12) hour -= 12;
  return `${hour}:${minute} ${period}`;
}

// Format YYYY-MM-DD to "Monday, Aug 31, 2026"
function formatDateDisplay(dateStr: string): string {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-").map(Number);
  const dateObj = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return dateObj.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

// Get today's date in Manila timezone (YYYY-MM-DD)
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

export function ScheduleCalendarStep({
  workspace,
  onBackToMap,
  onContinue,
  candidateRank = 0,
  lockedSchedule,
}: ScheduleCalendarStepProps) {
  const todayStr = useMemo(() => getTodayManila(), []);
  const [todayYear, todayMonth] = useMemo(() => todayStr.split("-").map(Number), [todayStr]);
  const initialDate = lockedSchedule?.date || todayStr;
  const [initialYear, initialMonth] = initialDate.split("-").map(Number);

  const [viewYear, setViewYear] = useState<number>(initialYear);
  const [viewMonth, setViewMonth] = useState<number>(initialMonth); // 1-12

  const excludedStartTimes = useMemo(() => lockedSchedule?.excludedStartTimes || [], [lockedSchedule]);
  const initialStartTimeVal =
    lockedSchedule?.initialStartTime && !excludedStartTimes.includes(lockedSchedule.initialStartTime)
      ? lockedSchedule.initialStartTime
      : null;

  const [selectedDate, setSelectedDate] = useState<string>(initialDate);
  const [selectedDurationHours, setSelectedDurationHours] = useState<number>(
    lockedSchedule?.durationHours || 2
  );
  const [selectedStartTime, setSelectedStartTime] = useState<string | null>(initialStartTimeVal);

  const [monthAvailability, setMonthAvailability] = useState<Record<string, AvailableDate>>({});
  const [loadingDates, setLoadingDates] = useState(false);

  const [timeSlots, setTimeSlots] = useState<AvailableTimeSlot[]>([]);
  const [loadingTimes, setLoadingTimes] = useState(false);
  const [timeError, setTimeError] = useState<string | null>(null);

  // Month bounds
  const startDateOfMonth = `${viewYear}-${String(viewMonth).padStart(2, "0")}-01`;
  const daysInViewMonth = new Date(Date.UTC(viewYear, viewMonth, 0)).getUTCDate();
  const endDateOfMonth = `${viewYear}-${String(viewMonth).padStart(2, "0")}-${String(
    daysInViewMonth
  ).padStart(2, "0")}`;

  // First day offset (0 = Sunday, 1 = Monday, etc.)
  const firstDayOfWeek = new Date(Date.UTC(viewYear, viewMonth - 1, 1)).getUTCDay();

  const isCurrentOrPastMonth =
    viewYear < todayYear || (viewYear === todayYear && viewMonth <= todayMonth);

  // Fetch month date availability
  useEffect(() => {
    let cancelled = false;
    setLoadingDates(true);

    fetchDateAvailability({
      workspaceInstanceId: workspace.workspaceInstanceId,
      startDate: startDateOfMonth,
      endDate: endDateOfMonth,
      durationMinutes: selectedDurationHours * 60,
    })
      .then((res) => {
        if (cancelled) return;
        const dateMap: Record<string, AvailableDate> = {};
        for (const item of res.dates) {
          dateMap[item.date] = item;
        }
        setMonthAvailability(dateMap);
      })
      .catch(() => {
        if (!cancelled) setMonthAvailability({});
      })
      .finally(() => {
        if (!cancelled) setLoadingDates(false);
      });

    return () => {
      cancelled = true;
    };
  }, [workspace.workspaceInstanceId, startDateOfMonth, endDateOfMonth, selectedDurationHours]);

  // Fetch time slots for selected date & duration
  useEffect(() => {
    if (!selectedDate || selectedDurationHours <= 0) {
      setTimeSlots([]);
      setSelectedStartTime(null);
      return;
    }

    let cancelled = false;
    setLoadingTimes(true);
    setTimeError(null);

    fetchTimeAvailability({
      workspaceInstanceId: workspace.workspaceInstanceId,
      date: selectedDate,
      durationMinutes: selectedDurationHours * 60,
    })
      .then((res) => {
        if (cancelled) return;
        setTimeSlots(res.slots || []);
        // Reset selected start time if current selection is no longer valid/available or is excluded
        setSelectedStartTime((curr) => {
          if (!curr) return null;
          if (excludedStartTimes.includes(curr)) return null;
          const found = res.slots?.find((s) => s.startTime === curr && s.isAvailable);
          return found ? curr : null;
        });
      })
      .catch((err) => {
        if (!cancelled) {
          setTimeError(err instanceof Error ? err.message : "Unable to load available times.");
          setTimeSlots([]);
          setSelectedStartTime(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingTimes(false);
      });

    return () => {
      cancelled = true;
    };
  }, [workspace.workspaceInstanceId, selectedDate, selectedDurationHours]);

  const handlePrevMonth = () => {
    if (isCurrentOrPastMonth) return;
    if (viewMonth === 1) {
      setViewYear((y) => y - 1);
      setViewMonth(12);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (viewMonth === 12) {
      setViewYear((y) => y + 1);
      setViewMonth(1);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const monthLabel = useMemo(() => {
    const d = new Date(Date.UTC(viewYear, viewMonth - 1, 1));
    return d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  }, [viewYear, viewMonth]);


  const selectedSlot = useMemo(() => {
    if (!selectedStartTime) return null;
    const found = timeSlots.find((s) => s.startTime === selectedStartTime);
    if (found) return found;
    // Fallback if not found in cached slots
    const [h, m] = selectedStartTime.split(":").map(Number);
    const endMinutes = h * 60 + m + selectedDurationHours * 60;
    const endH = Math.floor(endMinutes / 60);
    const endM = endMinutes % 60;
    const endTime = `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;
    return {
      startTime: selectedStartTime,
      endTime,
      isAvailable: true,
      blockingReason: null,
    };
  }, [timeSlots, selectedStartTime, selectedDurationHours]);

  const totalPrice = workspace.rateAmount * selectedDurationHours;


  const handleContinue = () => {
    if (!selectedDate || !selectedStartTime || !selectedSlot) return;
    onContinue({
      date: selectedDate,
      durationHours: selectedDurationHours,
      startTime: selectedStartTime,
      endTime: selectedSlot.endTime,
    });
  };

  return (
    <div className="w-full flex flex-col gap-6">
      {/* Context Banner & Selected Spot Details */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-[24px] border border-[var(--da-border)] bg-white p-4 sm:p-6 shadow-[var(--da-shadow-md)]">
        <div className="flex items-center gap-4">
          {workspace.photoPath ? (
            <img
              src={workspace.photoPath}
              alt={workspace.displayName}
              className="h-16 w-16 rounded-2xl object-cover border border-[var(--da-border-light)]"
              style={{
                objectPosition: getWorkspacePhotoObjectPosition(workspace.photoPosition),
              }}
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--da-canvas)] border border-[var(--da-border-light)] text-2xl">
              🏢
            </div>
          )}
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-[var(--da-primary)]">
                Selected Spot
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-extrabold text-[var(--da-brand-dark)]">
              {workspace.displayName}
            </h2>
            <p className="text-xs font-medium text-[var(--da-text-secondary)] mt-0.5">
              {workspace.templateName} • {workspace.floorName} • Capacity: {workspace.capacity} seat
              {workspace.capacity > 1 ? "s" : ""} •{" "}
              <span className="font-bold text-[var(--da-brand-dark)]">
                ₱{workspace.rateAmount}/hr
              </span>
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onBackToMap}
          className="da-secondary-button px-4 py-2 text-xs font-bold shrink-0"
        >
          ← Change Spot
        </button>
      </div>

      {/* Main Scheduling Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Calendar & Duration Selector (7 Cols) */}
        <div className="lg:col-span-7 flex flex-col gap-6">
          {/* Calendar Card */}
          <div className="rounded-[24px] border border-[var(--da-border)] bg-white p-5 sm:p-6 shadow-[var(--da-shadow-md)]">
            <div className="flex items-center justify-between border-b border-[var(--da-border-light)] pb-4 mb-4">
              <div>
                <h3 className="text-base font-extrabold text-[var(--da-brand-dark)] flex items-center gap-2">
                  1. {lockedSchedule ? "Booking Date (Locked)" : "Select Date"}
                  {candidateRank > 0 ? (
                    <span className="rounded-full bg-amber-50 border border-amber-200 px-2.5 py-0.5 text-[10px] font-bold text-amber-800">
                      Backup {candidateRank}
                    </span>
                  ) : null}
                </h3>
                {lockedSchedule ? (
                  <p className="text-xs text-[var(--da-text-secondary)]">
                    Backups must use the same date ({formatDateDisplay(lockedSchedule.date)}) as your Main selection.
                  </p>
                ) : null}
              </div>

              {/* Month Navigation */}
              {!lockedSchedule ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handlePrevMonth}
                    disabled={isCurrentOrPastMonth}
                    className={`flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--da-border)] bg-white text-sm font-bold transition ${
                      isCurrentOrPastMonth
                        ? "opacity-30 cursor-not-allowed bg-slate-50"
                        : "hover:bg-slate-50 text-[var(--da-brand-dark)]"
                    }`}
                    aria-label="Previous month"
                  >
                    ←
                  </button>
                  <span className="min-w-[130px] text-center text-xs font-bold text-[var(--da-brand-dark)]">
                    {monthLabel}
                  </span>
                  <button
                    type="button"
                    onClick={handleNextMonth}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--da-border)] bg-white text-sm font-bold hover:bg-slate-50 text-[var(--da-brand-dark)] transition"
                    aria-label="Next month"
                  >
                    →
                  </button>
                </div>
              ) : (
                <span className="text-xs font-bold text-[var(--da-primary)] bg-[var(--da-info)] px-3 py-1 rounded-full">
                  Locked to Main
                </span>
              )}
            </div>

            {/* Weekday Header */}
            <div className="grid grid-cols-7 gap-1 text-center mb-2 text-[11px] font-bold uppercase tracking-wider text-[var(--da-text-secondary)]">
              <span>Sun</span>
              <span>Mon</span>
              <span>Tue</span>
              <span>Wed</span>
              <span>Thu</span>
              <span>Fri</span>
              <span>Sat</span>
            </div>

            {/* Days Grid */}
            <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
              {/* Empty leading cells */}
              {Array.from({ length: firstDayOfWeek }).map((_, idx) => (
                <div key={`empty-${idx}`} className="h-10 sm:h-12" />
              ))}

              {/* Days of Month */}
              {Array.from({ length: daysInViewMonth }).map((_, idx) => {
                const dayNum = idx + 1;
                const dateStr = `${viewYear}-${String(viewMonth).padStart(2, "0")}-${String(
                  dayNum
                ).padStart(2, "0")}`;

                const isPast = dateStr < todayStr;
                const isToday = dateStr === todayStr;
                const isSelected = dateStr === selectedDate;

                const dayAvail = monthAvailability[dateStr];
                const isClosed = dayAvail && !dayAvail.isAvailable && dayAvail.reason === "BUSINESS_CLOSED";
                const isBlocked = dayAvail && !dayAvail.isAvailable && dayAvail.reason === "BLOCKED";
                const isUnavailable = isPast || isClosed || isBlocked || (Boolean(lockedSchedule) && !isSelected);

                return (
                  <button
                    key={dateStr}
                    type="button"
                    disabled={isUnavailable}
                    onClick={() => {
                      if (!lockedSchedule) {
                        setSelectedDate(dateStr);
                      }
                    }}
                    className={`group relative flex h-10 sm:h-12 flex-col items-center justify-center rounded-xl text-xs font-bold transition-all ${
                      isSelected
                        ? "bg-[var(--da-primary)] text-white shadow-md ring-2 ring-[var(--da-accent)]"
                        : isPast
                        ? "opacity-30 cursor-not-allowed bg-slate-50 text-slate-400"
                        : isClosed || isBlocked || Boolean(lockedSchedule)
                        ? "opacity-45 cursor-not-allowed bg-slate-50 text-slate-400 border border-slate-100"
                        : "bg-[var(--da-canvas)] text-[var(--da-brand-dark)] hover:bg-[var(--da-info)] hover:border-[var(--da-primary)] border border-transparent"
                    }`}
                  >
                    <span>{dayNum}</span>
                    {isToday && !isSelected ? (
                      <span className="h-1 w-1 rounded-full bg-[var(--da-primary)] mt-0.5" />
                    ) : null}
                    {isClosed ? (
                      <span className="text-[8px] font-semibold opacity-75">Closed</span>
                    ) : null}
                  </button>
                );
              })}
            </div>

            {loadingDates ? (
              <p className="mt-3 text-center text-xs text-[var(--da-text-secondary)] italic">
                Refreshing calendar availability...
              </p>
            ) : null}
          </div>

          {/* Duration Selector Card (Customer chooses hours FIRST) */}
          <div className="rounded-[24px] border border-[var(--da-border)] bg-white p-5 sm:p-6 shadow-[var(--da-shadow-md)]">
            <div className="flex items-center justify-between border-b border-[var(--da-border-light)] pb-3 mb-4">
              <div>
                <h3 className="text-base font-extrabold text-[var(--da-brand-dark)]">
                  2. {lockedSchedule ? "Duration (Locked to Main)" : "Choose Duration (Hours)"}
                </h3>
                <p className="text-xs text-[var(--da-text-secondary)]">
                  {lockedSchedule
                    ? `Backups must use the exact same duration (${lockedSchedule.durationHours} hrs) as Main.`
                    : "Choose how many hours you need before selecting start time."}
                </p>
              </div>
              <span className="rounded-full bg-[var(--da-info)] px-3 py-1 text-xs font-extrabold text-[var(--da-primary)]">
                {selectedDurationHours} {selectedDurationHours === 1 ? "Hour" : "Hours"}
              </span>
            </div>

            <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
              {DURATION_OPTIONS.map((hours) => {
                const isSelected = selectedDurationHours === hours;
                const isDisabled = Boolean(lockedSchedule) && !isSelected;
                return (
                  <button
                    key={hours}
                    type="button"
                    disabled={isDisabled}
                    onClick={() => {
                      if (!lockedSchedule) {
                        setSelectedDurationHours(hours);
                      }
                    }}
                    className={`flex flex-col items-center justify-center py-2.5 px-2 rounded-xl text-xs font-bold transition ${
                      isSelected
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
          </div>
        </div>

        {/* Right Column: Start Time & Summary Box (5 Cols) */}
        <div className="lg:col-span-5 flex flex-col gap-6">
          {/* Start Time Selector Card */}
          <div className="rounded-[24px] border border-[var(--da-border)] bg-white p-5 sm:p-6 shadow-[var(--da-shadow-md)]">
            <div className="border-b border-[var(--da-border-light)] pb-3 mb-4">
              <h3 className="text-base font-extrabold text-[var(--da-brand-dark)]">
                3. Choose Start Time
                {candidateRank > 0 ? ` for Backup ${candidateRank}` : ""}
              </h3>
              <p className="text-xs text-[var(--da-text-secondary)] mt-0.5">
                {formatDateDisplay(selectedDate)} • {selectedDurationHours} hr
                {selectedDurationHours > 1 ? "s" : ""}
                {candidateRank > 0 ? " (start time may differ from Main)" : ""}
              </p>
            </div>

            {loadingTimes ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="h-7 w-7 animate-spin rounded-full border-2 border-[var(--da-primary)] border-t-transparent mb-2" />
                <p className="text-xs font-semibold text-[var(--da-text-secondary)]">
                  Computing available start times...
                </p>
              </div>
            ) : timeError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-700">
                <p className="font-bold">Unable to load times</p>
                <p className="mt-0.5">{timeError}</p>
              </div>
            ) : timeSlots.length === 0 ? (
              <div className="rounded-xl bg-[var(--da-canvas)] border border-[var(--da-border-light)] p-6 text-center">
                <p className="text-xs font-bold text-[var(--da-brand-dark)]">
                  No slots available on this date
                </p>
                <p className="mt-1 text-[11px] text-[var(--da-text-secondary)]">
                  The business may be closed or operating hours do not accommodate a{" "}
                  {selectedDurationHours}-hour booking. Please pick another date or spot.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-2 max-h-[240px] overflow-y-auto pr-1">
                  {timeSlots.map((slot) => {
                    const isExcluded = excludedStartTimes.includes(slot.startTime);
                    const isSelected = selectedStartTime === slot.startTime;
                    const isAvailable = slot.isAvailable && !isExcluded;

                    let reasonLabel = "Reserved";
                    if (isExcluded) reasonLabel = "Already Selected";
                    else if (slot.blockingReason === "PAST_TIME") reasonLabel = "Past";
                    else if (slot.blockingReason === "BUSINESS_CLOSED") reasonLabel = "Closed";
                    else if (slot.blockingReason === "SCHEDULE_BLOCKED") reasonLabel = "Blocked";

                    return (
                      <button
                        key={slot.startTime}
                        type="button"
                        disabled={!isAvailable}
                        onClick={() => {
                          setSelectedStartTime(slot.startTime);
                        }}
                        className={`flex flex-col items-start p-2.5 rounded-xl border text-left transition-all ${
                          isSelected
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
                        </span>
                      </button>
                    );
                  })}
                </div>


              </div>
            )}
          </div>

          {/* Real-time Summary Box */}
          <div className="rounded-[24px] border border-[var(--da-border)] bg-white p-5 sm:p-6 shadow-[var(--da-shadow-md)] flex flex-col gap-4">
            <h4 className="text-sm font-extrabold text-[var(--da-brand-dark)] uppercase tracking-wider">
              {candidateRank > 0
                ? `Backup Spot ${candidateRank} Schedule Summary`
                : "Reservation Schedule Summary"}
            </h4>

            <div className="rounded-2xl bg-[var(--da-canvas)] border border-[var(--da-border-light)] p-4 flex flex-col gap-2.5 text-xs text-[var(--da-text-secondary)]">
              <div className="flex justify-between items-center">
                <span>Date:</span>
                <span className="font-bold text-[var(--da-brand-dark)]">
                  {formatDateDisplay(selectedDate)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span>Duration:</span>
                <span className="font-bold text-[var(--da-brand-dark)]">
                  {selectedDurationHours} {selectedDurationHours === 1 ? "Hour" : "Hours"}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span>Time Range:</span>
                <span className="font-bold text-[var(--da-brand-dark)]">
                  {selectedSlot
                    ? `${formatTime12Hour(selectedSlot.startTime)} – ${formatTime12Hour(
                        selectedSlot.endTime
                      )}`
                    : "Please select start time"}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span>Rate:</span>
                <span className="font-bold text-[var(--da-brand-dark)]">
                  ₱{workspace.rateAmount}/hr
                </span>
              </div>
              <div className="border-t border-[var(--da-border-light)] pt-2 flex justify-between items-center">
                <span className="font-extrabold text-sm text-[var(--da-brand-dark)]">
                  Estimated Total:
                </span>
                <span className="font-extrabold text-base text-[var(--da-primary)]">
                  ₱{totalPrice.toFixed(2)}
                </span>
              </div>
            </div>

            {/* No Hold Rule Notice */}
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-[11px] leading-4 text-slate-600">
              <span className="font-bold text-slate-800">
                {candidateRank > 0 ? "Atomic Allocation Rule:" : "No-Hold Rule:"}
              </span>{" "}
              {candidateRank > 0
                ? "This backup spot is an alternative candidate. DeskAtlas attempts to assign Main first; if Main is taken at payment review, Backup 1 is allocated, then Backup 2."
                : "Guest reservations do not reserve inventory until payment is reviewed and allocated."}
            </div>

            {/* Continue Button */}
            <button
              type="button"
              disabled={!selectedDate || !selectedStartTime}
              onClick={handleContinue}
              className={`da-primary-button w-full justify-center py-3 text-sm font-bold ${
                !selectedDate || !selectedStartTime ? "opacity-50 cursor-not-allowed" : ""
              }`}
            >
              {selectedStartTime
                ? candidateRank > 0
                  ? `Confirm Backup Spot ${candidateRank} Schedule →`
                  : "Proceed with this Schedule →"
                : "Select a Start Time to Proceed"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
