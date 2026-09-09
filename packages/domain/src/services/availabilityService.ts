import type {
  AvailabilityRepository,
  DateAvailabilityQuery,
  DateAvailabilityResult,
  OperatingHoursInterval,
  TimeAvailabilityQuery,
  TimeAvailabilityResult,
  TemplateAvailabilityQuery,
  TemplateAvailabilityResult,
  AvailableInstanceSummary,
  AvailableDate,
  AvailableTimeSlot,
  ScheduleBlock,
  BlockingReservationWindow,
  OccupiedInstancesResult,
} from '../models/availability';
import { getWorkspaceAvailabilityStatus } from './workspaceService';

const MINUTES_PER_DAY = 24 * 60;

export class AvailabilityValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AvailabilityValidationError';
  }
}

export function createAvailabilityService(repository: AvailabilityRepository) {
  return {
    async listDateAvailability(query: DateAvailabilityQuery): Promise<DateAvailabilityResult> {
      const normalized = normalizeDateAvailabilityQuery(query);
      const instance = await repository.getWorkspaceInstance(normalized.workspaceInstanceId);
      if (!instance) {
        throw new AvailabilityValidationError(
          `Workspace instance not found: ${normalized.workspaceInstanceId}`
        );
      }

      const settings = await repository.getBusinessSettings();
      const workspaceAvailability = getWorkspaceAvailabilityStatus(instance);
      const dates = await listDateAvailabilityForRange(
        repository,
        settings,
        workspaceAvailability.isBookable,
        normalized,
        normalized.nowIso ? new Date(normalized.nowIso) : new Date()
      );

      return {
        workspaceInstanceId: instance.id,
        timezone: settings.timezone,
        bookingIntervalMinutes: settings.bookingIntervalMinutes,
        workspaceIsBookable: workspaceAvailability.isBookable,
        workspaceBlockingReason: workspaceAvailability.blockingReason,
        dates,
      };
    },

    async listTimeAvailability(query: TimeAvailabilityQuery): Promise<TimeAvailabilityResult> {
      const normalized = normalizeTimeAvailabilityQuery(query);
      const instance = await repository.getWorkspaceInstance(normalized.workspaceInstanceId);
      if (!instance) {
        throw new AvailabilityValidationError(
          `Workspace instance not found: ${normalized.workspaceInstanceId}`
        );
      }

      const settings = await repository.getBusinessSettings();
      const workspaceAvailability = getWorkspaceAvailabilityStatus(instance);
      const slots = await listTimeSlotsForDate(
        repository,
        settings,
        workspaceAvailability.isBookable,
        instance.id,
        normalized.date,
        normalized.durationMinutes,
        normalized.nowIso ? new Date(normalized.nowIso) : new Date()
      );

      return {
        workspaceInstanceId: instance.id,
        date: normalized.date,
        timezone: settings.timezone,
        bookingIntervalMinutes: settings.bookingIntervalMinutes,
        workspaceIsBookable: workspaceAvailability.isBookable,
        workspaceBlockingReason: workspaceAvailability.blockingReason,
        slots,
      };
    },

    async listTemplateAvailability(query: TemplateAvailabilityQuery): Promise<TemplateAvailabilityResult> {
      const normalized = normalizeTemplateAvailabilityQuery(query);
      if (!repository.listWorkspaceInstancesByTemplate) {
        throw new Error('Repository does not support listWorkspaceInstancesByTemplate');
      }

      const instances = await repository.listWorkspaceInstancesByTemplate(normalized.templateId);
      if (instances.length === 0) {
        throw new AvailabilityValidationError(
          `No active instances found for template: ${normalized.templateId}`
        );
      }

      const templateName = instances[0].template.name;
      const settings = await repository.getBusinessSettings();
      const now = normalized.nowIso ? new Date(normalized.nowIso) : new Date();

      const allInstances: AvailableInstanceSummary[] = [];

      for (const instance of instances) {
        const workspaceAvailability = getWorkspaceAvailabilityStatus(instance);
        const photoPosition = (instance.template.defaultStyle as any)?.photoPosition;

        if (!workspaceAvailability.isBookable) {
          allInstances.push({
            workspaceInstanceId: instance.id,
            templateId: instance.templateId,
            floorId: instance.floorId,
            floorName: instance.floor.name,
            instanceCode: instance.instanceCode,
            displayName: instance.displayName,
            templateName: instance.template.name,
            rateAmount: instance.template.rateAmount,
            capacity: instance.template.capacity,
            photoPath: instance.template.photoPath,
            photoPosition: photoPosition && typeof photoPosition === 'object' ? photoPosition : undefined,
            operationalStatus: instance.operationalStatus,
            isAvailable: false,
            blockingReason: workspaceAvailability.blockingReason || instance.operationalStatus,
          });
          continue;
        }

        const slots = await listTimeSlotsForDate(
          repository,
          settings,
          true,
          instance.id,
          normalized.date,
          normalized.durationMinutes,
          now
        );

        if (normalized.startTime) {
          const targetSlot = slots.find((s) => s.startTime === normalized.startTime);
          const isAvailable = Boolean(targetSlot && targetSlot.isAvailable);
          const blockingReason = isAvailable ? null : (targetSlot?.blockingReason ?? 'UNAVAILABLE');

          allInstances.push({
            workspaceInstanceId: instance.id,
            templateId: instance.templateId,
            floorId: instance.floorId,
            floorName: instance.floor.name,
            instanceCode: instance.instanceCode,
            displayName: instance.displayName,
            templateName: instance.template.name,
            rateAmount: instance.template.rateAmount,
            capacity: instance.template.capacity,
            photoPath: instance.template.photoPath,
            photoPosition: photoPosition && typeof photoPosition === 'object' ? photoPosition : undefined,
            operationalStatus: instance.operationalStatus,
            isAvailable,
            blockingReason,
          });
        } else {
          const hasAnyAvailable = slots.some((s) => s.isAvailable);
          allInstances.push({
            workspaceInstanceId: instance.id,
            templateId: instance.templateId,
            floorId: instance.floorId,
            floorName: instance.floor.name,
            instanceCode: instance.instanceCode,
            displayName: instance.displayName,
            templateName: instance.template.name,
            rateAmount: instance.template.rateAmount,
            capacity: instance.template.capacity,
            photoPath: instance.template.photoPath,
            photoPosition: photoPosition && typeof photoPosition === 'object' ? photoPosition : undefined,
            operationalStatus: instance.operationalStatus,
            isAvailable: hasAnyAvailable,
            blockingReason: hasAnyAvailable ? null : 'NO_TIME_REMAINING',
          });
        }
      }

      let endTime: string | null = null;
      if (normalized.startTime) {
        const startMinutes = parseTimeToMinutes(normalized.startTime);
        endTime = formatMinutes(startMinutes + normalized.durationMinutes);
      }

      return {
        templateId: normalized.templateId,
        templateName,
        date: normalized.date,
        durationMinutes: normalized.durationMinutes,
        startTime: normalized.startTime ?? null,
        endTime,
        timezone: settings.timezone,
        bookingIntervalMinutes: settings.bookingIntervalMinutes,
        availableInstances: allInstances.filter((i) => i.isAvailable),
        allInstances,
      };
    },

    async listOccupiedInstances(query?: { nowIso?: string }): Promise<OccupiedInstancesResult> {
      const now = query?.nowIso ? new Date(query.nowIso) : new Date();
      const fiveMinLater = new Date(now.getTime() + 5 * 60 * 1000);
      const rangeStartIso = now.toISOString();
      const rangeEndIso = fiveMinLater.toISOString();

      if (repository.listOccupiedInstances) {
        const ids = await repository.listOccupiedInstances(rangeStartIso, rangeEndIso);
        return { occupiedInstanceIds: ids, asOf: rangeStartIso };
      }

      return { occupiedInstanceIds: [], asOf: rangeStartIso };
    },
  };
}

async function listDateAvailabilityForRange(
  repository: AvailabilityRepository,
  settings: { timezone: string; bookingIntervalMinutes: number },
  workspaceIsBookable: boolean,
  query: Required<DateAvailabilityQuery>,
  now: Date
): Promise<AvailableDate[]> {
  const dates: AvailableDate[] = [];
  let currentDate = query.startDate;

  while (currentDate <= query.endDate) {
    const slots = await listTimeSlotsForDate(
      repository,
      settings,
      workspaceIsBookable,
      query.workspaceInstanceId,
      currentDate,
      query.durationMinutes,
      now
    );

    const firstAvailable = slots.find((slot) => slot.isAvailable);
    dates.push({
      date: currentDate,
      isAvailable: Boolean(firstAvailable),
      reason: resolveDateReason(workspaceIsBookable, slots),
      firstAvailableTime: firstAvailable?.startTime ?? null,
    });

    currentDate = addDays(currentDate, 1);
  }

  return dates;
}

async function listTimeSlotsForDate(
  repository: AvailabilityRepository,
  settings: { timezone: string; bookingIntervalMinutes: number },
  workspaceIsBookable: boolean,
  workspaceInstanceId: string,
  date: string,
  durationMinutes: number,
  now: Date
): Promise<AvailableTimeSlot[]> {
  if (!workspaceIsBookable) {
    return [];
  }

  const dayOfWeek = getDayOfWeek(date);
  const intervals = (await repository.listOperatingHours(dayOfWeek))
    .filter((interval) => interval.isActive)
    .sort((left, right) => left.opensAt.localeCompare(right.opensAt));

  if (intervals.length === 0) {
    return [];
  }

  const rangeStart = zonedDateTimeToUtc(date, '00:00', settings.timezone);
  const rangeEnd = zonedDateTimeToUtc(addDays(date, 1), '00:00', settings.timezone);
  const [blocks, reservations] = await Promise.all([
    repository.listScheduleBlocks(
      workspaceInstanceId,
      rangeStart.toISOString(),
      rangeEnd.toISOString()
    ),
    repository.listBlockingReservations(
      workspaceInstanceId,
      rangeStart.toISOString(),
      rangeEnd.toISOString()
    ),
  ]);

  const slots: AvailableTimeSlot[] = [];
  for (const interval of intervals) {
    slots.push(
      ...buildIntervalSlots({
        interval,
        date,
        durationMinutes,
        bookingIntervalMinutes: settings.bookingIntervalMinutes,
        timezone: settings.timezone,
        now,
        blocks,
        reservations,
      })
    );
  }

  return dedupeSlots(slots);
}

function buildIntervalSlots(input: {
  interval: OperatingHoursInterval;
  date: string;
  durationMinutes: number;
  bookingIntervalMinutes: number;
  timezone: string;
  now: Date;
  blocks: ScheduleBlock[];
  reservations: BlockingReservationWindow[];
}): AvailableTimeSlot[] {
  const intervalStartMinutes = parseTimeToMinutes(input.interval.opensAt);
  const intervalEndMinutes = parseTimeToMinutes(input.interval.closesAt);
  const latestStartMinutes = intervalEndMinutes - input.durationMinutes;

  if (latestStartMinutes < intervalStartMinutes) {
    return [];
  }

  const slots: AvailableTimeSlot[] = [];
  for (
    let startMinutes = intervalStartMinutes;
    startMinutes <= latestStartMinutes;
    startMinutes += input.bookingIntervalMinutes
  ) {
    const endMinutes = startMinutes + input.durationMinutes;
    const startTime = formatMinutes(startMinutes);
    const endTime = formatMinutes(endMinutes);
    const slotStart = zonedDateTimeToUtc(input.date, startTime, input.timezone);
    const slotEnd = new Date(slotStart.getTime() + input.durationMinutes * 60_000);

    const blockingReason = getSlotBlockingReason(
      slotStart,
      slotEnd,
      input.now,
      input.blocks,
      input.reservations
    );

    slots.push({
      startTime,
      endTime,
      isAvailable: blockingReason === null,
      blockingReason,
    });
  }

  return slots;
}

function getSlotBlockingReason(
  slotStart: Date,
  slotEnd: Date,
  now: Date,
  blocks: ScheduleBlock[],
  reservations: BlockingReservationWindow[]
) {
  if (slotStart.getTime() + 60_000 <= now.getTime()) {
    return 'PAST_TIME' as const;
  }

  if (blocks.some((block) => rangesOverlap(slotStart, slotEnd, new Date(block.startAt), new Date(block.endAt)))) {
    return 'SCHEDULE_BLOCKED' as const;
  }

  if (
    reservations.some((reservation) =>
      rangesOverlap(slotStart, slotEnd, new Date(reservation.startAt), new Date(reservation.endAt))
    )
  ) {
    return 'RESERVATION_CONFLICT' as const;
  }

  return null;
}

function resolveDateReason(workspaceIsBookable: boolean, slots: AvailableTimeSlot[]) {
  if (!workspaceIsBookable) {
    return 'WORKSPACE_NOT_BOOKABLE' as const;
  }
  if (slots.length === 0) {
    return 'BUSINESS_CLOSED' as const;
  }
  if (slots.some((slot) => slot.isAvailable)) {
    return 'AVAILABLE' as const;
  }
  return slots.some((slot) => slot.blockingReason === 'SCHEDULE_BLOCKED')
    ? ('BLOCKED' as const)
    : ('NO_TIME_REMAINING' as const);
}

function dedupeSlots(slots: AvailableTimeSlot[]): AvailableTimeSlot[] {
  const seen = new Set<string>();
  const deduped: AvailableTimeSlot[] = [];

  for (const slot of slots) {
    if (seen.has(slot.startTime)) {
      continue;
    }
    seen.add(slot.startTime);
    deduped.push(slot);
  }

  return deduped.sort((a, b) => a.startTime.localeCompare(b.startTime));
}

function normalizeDateAvailabilityQuery(query: DateAvailabilityQuery): Required<DateAvailabilityQuery> {
  const workspaceInstanceId = requireNonBlank(query.workspaceInstanceId, 'Workspace instance id');
  const startDate = requireDateString(query.startDate, 'Start date');
  const endDate = requireDateString(query.endDate, 'End date');
  const durationMinutes = requirePositiveMinutes(query.durationMinutes, 'Duration');

  if (startDate > endDate) {
    throw new AvailabilityValidationError('Start date must be on or before end date');
  }

  return {
    workspaceInstanceId,
    startDate,
    endDate,
    durationMinutes,
    nowIso: query.nowIso ?? new Date().toISOString(),
  };
}

function normalizeTimeAvailabilityQuery(query: TimeAvailabilityQuery): Required<TimeAvailabilityQuery> {
  return {
    workspaceInstanceId: requireNonBlank(query.workspaceInstanceId, 'Workspace instance id'),
    date: requireDateString(query.date, 'Date'),
    durationMinutes: requirePositiveMinutes(query.durationMinutes, 'Duration'),
    nowIso: query.nowIso ?? new Date().toISOString(),
  };
}

function normalizeTemplateAvailabilityQuery(query: TemplateAvailabilityQuery): Required<Omit<TemplateAvailabilityQuery, 'startTime'>> & {
  startTime?: string;
} {
  let startTime: string | undefined = undefined;
  if (query.startTime && query.startTime.trim().length > 0) {
    const trimmed = query.startTime.trim();
    if (!/^(\d{1,2}):(\d{2})(?::\d{2})?$/.test(trimmed)) {
      throw new AvailabilityValidationError(`Invalid start time: ${trimmed}`);
    }
    const [h, m] = trimmed.split(':');
    startTime = `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
  }

  return {
    templateId: requireNonBlank(query.templateId, 'Template id'),
    date: requireDateString(query.date, 'Date'),
    durationMinutes: requirePositiveMinutes(query.durationMinutes, 'Duration'),
    nowIso: query.nowIso ?? new Date().toISOString(),
    startTime,
  };
}

function requireNonBlank(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AvailabilityValidationError(`${label} is required`);
  }

  return value.trim();
}

function requireDateString(value: string, label: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new AvailabilityValidationError(`${label} must use YYYY-MM-DD format`);
  }

  return value;
}

function requirePositiveMinutes(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new AvailabilityValidationError(`${label} must be a positive integer number of minutes`);
  }

  return value;
}

function parseTimeToMinutes(value: string): number {
  const match = value.match(/^(\d{2}):(\d{2})(?::\d{2})?$/);
  if (!match) {
    throw new AvailabilityValidationError(`Invalid time value: ${value}`);
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours * 60 + minutes;
}

function formatMinutes(totalMinutes: number): string {
  if (totalMinutes === MINUTES_PER_DAY) {
    return '24:00';
  }
  const normalized = ((totalMinutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(
    value.getUTCDate()
  ).padStart(2, '0')}`;
}

function getDayOfWeek(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function rangesOverlap(
  leftStart: Date,
  leftEnd: Date,
  rightStart: Date,
  rightEnd: Date
): boolean {
  return leftStart.getTime() < rightEnd.getTime() && leftEnd.getTime() > rightStart.getTime();
}

function zonedDateTimeToUtc(date: string, time: string, timezone: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  const [hours, minutes] = time.split(':').map(Number);
  let utcTimestamp = Date.UTC(year, month - 1, day, hours, minutes, 0);

  for (let iteration = 0; iteration < 2; iteration += 1) {
    const offsetMinutes = getTimezoneOffsetMinutes(new Date(utcTimestamp), timezone);
    utcTimestamp = Date.UTC(year, month - 1, day, hours, minutes, 0) - offsetMinutes * 60_000;
  }

  return new Date(utcTimestamp);
}

function getTimezoneOffsetMinutes(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)])
  ) as Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', number>;

  const zonedAsUtc = Date.UTC(
    values.year,
    values.month - 1,
    values.day,
    values.hour,
    values.minute,
    values.second
  );

  return Math.round((zonedAsUtc - date.getTime()) / 60_000);
}
