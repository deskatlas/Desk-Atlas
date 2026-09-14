import type {
  WorkspaceAvailabilityBlockReason,
  WorkspaceInstanceDetails,
} from './workspace';

export interface BusinessAvailabilitySettings {
  timezone: string;
  bookingIntervalMinutes: number;
}

export interface OperatingHoursInterval {
  id: string;
  dayOfWeek: number;
  opensAt: string;
  closesAt: string;
  isActive: boolean;
}

export interface ScheduleBlock {
  id: string;
  scope: 'BUSINESS' | 'WORKSPACE';
  workspaceInstanceId: string | null;
  blockType: string;
  startAt: string;
  endAt: string;
  reason: string | null;
}

export interface BlockingReservationWindow {
  reservationId: string;
  reservationStatus: 'CONFIRMED' | 'CHECKED_IN';
  startAt: string;
  endAt: string;
}

export interface AvailabilityRepository {
  getWorkspaceInstance(instanceId: string): Promise<WorkspaceInstanceDetails | null>;
  getBusinessSettings(): Promise<BusinessAvailabilitySettings>;
  listOperatingHours(dayOfWeek: number): Promise<OperatingHoursInterval[]>;
  listScheduleBlocks(
    workspaceInstanceId: string,
    rangeStartIso: string,
    rangeEndIso: string
  ): Promise<ScheduleBlock[]>;
  listBlockingReservations(
    workspaceInstanceId: string,
    rangeStartIso: string,
    rangeEndIso: string
  ): Promise<BlockingReservationWindow[]>;
  listWorkspaceInstancesByTemplate?(templateId: string): Promise<WorkspaceInstanceDetails[]>;
  listOccupiedInstances?(rangeStartIso: string, rangeEndIso: string): Promise<string[]>;
}

export interface OccupiedInstancesResult {
  occupiedInstanceIds: string[];
  asOf: string;
}

export type AvailabilityDateReason =
  | 'AVAILABLE'
  | 'WORKSPACE_NOT_BOOKABLE'
  | 'BUSINESS_CLOSED'
  | 'NO_TIME_REMAINING'
  | 'BLOCKED';

export interface AvailableDate {
  date: string;
  isAvailable: boolean;
  reason: AvailabilityDateReason;
  firstAvailableTime: string | null;
}

export type TimeSlotBlockingReason =
  | 'WORKSPACE_NOT_BOOKABLE'
  | 'PAST_TIME'
  | 'IMMEDIATE_WALK_IN_ONLY'
  | 'BUSINESS_CLOSED'
  | 'SCHEDULE_BLOCKED'
  | 'RESERVATION_CONFLICT';

export interface AvailableTimeSlot {
  startTime: string;
  endTime: string;
  isAvailable: boolean;
  blockingReason: TimeSlotBlockingReason | null;
}

export interface DateAvailabilityQuery {
  workspaceInstanceId: string;
  startDate: string;
  endDate: string;
  durationMinutes: number;
  nowIso?: string;
  channel?: 'ONLINE' | 'KIOSK';
  minimumLeadMinutes?: number;
}

export interface TimeAvailabilityQuery {
  workspaceInstanceId: string;
  date: string;
  durationMinutes: number;
  nowIso?: string;
  channel?: 'ONLINE' | 'KIOSK';
  minimumLeadMinutes?: number;
}

export interface DateAvailabilityResult {
  workspaceInstanceId: string;
  timezone: string;
  bookingIntervalMinutes: number;
  workspaceIsBookable: boolean;
  workspaceBlockingReason: WorkspaceAvailabilityBlockReason | null;
  dates: AvailableDate[];
}

export interface TimeAvailabilityResult {
  workspaceInstanceId: string;
  date: string;
  timezone: string;
  bookingIntervalMinutes: number;
  workspaceIsBookable: boolean;
  workspaceBlockingReason: WorkspaceAvailabilityBlockReason | null;
  slots: AvailableTimeSlot[];
}

export interface TemplateAvailabilityQuery {
  templateId: string;
  date: string;
  durationMinutes: number;
  startTime?: string;
  nowIso?: string;
  channel?: 'ONLINE' | 'KIOSK';
  minimumLeadMinutes?: number;
}

export interface AvailableInstanceSummary {
  workspaceInstanceId: string;
  templateId: string;
  floorId: string;
  floorName: string;
  instanceCode: string;
  displayName: string;
  templateName: string;
  rateAmount: number;
  capacity: number;
  photoPath: string | null;
  photoPosition?: { x: number; y: number };
  operationalStatus: string;
  isAvailable: boolean;
  blockingReason: string | null;
}

export interface TemplateAvailabilityResult {
  templateId: string;
  templateName: string;
  date: string;
  durationMinutes: number;
  startTime: string | null;
  endTime: string | null;
  timezone: string;
  bookingIntervalMinutes: number;
  availableInstances: AvailableInstanceSummary[];
  allInstances: AvailableInstanceSummary[];
}

export interface UpcomingBookingInfo {
  startAt: string;
  endAt: string;
  type: 'RESERVATION' | 'SCHEDULE_BLOCK';
  startTimeFormatted: string;
  blockType?: string;
  reason?: string | null;
}

export interface NextUpcomingBookingResult {
  workspaceInstanceId: string;
  nowIso: string;
  nextBooking: UpcomingBookingInfo | null;
  minutesUntilNextBooking: number | null;
  operatingHoursCloseAt: string | null;
  minutesUntilClosing: number | null;
  maxAvailableMinutes: number | null;
  maxAvailableHours: number | null;
}

export interface ValidateReservationWindowQuery {
  workspaceInstanceId: string;
  startAt: string;
  endAt: string;
  maxDurationMinutes?: number;
}

export interface ReservationWindowValidationResult {
  isValid: boolean;
  conflictType?:
    | 'MAX_DURATION_EXCEEDED'
    | 'FACILITY_CLOSURE'
    | 'BUSINESS_CLOSED'
    | 'MAINTENANCE_BLOCK'
    | 'RESERVATION_CONFLICT';
  errorMessage?: string;
}

