import type {
  BookingRental,
  RentalExtension,
  AssignRentalInput,
  ExtendRentalInput,
  ReturnRentalInput,
  RentalEndAlert,
} from '../models/rental';

export interface RentalFilter {
  status?: string;
  reservationId?: string;
  customerId?: string;
}

export interface RentalRepository {
  listRentals(filter?: RentalFilter): Promise<BookingRental[]>;
  getRentalById(id: string): Promise<BookingRental | null>;
  getRentalByCode(code: string): Promise<BookingRental | null>;
  assignRental(input: AssignRentalInput): Promise<BookingRental>;
  extendRental(input: ExtendRentalInput): Promise<BookingRental>;
  returnRental(input: ReturnRentalInput): Promise<BookingRental>;
  listExtensions(rentalId: string): Promise<RentalExtension[]>;
  getRentalAlerts(thresholdMinutes: number, now?: Date): Promise<RentalEndAlert[]>;
  markRentalConfirmationSent?(rentalId: string, sentAt?: string): Promise<void>;
  markRentalEndAlertSent?(rentalId: string, sentAt?: string | null): Promise<void>;
}

