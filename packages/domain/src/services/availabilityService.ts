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
  NextUpcomingBookingResult,
  ValidateReservationWindowQuery,
  ReservationWindowValidationResult,
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
        normalized.nowIso ? new Date(normalized.nowIso) : new Date(),
        normalized.minimumLeadMinutes
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
          now,
          normalized.minimumLeadMinutes
        );

        if (normalized.startTime) {
          const targetSlot = slots.find((s) => s.startTime === normalized.startTime);
          let isAvailable = Boolean(targetSlot && targetSlot.isAvailable);
          let blockingReason = isAvailable ? null : (targetSlot?.blockingReason ?? 'UNAVAILABLE');

          if (!targetSlot) {
            const dayOfWeek = getDayOfWeek(normalized.date);
            const intervals = (await repository.listOperatingHours(dayOfWeek)).filter((i) => i.isActive);
            const startMinutes = parseTimeToMinutes(normalized.startTime);
            const operatingHoursByDay = new Map<number, OperatingHoursInterval[]>();
            operatingHoursByDay.set(dayOfWeek, intervals);

            const isCovered = checkOperatingHoursCoverage({
              date: normalized.date,
              startMinutes,
              durationMinutes: normalized.durationMinutes,
              operatingHoursByDay,
            });

            const slotStart = zonedDateTimeToUtc(normalized.date, normalized.startTime, settings.timezone);
            const slotEnd = new Date(slotStart.getTime() + normalized.durationMinutes * 60_000);

            const [blocks, reservations] = await Promise.all([
              repository.listScheduleBlocks(instance.id, slotStart.toISOString(), slotEnd.toISOString()),
              repository.listBlockingReservations(instance.id, slotStart.toISOString(), slotEnd.toISOString()),
            ]);

            const reason = getSlotBlockingReason(
              slotStart,
              slotEnd,
              now,
              isCovered,
              blocks,
              reservations,
              normalized.minimumLeadMinutes
            );
            isAvailable = reason === null;
            blockingReason = reason;
          }

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

    async listOccupiedInstances(query?: { nowIso?: string; durationMinutes?: number }): Promise<OccupiedInstancesResult> {
      const now = query?.nowIso ? new Date(query.nowIso) : new Date();
      const durationMs = query?.durationMinutes && query.durationMinutes > 0
        ? query.durationMinutes * 60 * 1000
        : 5 * 60 * 1000;
      const endWindow = new Date(now.getTime() + durationMs);
      const rangeStartIso = now.toISOString();
      const rangeEndIso = endWindow.toISOString();

      if (repository.listOccupiedInstances) {
        const ids = await repository.listOccupiedInstances(rangeStartIso, rangeEndIso);
        return { occupiedInstanceIds: ids, asOf: rangeStartIso };
      }

      return { occupiedInstanceIds: [], asOf: rangeStartIso };
    },

    async getNextUpcomingBooking(
      workspaceInstanceId: string,
      nowIso?: string
    ): Promise<NextUpcomingBookingResult> {
      const now = nowIso ? new Date(nowIso) : new Date();
      const startIso = now.toISOString();
      const endWindow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

      const settings = await repository.getBusinessSettings();
      const timezone = settings.timezone || 'Asia/Manila';

      const [blocking, scheduleBlocks] = await Promise.all([
        workspaceInstanceId
          ? repository.listBlockingReservations(workspaceInstanceId, startIso, endWindow)
          : Promise.resolve([]),
        repository.listScheduleBlocks(workspaceInstanceId || '', startIso, endWindow),
      ]);

      const allUpcoming = [
        ...blocking.map((b) => ({
          startAt: b.startAt,
          endAt: b.endAt,
          type: 'RESERVATION' as const,
        })),
        ...scheduleBlocks
          .filter((s) => s.scope === 'BUSINESS' || s.workspaceInstanceId === workspaceInstanceId)
          .map((s) => ({
            startAt: s.startAt,
            endAt: s.endAt,
            type: 'SCHEDULE_BLOCK' as const,
            blockType: s.blockType,
            reason: s.reason,
          })),
      ]
        .filter((item) => new Date(item.endAt).getTime() > now.getTime())
        .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());

      const next = allUpcoming[0] ?? null;
      let minutesUntilNextBooking: number | null = null;
      if (next) {
        const diffMs = new Date(next.startAt).getTime() - now.getTime();
        minutesUntilNextBooking = Math.max(0, Math.floor(diffMs / (60 * 1000)));
      }

      // Check operating hours closing time
      const { dateStr, dayOfWeek } = getDatePartsInTz(now, timezone);
      const dayIntervals = (await repository.listOperatingHours(dayOfWeek))
        .filter((i) => i.isActive)
        .sort((a, b) => a.opensAt.localeCompare(b.opensAt));

      let operatingHoursCloseAt: string | null = null;
      let minutesUntilClosing: number | null = null;

      if (dayIntervals.length > 0) {
        const lastInterval = dayIntervals[dayIntervals.length - 1];
        const closeUtc = zonedDateTimeToUtc(dateStr, lastInterval.closesAt, timezone);
        operatingHoursCloseAt = closeUtc.toISOString();
        const diffCloseMs = closeUtc.getTime() - now.getTime();
        minutesUntilClosing = Math.max(0, Math.floor(diffCloseMs / (60 * 1000)));
      } else {
        // Venue is closed for the entire day
        operatingHoursCloseAt = null;
        minutesUntilClosing = 0;
      }

      // Kiosk walk-in sessions cap at max 24 hours (1440 minutes) or closing time
      let maxAvailableMinutes: number | null = 24 * 60;
      if (minutesUntilClosing !== null) {
        maxAvailableMinutes = Math.min(maxAvailableMinutes, minutesUntilClosing);
      }
      if (minutesUntilNextBooking !== null) {
        maxAvailableMinutes = Math.min(maxAvailableMinutes, minutesUntilNextBooking);
      }

      const maxAvailableHours = maxAvailableMinutes !== null ? Math.floor(maxAvailableMinutes / 60) : null;

      const formatTimeInTz = (iso: string) => {
        try {
          return new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
          }).format(new Date(iso));
        } catch {
          return iso;
        }
      };

      return {
        workspaceInstanceId,
        nowIso: startIso,
        nextBooking: next
          ? {
              startAt: next.startAt,
              endAt: next.endAt,
              type: next.type,
              startTimeFormatted: formatTimeInTz(next.startAt),
              blockType: 'blockType' in next ? (next as any).blockType : undefined,
              reason: 'reason' in next ? (next as any).reason : undefined,
            }
          : null,
        minutesUntilNextBooking,
        operatingHoursCloseAt,
        minutesUntilClosing,
        maxAvailableMinutes,
        maxAvailableHours,
      };
    },

    async validateReservationWindow(
      query: ValidateReservationWindowQuery
    ): Promise<ReservationWindowValidationResult> {
      const { workspaceInstanceId, startAt, endAt, maxDurationMinutes = 24 * 60 } = query;
      const startMs = new Date(startAt).getTime();
      const endMs = new Date(endAt).getTime();
      const durationMinutes = Math.round((endMs - startMs) / 60000);

      if (durationMinutes <= 0) {
        return {
          isValid: false,
          conflictType: 'MAX_DURATION_EXCEEDED',
          errorMessage: 'Invalid reservation duration.',
        };
      }

      if (durationMinutes > maxDurationMinutes) {
        return {
          isValid: false,
          conflictType: 'MAX_DURATION_EXCEEDED',
          errorMessage:
            'The requested duration extends into a scheduled facility closure or non-operational period.',
        };
      }

      const settings = await repository.getBusinessSettings();
      const timezone = settings.timezone || 'Asia/Manila';

      // 1. Check schedule blocks across [startAt, endAt)
      const scheduleBlocks = await repository
        .listScheduleBlocks(workspaceInstanceId, startAt, endAt)
        .catch(() => []);

      const closureBlock = scheduleBlocks.find(
        (b) => b.scope === 'BUSINESS' || b.blockType === 'CLOSURE'
      );
      if (closureBlock) {
        return {
          isValid: false,
          conflictType: 'FACILITY_CLOSURE',
          errorMessage:
            'The requested duration extends into a scheduled facility closure or non-operational period.',
        };
      }

      const maintenanceBlock = scheduleBlocks.find((b) => b.blockType === 'MAINTENANCE');
      if (maintenanceBlock) {
        return {
          isValid: false,
          conflictType: 'MAINTENANCE_BLOCK',
          errorMessage:
            'The selected workspace is unavailable for the requested time window due to a scheduled maintenance block.',
        };
      }

      // 2. Check operating hours coverage
      const { dateStr: startDateStr, timeStr: startTimeStr } = getDatePartsInTz(
        new Date(startMs),
        timezone
      );
      const startDayOfWeek = getDayOfWeek(startDateStr);
      const startMinutes = parseTimeToMinutes(startTimeStr);

      const extraDays = Math.ceil(durationMinutes / MINUTES_PER_DAY) + 1;
      const operatingHoursByDay = new Map<number, OperatingHoursInterval[]>();

      const daysToFetch = new Set<number>();
      for (let i = 0; i <= extraDays; i++) {
        daysToFetch.add((startDayOfWeek + i) % 7);
      }

      await Promise.all(
        Array.from(daysToFetch).map(async (d) => {
          const intervals = (await repository.listOperatingHours(d))
            .filter((interval) => interval.isActive)
            .sort((left, right) => left.opensAt.localeCompare(right.opensAt));
          operatingHoursByDay.set(d, intervals);
        })
      );

      const isCovered = checkOperatingHoursCoverage({
        date: startDateStr,
        startMinutes,
        durationMinutes,
        operatingHoursByDay,
      });

      if (!isCovered) {
        return {
          isValid: false,
          conflictType: 'BUSINESS_CLOSED',
          errorMessage:
            'The requested duration extends into a scheduled facility closure or non-operational period.',
        };
      }

      // 3. Check blocking reservations
      if (workspaceInstanceId) {
        const blocking = await repository
          .listBlockingReservations(workspaceInstanceId, startAt, endAt)
          .catch(() => []);

        if (blocking.length > 0) {
          return {
            isValid: false,
            conflictType: 'RESERVATION_CONFLICT',
            errorMessage:
              'The selected workspace is unavailable for the requested time window due to an existing reservation.',
          };
        }
      }

      return { isValid: true };
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
      now,
      query.minimumLeadMinutes
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
  now: Date,
  minimumLeadMinutes: number = 0
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
  const extraDays = Math.ceil(durationMinutes / MINUTES_PER_DAY) + 1;
  const rangeEnd = zonedDateTimeToUtc(addDays(date, extraDays), '00:00', settings.timezone);

  const operatingHoursByDay = new Map<number, OperatingHoursInterval[]>();
  operatingHoursByDay.set(dayOfWeek, intervals);

  const daysToFetch = new Set<number>();
  for (let i = 1; i <= extraDays; i++) {
    daysToFetch.add((dayOfWeek + i) % 7);
  }

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
    ...Array.from(daysToFetch).map(async (d) => {
      const dayIntervals = (await repository.listOperatingHours(d))
        .filter((interval) => interval.isActive)
        .sort((left, right) => left.opensAt.localeCompare(right.opensAt));
      operatingHoursByDay.set(d, dayIntervals);
    }),
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
        operatingHoursByDay,
        minimumLeadMinutes,
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
  operatingHoursByDay: Map<number, OperatingHoursInterval[]>;
  minimumLeadMinutes?: number;
}): AvailableTimeSlot[] {
  const intervalStartMinutes = parseTimeToMinutes(input.interval.opensAt);
  const intervalEndMinutes = parseTimeToMinutes(input.interval.closesAt);

  let latestStartMinutes: number;
  if (intervalEndMinutes >= MINUTES_PER_DAY) {
    // When interval extends to midnight (24:00), allow start times up to the last interval slot of the day
    latestStartMinutes = MINUTES_PER_DAY - input.bookingIntervalMinutes;
  } else {
    // When interval closes before midnight, booking must complete before interval closes
    latestStartMinutes = intervalEndMinutes - input.durationMinutes;
  }

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

    const isCovered = checkOperatingHoursCoverage({
      date: input.date,
      startMinutes,
      durationMinutes: input.durationMinutes,
      operatingHoursByDay: input.operatingHoursByDay,
    });

    const blockingReason = getSlotBlockingReason(
      slotStart,
      slotEnd,
      input.now,
      isCovered,
      input.blocks,
      input.reservations,
      input.minimumLeadMinutes ?? 0
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

function checkOperatingHoursCoverage(input: {
  date: string;
  startMinutes: number;
  durationMinutes: number;
  operatingHoursByDay: Map<number, OperatingHoursInterval[]>;
}): boolean {
  let remainingMinutes = input.durationMinutes;
  let currentStartMinutes = input.startMinutes;
  let currentDate = input.date;

  while (remainingMinutes > 0) {
    const minutesUntilMidnight = MINUTES_PER_DAY - currentStartMinutes;
    const minutesInThisDay = Math.min(remainingMinutes, minutesUntilMidnight);
    const currentEndMinutes = currentStartMinutes + minutesInThisDay;

    const currentDayOfWeek = getDayOfWeek(currentDate);
    const intervals = input.operatingHoursByDay.get(currentDayOfWeek) || [];

    const isCovered = intervals.some((interval) => {
      const openMin = parseTimeToMinutes(interval.opensAt);
      const closeMin = parseTimeToMinutes(interval.closesAt);
      return openMin <= currentStartMinutes && closeMin >= currentEndMinutes;
    });

    if (!isCovered) {
      return false;
    }

    remainingMinutes -= minutesInThisDay;
    currentStartMinutes = 0;
    currentDate = addDays(currentDate, 1);
  }

  return true;
}

function getSlotBlockingReason(
  slotStart: Date,
  slotEnd: Date,
  now: Date,
  isCoveredByOperatingHours: boolean,
  blocks: ScheduleBlock[],
  reservations: BlockingReservationWindow[],
  minimumLeadMinutes: number = 0
) {
  if (slotStart.getTime() + 60_000 <= now.getTime()) {
    return 'PAST_TIME' as const;
  }

  if (minimumLeadMinutes > 0 && slotStart.getTime() - now.getTime() < minimumLeadMinutes * 60_000) {
    return 'IMMEDIATE_WALK_IN_ONLY' as const;
  }

  if (!isCoveredByOperatingHours) {
    return 'BUSINESS_CLOSED' as const;
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

function resolveMinimumLeadMinutes(channel?: 'ONLINE' | 'KIOSK', minimumLeadMinutes?: number): number {
  if (minimumLeadMinutes !== undefined) {
    return Math.max(0, minimumLeadMinutes);
  }
  if (channel === 'ONLINE') {
    return 30;
  }
  return 0;
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
    channel: query.channel ?? (query.minimumLeadMinutes !== undefined && query.minimumLeadMinutes > 0 ? 'ONLINE' : 'KIOSK'),
    minimumLeadMinutes: resolveMinimumLeadMinutes(query.channel, query.minimumLeadMinutes),
  };
}

function normalizeTimeAvailabilityQuery(query: TimeAvailabilityQuery): Required<TimeAvailabilityQuery> {
  return {
    workspaceInstanceId: requireNonBlank(query.workspaceInstanceId, 'Workspace instance id'),
    date: requireDateString(query.date, 'Date'),
    durationMinutes: requirePositiveMinutes(query.durationMinutes, 'Duration'),
    nowIso: query.nowIso ?? new Date().toISOString(),
    channel: query.channel ?? (query.minimumLeadMinutes !== undefined && query.minimumLeadMinutes > 0 ? 'ONLINE' : 'KIOSK'),
    minimumLeadMinutes: resolveMinimumLeadMinutes(query.channel, query.minimumLeadMinutes),
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
    channel: query.channel ?? (query.minimumLeadMinutes !== undefined && query.minimumLeadMinutes > 0 ? 'ONLINE' : 'KIOSK'),
    minimumLeadMinutes: resolveMinimumLeadMinutes(query.channel, query.minimumLeadMinutes),
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

export function getDatePartsInTz(
  date: Date,
  timezone: string
): { dateStr: string; dayOfWeek: number; timeStr: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const year = parts.find((p) => p.type === 'year')?.value ?? '2026';
  const month = parts.find((p) => p.type === 'month')?.value ?? '01';
  const day = parts.find((p) => p.type === 'day')?.value ?? '01';
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';

  const dateStr = `${year}-${month}-${day}`;
  const dayOfWeek = getDayOfWeek(dateStr);
  const timeStr = `${hour}:${minute}`;

  return { dateStr, dayOfWeek, timeStr };
}

function rangesOverlap(
  leftStart: Date,
  leftEnd: Date,
  rightStart: Date,
  rightEnd: Date
): boolean {
  return leftStart.getTime() < rightEnd.getTime() && leftEnd.getTime() > rightStart.getTime();
}

export function parseTimeToHoursAndMinutes(timeStr: string): { hours: number; minutes: number } {
  const trimmed = (timeStr || '').trim();
  const isPm = /pm/i.test(trimmed);
  const isAm = /am/i.test(trimmed);
  const cleanTime = trimmed.replace(/[^\d:]/g, '');
  const [hStr, mStr] = cleanTime.split(':');
  let hours = Number(hStr) || 0;
  const minutes = Number(mStr) || 0;

  if (isPm && hours < 12) {
    hours += 12;
  } else if (isAm && hours === 12) {
    hours = 0;
  }

  return { hours, minutes };
}

export function zonedDateTimeToUtc(date: string, time: string, timezone: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  const { hours, minutes } = parseTimeToHoursAndMinutes(time);
  let utcTimestamp = Date.UTC(year, month - 1, day, hours, minutes, 0);

  for (let iteration = 0; iteration < 2; iteration += 1) {
    const offsetMinutes = getTimezoneOffsetMinutes(new Date(utcTimestamp), timezone);
    utcTimestamp = Date.UTC(year, month - 1, day, hours, minutes, 0) - offsetMinutes * 60_000;
  }

  return new Date(utcTimestamp);
}

export function getTimezoneOffsetMinutes(date: Date, timezone: string): number {
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
