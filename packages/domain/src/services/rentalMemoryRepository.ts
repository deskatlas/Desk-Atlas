import type {
  BookingRental,
  RentalExtension,
  AssignRentalInput,
  ExtendRentalInput,
  ReturnRentalInput,
  RentalEndAlert,
} from '../models/rental';
import type { RentalFilter, RentalRepository } from './rentalRepository';
import type { InMemoryAdditionalServiceRepository } from './additionalServiceMemoryRepository';

export interface MockReservationInfo {
  id: string;
  status: string;
  customerId?: string | null;
  customerName: string;
  customerEmail?: string;
  spotName: string;
  referenceCode: string;
}

export class InMemoryRentalRepository implements RentalRepository {
  private rentals: BookingRental[] = [];
  private extensions: RentalExtension[] = [];
  private reservations: Map<string, MockReservationInfo> = new Map();
  private servicesRepo?: InMemoryAdditionalServiceRepository;
  private serviceLocks: Map<string, Promise<void>> = new Map();

  constructor(
    initialRentals: BookingRental[] = [],
    servicesRepo?: InMemoryAdditionalServiceRepository
  ) {
    this.rentals = [...initialRentals];
    this.servicesRepo = servicesRepo;
  }

  setServicesRepo(repo: InMemoryAdditionalServiceRepository) {
    this.servicesRepo = repo;
  }

  addMockReservation(reservation: MockReservationInfo) {
    this.reservations.set(reservation.id, reservation);
  }

  updateRentalDueAt(id: string, dueAt: string): void {
    const item = this.rentals.find((r) => r.id === id);
    if (item) {
      item.dueAt = dueAt;
    }
  }

  async listRentals(filter?: RentalFilter): Promise<BookingRental[]> {
    let result = [...this.rentals];
    if (filter?.status) {
      result = result.filter((r) => r.status === filter.status);
    }
    if (filter?.reservationId) {
      result = result.filter((r) => r.reservationId === filter.reservationId);
    }
    if (filter?.customerId) {
      result = result.filter((r) => r.customerId === filter.customerId);
    }
    return result.map((r) => this.enrichRental(r));
  }

  async getRentalById(id: string): Promise<BookingRental | null> {
    const rental = this.rentals.find((r) => r.id === id);
    return rental ? this.enrichRental(rental) : null;
  }

  async getRentalByCode(code: string): Promise<BookingRental | null> {
    const rental = this.rentals.find((r) => r.rentalCode === code);
    return rental ? this.enrichRental(rental) : null;
  }

  async assignRental(input: AssignRentalInput): Promise<BookingRental> {
    const res = this.reservations.get(input.reservationId);
    if (!res) {
      throw new Error('Reservation not found');
    }
    if (res.status !== 'CHECKED_IN' && res.status !== 'CONFIRMED') {
      throw new Error('Customer must have an active checked-in reservation');
    }

    if (!this.servicesRepo) {
      throw new Error('Service repository not configured');
    }

    // Mirror PostgreSQL FOR UPDATE row lock on the service row
    const prevLock = this.serviceLocks.get(input.serviceId) ?? Promise.resolve();
    let releaseLock!: () => void;
    const currentLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    this.serviceLocks.set(input.serviceId, currentLock);

    try {
      await prevLock;

      const service = await this.servicesRepo.getAdditionalServiceById(input.serviceId);
      if (!service || service.serviceType !== 'rental') {
        throw new Error('Selected service is not an active rental item');
      }
      if (service.availableInventory < 1) {
        throw new Error('Item is currently out of stock');
      }

      let rate = 0;
      const now = new Date();
      let dueAt = new Date(now.getTime());

      if (input.billingMode === 'hourly') {
        if (!service.hourlyRate) {
          throw new Error('Hourly rate is required for this item');
        }
        rate = service.hourlyRate;
        dueAt = new Date(now.getTime() + input.durationUnits * 60 * 60 * 1000);
      } else if (input.billingMode === 'daily') {
        if (!service.dailyRate) {
          throw new Error('Daily rate not available for this item');
        }
        rate = service.dailyRate;
        dueAt = new Date(now.getTime() + input.durationUnits * 24 * 60 * 60 * 1000);
      } else {
        throw new Error('Invalid billing mode');
      }

      const totalAmount = rate * input.durationUnits;
      const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
      const randSuffix = Math.random().toString(36).substring(2, 8).toUpperCase();
      const rentalCode = `RNT-${dateStr}-${randSuffix}`;

      // Decrement inventory atomically
      await this.servicesRepo.updateAdditionalService(service.id, {
        availableInventory: service.availableInventory - 1,
      });

      const newRental: BookingRental = {
        id: `rnt-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        rentalCode,
        reservationId: input.reservationId,
        customerId: res.customerId ?? null,
        serviceId: input.serviceId,
        unitCount: 1,
        billingMode: input.billingMode,
        durationUnits: input.durationUnits,
        rateApplied: rate,
        totalAmount,
        idVerified: input.idVerified ?? true,
        idNotes: input.idNotes ?? '',
        status: 'active',
        rentedAt: now.toISOString(),
        dueAt: dueAt.toISOString(),
        staffUserId: input.staffUserId ?? null,
        notes: input.notes ?? '',
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        customerName: res.customerName,
        customerEmail: res.customerEmail,
        spotName: res.spotName,
        serviceName: service.name,
        referenceCode: res.referenceCode,
      };

      this.rentals.push(newRental);
      return this.enrichRental(newRental);
    } finally {
      releaseLock();
    }
  }

  async extendRental(input: ExtendRentalInput): Promise<BookingRental> {
    const rental = this.rentals.find((r) => r.id === input.rentalId);
    if (!rental) {
      throw new Error('Rental record not found');
    }
    if (rental.status === 'returned') {
      throw new Error('Cannot extend a returned rental');
    }

    if (!this.servicesRepo) {
      throw new Error('Service repository not configured');
    }
    const service = await this.servicesRepo.getAdditionalServiceById(rental.serviceId);
    if (!service) {
      throw new Error('Rental service item not found');
    }

    let rate = 0;
    const currentDue = new Date(rental.dueAt);
    let newDue = new Date(currentDue.getTime());

    if (input.extensionMode === 'hourly') {
      if (!service.hourlyRate) {
        throw new Error('Hourly rate is required for this item');
      }
      rate = service.hourlyRate;
      newDue = new Date(currentDue.getTime() + input.additionalUnits * 60 * 60 * 1000);
    } else if (input.extensionMode === 'daily') {
      if (!service.dailyRate) {
        throw new Error('Daily rate not available for this item');
      }
      rate = service.dailyRate;
      newDue = new Date(currentDue.getTime() + input.additionalUnits * 24 * 60 * 60 * 1000);
    } else {
      throw new Error('Invalid extension mode');
    }

    const additionalAmount = rate * input.additionalUnits;
    const now = new Date().toISOString();

    const extension: RentalExtension = {
      id: `ext-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      rentalId: rental.id,
      extensionMode: input.extensionMode,
      additionalUnits: input.additionalUnits,
      rateApplied: rate,
      additionalAmount,
      previousDueAt: rental.dueAt,
      newDueAt: newDue.toISOString(),
      staffUserId: input.staffUserId ?? null,
      extendedAt: now,
    };

    this.extensions.push(extension);

    rental.dueAt = newDue.toISOString();
    rental.totalAmount = rental.totalAmount + additionalAmount;
    rental.endAlertSentAt = null;
    rental.updatedAt = now;

    return this.enrichRental(rental);
  }

  async returnRental(input: ReturnRentalInput): Promise<BookingRental> {
    const rental = this.rentals.find((r) => r.id === input.rentalId);
    if (!rental) {
      throw new Error('Rental record not found');
    }
    if (rental.status === 'returned') {
      throw new Error('Rental item has already been returned');
    }

    if (this.servicesRepo) {
      const service = await this.servicesRepo.getAdditionalServiceById(rental.serviceId);
      if (service) {
        await this.servicesRepo.updateAdditionalService(service.id, {
          availableInventory: service.availableInventory + 1,
        });
      }
    }

    const now = new Date().toISOString();
    rental.status = 'returned';
    rental.returnedAt = now;
    rental.updatedAt = now;
    if (input.staffUserId) {
      rental.staffUserId = input.staffUserId;
    }

    return this.enrichRental(rental);
  }

  async listExtensions(rentalId: string): Promise<RentalExtension[]> {
    return this.extensions.filter((e) => e.rentalId === rentalId);
  }

  async markRentalConfirmationSent(rentalId: string, sentAt: string = new Date().toISOString()): Promise<void> {
    const item = this.rentals.find((r) => r.id === rentalId);
    if (item) {
      item.confirmationSentAt = sentAt;
    }
  }

  async markRentalEndAlertSent(rentalId: string, sentAt: string | null = new Date().toISOString()): Promise<void> {
    const item = this.rentals.find((r) => r.id === rentalId);
    if (item) {
      item.endAlertSentAt = sentAt;
    }
  }

  async getRentalAlerts(thresholdMinutes: number, now: Date = new Date()): Promise<RentalEndAlert[]> {
    const nowMs = now.getTime();
    const thresholdMs = thresholdMinutes * 60 * 1000;
    const active = this.rentals.filter((r) => r.status === 'active');
    const alerts: RentalEndAlert[] = [];

    for (const rental of active) {
      const enriched = this.enrichRental(rental);
      const dueMs = new Date(rental.dueAt).getTime();
      const diffMs = dueMs - nowMs;
      const isOverdue = diffMs <= 0;
      const isNearingEnd = diffMs <= thresholdMs && diffMs > 0;

      if (isNearingEnd || isOverdue) {
        alerts.push({
          rentalId: rental.id,
          rentalCode: rental.rentalCode,
          reservationId: rental.reservationId,
          referenceCode: enriched.referenceCode,
          spotName: enriched.spotName || 'Unassigned Desk',
          customerName: enriched.customerName || 'Customer',
          customerEmail: enriched.customerEmail,
          itemName: enriched.serviceName || 'Rental Item',
          dueAt: rental.dueAt,
          timeRemainingMinutes: Math.round(diffMs / 60000),
          isOverdue,
          endAlertSentAt: rental.endAlertSentAt ?? null,
        });
      }
    }

    return alerts;
  }

  private enrichRental(rental: BookingRental): BookingRental {
    const res = this.reservations.get(rental.reservationId);
    const nowMs = Date.now();
    const dueMs = new Date(rental.dueAt).getTime();
    const diffMs = dueMs - nowMs;

    return {
      ...rental,
      referenceCode: rental.referenceCode || res?.referenceCode,
      customerName: rental.customerName || res?.customerName || 'Customer',
      customerEmail: rental.customerEmail || res?.customerEmail,
      spotName: rental.spotName || res?.spotName || 'Workspace',
      isOverdue: rental.status === 'active' && diffMs <= 0,
      isNearingEnd: rental.status === 'active' && diffMs > 0 && diffMs <= 5 * 60 * 1000,
      timeRemainingMinutes: Math.round(diffMs / 60000),
    };
  }
}
