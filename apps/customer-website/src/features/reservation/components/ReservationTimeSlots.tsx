"use client";
// PRD-F1/F14 / DSD-UI2/UI6: identical clickable time cards for reservation and reschedule.
import type { AvailableTimeSlot } from '@deskatlas/domain';
interface Props {
  slots: AvailableTimeSlot[];
  selectedTime: string | null;
  durationHours: number;
  onSelect: (time: string) => void;
  disabled?: boolean;
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

export function ReservationTimeSlots({ slots, selectedTime, durationHours, onSelect, disabled = false }: Props) {
  return (
    <div className="grid grid-cols-2 gap-2 max-h-[260px] overflow-y-auto pr-1">
      {slots.filter(slot => slot.isAvailable).map(slot => {
        const isSelected = slot.isAvailable && selectedTime === slot.startTime;
        const [hour, minute] = slot.startTime.split(':').map(Number);
        const overnight = hour * 60 + minute + durationHours * 60 >= 1440;
        return (
          <button key={slot.startTime} type="button" disabled={disabled || !slot.isAvailable} aria-pressed={isSelected}
            onClick={() => { if (slot.isAvailable && !disabled) onSelect(slot.startTime); }}
            className={`flex flex-col items-start p-3 rounded-xl border text-left transition-all ${isSelected
              ? 'bg-[var(--da-primary,#009689)] text-white border-[var(--da-accent,#007A70)] shadow-sm ring-2 ring-[var(--da-accent,#007A70)]'
              : 'bg-white text-[var(--da-brand-dark,#009689)] border-[var(--da-border-light,#E2E8F0)] hover:border-[var(--da-primary,#009689)] hover:bg-[var(--da-canvas,#F8FAFC)]'}`}>
            <div className="flex w-full items-center justify-between">
              <span className="text-xs font-bold">{formatTime12Hour(slot.startTime)}</span>
              <span className="text-[10px] font-semibold opacity-80">Available</span>
            </div>
            <span className="text-[10px] opacity-75 mt-0.5">to {formatTime12Hour(slot.endTime)}{overnight ? ' (Next Day)' : ''}</span>
          </button>
        );
      })}
    </div>
  );
}
