export type BusinessOperatingHoursMode = '24_7' | '24_HOURS_SELECTED_DAYS' | 'CUSTOM_HOURS';

export interface LandingPreviewPhoto {
  id: string;
  url: string;
  storagePath?: string | null;
  position: { x: number; y: number };
  displayOrder: number;
}

export interface PublicLandingPreviewPhoto {
  id: string;
  url: string;
  position: { x: number; y: number };
  displayOrder: number;
}

export interface WorkspaceStatusColors {
  available: string;
  occupied: string;
  maintenance: string;
  unavailable: string;
}

export const DEFAULT_WORKSPACE_STATUS_COLORS: WorkspaceStatusColors = {
  available: '#10B981',
  occupied: '#EF4444',
  maintenance: '#F59E0B',
  unavailable: '#6B7280',
};

export interface BusinessSettings {
  id: number;
  businessName: string;
  timezone: string;
  contactEmail: string | null;
  contactPhone: string | null;
  bookingIntervalMinutes: number;
  paymentExpiryMinutes: number;
  kioskTimeoutMinutes: number | null;
  kioskAllowanceMinutes?: number | null;
  bookingEndAlertMinutes?: number | null;
  customerSessionTimeoutMinutes?: number | null;
  customerRescheduleCutoffHours?: number | null;
  landingPreviewPhotos?: LandingPreviewPhoto[];
  statusColors?: WorkspaceStatusColors;
  cancellationPolicyPdfUrl?: string | null;
  cancellationPolicyPdfFilename?: string | null;
  cancellationPolicyUpdatedAt?: string | null;
  updatedAt?: string | null;
}

export interface OperatingHoursDaySchedule {
  dayOfWeek: number;
  isOpen: boolean;
  is24Hours: boolean;
  intervals: Array<{
    id?: string;
    opensAt: string;
    closesAt: string;
  }>;
}

export interface OperatingHoursConfig {
  mode: BusinessOperatingHoursMode;
  schedules: OperatingHoursDaySchedule[];
}

export interface AdminPaymentMethod {
  id: string;
  methodType: 'GCASH' | 'BANK' | 'CASH';
  displayName: string;
  accountName: string | null;
  accountNumber: string | null;
  qrImagePath: string | null;
  instructions: string | null;
  allowWeb: boolean;
  allowKiosk: boolean;
  isActive: boolean;
  displayOrder: number;
}

export interface UpdateBusinessSettingsInput {
  businessName: string;
  timezone: string;
  contactEmail?: string | null;
  contactPhone?: string | null;
  bookingIntervalMinutes: number;
  paymentExpiryMinutes: number;
  kioskTimeoutMinutes?: number | null;
  kioskAllowanceMinutes?: number | null;
  bookingEndAlertMinutes?: number | null;
  customerSessionTimeoutMinutes?: number | null;
  customerRescheduleCutoffHours?: number | null;
  landingPreviewPhotos?: LandingPreviewPhoto[];
  statusColors?: WorkspaceStatusColors;
  cancellationPolicyPdfUrl?: string | null;
  cancellationPolicyPdfFilename?: string | null;
  cancellationPolicyUpdatedAt?: string | null;
}

export interface UpdateOperatingHoursInput {
  mode?: BusinessOperatingHoursMode;
  schedules: Array<{
    dayOfWeek: number;
    isOpen: boolean;
    is24Hours?: boolean;
    intervals?: Array<{
      opensAt: string;
      closesAt: string;
    }>;
  }>;
}

export interface CreatePaymentMethodInput {
  methodType: 'GCASH' | 'BANK' | 'CASH';
  displayName: string;
  accountName?: string | null;
  accountNumber?: string | null;
  qrImagePath?: string | null;
  instructions?: string | null;
  allowWeb: boolean;
  allowKiosk: boolean;
  isActive?: boolean;
  displayOrder?: number;
}

export interface UpdatePaymentMethodInput {
  id: string;
  methodType?: 'GCASH' | 'BANK' | 'CASH';
  displayName: string;
  accountName?: string | null;
  accountNumber?: string | null;
  qrImagePath?: string | null;
  instructions?: string | null;
  allowWeb: boolean;
  allowKiosk: boolean;
  isActive: boolean;
  displayOrder?: number;
}

export interface ReorderPaymentMethodsInput {
  orderedIds: string[];
}

export interface SettingsOverview {
  businessSettings: BusinessSettings;
  operatingHoursConfig: OperatingHoursConfig;
  paymentMethods: AdminPaymentMethod[];
}

export type BusinessClosureType = 'FULL_DAY' | 'SPECIAL_HOURS';

export interface BusinessClosureException {
  id: string;
  date: string;
  endDate?: string | null;
  closureType: BusinessClosureType;
  opensAt: string | null;
  closesAt: string | null;
  reason: string | null;
  createdAt?: string;
  blockIds: string[];
}

export interface CreateBusinessClosureInput {
  date: string;
  endDate?: string | null;
  closureType: BusinessClosureType;
  opensAt?: string | null;
  closesAt?: string | null;
  reason?: string | null;
}

