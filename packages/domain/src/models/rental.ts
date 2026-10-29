export type RentalBillingMode = 'hourly' | 'daily';
export type RentalStatus = 'active' | 'returned' | 'overdue' | 'cancelled';

export interface BookingRental {
  id: string;
  rentalCode: string;
  reservationId: string;
  customerId?: string | null;
  serviceId: string;
  unitCount: number;
  billingMode: RentalBillingMode;
  durationUnits: number;
  rateApplied: number;
  totalAmount: number;
  idVerified: boolean;
  idNotes: string;
  status: RentalStatus;
  rentedAt: string;
  dueAt: string;
  returnedAt?: string | null;
  staffUserId?: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
  confirmationSentAt?: string | null;
  endAlertSentAt?: string | null;

  // Enriched presentation fields
  referenceCode?: string;
  customerName?: string;
  customerEmail?: string;
  spotName?: string;
  serviceName?: string;
  isNearingEnd?: boolean;
  isOverdue?: boolean;
  timeRemainingMinutes?: number;
}

export interface RentalExtension {
  id: string;
  rentalId: string;
  extensionMode: RentalBillingMode;
  additionalUnits: number;
  rateApplied: number;
  additionalAmount: number;
  previousDueAt: string;
  newDueAt: string;
  staffUserId?: string | null;
  extendedAt: string;
}

export interface AssignRentalInput {
  reservationId: string;
  serviceId: string;
  billingMode: RentalBillingMode;
  durationUnits: number;
  idVerified: boolean;
  idNotes?: string;
  staffUserId?: string | null;
  notes?: string;
}

export interface ExtendRentalInput {
  rentalId: string;
  extensionMode: RentalBillingMode;
  additionalUnits: number;
  staffUserId?: string | null;
}

export interface ReturnRentalInput {
  rentalId: string;
  staffUserId?: string | null;
}

export interface RentalEndAlert {
  rentalId: string;
  rentalCode: string;
  reservationId: string;
  referenceCode?: string;
  spotName: string;
  customerName: string;
  customerEmail?: string | null;
  itemName: string;
  dueAt: string;
  timeRemainingMinutes: number;
  isOverdue: boolean;
  endAlertSentAt?: string | null;
}

