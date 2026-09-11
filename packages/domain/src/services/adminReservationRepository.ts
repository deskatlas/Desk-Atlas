import { AdminReservationDetail, AdminReservationSummary } from "../models/reservation";

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
}

