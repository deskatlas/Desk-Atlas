import { BookingAccessState, ReservationStatus } from "../models/reservation";

export interface BookingAccessRecord {
  reservationId: string;
  referenceCode: string;
  reservationStatus: ReservationStatus;
  customerFirstName: string;
  customerLastName: string;
  customerEmail?: string;
  bookingTokenHash: string;
  bookingToken?: string | null;
  qrIssuedAt: string;
  qrRevokedAt: string | null;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  confirmedAt?: string | null;
  source?: string | null;
  hasPreviousScan?: boolean;
  assignedWorkspaceInstanceId: string;
  assignedWorkspaceDisplayName: string;
  assignedWorkspaceInstanceCode: string;
  assignedWorkspaceTemplateName: string;
  assignedFloorName: string;
  assignedStartAt: string;
  assignedEndAt: string;
}

export interface BookingAccessRepository {
  issueBookingAccessToken(input: {
    reservationId: string;
    tokenHash: string;
    token?: string;
    issuedAt: string;
  }): Promise<boolean>;
  findBookingAccessByTokenHash(tokenHash: string): Promise<BookingAccessRecord | null>;
  findBookingAccessByReferenceOrId?(identifier: string): Promise<BookingAccessRecord | null>;
  recordBookingScan(input: {
    reservationId: string;
    scannedAt: string;
    accessState: BookingAccessState;
    actorUserId?: string | null;
    actorRole?: "ADMIN" | "STAFF" | "SYSTEM" | null;
    reentry?: boolean;
    checkIn?: boolean;
  }): Promise<void>;
}
