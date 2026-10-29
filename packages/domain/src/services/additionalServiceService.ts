import type {
  AdditionalService,
  AdditionalServiceType,
  CreateAdditionalServiceInput,
  UpdateAdditionalServiceInput,
} from '../models/additionalService';
import type { AdditionalServiceRepository } from './additionalServiceRepository';

export class AdditionalServiceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdditionalServiceValidationError';
  }
}

export function validateCreateAdditionalServiceInput(input: CreateAdditionalServiceInput): void {
  if (!input.name || input.name.trim().length < 2) {
    throw new AdditionalServiceValidationError('Service name must be at least 2 characters');
  }
  if (input.name.trim().length > 100) {
    throw new AdditionalServiceValidationError('Service name cannot exceed 100 characters');
  }

  if (input.serviceType !== 'rental' && input.serviceType !== 'one_time') {
    throw new AdditionalServiceValidationError('Service type must be either rental or one_time');
  }

  if (input.serviceType === 'rental') {
    if (
      input.hourlyRate === undefined ||
      input.hourlyRate === null ||
      isNaN(Number(input.hourlyRate)) ||
      Number(input.hourlyRate) <= 0
    ) {
      throw new AdditionalServiceValidationError(
        'Hourly rate is required and must be greater than 0 for rental items'
      );
    }

    if (input.dailyRate !== undefined && input.dailyRate !== null) {
      const daily = Number(input.dailyRate);
      const hourly = Number(input.hourlyRate);
      if (isNaN(daily) || daily <= 0) {
        throw new AdditionalServiceValidationError('Daily rate must be greater than 0');
      }
      if (daily < hourly) {
        throw new AdditionalServiceValidationError(
          'Per-day rate must be greater than or equal to the hourly rate'
        );
      }
    }

    const totalInventory = input.totalInventory !== undefined ? Number(input.totalInventory) : 1;
    if (isNaN(totalInventory) || !Number.isInteger(totalInventory) || totalInventory < 1) {
      throw new AdditionalServiceValidationError('Total inventory must be at least 1');
    }
  } else if (input.serviceType === 'one_time') {
    if (!input.details || input.details.trim().length === 0) {
      throw new AdditionalServiceValidationError(
        'Service details and pricing breakdown are required for one-time services'
      );
    }
  }
}

export function validateUpdateAdditionalServiceInput(
  existing: AdditionalService,
  input: UpdateAdditionalServiceInput
): void {
  if (input.name !== undefined) {
    if (input.name.trim().length < 2) {
      throw new AdditionalServiceValidationError('Service name must be at least 2 characters');
    }
    if (input.name.trim().length > 100) {
      throw new AdditionalServiceValidationError('Service name cannot exceed 100 characters');
    }
  }

  const effectiveType = input.serviceType ?? existing.serviceType;
  if (effectiveType === 'rental') {
    const hourly =
      input.hourlyRate !== undefined ? input.hourlyRate : existing.hourlyRate;
    if (hourly === null || hourly === undefined || Number(hourly) <= 0) {
      throw new AdditionalServiceValidationError(
        'Hourly rate is required and must be greater than 0 for rental items'
      );
    }

    const daily =
      input.dailyRate !== undefined ? input.dailyRate : existing.dailyRate;
    if (daily !== null && daily !== undefined) {
      if (Number(daily) < Number(hourly)) {
        throw new AdditionalServiceValidationError(
          'Per-day rate must be greater than or equal to the hourly rate'
        );
      }
    }

    const total =
      input.totalInventory !== undefined ? input.totalInventory : existing.totalInventory;
    if (total < 1 || !Number.isInteger(total)) {
      throw new AdditionalServiceValidationError('Total inventory must be at least 1');
    }

    const available =
      input.availableInventory !== undefined ? input.availableInventory : existing.availableInventory;
    if (available < 0 || available > total) {
      throw new AdditionalServiceValidationError(
        'Available inventory must be between 0 and total inventory'
      );
    }
  } else if (effectiveType === 'one_time') {
    const details = input.details !== undefined ? input.details : existing.details;
    if (!details || details.trim().length === 0) {
      throw new AdditionalServiceValidationError(
        'Service details and pricing breakdown are required for one-time services'
      );
    }
  }
}

export class AdditionalServiceService {
  constructor(private readonly repository: AdditionalServiceRepository) {}

  async listServices(filter?: {
    isActive?: boolean;
    serviceType?: AdditionalServiceType;
  }): Promise<AdditionalService[]> {
    return this.repository.listAdditionalServices(filter);
  }

  async getServiceById(id: string): Promise<AdditionalService | null> {
    return this.repository.getAdditionalServiceById(id);
  }

  async createService(input: CreateAdditionalServiceInput): Promise<AdditionalService> {
    validateCreateAdditionalServiceInput(input);
    return this.repository.createAdditionalService(input);
  }

  async updateService(
    id: string,
    input: UpdateAdditionalServiceInput
  ): Promise<AdditionalService> {
    const existing = await this.repository.getAdditionalServiceById(id);
    if (!existing) {
      throw new AdditionalServiceValidationError(`Additional service not found: ${id}`);
    }
    validateUpdateAdditionalServiceInput(existing, input);
    return this.repository.updateAdditionalService(id, input);
  }

  async deleteService(id: string): Promise<boolean> {
    const existing = await this.repository.getAdditionalServiceById(id);
    if (!existing) {
      throw new AdditionalServiceValidationError(`Additional service not found: ${id}`);
    }
    return this.repository.deleteAdditionalService(id);
  }
}

export function createAdditionalServiceService(
  repository: AdditionalServiceRepository
): AdditionalServiceService {
  return new AdditionalServiceService(repository);
}

