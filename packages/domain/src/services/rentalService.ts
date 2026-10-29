import type {
  BookingRental,
  RentalExtension,
  AssignRentalInput,
  ExtendRentalInput,
  ReturnRentalInput,
  RentalEndAlert,
} from '../models/rental';
import type { RentalFilter, RentalRepository } from './rentalRepository';
import {
  TransactionalEmailService,
  createTransactionalEmailService,
} from './transactionalEmailService';

export class RentalValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RentalValidationError';
  }
}

export class RentalService {
  private readonly emailService: TransactionalEmailService;

  constructor(
    private readonly repo: RentalRepository,
    emailService?: TransactionalEmailService
  ) {
    this.emailService = emailService ?? createTransactionalEmailService();
  }

  async listRentals(filter?: RentalFilter): Promise<BookingRental[]> {
    return this.repo.listRentals(filter);
  }

  async getRentalById(id: string): Promise<BookingRental | null> {
    if (!id || typeof id !== 'string' || !id.trim()) {
      throw new RentalValidationError('Rental ID is required');
    }
    return this.repo.getRentalById(id.trim());
  }

  async getRentalByCode(code: string): Promise<BookingRental | null> {
    if (!code || typeof code !== 'string' || !code.trim()) {
      throw new RentalValidationError('Rental code is required');
    }
    return this.repo.getRentalByCode(code.trim());
  }

  async assignRental(input: AssignRentalInput): Promise<BookingRental> {
    if (!input.reservationId || typeof input.reservationId !== 'string' || !input.reservationId.trim()) {
      throw new RentalValidationError('Reservation ID is required');
    }
    if (!input.serviceId || typeof input.serviceId !== 'string' || !input.serviceId.trim()) {
      throw new RentalValidationError('Rental service ID is required');
    }
    if (input.billingMode !== 'hourly' && input.billingMode !== 'daily') {
      throw new RentalValidationError("Billing mode must be either 'hourly' or 'daily'");
    }
    if (!Number.isInteger(input.durationUnits) || input.durationUnits <= 0) {
      throw new RentalValidationError('Duration units must be a positive integer');
    }
    if (!input.idVerified) {
      throw new RentalValidationError('Customer ID must be verified and held at the front desk');
    }

    try {
      const rental = await this.repo.assignRental({
        ...input,
        reservationId: input.reservationId.trim(),
        serviceId: input.serviceId.trim(),
        idNotes: input.idNotes ? input.idNotes.trim() : '',
        notes: input.notes ? input.notes.trim() : '',
      });

      if (rental.customerEmail) {
        try {
          await this.emailService.sendRentalConfirmationEmail({
            to: rental.customerEmail,
            customerName: rental.customerName,
            customerFirstName: rental.customerName?.split(' ')[0],
            rentalCode: rental.rentalCode,
            referenceCode: rental.referenceCode,
            spotName: rental.spotName,
            itemName: rental.serviceName || 'Rental Item',
            billingMode: rental.billingMode,
            durationUnits: rental.durationUnits,
            rateApplied: rental.rateApplied,
            totalAmount: rental.totalAmount,
            rentedAt: rental.rentedAt,
            dueAt: rental.dueAt,
            idVerified: rental.idVerified,
            idNotes: rental.idNotes,
            notes: rental.notes,
          });

          if (this.repo.markRentalConfirmationSent) {
            await this.repo.markRentalConfirmationSent(rental.id);
          }
        } catch (emailErr: unknown) {
          console.warn('[RentalService] Failed to send rental confirmation email:', emailErr);
        }
      }

      return rental;
    } catch (err: unknown) {
      if (err instanceof RentalValidationError) {
        throw err;
      }
      const msg = err instanceof Error ? err.message : 'Failed to assign rental';
      throw new RentalValidationError(msg);
    }
  }

  async extendRental(input: ExtendRentalInput): Promise<BookingRental> {
    if (!input.rentalId || typeof input.rentalId !== 'string' || !input.rentalId.trim()) {
      throw new RentalValidationError('Rental ID is required');
    }
    if (input.extensionMode !== 'hourly' && input.extensionMode !== 'daily') {
      throw new RentalValidationError("Extension mode must be either 'hourly' or 'daily'");
    }
    if (!Number.isInteger(input.additionalUnits) || input.additionalUnits <= 0) {
      throw new RentalValidationError('Additional duration units must be a positive integer');
    }

    try {
      const updated = await this.repo.extendRental({
        ...input,
        rentalId: input.rentalId.trim(),
      });

      if (this.repo.markRentalEndAlertSent) {
        await this.repo.markRentalEndAlertSent(updated.id, null);
      }

      return updated;
    } catch (err: unknown) {
      if (err instanceof RentalValidationError) {
        throw err;
      }
      const msg = err instanceof Error ? err.message : 'Failed to extend rental';
      throw new RentalValidationError(msg);
    }
  }

  async returnRental(input: ReturnRentalInput): Promise<BookingRental> {
    if (!input.rentalId || typeof input.rentalId !== 'string' || !input.rentalId.trim()) {
      throw new RentalValidationError('Rental ID is required');
    }

    try {
      return await this.repo.returnRental({
        ...input,
        rentalId: input.rentalId.trim(),
      });
    } catch (err: unknown) {
      if (err instanceof RentalValidationError) {
        throw err;
      }
      const msg = err instanceof Error ? err.message : 'Failed to return rental';
      throw new RentalValidationError(msg);
    }
  }

  async listExtensions(rentalId: string): Promise<RentalExtension[]> {
    if (!rentalId || typeof rentalId !== 'string' || !rentalId.trim()) {
      throw new RentalValidationError('Rental ID is required');
    }
    return this.repo.listExtensions(rentalId.trim());
  }

  async getRentalAlerts(thresholdMinutes: number, now?: Date): Promise<RentalEndAlert[]> {
    const threshold =
      typeof thresholdMinutes === 'number' && thresholdMinutes >= 1 && thresholdMinutes <= 60
        ? thresholdMinutes
        : 5;
    return this.repo.getRentalAlerts(threshold, now);
  }

  async processRentalEndAlertEmails(
    thresholdMinutes: number,
    now: Date = new Date()
  ): Promise<{ sentCount: number; rentalIds: string[] }> {
    const threshold =
      typeof thresholdMinutes === 'number' && thresholdMinutes >= 1 && thresholdMinutes <= 60
        ? thresholdMinutes
        : 5;

    const rentals = await this.repo.listRentals({ status: 'active' });
    const nowMs = now.getTime();
    const thresholdMs = threshold * 60 * 1000;
    const sentRentalIds: string[] = [];

    for (const rental of rentals) {
      if (rental.endAlertSentAt) {
        continue;
      }
      if (!rental.customerEmail) {
        continue;
      }

      const dueMs = new Date(rental.dueAt).getTime();
      const diffMs = dueMs - nowMs;
      const isWithinAlertThreshold = diffMs <= thresholdMs;

      if (isWithinAlertThreshold) {
        try {
          const minutesRemaining = Math.max(0, Math.round(diffMs / 60000));
          await this.emailService.sendRentalEndingAlertEmail({
            to: rental.customerEmail,
            customerName: rental.customerName,
            customerFirstName: rental.customerName?.split(' ')[0],
            rentalCode: rental.rentalCode,
            referenceCode: rental.referenceCode,
            spotName: rental.spotName,
            itemName: rental.serviceName || 'Rental Item',
            dueAt: rental.dueAt,
            timeRemainingMinutes: minutesRemaining,
            isOverdue: diffMs <= 0,
          });

          if (this.repo.markRentalEndAlertSent) {
            await this.repo.markRentalEndAlertSent(rental.id, now.toISOString());
          }
          sentRentalIds.push(rental.id);
        } catch (emailErr: unknown) {
          console.warn(`[RentalService] Failed to send ending alert email for rental ${rental.id}:`, emailErr);
        }
      }
    }

    return {
      sentCount: sentRentalIds.length,
      rentalIds: sentRentalIds,
    };
  }
}

export function createRentalService(
  repo: RentalRepository,
  emailService?: TransactionalEmailService
): RentalService {
  return new RentalService(repo, emailService);
}

