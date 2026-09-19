import { AdminReservationDetail, AdminReservationSummary, CustomerRelocationRequest } from "../models/reservation";

export interface CancelReservationInput {
  reservationId: string;
  reason: string;
  notes?: string;
  actorUserId?: string;
  actorRole?: string;
}

export interface RescheduleReservationInput {
  reservationId: string;
  startAt: string;
  endAt: string;
  workspaceInstanceId?: string;
  actorUserId?: string;
  actorRole?: string;
  cutoffHours?: number;
}

export interface RescheduleSlotAvailability {
  startTime: string;
  endTime: string;
  startAt: string;
  endAt: string;
  isAvailable: boolean;
  reason?: string;
}

export interface CheckRescheduleAvailabilityInput {
  reservationId: string;
  startAt?: string;
  endAt?: string;
  date?: string;
  durationHours?: number;
  workspaceInstanceId?: string;
}

export interface RescheduleAvailabilityResult {
  available: boolean;
  reason?: string;
  workspaceInstanceId?: string;
  workspaceDisplayName?: string;
  slots?: RescheduleSlotAvailability[];
}

export interface RelocateReservationInput {
  reservationId: string;
  targetWorkspaceInstanceId: string;
  reason: string;
  notes?: string;
  actorUserId?: string;
  actorRole?: string;
  evaluationTime?: string | Date;
}

export interface AvailableRelocationSpot {
  id: string;
  instanceCode: string;
  displayName: string;
  templateId: string;
  templateName: string;
  floorId: string;
  floorName?: string;
  isAvailable: boolean;
  reason?: string;
}

export interface ListAvailableRelocationSpotsInput {
  reservationId: string;
  evaluationTime?: string | Date;
}

export interface AdminReservationRepository {
  listAdminReservations(): Promise<AdminReservationSummary[]>;
  getAdminReservationDetail(idOrReferenceCode: string): Promise<AdminReservationDetail | null>;
  cancelReservation?(input: CancelReservationInput): Promise<{
    success: boolean;
    reservation: AdminReservationDetail;
    message?: string;
  }>;
  rescheduleReservation?(input: RescheduleReservationInput): Promise<{
    success: boolean;
    reservation: AdminReservationDetail;
    message?: string;
  }>;
  checkRescheduleAvailability?(input: CheckRescheduleAvailabilityInput): Promise<RescheduleAvailabilityResult>;
  relocateReservation?(input: RelocateReservationInput): Promise<{
    success: boolean;
    reservation: AdminReservationDetail;
    message?: string;
    oldWorkspaceDisplayName?: string;
    newWorkspaceDisplayName?: string;
    previousSpotName?: string;
    newSpotName?: string;
  }>;
  listAvailableRelocationSpots?(input: ListAvailableRelocationSpotsInput): Promise<AvailableRelocationSpot[]>;
  requestCustomerRelocation?(input: RequestCustomerRelocationInput): Promise<CustomerRelocationRequest>;
  decideCustomerRelocation?(input: DecideCustomerRelocationInput): Promise<{
    success: boolean;
    decision: "APPROVE" | "DECLINE";
    reservation: AdminReservationDetail;
    message?: string;
  }>;
  extendReservation?(input: ExtendReservationInput): Promise<ExtendReservationResult>;
  checkExtendAvailability?(input: CheckExtendAvailabilityInput): Promise<ExtendAvailabilityResult>;
}

export interface RequestCustomerRelocationInput {
  reservationId: string;
  targetWorkspaceInstanceId: string;
  reason: string;
  notes?: string | null;
}

export interface DecideCustomerRelocationInput {
  reservationId: string;
  decision: "APPROVE" | "DECLINE";
  notes?: string | null;
  actorUserId?: string | null;
  actorRole: "STAFF" | "ADMIN" | "SUPERADMIN";
}

export interface ExtendReservationInput {
  reservationId: string;
  extensionMinutes: number;
  additionalFee?: number;
  paymentMethod?: string;
  actorUserId?: string;
  actorRole?: "ADMIN" | "STAFF";
}

export interface CheckExtendAvailabilityInput {
  reservationId: string;
  extensionMinutes?: number;
}

export interface ExtendAvailabilityNextBooking {
  reservationId?: string;
  referenceCode?: string;
  customerName?: string;
  startAt: string;
  startTimeFormatted?: string;
}

export interface ExtendAvailabilityResult {
  canExtend: boolean;
  reservationId: string;
  referenceCode: string;
  currentEndAt: string;
  proposedEndAt?: string;
  extensionMinutes?: number;
  maxExtensionMinutes: number;
  hourlyRate: number;
  additionalFee: number;
  nextBooking?: ExtendAvailabilityNextBooking | null;
  closingTime?: string | null;
  reason?: string;
  workspaceDisplayName?: string;
  templateName?: string;
}

export interface ExtendReservationResult {
  success: boolean;
  reservation: AdminReservationDetail;
  previousEndAt: string;
  newEndAt: string;
  addedDurationMinutes: number;
  additionalFee: number;
  paymentMethod: string;
  message?: string;
}
