import {
  OperationalActivityRecord,
  OperationalActivityType,
  OccupancyRecord,
  ReservationOperationalActionRequest,
  ReservationOperationalActionResult,
  StaffOperationalReservation,
} from "../models/reservation";
import { StaffOperationsRepository } from "./staffOperationsRepository";
import { filterReservationsBySearch } from "./reservationSearch";

export class StaffOperationsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StaffOperationsError";
  }
}

export class StaffOperationsConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StaffOperationsConflictError";
  }
}

export class StaffOperationsService {
  constructor(
    private readonly staffOperationsRepository: StaffOperationsRepository,
    private readonly nowProvider: () => Date = () => new Date()
  ) {}

  async listOperationalReservations(search?: string): Promise<StaffOperationalReservation[]> {
    const list = await this.staffOperationsRepository.listOperationalReservations(
      this.nowProvider().toISOString()
    );
    if (search && search.trim() !== "") {
      return filterReservationsBySearch(list, search);
    }
    return list;
  }

  async getOperationalReservation(
    idOrReferenceCode: string
  ): Promise<StaffOperationalReservation | null> {
    if (!idOrReferenceCode || idOrReferenceCode.trim() === "") {
      throw new StaffOperationsError("Reservation ID is required.");
    }

    return this.staffOperationsRepository.getOperationalReservation(
      idOrReferenceCode.trim()
    );
  }

  async listOccupancy(): Promise<OccupancyRecord[]> {
    return this.staffOperationsRepository.listOccupancy(this.nowProvider().toISOString());
  }

  async listOperationalActivity(
    limit = 20,
    filter?: { activityType?: OperationalActivityType }
  ): Promise<OperationalActivityRecord[]> {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new StaffOperationsError("Activity limit must be a positive integer.");
    }

    const records = await this.staffOperationsRepository.listOperationalActivity(limit);
    if (filter?.activityType) {
      return records.filter((r) => r.activityType === filter.activityType);
    }
    return records;
  }

  async checkInReservation(
    request: ReservationOperationalActionRequest
  ): Promise<ReservationOperationalActionResult> {
    const actor = validateActor(request);
    return this.staffOperationsRepository.checkInReservation({
      reservationId: request.reservationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      actedAt: this.nowProvider().toISOString(),
    });
  }

  async checkOutReservation(
    request: ReservationOperationalActionRequest
  ): Promise<ReservationOperationalActionResult> {
    const actor = validateActor(request);
    return this.staffOperationsRepository.checkOutReservation({
      reservationId: request.reservationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      actedAt: this.nowProvider().toISOString(),
    });
  }
}

function validateActor(request: ReservationOperationalActionRequest) {
  if (!request.reservationId || request.reservationId.trim() === "") {
    throw new StaffOperationsError("Reservation ID is required.");
  }

  if (!request.actor?.userId || request.actor.userId.trim() === "") {
    throw new StaffOperationsError("Actor user ID is required.");
  }

  const normalizedRole = String(request.actor.role || "").toUpperCase();
  if (normalizedRole !== "ADMIN" && normalizedRole !== "STAFF") {
    throw new StaffOperationsConflictError(
      "Only ADMIN or STAFF may perform reservation operational actions."
    );
  }

  return {
    ...request.actor,
    role: normalizedRole as "ADMIN" | "STAFF",
  };
}

export function createStaffOperationsService(
  staffOperationsRepository: StaffOperationsRepository,
  nowProvider?: () => Date
) {
  return new StaffOperationsService(staffOperationsRepository, nowProvider);
}
