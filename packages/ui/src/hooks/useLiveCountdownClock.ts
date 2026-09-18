'use client';

import { useState, useEffect } from 'react';

export type CountdownUrgency = 'normal' | 'warning' | 'urgent' | 'expired';

export interface FormattedRemainingDuration {
  totalSeconds: number;
  hours: number;
  minutes: number;
  seconds: number;
  formatted: string;
  urgency: CountdownUrgency;
  isExpired: boolean;
  label: string;
}

export function formatRemainingDuration(
  bookingEndAt: string | Date | null | undefined,
  nowMs: number = Date.now()
): FormattedRemainingDuration {
  if (!bookingEndAt) {
    return {
      totalSeconds: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
      formatted: '--:--',
      urgency: 'normal',
      isExpired: false,
      label: '',
    };
  }

  const endMs = typeof bookingEndAt === 'string' ? new Date(bookingEndAt).getTime() : bookingEndAt.getTime();
  if (isNaN(endMs)) {
    return {
      totalSeconds: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
      formatted: '--:--',
      urgency: 'normal',
      isExpired: false,
      label: '',
    };
  }

  const diffMs = endMs - nowMs;
  const totalSeconds = Math.floor(diffMs / 1000);

  if (totalSeconds <= 0) {
    return {
      totalSeconds,
      hours: 0,
      minutes: 0,
      seconds: 0,
      formatted: '00:00',
      urgency: 'expired',
      isExpired: true,
      label: '⏳ Overdue',
    };
  }

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n: number) => String(n).padStart(2, '0');

  let formatted: string;
  let urgency: CountdownUrgency;

  if (totalSeconds <= 300) {
    // Under 5 minutes -> Urgent
    urgency = 'urgent';
    formatted = `${pad(minutes)}:${pad(seconds)}`;
  } else if (totalSeconds <= 900) {
    // 5 - 15 minutes -> Warning
    urgency = 'warning';
    formatted = `${pad(minutes)}:${pad(seconds)}`;
  } else {
    // > 15 minutes -> Standard
    urgency = 'normal';
    if (hours > 0) {
      formatted = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
    } else {
      formatted = `${pad(minutes)}:${pad(seconds)}`;
    }
  }

  return {
    totalSeconds,
    hours,
    minutes,
    seconds,
    formatted,
    urgency,
    isExpired: false,
    label: `⏳ ${formatted}`,
  };
}

export function useLiveCountdownClock(intervalMs: number = 1000): number {
  const [currentTick, setCurrentTick] = useState<number>(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTick(Date.now());
    }, intervalMs);

    return () => clearInterval(timer);
  }, [intervalMs]);

  return currentTick;
}

export function useRemainingTime(
  bookingEndAt: string | Date | null | undefined,
  intervalMs: number = 1000
): FormattedRemainingDuration {
  const currentTick = useLiveCountdownClock(intervalMs);
  return formatRemainingDuration(bookingEndAt, currentTick);
}
