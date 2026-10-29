import type {
  AdditionalService,
  AdditionalServiceType,
  CreateAdditionalServiceInput,
  UpdateAdditionalServiceInput,
} from '../models/additionalService';
import type { AdditionalServiceRepository } from './additionalServiceRepository';

export class InMemoryAdditionalServiceRepository implements AdditionalServiceRepository {
  private services: AdditionalService[] = [];

  constructor(initialServices: AdditionalService[] = []) {
    this.services = [...initialServices];
  }

  async listAdditionalServices(filter?: {
    isActive?: boolean;
    serviceType?: AdditionalServiceType;
  }): Promise<AdditionalService[]> {
    let result = [...this.services];
    if (filter?.isActive !== undefined) {
      result = result.filter((s) => s.isActive === filter.isActive);
    }
    if (filter?.serviceType !== undefined) {
      result = result.filter((s) => s.serviceType === filter.serviceType);
    }
    return result;
  }

  async getAdditionalServiceById(id: string): Promise<AdditionalService | null> {
    const item = this.services.find((s) => s.id === id);
    return item ? { ...item } : null;
  }

  async createAdditionalService(input: CreateAdditionalServiceInput): Promise<AdditionalService> {
    const now = new Date().toISOString();
    const totalInventory = input.serviceType === 'rental' ? (input.totalInventory ?? 1) : 0;
    const newService: AdditionalService = {
      id: `svc-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      name: input.name.trim(),
      description: input.description?.trim() ?? '',
      serviceType: input.serviceType,
      hourlyRate: input.serviceType === 'rental' ? (input.hourlyRate ?? null) : null,
      dailyRate: input.serviceType === 'rental' ? (input.dailyRate ?? null) : null,
      totalInventory,
      availableInventory: totalInventory,
      details: input.details?.trim() ?? '',
      isActive: input.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    };
    this.services.push(newService);
    return { ...newService };
  }

  async updateAdditionalService(
    id: string,
    input: UpdateAdditionalServiceInput
  ): Promise<AdditionalService> {
    const index = this.services.findIndex((s) => s.id === id);
    if (index === -1) {
      throw new Error(`Additional service not found: ${id}`);
    }
    const existing = this.services[index];
    const now = new Date().toISOString();
    const serviceType = input.serviceType ?? existing.serviceType;
    const totalInventory =
      serviceType === 'rental'
        ? (input.totalInventory !== undefined ? input.totalInventory : existing.totalInventory)
        : 0;
    const availableInventory =
      serviceType === 'rental'
        ? (input.availableInventory !== undefined
            ? Math.min(input.availableInventory, totalInventory)
            : Math.min(existing.availableInventory, totalInventory))
        : 0;

    const updated: AdditionalService = {
      ...existing,
      name: input.name !== undefined ? input.name.trim() : existing.name,
      description: input.description !== undefined ? input.description.trim() : existing.description,
      serviceType,
      hourlyRate:
        serviceType === 'rental'
          ? (input.hourlyRate !== undefined ? input.hourlyRate : existing.hourlyRate)
          : null,
      dailyRate:
        serviceType === 'rental'
          ? (input.dailyRate !== undefined ? input.dailyRate : existing.dailyRate)
          : null,
      totalInventory,
      availableInventory,
      details: input.details !== undefined ? input.details.trim() : existing.details,
      isActive: input.isActive !== undefined ? input.isActive : existing.isActive,
      updatedAt: now,
    };

    this.services[index] = updated;
    return { ...updated };
  }

  async deleteAdditionalService(id: string): Promise<boolean> {
    const initialLen = this.services.length;
    this.services = this.services.filter((s) => s.id !== id);
    return this.services.length < initialLen;
  }
}

