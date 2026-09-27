export type RateType = 'HOURLY' | 'DAY_PASS' | 'NIGHT_PASS' | 'WHOLE_DAY_PASS' | 'HALF_DAY_PASS';

export interface PassScheduleWindow {
  startTime: string; // e.g. '07:00'
  endTime: string;   // e.g. '23:30' or '07:00' (next day)
  crossesMidnight: boolean;
}

export interface WorkspacePassPricingConfig {
  hasHourly?: boolean;
  hourlyRate?: number;
  rateAmount?: number;
  hasDayPass?: boolean;
  dayPassPrice?: number | null;
  hasNightPass?: boolean;
  nightPassPrice?: number | null;
  hasWholeDayPass?: boolean;
  wholeDayPassPrice?: number | null;
  hasHalfDayPass?: boolean;
  halfDayPassPrice?: number | null;
}

export interface CalculatedPriceResult {
  rateType: RateType;
  unitPrice: number;
  totalAmount: number;
}

export class PricingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PricingValidationError';
    Object.setPrototypeOf(this, PricingValidationError.prototype);
  }
}

export const MANILA_TIMEZONE = 'Asia/Manila';

let _clientServerOffsetMs = 0;

/**
 * Synchronizes client clock with authoritative server PHT timestamp to prevent client-side time tampering.
 */
export function setServerTimeSync(serverTimestamp: number | string | Date): void {
  const serverMs = typeof serverTimestamp === 'number'
    ? serverTimestamp
    : new Date(serverTimestamp).getTime();
  if (!isNaN(serverMs)) {
    _clientServerOffsetMs = serverMs - Date.now();
  }
}

/**
 * Returns current clock drift offset between server and local device.
 */
export function getServerTimeSyncOffset(): number {
  return _clientServerOffsetMs;
}

/**
 * Returns current Date in PHT accounting for synchronized server time.
 */
export function getPhtNow(): Date {
  return new Date(Date.now() + _clientServerOffsetMs);
}

/**
 * Extracts datetime components formatted under Asia/Manila timezone (PHT, UTC+8).
 */
export function getPhtDateTimeParts(date: Date | string | number = getPhtNow()): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const d = typeof date === 'object' && date instanceof Date ? date : new Date(date);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: MANILA_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);

  const year = parseInt(parts.find((p) => p.type === 'year')?.value ?? '2026', 10);
  const month = parseInt(parts.find((p) => p.type === 'month')?.value ?? '1', 10);
  const day = parseInt(parts.find((p) => p.type === 'day')?.value ?? '1', 10);
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
  const minute = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
  const second = parseInt(parts.find((p) => p.type === 'second')?.value ?? '0', 10);

  return { year, month, day, hour, minute, second };
}

/**
 * Returns current date string in PHT (YYYY-MM-DD).
 */
export function getPhtDateString(date: Date | string | number = getPhtNow()): string {
  const { year, month, day } = getPhtDateTimeParts(date);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Returns current time string in PHT (HH:mm).
 */
export function getPhtTimeString(date: Date | string | number = getPhtNow()): string {
  const { hour, minute } = getPhtDateTimeParts(date);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * Converts a PHT date string and time string to a UTC Date object.
 */
export function zonedDateTimeToUtc(
  dateStr: string,
  timeStr: string,
  timezone: string = MANILA_TIMEZONE
): Date {
  if (timezone === 'Asia/Manila' || timezone === 'PHT') {
    const [year, month, day] = dateStr.split('-').map(Number);
    const [hours, minutes] = timeStr.split(':').map(Number);
    return new Date(Date.UTC(year, month - 1, day, hours - 8, minutes, 0, 0));
  }
  const isoLocal = `${dateStr}T${timeStr}:00`;
  return new Date(isoLocal);
}

/**
 * Evaluates whether Day Pass is valid at the given PHT time.
 */
export function isDayPassEligibleAtTime(
  phtTimeStr: string,
  dayPassStartTime: string = '07:00',
  dayPassEndTime: string = '23:30'
): boolean {
  const cleanNow = phtTimeStr.slice(0, 5);
  const cleanStart = dayPassStartTime.slice(0, 5);
  const cleanEnd = dayPassEndTime.slice(0, 5);
  const [hNow, mNow] = cleanNow.split(':').map(Number);
  const [hStart, mStart] = cleanStart.split(':').map(Number);
  const [hEnd, mEnd] = cleanEnd.split(':').map(Number);
  const nowMins = hNow * 60 + mNow;
  const startMins = hStart * 60 + mStart;
  const endMins = hEnd * 60 + mEnd;
  return nowMins >= (startMins - 60) && nowMins < (endMins - 60);
}

/**
 * Evaluates whether Night Pass is valid at the given PHT time.
 */
export function isNightPassEligibleAtTime(
  phtTimeStr: string,
  nightPassStartTime: string = '20:00',
  nightPassEndTime: string = '07:00'
): boolean {
  const cleanNow = phtTimeStr.slice(0, 5);
  const cleanStart = nightPassStartTime.slice(0, 5);
  const cleanEnd = nightPassEndTime.slice(0, 5);
  const [hNow, mNow] = cleanNow.split(':').map(Number);
  const [hStart, mStart] = cleanStart.split(':').map(Number);
  const [hEnd, mEnd] = cleanEnd.split(':').map(Number);
  const nowMins = hNow * 60 + mNow;
  const startMins = hStart * 60 + mStart;
  const endMins = hEnd * 60 + mEnd;

  // If night shift crosses midnight (e.g. 20:00 to 07:00)
  if (startMins > endMins) {
    return nowMins >= (startMins - 120) || nowMins < (endMins - 60);
  }
  return nowMins >= startMins && nowMins < endMins - 60;
}

/**
 * Resolves reservation timestamps for shift windows, automatically handling
 * overnight shifts spanning across midnight into the following calendar day.
 */
export function resolvePassInterval(
  bookingDateStr: string,
  startTime: string,
  endTime: string
): { startAt: string; endAt: string; crossesMidnight: boolean } {
  const cleanStart = startTime.trim().slice(0, 5);
  const cleanEnd = endTime.trim().slice(0, 5);
  const startAt = `${bookingDateStr}T${cleanStart}:00`;
  const crossesMidnight = cleanEnd <= cleanStart;

  if (!crossesMidnight) {
    return {
      startAt,
      endAt: `${bookingDateStr}T${cleanEnd}:00`,
      crossesMidnight: false,
    };
  }

  // Calculate next calendar day in UTC
  const [year, month, day] = bookingDateStr.split('-').map(Number);
  const nextDay = new Date(Date.UTC(year, month - 1, day + 1));
  const nextDayStr = nextDay.toISOString().split('T')[0];

  return {
    startAt,
    endAt: `${nextDayStr}T${cleanEnd}:00`,
    crossesMidnight: true,
  };
}

/**
 * Validates whether the given pass type is feasible under the venue's operating hours.
 */
export function isPassTypeSupportedByOperatingHours(
  passType: RateType,
  businessHours: {
    openTime?: string;
    closeTime?: string;
    opensAt?: string;
    closesAt?: string;
    is24Hours?: boolean;
  }
): boolean {
  if (businessHours.is24Hours) {
    return true;
  }

  if (passType === 'WHOLE_DAY_PASS') {
    return false;
  }

  if (passType === 'NIGHT_PASS') {
    const open = (businessHours.openTime || businessHours.opensAt || '09:00').slice(0, 5);
    const close = (businessHours.closeTime || businessHours.closesAt || '18:00').slice(0, 5);
    // If business is not 24h, overnight night passes require opening at or before 07:00 and closing at or after 23:00
    return open <= '07:00' && close >= '23:00';
  }

  return true;
}

export interface PassShiftWindowConfig {
  dayPassStartTime?: string;
  dayPassEndTime?: string;
  nightPassStartTime?: string;
  nightPassEndTime?: string;
}

/**
 * Evaluates whether a given PHT time falls in the daytime window.
 * Default day window is 07:00 to 20:00.
 */
export function isDayTime(
  timeStr: string = getPhtTimeString(),
  dayStart: string = '07:00',
  dayEnd: string = '20:00'
): boolean {
  const cleanTime = timeStr.trim().slice(0, 5);
  const [h, m] = cleanTime.split(':').map(Number);
  const currentMins = (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m);

  const [dhStart, dmStart] = dayStart.slice(0, 5).split(':').map(Number);
  const [dhEnd, dmEnd] = dayEnd.slice(0, 5).split(':').map(Number);
  const startMins = (isNaN(dhStart) ? 7 : dhStart) * 60 + (isNaN(dmStart) ? 0 : dmStart);
  const endMins = (isNaN(dhEnd) ? 20 : dhEnd) * 60 + (isNaN(dmEnd) ? 0 : dmEnd);

  if (startMins < endMins) {
    return currentMins >= startMins && currentMins < endMins;
  }
  // Crosses midnight
  return currentMins >= startMins || currentMins < endMins;
}

/**
 * Evaluates whether a given PHT time falls in the nighttime window.
 * Default night window is 20:00 to 07:00.
 */
export function isNightTime(
  timeStr: string = getPhtTimeString(),
  nightStart: string = '20:00',
  nightEnd: string = '07:00'
): boolean {
  const cleanTime = timeStr.trim().slice(0, 5);
  const [h, m] = cleanTime.split(':').map(Number);
  const currentMins = (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m);

  const [nhStart, nmStart] = nightStart.slice(0, 5).split(':').map(Number);
  const [nhEnd, nmEnd] = nightEnd.slice(0, 5).split(':').map(Number);
  const startMins = (isNaN(nhStart) ? 20 : nhStart) * 60 + (isNaN(nmStart) ? 0 : nmStart);
  const endMins = (isNaN(nhEnd) ? 7 : nhEnd) * 60 + (isNaN(nmEnd) ? 0 : nmEnd);

  if (startMins > endMins) {
    return currentMins >= startMins || currentMins < endMins;
  }
  return currentMins >= startMins && currentMins < endMins;
}

/**
 * Resolves the dynamic hourly rate based on whether the booking time is Day or Night.
 * If day time, uses configured Day Pass price if available, otherwise base rate.
 * If night time, uses configured Night Pass price if available, otherwise base rate.
 */
export function resolveTimeBasedHourlyRate(
  config: WorkspacePassPricingConfig,
  timeStr: string = getPhtTimeString(),
  param3?: string | PassShiftWindowConfig,
  param4?: string,
  param5?: string,
  param6?: string
): {
  rate: number;
  isNight: boolean;
  tierLabel: string;
  hasConfiguredRate: boolean;
} {
  let dayStart = '07:00';
  let dayEnd = '20:00';
  let nightStart: string | undefined;
  let nightEnd: string | undefined;

  if (typeof param3 === 'object' && param3 !== null) {
    dayStart = param3.dayPassStartTime || dayStart;
    dayEnd = param3.dayPassEndTime || dayEnd;
    nightStart = param3.nightPassStartTime;
    nightEnd = param3.nightPassEndTime;
  } else if (typeof param3 === 'string') {
    dayStart = param3;
    if (typeof param4 === 'string') dayEnd = param4;
    if (typeof param5 === 'string') nightStart = param5;
    if (typeof param6 === 'string') nightEnd = param6;
  }

  const isNight = nightStart
    ? isNightTime(timeStr, nightStart, nightEnd || '07:00')
    : !isDayTime(timeStr, dayStart, dayEnd);

  const baseRate = Number(config.hourlyRate ?? config.rateAmount ?? 0);

  if (!isNight) {
    const hasDayPrice = Boolean(config.hasDayPass && config.dayPassPrice !== null && config.dayPassPrice !== undefined && !isNaN(Number(config.dayPassPrice)));
    const rate = hasDayPrice ? Number(config.dayPassPrice) : baseRate;
    return {
      rate,
      isNight: false,
      tierLabel: 'Day Rate',
      hasConfiguredRate: hasDayPrice,
    };
  } else {
    const hasNightPrice = Boolean(config.hasNightPass && config.nightPassPrice !== null && config.nightPassPrice !== undefined && !isNaN(Number(config.nightPassPrice)));
    const rate = hasNightPrice ? Number(config.nightPassPrice) : baseRate;
    return {
      rate,
      isNight: true,
      tierLabel: 'Night Rate',
      hasConfiguredRate: hasNightPrice,
    };
  }
}

/**
 * Calculates reservation total for hourly or fixed pass tiers.
 */
export function calculateReservationPrice(
  arg1: RateType | WorkspacePassPricingConfig,
  arg2: RateType | WorkspacePassPricingConfig,
  durationHours: number = 1,
  timeStr?: string,
  dayStart?: string | PassShiftWindowConfig,
  dayEnd?: string,
  nightStart?: string,
  nightEnd?: string
): CalculatedPriceResult {
  let rateType: RateType;
  let config: WorkspacePassPricingConfig;

  if (typeof arg1 === 'string') {
    rateType = arg1 as RateType;
    config = arg2 as WorkspacePassPricingConfig;
  } else {
    config = arg1 as WorkspacePassPricingConfig;
    rateType = arg2 as RateType;
  }

  if (rateType === 'DAY_PASS') {
    if (!config.hasDayPass || config.dayPassPrice === null || config.dayPassPrice === undefined) {
      throw new PricingValidationError('DAY_PASS is not enabled for this workspace template');
    }
    const price = Number(config.dayPassPrice);
    return { rateType: 'DAY_PASS', unitPrice: price, totalAmount: price };
  }

  if (rateType === 'NIGHT_PASS') {
    if (!config.hasNightPass || config.nightPassPrice === null || config.nightPassPrice === undefined) {
      throw new PricingValidationError('NIGHT_PASS is not enabled for this workspace template');
    }
    const price = Number(config.nightPassPrice);
    return { rateType: 'NIGHT_PASS', unitPrice: price, totalAmount: price };
  }

  if (rateType === 'WHOLE_DAY_PASS') {
    if (!config.hasWholeDayPass || config.wholeDayPassPrice === null || config.wholeDayPassPrice === undefined) {
      throw new PricingValidationError('WHOLE_DAY_PASS is not enabled for this workspace template');
    }
    const price = Number(config.wholeDayPassPrice);
    return { rateType: 'WHOLE_DAY_PASS', unitPrice: price, totalAmount: price };
  }

  if (rateType === 'HALF_DAY_PASS') {
    if (!config.hasHalfDayPass || config.halfDayPassPrice === null || config.halfDayPassPrice === undefined) {
      throw new PricingValidationError('HALF_DAY_PASS is not enabled for this workspace template');
    }
    const price = Number(config.halfDayPassPrice);
    return { rateType: 'HALF_DAY_PASS', unitPrice: price, totalAmount: price };
  }

  const baseRate = timeStr
    ? resolveTimeBasedHourlyRate(config, timeStr, dayStart, dayEnd, nightStart, nightEnd).rate
    : Number(config.hourlyRate ?? config.rateAmount ?? 0);
  const total = baseRate * durationHours;
  return { rateType: 'HOURLY', unitPrice: baseRate, totalAmount: total };
}

/**
 * Validates pass pricing configuration values.
 */
export function validatePassPricingConfig(config: Partial<WorkspacePassPricingConfig>): {
  isValid: boolean;
  error?: string;
} {
  if (config.hasDayPass) {
    if (config.dayPassPrice === null || config.dayPassPrice === undefined || isNaN(Number(config.dayPassPrice))) {
      return { isValid: false, error: 'Day Pass price is required when Day Pass is enabled' };
    }
    if (Number(config.dayPassPrice) < 0) {
      return { isValid: false, error: 'Day Pass price cannot be negative' };
    }
  }

  if (config.hasNightPass) {
    if (config.nightPassPrice === null || config.nightPassPrice === undefined || isNaN(Number(config.nightPassPrice))) {
      return { isValid: false, error: 'Night Pass price is required when Night Pass is enabled' };
    }
    if (Number(config.nightPassPrice) < 0) {
      return { isValid: false, error: 'Night Pass price cannot be negative' };
    }
  }

  if (config.hasWholeDayPass) {
    if (config.wholeDayPassPrice === null || config.wholeDayPassPrice === undefined || isNaN(Number(config.wholeDayPassPrice))) {
      return { isValid: false, error: 'Whole Day Pass price is required when Whole Day Pass is enabled' };
    }
    if (Number(config.wholeDayPassPrice) < 0) {
      return { isValid: false, error: 'Whole Day Pass price cannot be negative' };
    }
  }

  if (config.hasHalfDayPass) {
    if (config.halfDayPassPrice === null || config.halfDayPassPrice === undefined || isNaN(Number(config.halfDayPassPrice))) {
      return { isValid: false, error: 'Half Day Pass price is required when Half Day Pass is enabled' };
    }
    if (Number(config.halfDayPassPrice) < 0) {
      return { isValid: false, error: 'Half Day Pass price cannot be negative' };
    }
  }

  return { isValid: true };
}
