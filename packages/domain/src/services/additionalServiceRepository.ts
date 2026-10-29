import type {
  AdditionalService,
  AdditionalServiceType,
  CreateAdditionalServiceInput,
  UpdateAdditionalServiceInput,
} from '../models/additionalService';

export interface AdditionalServiceRepository {
  listAdditionalServices(filter?: {
    isActive?: boolean;
    serviceType?: AdditionalServiceType;
  }): Promise<AdditionalService[]>;
  getAdditionalServiceById(id: string): Promise<AdditionalService | null>;
  createAdditionalService(input: CreateAdditionalServiceInput): Promise<AdditionalService>;
  updateAdditionalService(id: string, input: UpdateAdditionalServiceInput): Promise<AdditionalService>;
  deleteAdditionalService(id: string): Promise<boolean>;
}

