export type AdditionalServiceType = 'rental' | 'one_time';

export interface AdditionalService {
  id: string;
  name: string;
  description: string;
  serviceType: AdditionalServiceType;
  hourlyRate: number | null;
  dailyRate: number | null;
  totalInventory: number;
  availableInventory: number;
  details: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAdditionalServiceInput {
  name: string;
  description?: string;
  serviceType: AdditionalServiceType;
  hourlyRate?: number | null;
  dailyRate?: number | null;
  totalInventory?: number;
  details?: string;
  isActive?: boolean;
}

export interface UpdateAdditionalServiceInput {
  name?: string;
  description?: string;
  serviceType?: AdditionalServiceType;
  hourlyRate?: number | null;
  dailyRate?: number | null;
  totalInventory?: number;
  availableInventory?: number;
  details?: string;
  isActive?: boolean;
}

