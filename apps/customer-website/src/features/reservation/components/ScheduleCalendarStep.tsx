"use client";

import { useEffect, useMemo, useState } from "react";
import {
  type WorkspaceMapViewModel,
  getWorkspacePhotoObjectPosition,
} from "@/features/workspace-discovery";
import type { AvailableTimeSlot, AvailableDate, PromotionalRate, RateType } from "@deskatlas/domain";
import {
  calculateMaxBookingDate,
  resolveEffectivePrice,
  getPhtNow,
  getPhtDateString,
  getPhtTimeString,
  setServerTimeSync,
  resolvePassInterval,
  resolveTimeBasedHourlyRate,
  isDayTime,
  MANILA_TIMEZONE,
} from "@deskatlas/domain";
import { fetchDateAvailability, fetchTimeAvailability } from "@/app/lib/availabilityApi";
import { handleNumericKeyDown } from "@deskatlas/ui";

interface ScheduleCalendarStepProps {
  workspace: WorkspaceMapViewModel;
  onBackToMap: () => void;
  onContinue: (schedule: {
    date: string;
    durationHours: number;
    startTime: string;
    endTime: string;
    rateType?: RateType;
  }) => void;
  candidateRank?: 0 | 1 | 2;
  lockedSchedule?: {
    date: string;
    durationHours: number;
    initialStartTime?: string;
    excludedStartTimes?: string[];
    rateType?: RateType;
  };
  maxAdvanceBookingDays?: number;
}

// Format 24-hour HH:mm to friendly 12-hour (e.g. "09:00" -> "9:00 AM", "13:00" -> "1:00 PM")
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

const DURATION_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8];

export function ScheduleCalendarStep({
  workspace,
  onBackToMap,
  onContinue,
  candidateRank = 0,
  lockedSchedule,
  maxAdvanceBookingDays = 90,
}: ScheduleCalendarStepProps) {
  // Synchronize with server PHT time on mount
  const [todayStr, setTodayStr] = useState(() => getPhtDateString());

  useEffect(() => {
    fetch("/api/time")
      .then((res) => res.json())
      .then((data) => {
        if (data?.serverTimestamp) {
          setServerTimeSync(data.serverTimestamp);
          setTodayStr(getPhtDateString());
        }
      })
      .catch(() => {});
  }, []);

  const [todayYear, todayMonth] = useMemo(() => todayStr.split("-").map(Number), [todayStr]);
  const initialDate = lockedSchedule?.date || todayStr;
  const [initialYear, initialMonth] = initialDate.split("-").map(Number);

  // Rate Tier state: default HOURLY, or 12h / 24h pass if configured and locked
  const [selectedRateType, setSelectedRateType] = useState<RateType>(
    lockedSchedule?.rateType || 'HOURLY'
  );

  const [passWindows, setPassWindows] = useState({
    dayPassStartTime: '07:00',
    dayPassEndTime: '23:30',
    nightPassStartTime: '20:00',
    nightPassEndTime: '07:00',
  });

  useEffect(() => {
    fetch("/api/settings")
      .then((res) => res.json())
      .then((data) => {
        if (data) {
          setPassWindows({
            dayPassStartTime: data.dayPassStartTime || '07:00',
            dayPassEndTime: data.dayPassEndTime || '23:30',
            nightPassStartTime: data.nightPassStartTime || '20:00',
            nightPassEndTime: data.nightPassEndTime || '07:00',
          });
        }
      })
      .catch(() => {});
  }, []);

  const maxAllowedDateStr = useMemo(
    () => calculateMaxBookingDate(todayStr, maxAdvanceBookingDays || 90),
    [todayStr, maxAdvanceBookingDays]
  );
  const [maxViewYear, maxViewMonth] = useMemo(
    () => maxAllowedDateStr.split("-").map(Number),
    [maxAllowedDateStr]
  );

  const [viewYear, setViewYear] = useState<number>(initialYear);
  const [viewMonth, setViewMonth] = useState<number>(initialMonth); // 1-12

  const daysInViewMonth = useMemo(
    () => new Date(viewYear, viewMonth, 0).getDate(),
    [viewYear, viewMonth]
  );
  const firstDayOfWeek = useMemo(
    () => new Date(viewYear, viewMonth - 1, 1).getDay(),
    [viewYear, viewMonth]
  );

  const monthLabel = useMemo(() => {
    const d = new Date(viewYear, viewMonth - 1, 1);
    return d.toLocaleString("default", { month: "long", year: "numeric" });
  }, [viewYear, viewMonth]);

  const isCurrentOrPastMonth = useMemo(() => {
    return (
      viewYear < initialYear ||
      (viewYear === initialYear && viewMonth <= initialMonth)
    );
  }, [viewYear, viewMonth, initialYear, initialMonth]);

  const isAtOrPastMaxMonth = useMemo(() => {
    return (
      viewYear > maxViewYear ||
      (viewYear === maxViewYear && viewMonth >= maxViewMonth)
    );
  }, [viewYear, viewMonth, maxViewYear, maxViewMonth]);

  const handlePrevMonth = () => {
    if (isCurrentOrPastMonth) return;
    if (viewMonth === 1) {
      setViewYear((prev) => prev - 1);
      setViewMonth(12);
    } else {
      setViewMonth((prev) => prev - 1);
    }
  };

  const handleNextMonth = () => {
    if (isAtOrPastMaxMonth) return;
    if (viewMonth === 12) {
      setViewYear((prev) => prev + 1);
      setViewMonth(1);
    } else {
      setViewMonth((prev) => prev + 1);
    }
  };

  const excludedStartTimes = useMemo(() => lockedSchedule?.excludedStartTimes || [], [lockedSchedule]);
  const initialStartTimeVal =
    lockedSchedule?.initialStartTime && !excludedStartTimes.includes(lockedSchedule.initialStartTime)
      ? lockedSchedule.initialStartTime
      : null;

  const [selectedDate, setSelectedDate] = useState<string>(initialDate);
  const [selectedDurationHours, setSelectedDurationHours] = useState<number>(
    lockedSchedule?.durationHours || 2
  );
  const [durationInputStr, setDurationInputStr] = useState<string>(
    String(lockedSchedule?.durationHours || 2)
  );
  const [selectedStartTime, setSelectedStartTime] = useState<string | null>(initialStartTimeVal);

  const [monthAvailability, setMonthAvailability] = useState<Record<string, AvailableDate>>({});
  const [loadingDates, setLoadingDates] = useState(false);

  const [timeSlots, setTimeSlots] = useState<AvailableTimeSlot[]>([]);
  const [loadingTimes, setLoadingTimes] = useState(false);
  const [timeError, setTimeError] = useState<string | null>(null);

  const startDateOfMonth = useMemo(() => {
    return `${viewYear}-${String(viewMonth).padStart(2, "0")}-01`;
  }, [viewYear, viewMonth]);

  const endDateOfMonth = useMemo(() => {
    return `${viewYear}-${String(viewMonth).padStart(2, "0")}-${String(daysInViewMonth).padStart(2, "0")}`;
  }, [viewYear, viewMonth, daysInViewMonth]);

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
  }, [workspace.workspaceInstanceId, selectedDate, selectedDurationHours, excludedStartTimes]);

  // Sync duration when rate type changes for fixed passes
  useEffect(() => {
    if (selectedRateType === 'WHOLE_DAY_PASS') {
      setSelectedDurationHours(24);
      setDurationInputStr("24");
    } else if (selectedRateType === 'HALF_DAY_PASS') {
      setSelectedDurationHours(12);
      setDurationInputStr("12");
    }
  }, [selectedRateType]);

  const selectedSlot = useMemo(() => {
    if (!selectedStartTime) return null;
    const found = timeSlots.find((s) => s.startTime === selectedStartTime);
    if (found) return found;

    // Fallback calculation
    const [h, m] = selectedStartTime.split(":").map(Number);
    const endMinutes = h * 60 + m + selectedDurationHours * 60;
    const endH = Math.floor(endMinutes / 60) % 24;
    const endM = endMinutes % 60;
    const endTime = `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;
    return {
      startTime: selectedStartTime,
      endTime,
      isAvailable: true,
      blockingReason: null,
    };
  }, [timeSlots, selectedStartTime, selectedDurationHours]);

  const [activePromotions, setActivePromotions] = useState<PromotionalRate[]>([]);
  useEffect(() => {
    fetch("/api/public/promotions")
      .then((res) => res.json())
      .then((data) => {
        if (data?.data) setActivePromotions(data.data);
      })
      .catch(() => {});
  }, []);

  const targetBookingTime = useMemo(() => {
    if (!selectedDate) return getPhtNow();
    const time = selectedStartTime || "09:00";
    return new Date(`${selectedDate}T${time}:00`);
  }, [selectedDate, selectedStartTime]);

  // Dynamic Day vs Night hourly rate based on start time
  const hourlyTier = useMemo(() => {
    const timeToCheck = selectedStartTime || getPhtTimeString();
    return resolveTimeBasedHourlyRate(
      workspace,
      timeToCheck,
      passWindows
    );
  }, [workspace, selectedStartTime, passWindows]);

  const baseRegularPrice = useMemo(() => {
    if (selectedRateType === 'DAY_PASS') return workspace.dayPassPrice ?? workspace.rateAmount;
    if (selectedRateType === 'NIGHT_PASS') return workspace.nightPassPrice ?? workspace.rateAmount;
    if (selectedRateType === 'WHOLE_DAY_PASS') return workspace.wholeDayPassPrice ?? (workspace.rateAmount * 24);
    if (selectedRateType === 'HALF_DAY_PASS') return workspace.halfDayPassPrice ?? (workspace.rateAmount * 12);
    return workspace.rateAmount;
  }, [selectedRateType, workspace]);

  const resolvedPricing = useMemo(() => {
    return resolveEffectivePrice(
      workspace.templateId,
      selectedRateType,
      baseRegularPrice,
      targetBookingTime,
      activePromotions,
      selectedRateType === 'HOURLY' ? selectedDurationHours : 1
    );
  }, [workspace.templateId, selectedRateType, baseRegularPrice, targetBookingTime, activePromotions, selectedDurationHours]);

  const totalPrice = resolvedPricing.estimatedTotal;

  const handleContinue = () => {
    if (!selectedDate) return;

    if (selectedRateType === 'DAY_PASS') {
      const [sh, sm] = passWindows.dayPassStartTime.split(":").map(Number);
      const [eh, em] = passWindows.dayPassEndTime.split(":").map(Number);
      let durMins = eh * 60 + em - (sh * 60 + sm);
      if (durMins <= 0) durMins = 12 * 60;
      const durHours = Math.round((durMins / 60) * 10) / 10;
      onContinue({
        date: selectedDate,
        durationHours: durHours,
        startTime: passWindows.dayPassStartTime,
        endTime: passWindows.dayPassEndTime,
        rateType: 'DAY_PASS',
      });
      return;
    }

    if (selectedRateType === 'NIGHT_PASS') {
      const [sh, sm] = passWindows.nightPassStartTime.split(":").map(Number);
      const [eh, em] = passWindows.nightPassEndTime.split(":").map(Number);
      let durMins = eh * 60 + em - (sh * 60 + sm);
      if (durMins <= 0) durMins += 1440;
      const durHours = Math.round((durMins / 60) * 10) / 10;
      onContinue({
        date: selectedDate,
        durationHours: durHours,
        startTime: passWindows.nightPassStartTime,
        endTime: passWindows.nightPassEndTime,
        rateType: 'NIGHT_PASS',
      });
      return;
    }

    if (!selectedSlot || !selectedDurationHours || selectedDurationHours <= 0) return;
    const effectiveStartTime = selectedSlot.startTime;
    onContinue({
      date: selectedDate,
      durationHours: selectedDurationHours,
      startTime: effectiveStartTime,
      endTime: selectedSlot.endTime,
      rateType: selectedRateType,
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
                    disabled={isAtOrPastMaxMonth}
                    className={`flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--da-border)] bg-white text-sm font-bold transition ${
                      isAtOrPastMaxMonth
                        ? "opacity-30 cursor-not-allowed bg-slate-50 text-slate-300"
                        : "hover:bg-slate-50 text-[var(--da-brand-dark)]"
                    }`}
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

                const isBeyondHorizon = dateStr > maxAllowedDateStr;
                const dayAvail = monthAvailability[dateStr];
                const isClosed = dayAvail && !dayAvail.isAvailable && dayAvail.reason === "BUSINESS_CLOSED";
                const isBlocked = dayAvail && !dayAvail.isAvailable && dayAvail.reason === "BLOCKED";
                const isUnavailable = isPast || isBeyondHorizon || isClosed || isBlocked || (Boolean(lockedSchedule) && !isSelected);

                return (
                  <button
                    key={dateStr}
                    type="button"
                    disabled={isUnavailable}
                    title={
                      isBeyondHorizon
                        ? `Bookings open only up to ${maxAdvanceBookingDays} days in advance (until ${formatDateDisplay(maxAllowedDateStr)})`
                        : isClosed
                        ? "Business is closed on this day"
                        : undefined
                    }
                    onClick={() => {
                      if (!lockedSchedule) {
                        setSelectedDate(dateStr);
                      }
                    }}
                    className={`group relative flex h-10 sm:h-12 flex-col items-center justify-center rounded-xl text-xs font-bold transition-all ${
                      isSelected
                        ? "bg-[var(--da-primary)] text-white shadow-md ring-2 ring-[var(--da-accent)]"
                        : isPast || isBeyondHorizon
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

          {/* Pass / Rate Tier Selector Card */}
          <div className="rounded-[24px] border border-[var(--da-border)] bg-white p-5 sm:p-6 shadow-[var(--da-shadow-md)]">
            <div className="flex items-center justify-between border-b border-[var(--da-border-light)] pb-3 mb-4">
              <div>
                <h3 className="text-base font-extrabold text-[var(--da-brand-dark)]">
                  2. {lockedSchedule ? "Rate Tier (Locked to Main)" : "Select Booking Tier & Duration"}
                </h3>
                <p className="text-xs text-[var(--da-text-secondary)]">
                  Choose between flexible hourly booking or flat-rate pass packages.
                </p>
              </div>
              <span className="rounded-full bg-[var(--da-info)] px-3 py-1 text-xs font-extrabold text-[var(--da-primary)]">
                {selectedRateType === 'WHOLE_DAY_PASS'
                  ? '24-Hour Pass'
                  : selectedRateType === 'HALF_DAY_PASS'
                  ? '12-Hour Pass'
                  : `${selectedDurationHours} ${selectedDurationHours === 1 ? 'Hour' : 'Hours'}`}
              </span>
            </div>

            {/* Rate Tier Tabs */}
            <div className="flex flex-wrap gap-2 mb-4">
              <button
                type="button"
                disabled={Boolean(lockedSchedule) && lockedSchedule?.rateType !== 'HOURLY'}
                onClick={() => {
                  if (!lockedSchedule) {
                    setSelectedRateType('HOURLY');
                    setSelectedDurationHours(2);
                    setDurationInputStr("2");
                  }
                }}
                className={`flex-1 min-w-[120px] flex flex-col items-center justify-center p-3 rounded-2xl border text-center transition ${
                  selectedRateType === 'HOURLY'
                    ? "bg-[var(--da-primary)] text-white border-[var(--da-accent)] shadow-sm ring-2 ring-[var(--da-accent)]"
                    : "bg-[var(--da-canvas)] text-[var(--da-brand-dark)] border-[var(--da-border-light)] hover:bg-slate-50"
                }`}
              >
                <span className="text-xs font-extrabold">🕒 Hourly</span>
                <span className="text-[11px] font-bold mt-0.5 opacity-90">
                  ₱{workspace.rateAmount}/hr
                </span>
              </button>

              {workspace.hasDayPass && workspace.dayPassPrice != null && (
                <button
                  type="button"
                  disabled={Boolean(lockedSchedule) && lockedSchedule?.rateType !== 'DAY_PASS'}
                  onClick={() => {
                    if (!lockedSchedule) {
                      setSelectedRateType('DAY_PASS');
                    }
                  }}
                  className={`flex-1 min-w-[120px] flex flex-col items-center justify-center p-3 rounded-2xl border text-center transition ${
                    selectedRateType === 'DAY_PASS'
                      ? "bg-[var(--da-primary)] text-white border-[var(--da-accent)] shadow-sm ring-2 ring-[var(--da-accent)]"
                      : "bg-[var(--da-canvas)] text-[var(--da-brand-dark)] border-[var(--da-border-light)] hover:bg-slate-50"
                  }`}
                >
                  <span className="text-xs font-extrabold">☀️ Day Pass</span>
                  <span className="text-[11px] font-bold mt-0.5 opacity-90">
                    ₱{workspace.dayPassPrice} flat
                  </span>
                </button>
              )}

              {workspace.hasNightPass && workspace.nightPassPrice != null && (
                <button
                  type="button"
                  disabled={Boolean(lockedSchedule) && lockedSchedule?.rateType !== 'NIGHT_PASS'}
                  onClick={() => {
                    if (!lockedSchedule) {
                      setSelectedRateType('NIGHT_PASS');
                    }
                  }}
                  className={`flex-1 min-w-[120px] flex flex-col items-center justify-center p-3 rounded-2xl border text-center transition ${
                    selectedRateType === 'NIGHT_PASS'
                      ? "bg-[var(--da-primary)] text-white border-[var(--da-accent)] shadow-sm ring-2 ring-[var(--da-accent)]"
                      : "bg-[var(--da-canvas)] text-[var(--da-brand-dark)] border-[var(--da-border-light)] hover:bg-slate-50"
                  }`}
                >
                  <span className="text-xs font-extrabold">🌙 Night Pass</span>
                  <span className="text-[11px] font-bold mt-0.5 opacity-90">
                    ₱{workspace.nightPassPrice} flat
                  </span>
                </button>
              )}

              {workspace.hasWholeDayPass && workspace.wholeDayPassPrice != null && (
                <button
                  type="button"
                  disabled={Boolean(lockedSchedule) && lockedSchedule?.rateType !== 'WHOLE_DAY_PASS'}
                  onClick={() => {
                    if (!lockedSchedule) {
                      setSelectedRateType('WHOLE_DAY_PASS');
                    }
                  }}
                  className={`flex-1 min-w-[120px] flex flex-col items-center justify-center p-3 rounded-2xl border text-center transition ${
                    selectedRateType === 'WHOLE_DAY_PASS'
                      ? "bg-[var(--da-primary)] text-white border-[var(--da-accent)] shadow-sm ring-2 ring-[var(--da-accent)]"
                      : "bg-[var(--da-canvas)] text-[var(--da-brand-dark)] border-[var(--da-border-light)] hover:bg-slate-50"
                  }`}
                >
                  <span className="text-xs font-extrabold">⏳ 24-Hour</span>
                  <span className="text-[11px] font-bold mt-0.5 opacity-90">
                    ₱{workspace.wholeDayPassPrice} flat
                  </span>
                </button>
              )}

              {workspace.hasHalfDayPass && workspace.halfDayPassPrice != null && (
                <button
                  type="button"
                  disabled={Boolean(lockedSchedule) && lockedSchedule?.rateType !== 'HALF_DAY_PASS'}
                  onClick={() => {
                    if (!lockedSchedule) {
                      setSelectedRateType('HALF_DAY_PASS');
                    }
                  }}
                  className={`flex-1 min-w-[120px] flex flex-col items-center justify-center p-3 rounded-2xl border text-center transition ${
                    selectedRateType === 'HALF_DAY_PASS'
                      ? "bg-[var(--da-primary)] text-white border-[var(--da-accent)] shadow-sm ring-2 ring-[var(--da-accent)]"
                      : "bg-[var(--da-canvas)] text-[var(--da-brand-dark)] border-[var(--da-border-light)] hover:bg-slate-50"
                  }`}
                >
                  <span className="text-xs font-extrabold">🌓 12-Hour</span>
                  <span className="text-[11px] font-bold mt-0.5 opacity-90">
                    ₱{workspace.halfDayPassPrice} flat
                  </span>
                </button>
              )}
            </div>

            {/* Standard Hourly Duration Selection */}
            {selectedRateType === 'HOURLY' ? (
              <>
                <div className="grid grid-cols-4 sm:grid-cols-8 md:grid-cols-10 gap-2">
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
                            setDurationInputStr(String(hours));
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

                {/* Custom Duration Input */}
                <div className="mt-4 pt-3 border-t border-[var(--da-border-light)] flex flex-wrap items-center justify-between gap-3">
                  <span className="text-xs font-bold text-[var(--da-text-secondary)]">
                    {lockedSchedule ? "Custom duration locked to Main" : "Or enter custom duration:"}
                  </span>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      aria-label="Custom duration in hours"
                      disabled={Boolean(lockedSchedule)}
                      value={durationInputStr}
                      onChange={(e) => {
                        if (lockedSchedule) return;
                        const raw = e.target.value;
                        const sanitized = raw.replace(/\D/g, "").replace(/^0+/, "");
                        setDurationInputStr(sanitized);
                        if (sanitized === "") {
                          setSelectedDurationHours(0);
                        } else {
                          const parsed = parseInt(sanitized, 10);
                          if (parsed === 12 && workspace.hasHalfDayPass && workspace.halfDayPassPrice != null) {
                            setSelectedRateType('HALF_DAY_PASS');
                          } else if (parsed === 24 && workspace.hasWholeDayPass && workspace.wholeDayPassPrice != null) {
                            setSelectedRateType('WHOLE_DAY_PASS');
                          } else {
                            setSelectedDurationHours(parsed > 0 ? parsed : 0);
                          }
                        }
                      }}
                      onKeyDown={handleNumericKeyDown}
                      placeholder="Hours"
                      className="w-20 rounded-xl border border-[var(--da-border)] bg-white px-3 py-1.5 text-center text-sm font-extrabold text-[var(--da-brand-dark)] placeholder:text-slate-400 focus:border-[var(--da-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--da-primary)]/20 disabled:opacity-40 disabled:bg-slate-100"
                    />
                    <span className="text-xs font-bold text-[var(--da-brand-dark)]">
                      {selectedDurationHours === 1 ? "hr" : "hrs"}
                    </span>
                  </div>
                </div>
              </>
            ) : selectedRateType === 'DAY_PASS' ? (
              <div className="rounded-2xl bg-amber-50/90 border border-amber-200/90 p-4 text-xs text-amber-950 leading-relaxed flex flex-col gap-2">
                <div className="font-extrabold flex items-center gap-2 text-sm text-amber-900">
                  <span>☀️</span>
                  <span>Day Pass Selected — Active Shift Window</span>
                </div>
                <p>
                  Day Pass covers the daytime operating window from <strong>{formatTime12Hour(passWindows.dayPassStartTime)}</strong> until <strong>{formatTime12Hour(passWindows.dayPassEndTime)}</strong> for a fixed price of <strong>₱{workspace.dayPassPrice}</strong>.
                </p>
              </div>
            ) : selectedRateType === 'NIGHT_PASS' ? (
              <div className="rounded-2xl bg-indigo-50/90 border border-indigo-200/90 p-4 text-xs text-indigo-950 leading-relaxed flex flex-col gap-2">
                <div className="font-extrabold flex items-center gap-2 text-sm text-indigo-900">
                  <span>🌙</span>
                  <span>Night Pass Selected — Overnight Shift Window</span>
                </div>
                <p>
                  Night Pass covers the overnight window from <strong>{formatTime12Hour(passWindows.nightPassStartTime)}</strong> until <strong>{formatTime12Hour(passWindows.nightPassEndTime)}</strong> the next morning for a fixed price of <strong>₱{workspace.nightPassPrice}</strong>.
                </p>
              </div>
            ) : (
              <div className="rounded-2xl bg-emerald-50/80 border border-emerald-200/80 p-4 text-xs text-emerald-900 leading-relaxed">
                <div className="font-extrabold flex items-center gap-2 text-sm mb-1">
                  <span>✨</span>
                  <span>
                    {selectedRateType === 'WHOLE_DAY_PASS'
                      ? '24-Hour Whole Day Pass Selected'
                      : '12-Hour Half Day Pass Selected'}
                  </span>
                </div>
                <p>
                  {selectedRateType === 'WHOLE_DAY_PASS'
                    ? `24-Hour Stay: Pick your desired check-in time below to book a full 24-hour continuous window for ₱${workspace.wholeDayPassPrice}.`
                    : `12-Hour Stay: Pick your desired check-in time below to book a full 12-hour continuous window for ₱${workspace.halfDayPassPrice}.`}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Start Time & Summary Box (5 Cols) */}
        <div className="lg:col-span-5 flex flex-col gap-6">
          {/* Start Time Selector Card */}
          <div className="rounded-[24px] border border-[var(--da-border)] bg-white p-5 sm:p-6 shadow-[var(--da-shadow-md)]">
            <div className="border-b border-[var(--da-border-light)] pb-3 mb-4">
              <h3 className="text-base font-extrabold text-[var(--da-brand-dark)]">
                {selectedRateType === 'DAY_PASS' || selectedRateType === 'NIGHT_PASS'
                  ? '3. Pass Shift Details'
                  : `3. Choose Start Time${candidateRank > 0 ? ` for Backup ${candidateRank}` : ''}`}
              </h3>
              <p className="text-xs text-[var(--da-text-secondary)] mt-0.5">
                {formatDateDisplay(selectedDate)}
                {selectedRateType === 'DAY_PASS'
                  ? ` • Day Pass (${formatTime12Hour(passWindows.dayPassStartTime)} – ${formatTime12Hour(passWindows.dayPassEndTime)})`
                  : selectedRateType === 'NIGHT_PASS'
                  ? ` • Night Pass (${formatTime12Hour(passWindows.nightPassStartTime)} – ${formatTime12Hour(passWindows.nightPassEndTime)})`
                  : ` • ${selectedDurationHours} hr${selectedDurationHours > 1 ? 's' : ''}`}
              </p>
            </div>

            {selectedRateType === 'DAY_PASS' ? (
              <div className="flex flex-col gap-3">
                <div className="rounded-2xl bg-amber-50/80 border border-amber-200/80 p-4 text-xs text-amber-950 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600 font-semibold">Start Time:</span>
                    <span className="font-extrabold text-[var(--da-brand-dark)]">{formatTime12Hour(passWindows.dayPassStartTime)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600 font-semibold">End Time:</span>
                    <span className="font-extrabold text-[var(--da-brand-dark)]">{formatTime12Hour(passWindows.dayPassEndTime)}</span>
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-amber-200/60">
                    <span className="text-slate-600 font-semibold">Fixed Total:</span>
                    <span className="font-extrabold text-emerald-700 text-sm">₱{workspace.dayPassPrice}</span>
                  </div>
                </div>
                <p className="text-[11px] text-[var(--da-text-secondary)]">
                  Your reservation is automatically set for the entire daytime shift window. Click <strong>Continue</strong> to proceed.
                </p>
              </div>
            ) : selectedRateType === 'NIGHT_PASS' ? (
              <div className="flex flex-col gap-3">
                <div className="rounded-2xl bg-indigo-50/80 border border-indigo-200/80 p-4 text-xs text-indigo-950 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600 font-semibold">Start Time:</span>
                    <span className="font-extrabold text-[var(--da-brand-dark)]">{formatTime12Hour(passWindows.nightPassStartTime)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600 font-semibold">End Time:</span>
                    <span className="font-extrabold text-[var(--da-brand-dark)]">{formatTime12Hour(passWindows.nightPassEndTime)} (Next Day)</span>
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-indigo-200/60">
                    <span className="text-slate-600 font-semibold">Fixed Total:</span>
                    <span className="font-extrabold text-emerald-700 text-sm">₱{workspace.nightPassPrice}</span>
                  </div>
                </div>
                <p className="text-[11px] text-[var(--da-text-secondary)]">
                  Your reservation is automatically set for the entire overnight shift window. Click <strong>Continue</strong> to proceed.
                </p>
              </div>
            ) : loadingTimes ? (
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
                <div className="rounded-xl bg-amber-50/80 border border-amber-200/80 p-3 text-[11px] leading-relaxed text-amber-900 flex items-center gap-2">
                  <span className="shrink-0 text-sm">💡</span>
                  <span>For immediate bookings (within 30 minutes), please proceed to walk in using our in-house kiosk.</span>
                </div>
                <div className="grid grid-cols-2 gap-2 max-h-[240px] overflow-y-auto pr-1">
                  {timeSlots.map((slot) => {
                    const isExcluded = excludedStartTimes.includes(slot.startTime);
                    const isSelected = selectedStartTime === slot.startTime;

                    const isWithin30Mins = (() => {
                      if (selectedDate !== todayStr) return false;
                      const [sh, sm] = slot.startTime.split(":").map(Number);
                      if (isNaN(sh) || isNaN(sm)) return false;
                      const now = getPhtNow();
                      const slotDate = new Date();
                      slotDate.setHours(sh, sm, 0, 0);
                      return slotDate.getTime() - now.getTime() < 30 * 60 * 1000;
                    })();

                    const isImmediateWalkIn =
                      slot.blockingReason === "IMMEDIATE_WALK_IN_ONLY" ||
                      (selectedDate === todayStr && isWithin30Mins && slot.blockingReason !== "PAST_TIME");
                    const isAvailable = slot.isAvailable && !isExcluded && !isImmediateWalkIn;

                    let reasonLabel = "Reserved";
                    if (isExcluded) reasonLabel = "Already Selected";
                    else if (slot.blockingReason === "PAST_TIME") reasonLabel = "Past";
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
                          {(() => {
                            const [sh, sm] = slot.startTime.split(":").map(Number);
                            return sh * 60 + sm + selectedDurationHours * 60 >= 1440 ? " (Next Day)" : "";
                          })()}
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
                      )}${(() => {
                        const [sh, sm] = selectedSlot.startTime.split(":").map(Number);
                        return sh * 60 + sm + selectedDurationHours * 60 >= 1440 ? " (Next Day)" : "";
                      })()}`
                    : "Please select start time"}
                </span>
              </div>
              {resolvedPricing.isPromotional ? (
                <>
                  <div className="flex justify-between items-center">
                    <span>Rate ({selectedRateType === 'HOURLY' ? 'Hourly' : 'Pass Package'}):</span>
                    <span className="font-bold text-[var(--da-brand-dark)] flex items-center gap-1.5">
                      <span className="line-through text-slate-400 font-normal">₱{resolvedPricing.regularPrice.toFixed(2)}{selectedRateType === 'HOURLY' ? '/hr' : ' flat'}</span>
                      <span className="text-[var(--da-primary)]">₱{resolvedPricing.effectivePrice.toFixed(2)}{selectedRateType === 'HOURLY' ? '/hr' : ' flat'}</span>
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>Discount Applied:</span>
                    <span className="font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded text-[11px]">
                      {resolvedPricing.promoName} (-₱{(resolvedPricing.regularPrice - resolvedPricing.effectivePrice).toFixed(2)})
                    </span>
                  </div>
                  <div className="border-t border-[var(--da-border-light)] pt-2 flex justify-between items-center">
                    <span className="font-extrabold text-sm text-[var(--da-brand-dark)]">
                      Estimated Total:
                    </span>
                    <span className="font-extrabold text-base text-[var(--da-primary)]">
                      ₱{resolvedPricing.estimatedTotal.toFixed(2)}
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex justify-between items-center">
                    <span>Rate ({selectedRateType === 'HOURLY' ? 'Hourly' : 'Pass Package'}):</span>
                    <span className="font-bold text-[var(--da-brand-dark)]">
                      ₱{baseRegularPrice.toFixed(2)}{selectedRateType === 'HOURLY' ? '/hr' : ' flat'}
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
                </>
              )}
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
              disabled={!selectedDate || !selectedSlot || !selectedDurationHours || selectedDurationHours <= 0}
              onClick={handleContinue}
              className={`da-primary-button w-full justify-center py-3 text-sm font-bold ${
                !selectedDate || !selectedSlot || !selectedDurationHours || selectedDurationHours <= 0 ? "opacity-50 cursor-not-allowed" : ""
              }`}
            >
              {selectedSlot
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
