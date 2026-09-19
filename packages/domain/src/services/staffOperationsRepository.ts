import {
  OperationalActivityRecord,
  ReservationOperationalActionResult,
  StaffOperationalReservation,
  OccupancyRecord,
} from "../models/reservation";

export interface StaffOperationsRepository {
  listOperationalReservations(nowIso: string): Promise<StaffOperationalReservation[]>;
  getOperationalReservation(idOrReferenceCode: string): Promise<StaffOperationalReservation | null>;
  listOccupancy(nowIso: string): Promise<OccupancyRecord[]>;
  listOperationalActivity(limit: number): Promise<OperationalActivityRecord[]>;
  checkInReservation(input: {
    reservationId: string;
    actorUserId: string;
    actorRole: "ADMIN" | "STAFF";
    actedAt: string;
  }): Promise<ReservationOperationalActionResult>;
  checkOutReservation(input: {
    reservationId: string;
    actorUserId: string;
    actorRole: "ADMIN" | "STAFF";
    actedAt: string;
  }): Promise<ReservationOperationalActionResult>;
  checkExtendAvailability?(input: any): Promise<any>;
  extendReservation?(input: any): Promise<any>;
  listAvailableRelocationSpots?(input: { reservationId: string }): Promise<any[]>;
  relocateReservation?(input: any): Promise<any>;
  decideCustomerRelocation?(input: any): Promise<any>;
}
