import type { DeskAtlasUser } from '../models/user';
import type { OperatingHoursInterval } from '../models/availability';
import type {
  AdminPaymentMethod,
  BusinessClosureException,
  BusinessOperatingHoursMode,
  BusinessSettings,
  CreateBusinessClosureInput,
  CreatePaymentMethodInput,
  LandingPreviewPhoto,
  OperatingHoursConfig,
  OperatingHoursDaySchedule,
  PublicLandingPreviewPhoto,
  SettingsOverview,
  UpdateBusinessSettingsInput,
  UpdateOperatingHoursInput,
  UpdatePaymentMethodInput,
  WorkspaceStatusColors,
} from '../models/settings';
import type { SettingsRepository } from './settingsRepository';
import { normalizeWorkspaceStatusColors } from './workspaceStatusColorService';

export class SettingsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettingsValidationError';
  }
}

export function createAdminSettingsService(repository: SettingsRepository) {
  return {
    async getSettingsOverview(): Promise<SettingsOverview> {
      const [businessSettings, rawOperatingHours, paymentMethods] = await Promise.all([
        repository.getBusinessSettings(),
        repository.listOperatingHours(),
        repository.listPaymentMethods(),
      ]);

      const operatingHoursConfig = buildOperatingHoursConfig(rawOperatingHours);

      return {
        businessSettings,
        operatingHoursConfig,
        paymentMethods,
      };
    },

    async getPublicBusinessSettings(): Promise<{
      businessName: string;
      timezone: string;
      contactEmail?: string | null;
      contactPhone?: string | null;
      facebookUrl?: string | null;
      instagramUrl?: string | null;
      twitterUrl?: string | null;
      websiteUrl?: string | null;
      customerSessionTimeoutMinutes: number;
      customerRescheduleCutoffHours: number;
      bookingIntervalMinutes: number;
      paymentExpiryMinutes: number;
      kioskAllowanceMinutes: number;
      bookingEndAlertMinutes: number;
      statusColors: WorkspaceStatusColors;
      cancellationPolicyPdfUrl?: string | null;
      cancellationPolicyPdfFilename?: string | null;
      cancellationPolicyUpdatedAt?: string | null;
    }> {
      const businessSettings = await repository.getBusinessSettings();
      return {
        businessName: businessSettings.businessName,
        timezone: businessSettings.timezone,
        contactEmail: businessSettings.contactEmail ?? null,
        contactPhone: businessSettings.contactPhone ?? null,
        facebookUrl: businessSettings.facebookUrl ?? null,
        instagramUrl: businessSettings.instagramUrl ?? null,
        twitterUrl: businessSettings.twitterUrl ?? null,
        websiteUrl: businessSettings.websiteUrl ?? null,
        customerSessionTimeoutMinutes: businessSettings.customerSessionTimeoutMinutes ?? 20,
        customerRescheduleCutoffHours: businessSettings.customerRescheduleCutoffHours ?? 12,
        bookingIntervalMinutes: businessSettings.bookingIntervalMinutes ?? 30,
        paymentExpiryMinutes: businessSettings.paymentExpiryMinutes ?? 60,
        kioskAllowanceMinutes: getKioskAllowanceMinutes(businessSettings.kioskAllowanceMinutes),
        bookingEndAlertMinutes: getBookingEndAlertMinutes(businessSettings.bookingEndAlertMinutes),
        statusColors: normalizeWorkspaceStatusColors(businessSettings.statusColors),
        cancellationPolicyPdfUrl: businessSettings.cancellationPolicyPdfUrl ?? null,
        cancellationPolicyPdfFilename: businessSettings.cancellationPolicyPdfFilename ?? null,
        cancellationPolicyUpdatedAt: businessSettings.cancellationPolicyUpdatedAt ?? null,
      };
    },

    async getPublicLandingPreviewPhotos(): Promise<PublicLandingPreviewPhoto[]> {
      const businessSettings = await repository.getBusinessSettings();
      const photos = businessSettings.landingPreviewPhotos ?? [];
      return photos
        .filter((p) => Boolean(p.url && !p.url.startsWith('data:')))
        .sort((a, b) => a.displayOrder - b.displayOrder)
        .slice(0, 3)
        .map((p) => ({
          id: p.id,
          url: p.url,
          position: {
            x: Math.max(0, Math.min(100, Number(p.position?.x ?? 50))),
            y: Math.max(0, Math.min(100, Number(p.position?.y ?? 50))),
          },
          displayOrder: p.displayOrder,
        }));
    },

    async updateBusinessSettings(
      input: UpdateBusinessSettingsInput,
      actor?: DeskAtlasUser | null
    ): Promise<BusinessSettings> {
      const normalized = normalizeBusinessSettingsInput(input);
      return repository.updateBusinessSettings(normalized, actor?.id ?? null);
    },

    async updateOperatingHours(
      input: UpdateOperatingHoursInput,
      _actor?: DeskAtlasUser | null
    ): Promise<OperatingHoursConfig> {
      const intervalsToSave = normalizeOperatingHoursInput(input);
      const saved = await repository.replaceOperatingHours(intervalsToSave);
      return buildOperatingHoursConfig(saved);
    },

    async createPaymentMethod(
      input: CreatePaymentMethodInput,
      _actor?: DeskAtlasUser | null
    ): Promise<AdminPaymentMethod> {
      const normalized = normalizeCreatePaymentMethodInput(input);
      return repository.createPaymentMethod(normalized);
    },

    async updatePaymentMethod(
      input: UpdatePaymentMethodInput,
      _actor?: DeskAtlasUser | null
    ): Promise<AdminPaymentMethod> {
      const normalized = normalizePaymentMethodInput(input);
      return repository.updatePaymentMethod(normalized);
    },

    async deletePaymentMethod(
      id: string,
      _actor?: DeskAtlasUser | null
    ): Promise<void> {
      if (!id || typeof id !== 'string' || !id.trim()) {
        throw new SettingsValidationError('Payment method ID is required');
      }
      return repository.deletePaymentMethod(id.trim());
    },

    async reorderPaymentMethods(
      orderedIds: string[],
      _actor?: DeskAtlasUser | null
    ): Promise<AdminPaymentMethod[]> {
      if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
        throw new SettingsValidationError('Ordered IDs array is required');
      }
      if (repository.reorderPaymentMethods) {
        return repository.reorderPaymentMethods(orderedIds);
      }
      // Fallback: update displayOrder sequentially
      const updated: AdminPaymentMethod[] = [];
      for (let i = 0; i < orderedIds.length; i++) {
        const item = await repository.updatePaymentMethod({
          id: orderedIds[i],
          displayName: '', // will be ignored or updated
          allowWeb: false,
          allowKiosk: false,
          isActive: true,
          displayOrder: i + 1,
        });
        updated.push(item);
      }
      return updated;
    },

    async listClosures(): Promise<BusinessClosureException[]> {
      const [businessSettings, rawBlocks] = await Promise.all([
        repository.getBusinessSettings(),
        repository.listBusinessScheduleBlocks(),
      ]);

      const timezone = businessSettings.timezone;
      const closureBlocks = rawBlocks.filter((b) => b.blockType === 'CLOSURE');
      const exceptions: BusinessClosureException[] = [];
      const partialBlocksByDate = new Map<string, typeof closureBlocks>();

      for (const block of closureBlocks) {
        const startZoned = utcToZonedDateTime(new Date(block.startAt), timezone);
        const endZoned = utcToZonedDateTime(new Date(block.endAt), timezone);

        const isFullDayAligned = startZoned.time === '00:00' && endZoned.time === '00:00';
        if (isFullDayAligned) {
          const startDay = startZoned.date;
          const endDay = addDays(endZoned.date, -1);
          const isMultiDay = endDay > startDay;
          exceptions.push({
            id: block.id,
            date: startDay,
            endDate: isMultiDay ? endDay : null,
            closureType: 'FULL_DAY',
            opensAt: null,
            closesAt: null,
            reason: block.reason,
            blockIds: [block.id],
          });
        } else {
          const list = partialBlocksByDate.get(startZoned.date) ?? [];
          list.push(block);
          partialBlocksByDate.set(startZoned.date, list);
        }
      }

      for (const [date, blocks] of partialBlocksByDate.entries()) {
        let opensAt: string | null = null;
        let closesAt: string | null = null;
        const blockIds = blocks.map((b) => b.id);
        const reason = blocks[0]?.reason ?? null;

        for (const b of blocks) {
          const bStartZoned = utcToZonedDateTime(new Date(b.startAt), timezone);
          const bEndZoned = utcToZonedDateTime(new Date(b.endAt), timezone);

          if (bStartZoned.time === '00:00') {
            opensAt = bEndZoned.time;
          }
          if (bEndZoned.time === '00:00') {
            closesAt = bStartZoned.time;
          }
        }

        exceptions.push({
          id: blockIds[0] ?? `special-${date}`,
          date,
          endDate: null,
          closureType: 'SPECIAL_HOURS',
          opensAt: opensAt ?? '00:00',
          closesAt: closesAt ?? '24:00',
          reason,
          blockIds,
        });
      }

      return exceptions.sort((a, b) => a.date.localeCompare(b.date));
    },

    async createClosure(
      input: CreateBusinessClosureInput,
      actor?: DeskAtlasUser | null
    ): Promise<BusinessClosureException> {
      if (!input.date || typeof input.date !== 'string' || !isValidDateString(input.date)) {
        throw new SettingsValidationError(`Invalid date format: ${input.date}. Expected YYYY-MM-DD`);
      }

      if (input.endDate && (!isValidDateString(input.endDate) || input.endDate < input.date)) {
        throw new SettingsValidationError('End date must be on or after start date');
      }

      const businessSettings = await repository.getBusinessSettings();
      const timezone = businessSettings.timezone || 'Asia/Manila';
      const todayStr = getTodayDateInTimezone(timezone);

      if (input.date < todayStr) {
        throw new SettingsValidationError('Closures and holidays cannot be set for past dates');
      }

      if (input.endDate && input.endDate < todayStr) {
        throw new SettingsValidationError('Closure end date cannot be in the past');
      }

      if (input.closureType === 'FULL_DAY') {
        const startDate = input.date;
        const endDate = input.endDate || input.date;

        const startUtc = zonedDateTimeToUtc(startDate, '00:00:00', timezone);
        const endUtc = zonedDateTimeToUtc(addDays(endDate, 1), '00:00:00', timezone);

        await repository.deleteBusinessScheduleBlocksForDateRange(
          startUtc.toISOString(),
          endUtc.toISOString()
        );

        const block = await repository.createScheduleBlock({
          scope: 'BUSINESS',
          blockType: 'CLOSURE',
          startAt: startUtc.toISOString(),
          endAt: endUtc.toISOString(),
          reason: input.reason?.trim() || null,
          createdByUserId: actor?.id ?? null,
        });

        return {
          id: block.id,
          date: startDate,
          endDate: endDate !== startDate ? endDate : null,
          closureType: 'FULL_DAY',
          opensAt: null,
          closesAt: null,
          reason: block.reason,
          blockIds: [block.id],
        };
      }

      if (input.closureType === 'SPECIAL_HOURS') {
        if (input.endDate && input.endDate !== input.date) {
          throw new SettingsValidationError('Special opening hours must be configured for a single date');
        }

        if (!input.opensAt || !input.closesAt) {
          throw new SettingsValidationError('Opens at and closes at times are required for special hours');
        }

        const opensAtNorm = normalizeTimeDisplay(input.opensAt);
        const closesAtNorm = normalizeTimeDisplay(input.closesAt);

        const openMinutes = parseTimeToMinutes(opensAtNorm);
        const closeMinutes = parseTimeToMinutes(closesAtNorm);

        if (openMinutes >= closeMinutes) {
          throw new SettingsValidationError(
            `Opening time (${opensAtNorm}) must be strictly before closing time (${closesAtNorm})`
          );
        }

        const dayStartUtc = zonedDateTimeToUtc(input.date, '00:00:00', timezone);
        const dayEndUtc = zonedDateTimeToUtc(addDays(input.date, 1), '00:00:00', timezone);

        await repository.deleteBusinessScheduleBlocksForDateRange(
          dayStartUtc.toISOString(),
          dayEndUtc.toISOString()
        );

        const blockIds: string[] = [];

        // Block 1: From start of day to opensAt
        if (opensAtNorm !== '00:00') {
          const b1Start = zonedDateTimeToUtc(input.date, '00:00:00', timezone);
          const b1End = zonedDateTimeToUtc(input.date, opensAtNorm, timezone);
          const b1 = await repository.createScheduleBlock({
            scope: 'BUSINESS',
            blockType: 'CLOSURE',
            startAt: b1Start.toISOString(),
            endAt: b1End.toISOString(),
            reason: input.reason?.trim() || null,
            createdByUserId: actor?.id ?? null,
          });
          blockIds.push(b1.id);
        }

        // Block 2: From closesAt to end of day
        if (closesAtNorm !== '24:00' && closesAtNorm !== '23:59') {
          const b2Start = zonedDateTimeToUtc(input.date, closesAtNorm, timezone);
          const b2End = zonedDateTimeToUtc(addDays(input.date, 1), '00:00:00', timezone);
          const b2 = await repository.createScheduleBlock({
            scope: 'BUSINESS',
            blockType: 'CLOSURE',
            startAt: b2Start.toISOString(),
            endAt: b2End.toISOString(),
            reason: input.reason?.trim() || null,
            createdByUserId: actor?.id ?? null,
          });
          blockIds.push(b2.id);
        }

        return {
          id: blockIds[0] ?? `special-${input.date}`,
          date: input.date,
          endDate: null,
          closureType: 'SPECIAL_HOURS',
          opensAt: opensAtNorm,
          closesAt: closesAtNorm,
          reason: input.reason?.trim() || null,
          blockIds,
        };
      }

      throw new SettingsValidationError(`Unsupported closure type: ${input.closureType}`);
    },

    async deleteClosure(blockIds: string[], _actor?: DeskAtlasUser | null): Promise<void> {
      if (!Array.isArray(blockIds) || blockIds.length === 0) {
        throw new SettingsValidationError('At least one block ID is required');
      }
      await repository.deleteScheduleBlocks(blockIds);
    },
  };
}


export function buildOperatingHoursConfig(
  rawIntervals: OperatingHoursInterval[]
): OperatingHoursConfig {
  const activeIntervals = rawIntervals.filter((i) => i.isActive);
  const schedules: OperatingHoursDaySchedule[] = [];

  for (let day = 0; day <= 6; day++) {
    const dayIntervals = activeIntervals
      .filter((i) => i.dayOfWeek === day)
      .sort((a, b) => a.opensAt.localeCompare(b.opensAt));

    const isOpen = dayIntervals.length > 0;
    const is24Hours =
      isOpen &&
      dayIntervals.some(
        (i) =>
          (i.opensAt === '00:00:00' || i.opensAt === '00:00') &&
          (i.closesAt === '24:00:00' || i.closesAt === '24:00' || i.closesAt === '23:59:59')
      );

    schedules.push({
      dayOfWeek: day,
      isOpen,
      is24Hours,
      intervals: dayIntervals.map((i) => ({
        id: i.id,
        opensAt: normalizeTimeDisplay(i.opensAt),
        closesAt: normalizeTimeDisplay(i.closesAt),
      })),
    });
  }

  // Determine mode
  const allOpen = schedules.every((s) => s.isOpen);
  const all24Hours = schedules.every((s) => s.isOpen && s.is24Hours);
  const openDaysAre24Hours =
    schedules.some((s) => s.isOpen) &&
    schedules.filter((s) => s.isOpen).every((s) => s.is24Hours) &&
    schedules.some((s) => !s.isOpen);

  let mode: BusinessOperatingHoursMode = 'CUSTOM_HOURS';
  if (allOpen && all24Hours) {
    mode = '24_7';
  } else if (openDaysAre24Hours) {
    mode = '24_HOURS_SELECTED_DAYS';
  }

  return {
    mode,
    schedules,
  };
}

export function getKioskAllowanceMinutes(configuredMinutes?: number | null): number {
  if (
    configuredMinutes === undefined ||
    configuredMinutes === null ||
    isNaN(configuredMinutes) ||
    !Number.isInteger(configuredMinutes) ||
    configuredMinutes < 0 ||
    configuredMinutes > 60
  ) {
    return 5;
  }
  return configuredMinutes;
}

export function getBookingEndAlertMinutes(configuredMinutes?: number | null): number {
  if (
    configuredMinutes === undefined ||
    configuredMinutes === null ||
    isNaN(configuredMinutes) ||
    !Number.isInteger(configuredMinutes) ||
    configuredMinutes < 1 ||
    configuredMinutes > 60
  ) {
    return 5;
  }
  return configuredMinutes;
}

function normalizeBusinessSettingsInput(
  input: UpdateBusinessSettingsInput
): UpdateBusinessSettingsInput {
  if (!input.businessName || typeof input.businessName !== 'string' || !input.businessName.trim()) {
    throw new SettingsValidationError('Business name is required');
  }

  if (!input.timezone || typeof input.timezone !== 'string' || !input.timezone.trim()) {
    throw new SettingsValidationError('Timezone is required');
  }

  const emailTrimmed = input.contactEmail && typeof input.contactEmail === 'string' && input.contactEmail.trim()
    ? input.contactEmail.trim()
    : null;
  const phoneTrimmed = input.contactPhone && typeof input.contactPhone === 'string' && input.contactPhone.trim()
    ? input.contactPhone.trim()
    : null;

  if (input.contactEmail !== undefined || input.contactPhone !== undefined) {
    if (!emailTrimmed && !phoneTrimmed) {
      throw new SettingsValidationError('At least one contact method (email or contact number) is required');
    }
  }

  if (emailTrimmed) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailTrimmed)) {
      throw new SettingsValidationError('Invalid contact email format');
    }
  }

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: input.timezone.trim() });
  } catch {
    throw new SettingsValidationError(`Invalid IANA timezone: ${input.timezone}`);
  }

  if (
    !Number.isInteger(input.bookingIntervalMinutes) ||
    input.bookingIntervalMinutes < 1 ||
    input.bookingIntervalMinutes > 1440
  ) {
    throw new SettingsValidationError(
      'Booking slot interval must be a positive integer in minutes (maximum 1440 minutes)'
    );
  }

  if (
    !Number.isInteger(input.paymentExpiryMinutes) ||
    input.paymentExpiryMinutes <= 0 ||
    input.paymentExpiryMinutes > 1440
  ) {
    throw new SettingsValidationError(
      'Payment expiry must be a positive integer in minutes (maximum 1440 minutes)'
    );
  }

  if (
    input.kioskTimeoutMinutes !== undefined &&
    input.kioskTimeoutMinutes !== null &&
    (!Number.isInteger(input.kioskTimeoutMinutes) || input.kioskTimeoutMinutes <= 0)
  ) {
    throw new SettingsValidationError('Kiosk timeout must be a positive integer in minutes');
  }

  if (
    input.kioskAllowanceMinutes !== undefined &&
    input.kioskAllowanceMinutes !== null &&
    (!Number.isInteger(input.kioskAllowanceMinutes) ||
      input.kioskAllowanceMinutes < 0 ||
      input.kioskAllowanceMinutes > 60)
  ) {
    throw new SettingsValidationError(
      'Kiosk booking allowance must be an integer between 0 and 60 minutes'
    );
  }

  if (
    input.bookingEndAlertMinutes !== undefined &&
    input.bookingEndAlertMinutes !== null &&
    (!Number.isInteger(input.bookingEndAlertMinutes) ||
      input.bookingEndAlertMinutes < 1 ||
      input.bookingEndAlertMinutes > 60)
  ) {
    throw new SettingsValidationError(
      'Booking end-time alert threshold must be an integer between 1 and 60 minutes'
    );
  }

  if (
    input.customerSessionTimeoutMinutes !== undefined &&
    input.customerSessionTimeoutMinutes !== null &&
    (!Number.isInteger(input.customerSessionTimeoutMinutes) ||
      input.customerSessionTimeoutMinutes < 1 ||
      input.customerSessionTimeoutMinutes > 180)
  ) {
    throw new SettingsValidationError(
      'Customer reservation session timeout must be an integer between 1 and 180 minutes'
    );
  }

  if (
    input.customerRescheduleCutoffHours !== undefined &&
    input.customerRescheduleCutoffHours !== null &&
    (!Number.isInteger(input.customerRescheduleCutoffHours) ||
      input.customerRescheduleCutoffHours < 0 ||
      input.customerRescheduleCutoffHours > 720)
  ) {
    throw new SettingsValidationError(
      'Customer self-service reschedule cutoff must be an integer between 0 and 720 hours'
    );
  }

  let normalizedPhotos: LandingPreviewPhoto[] | undefined = undefined;
  if (input.landingPreviewPhotos !== undefined) {
    if (!Array.isArray(input.landingPreviewPhotos)) {
      throw new SettingsValidationError('Landing preview photos must be an array');
    }
    if (input.landingPreviewPhotos.length > 3) {
      throw new SettingsValidationError('Maximum 3 landing preview photos allowed');
    }

    normalizedPhotos = input.landingPreviewPhotos.map((photo, idx) => {
      if (!photo || typeof photo !== 'object') {
        throw new SettingsValidationError(`Invalid preview photo at index ${idx}`);
      }
      if (!photo.id || typeof photo.id !== 'string') {
        throw new SettingsValidationError(`Preview photo ID is required at index ${idx}`);
      }
      if (!photo.url || typeof photo.url !== 'string' || !photo.url.trim()) {
        throw new SettingsValidationError(`Preview photo URL is required at index ${idx}`);
      }
      if (photo.url.startsWith('data:')) {
        throw new SettingsValidationError('Base64 data URLs are not permitted for preview photos; upload image to storage first');
      }

      const posX = typeof photo.position?.x === 'number' && !isNaN(photo.position.x)
        ? Math.max(0, Math.min(100, Math.round(photo.position.x)))
        : 50;
      const posY = typeof photo.position?.y === 'number' && !isNaN(photo.position.y)
        ? Math.max(0, Math.min(100, Math.round(photo.position.y)))
        : 50;

      const displayOrder = typeof photo.displayOrder === 'number' && Number.isInteger(photo.displayOrder)
        ? Math.max(0, Math.min(2, photo.displayOrder))
        : idx;

      return {
        id: photo.id.trim(),
        url: photo.url.trim(),
        storagePath: photo.storagePath ? photo.storagePath.trim() : null,
        position: { x: posX, y: posY },
        displayOrder,
      };
    });
  }

  let normalizedStatusColors: WorkspaceStatusColors | undefined = undefined;
  if (input.statusColors !== undefined) {
    if (typeof input.statusColors !== 'object' || input.statusColors === null) {
      throw new SettingsValidationError('Status colors must be an object');
    }
    normalizedStatusColors = normalizeWorkspaceStatusColors(input.statusColors);
  }

  const facebookUrl = validateOptionalUrl(input.facebookUrl, 'Facebook URL');
  const instagramUrl = validateOptionalUrl(input.instagramUrl, 'Instagram URL');
  const twitterUrl = validateOptionalUrl(input.twitterUrl, 'Twitter URL');
  const websiteUrl = validateOptionalUrl(input.websiteUrl, 'Website URL');

  return {
    businessName: input.businessName.trim(),
    timezone: input.timezone.trim(),
    contactEmail: input.contactEmail?.trim() || null,
    contactPhone: input.contactPhone?.trim() || null,
    facebookUrl,
    instagramUrl,
    twitterUrl,
    websiteUrl,
    bookingIntervalMinutes: input.bookingIntervalMinutes,
    paymentExpiryMinutes: input.paymentExpiryMinutes,
    kioskTimeoutMinutes: input.kioskTimeoutMinutes ?? null,
    kioskAllowanceMinutes:
      input.kioskAllowanceMinutes !== undefined && input.kioskAllowanceMinutes !== null
        ? input.kioskAllowanceMinutes
        : 5,
    bookingEndAlertMinutes:
      input.bookingEndAlertMinutes !== undefined && input.bookingEndAlertMinutes !== null
        ? input.bookingEndAlertMinutes
        : 5,
    customerSessionTimeoutMinutes:
      input.customerSessionTimeoutMinutes !== undefined && input.customerSessionTimeoutMinutes !== null
        ? input.customerSessionTimeoutMinutes
        : 20,
    customerRescheduleCutoffHours:
      input.customerRescheduleCutoffHours !== undefined && input.customerRescheduleCutoffHours !== null
        ? input.customerRescheduleCutoffHours
        : 12,
    landingPreviewPhotos: normalizedPhotos,
    statusColors: normalizedStatusColors,
    cancellationPolicyPdfUrl:
      input.cancellationPolicyPdfUrl !== undefined ? input.cancellationPolicyPdfUrl : undefined,
    cancellationPolicyPdfFilename:
      input.cancellationPolicyPdfFilename !== undefined ? input.cancellationPolicyPdfFilename : undefined,
    cancellationPolicyUpdatedAt:
      input.cancellationPolicyUpdatedAt !== undefined ? input.cancellationPolicyUpdatedAt : undefined,
  };
}

function validateOptionalUrl(url: string | null | undefined, fieldName: string): string | null {
  if (url === undefined || url === null) return null;
  if (typeof url !== 'string') {
    throw new SettingsValidationError(`${fieldName} must be a string`);
  }
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new SettingsValidationError(`${fieldName} must be a valid URL starting with http:// or https://`);
  }
  return trimmed;
}

function normalizeOperatingHoursInput(
  input: UpdateOperatingHoursInput
): Array<{ dayOfWeek: number; opensAt: string; closesAt: string; isActive: boolean }> {
  if (!input.schedules || !Array.isArray(input.schedules)) {
    throw new SettingsValidationError('Schedules array is required');
  }

  const result: Array<{
    dayOfWeek: number;
    opensAt: string;
    closesAt: string;
    isActive: boolean;
  }> = [];

  if (input.mode === '24_7') {
    for (let day = 0; day <= 6; day++) {
      result.push({
        dayOfWeek: day,
        opensAt: '00:00:00',
        closesAt: '24:00:00',
        isActive: true,
      });
    }
    return result;
  }

  if (input.mode === '24_HOURS_SELECTED_DAYS') {
    for (const s of input.schedules) {
      if (s.dayOfWeek < 0 || s.dayOfWeek > 6) {
        throw new SettingsValidationError(`Invalid day of week: ${s.dayOfWeek}`);
      }
      if (s.isOpen) {
        result.push({
          dayOfWeek: s.dayOfWeek,
          opensAt: '00:00:00',
          closesAt: '24:00:00',
          isActive: true,
        });
      }
    }
    return result;
  }

  // Custom hours
  for (const s of input.schedules) {
    if (s.dayOfWeek < 0 || s.dayOfWeek > 6) {
      throw new SettingsValidationError(`Invalid day of week: ${s.dayOfWeek}`);
    }

    if (!s.isOpen) {
      continue;
    }

    if (s.is24Hours) {
      result.push({
        dayOfWeek: s.dayOfWeek,
        opensAt: '00:00:00',
        closesAt: '24:00:00',
        isActive: true,
      });
      continue;
    }

    const intervals = s.intervals && s.intervals.length > 0 ? s.intervals : [];
    if (intervals.length === 0) {
      throw new SettingsValidationError(`Open day ${s.dayOfWeek} must have at least one time interval`);
    }

    for (const interval of intervals) {
      const opensAt = formatTimeForDb(interval.opensAt);
      const closesAt = formatTimeForDb(interval.closesAt);

      const openMinutes = parseTimeToMinutes(opensAt);
      const closeMinutes = parseTimeToMinutes(closesAt);

      if (openMinutes >= closeMinutes) {
        throw new SettingsValidationError(
          `Opening time (${interval.opensAt}) must be strictly before closing time (${interval.closesAt})`
        );
      }

      result.push({
        dayOfWeek: s.dayOfWeek,
        opensAt,
        closesAt,
        isActive: true,
      });
    }
  }

  return result;
}

function normalizeCreatePaymentMethodInput(input: CreatePaymentMethodInput): CreatePaymentMethodInput {
  if (!input.displayName || typeof input.displayName !== 'string' || !input.displayName.trim()) {
    throw new SettingsValidationError('Display name is required');
  }

  const validTypes: Array<'GCASH' | 'BANK' | 'CASH'> = ['GCASH', 'BANK', 'CASH'];
  if (!input.methodType || !validTypes.includes(input.methodType)) {
    throw new SettingsValidationError(`Invalid payment method type: ${input.methodType}. Expected GCASH, BANK, or CASH`);
  }

  if (input.methodType === 'CASH' && input.allowWeb) {
    throw new SettingsValidationError('Cash payment method cannot be enabled for online/web reservations');
  }

  if (input.qrImagePath && input.qrImagePath.startsWith('data:')) {
    throw new SettingsValidationError('Base64 image blobs are not permitted for QR images; upload QR code to storage first');
  }

  if (input.methodType !== 'CASH') {
    if (!input.accountName || typeof input.accountName !== 'string' || !input.accountName.trim()) {
      throw new SettingsValidationError('Account/Receiver name is required');
    }
    if (!input.accountNumber || typeof input.accountNumber !== 'string' || !input.accountNumber.trim()) {
      throw new SettingsValidationError('Account/Mobile number is required');
    }
  }

  if (input.accountNumber && input.accountNumber.trim() && !/^[0-9-]+$/.test(input.accountNumber.trim())) {
    throw new SettingsValidationError('Account/mobile number can only contain numerical digits and dashes (-)');
  }

  const displayOrder =
    input.displayOrder !== undefined && Number.isInteger(input.displayOrder) && input.displayOrder >= 0
      ? input.displayOrder
      : undefined;

  return {
    methodType: input.methodType,
    displayName: input.displayName.trim(),
    accountName: input.accountName?.trim() || null,
    accountNumber: input.accountNumber?.trim() || null,
    qrImagePath: input.qrImagePath?.trim() || null,
    instructions: input.instructions?.trim() || null,
    allowWeb: input.methodType === 'CASH' ? false : (input.allowWeb !== undefined ? Boolean(input.allowWeb) : true),
    allowKiosk: input.allowKiosk !== undefined ? Boolean(input.allowKiosk) : true,
    isActive: input.isActive !== undefined ? Boolean(input.isActive) : true,
    displayOrder,
  };
}

function normalizePaymentMethodInput(input: UpdatePaymentMethodInput): UpdatePaymentMethodInput {
  if (!input.id || typeof input.id !== 'string' || !input.id.trim()) {
    throw new SettingsValidationError('Payment method ID is required');
  }

  if (!input.displayName || typeof input.displayName !== 'string' || !input.displayName.trim()) {
    throw new SettingsValidationError('Display name is required');
  }

  if (input.methodType === 'CASH' && input.allowWeb) {
    throw new SettingsValidationError('Cash payment method cannot be enabled for online/web reservations');
  }

  if (input.qrImagePath && input.qrImagePath.startsWith('data:')) {
    throw new SettingsValidationError('Base64 image blobs are not permitted for QR images; upload QR code to storage first');
  }

  if (input.methodType !== 'CASH') {
    if (!input.accountName || typeof input.accountName !== 'string' || !input.accountName.trim()) {
      throw new SettingsValidationError('Account/Receiver name is required');
    }
    if (!input.accountNumber || typeof input.accountNumber !== 'string' || !input.accountNumber.trim()) {
      throw new SettingsValidationError('Account/Mobile number is required');
    }
  }

  if (input.accountNumber && input.accountNumber.trim() && !/^[0-9-]+$/.test(input.accountNumber.trim())) {
    throw new SettingsValidationError('Account/mobile number can only contain numerical digits and dashes (-)');
  }

  return {
    id: input.id.trim(),
    methodType: input.methodType,
    displayName: input.displayName.trim(),
    accountName: input.accountName?.trim() || null,
    accountNumber: input.accountNumber?.trim() || null,
    qrImagePath: input.qrImagePath?.trim() || null,
    instructions: input.instructions?.trim() || null,
    allowWeb: input.methodType === 'CASH' ? false : (input.allowWeb !== undefined ? Boolean(input.allowWeb) : true),
    allowKiosk: input.allowKiosk !== undefined ? Boolean(input.allowKiosk) : true,
    isActive: Boolean(input.isActive),
    displayOrder:
      input.displayOrder !== undefined && Number.isInteger(input.displayOrder) && input.displayOrder >= 0
        ? input.displayOrder
        : 0,
  };
}

function formatTimeForDb(timeStr: string): string {
  const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) {
    throw new SettingsValidationError(`Invalid time format: ${timeStr}`);
  }

  const hours = String(Number(match[1])).padStart(2, '0');
  const minutes = match[2];
  const seconds = match[3] ?? '00';
  return `${hours}:${minutes}:${seconds}`;
}

function normalizeTimeDisplay(timeStr: string): string {
  const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return timeStr;
  const hours = String(Number(match[1])).padStart(2, '0');
  return `${hours}:${match[2]}`;
}

function parseTimeToMinutes(timeStr: string): number {
  const match = timeStr.match(/^(\d{2}):(\d{2})/);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function getTodayDateInTimezone(timezone: string = 'Asia/Manila'): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    return new Date().toISOString().split('T')[0]!;
  }
}

export function isDateInPast(dateStr: string, timezone: string = 'Asia/Manila'): boolean {
  if (!dateStr) return false;
  const todayStr = getTodayDateInTimezone(timezone);
  return dateStr < todayStr;
}

export function isValidDateString(dateStr: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr) && !isNaN(new Date(dateStr).getTime());
}

export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(
    value.getUTCDate()
  ).padStart(2, '0')}`;
}

export function zonedDateTimeToUtc(date: string, time: string, timezone: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  const timeParts = time.split(':').map(Number);
  const hours = timeParts[0] ?? 0;
  const minutes = timeParts[1] ?? 0;
  const seconds = timeParts[2] ?? 0;

  let utcTimestamp = Date.UTC(year, month - 1, day, hours, minutes, seconds);

  for (let iteration = 0; iteration < 2; iteration += 1) {
    const offsetMinutes = getTimezoneOffsetMinutes(new Date(utcTimestamp), timezone);
    utcTimestamp = Date.UTC(year, month - 1, day, hours, minutes, seconds) - offsetMinutes * 60_000;
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

export function utcToZonedDateTime(date: Date, timezone: string): { date: string; time: string } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = formatter.formatToParts(date);
  const partMap: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      partMap[part.type] = part.value;
    }
  }
  const y = partMap.year ?? '1970';
  const m = (partMap.month ?? '01').padStart(2, '0');
  const d = (partMap.day ?? '01').padStart(2, '0');
  let h = partMap.hour ?? '00';
  if (h === '24') h = '00';
  const min = (partMap.minute ?? '00').padStart(2, '0');
  return {
    date: `${y}-${m}-${d}`,
    time: `${h.padStart(2, '0')}:${min.padStart(2, '0')}`,
  };
}

