import type {
  WorkspaceAuditLogEntry,
  CreateFloorInput,
  CreateWorkspaceInstanceInput,
  CreateWorkspaceTemplateInput,
  DuplicateWorkspaceInstanceInput,
  Floor,
  UpdateWorkspaceInstanceInput,
  UpdateWorkspaceTemplateInput,
  WorkspaceStatusImpactReservation,
  WorkspaceCatalog,
  WorkspaceInstanceDetails,
  WorkspaceOperationalStatus,
  WorkspaceRepository,
  WorkspaceTemplate,
} from '../models/workspace';
import { WorkspaceConflictError, sortWorkspaceInstances } from './workspaceService';

export class InMemoryWorkspaceRepository implements WorkspaceRepository {
  private templates = new Map<string, WorkspaceTemplate>();
  private floors = new Map<string, Floor>();
  private instances = new Map<string, WorkspaceInstanceDetails>();
  private reservationImpacts = new Map<string, WorkspaceStatusImpactReservation[]>();
  private auditLogs: WorkspaceAuditLogEntry[] = [];
  private sequence = 1;

  constructor() {
    this.floors.set('floor-default', {
      id: 'floor-default',
      name: 'Main Floor',
      floorNumber: 1,
      displayOrder: 0,
      isActive: true,
    });
  }

  async listCatalog(): Promise<WorkspaceCatalog> {
    return {
      templates: Array.from(this.templates.values()),
      floors: Array.from(this.floors.values()),
      instances: sortWorkspaceInstances(Array.from(this.instances.values())),
    };
  }

  async createFloor(input: CreateFloorInput): Promise<Floor> {
    const floor: Floor = {
      id: `floor-${this.sequence++}`,
      name: input.name,
      floorNumber: null,
      displayOrder: this.floors.size,
      isActive: true,
    };
    this.floors.set(floor.id, floor);
    return floor;
  }

  async getInstance(id: string): Promise<WorkspaceInstanceDetails> {
    return this.requireInstance(id);
  }

  async createTemplate(input: CreateWorkspaceTemplateInput): Promise<WorkspaceTemplate> {
    const template: WorkspaceTemplate = {
      id: `template-${this.sequence++}`,
      name: input.name,
      description: input.description ?? null,
      photoPath: input.photoPath ?? null,
      capacity: input.capacity,
      rateAmount: input.rateAmount,
      pricingUnit: input.pricingUnit ?? 'HOURLY',
      defaultShape: input.defaultShape ?? 'desk',
      defaultColor: input.defaultColor ?? '#009689',
      defaultStyle: input.defaultStyle ?? {},
      isActive: input.isActive ?? true,
    };
    this.templates.set(template.id, template);
    return template;
  }

  async updateTemplate(id: string, input: UpdateWorkspaceTemplateInput): Promise<WorkspaceTemplate> {
    const template = this.requireTemplate(id);
    const updated: WorkspaceTemplate = { ...template, ...input };
    this.templates.set(id, updated);
    this.refreshInstanceTemplate(id);
    return updated;
  }

  async deleteTemplate(id: string): Promise<{ deleted: boolean; deactivated?: boolean }> {
    const template = this.requireTemplate(id);
    const instances = Array.from(this.instances.values()).filter((i) => i.templateId === id);

    if (instances.length === 0) {
      this.templates.delete(id);
      return { deleted: true };
    }

    const nowIso = new Date().toISOString();
    for (const instance of instances) {
      const futureReservations = await this.listFutureConfirmedReservations(instance.id, nowIso);
      if (futureReservations.length > 0) {
        throw new WorkspaceConflictError('Cannot delete template with active or upcoming reservations');
      }
    }

    const updatedTemplate: WorkspaceTemplate = { ...template, isActive: false };
    this.templates.set(id, updatedTemplate);

    for (const instance of instances) {
      this.instances.set(instance.id, {
        ...instance,
        operationalStatus: 'INACTIVE',
        template: updatedTemplate,
      });
    }

    return { deleted: false, deactivated: true };
  }

  async createInstance(input: CreateWorkspaceInstanceInput): Promise<WorkspaceInstanceDetails> {
    this.requireUniqueCode(input.instanceCode);
    const template = this.requireTemplate(input.templateId);
    const floor = this.requireFloor(input.floorId);
    const instance: WorkspaceInstanceDetails = {
      id: `instance-${this.sequence++}`,
      templateId: template.id,
      floorId: floor.id,
      instanceCode: input.instanceCode,
      displayName: input.displayName,
      operationalStatus: input.operationalStatus ?? 'ACTIVE',
      template,
      floor,
    };
    this.instances.set(instance.id, instance);
    return instance;
  }

  async updateInstance(id: string, input: UpdateWorkspaceInstanceInput): Promise<WorkspaceInstanceDetails> {
    const existing = this.requireInstance(id);
    const updated: WorkspaceInstanceDetails = {
      ...existing,
      displayName: input.displayName ?? existing.displayName,
      operationalStatus: input.operationalStatus ?? existing.operationalStatus,
    };
    this.instances.set(id, updated);
    return updated;
  }

  async deactivateInstance(id: string): Promise<WorkspaceInstanceDetails> {
    return this.updateInstance(id, { operationalStatus: 'INACTIVE' });
  }

  async duplicateInstance(
    id: string,
    input: DuplicateWorkspaceInstanceInput
  ): Promise<WorkspaceInstanceDetails> {
    const existing = this.requireInstance(id);
    return this.createInstance({
      templateId: existing.templateId,
      floorId: existing.floorId,
      instanceCode: input.instanceCode,
      displayName: input.displayName,
      operationalStatus: existing.operationalStatus as WorkspaceOperationalStatus,
    });
  }

  async listFutureConfirmedReservations(
    instanceId: string,
    fromIso: string
  ): Promise<WorkspaceStatusImpactReservation[]> {
    const fromTime = Date.parse(fromIso);

    return (this.reservationImpacts.get(instanceId) ?? [])
      .filter((reservation) => {
        return (
          reservation.reservationStatus === 'CONFIRMED' &&
          reservation.startAt.length > 0 &&
          Date.parse(reservation.startAt) > fromTime
        );
      })
      .sort((left, right) => Date.parse(left.startAt) - Date.parse(right.startAt));
  }

  async appendAuditLog(entry: WorkspaceAuditLogEntry): Promise<void> {
    this.auditLogs.push({
      ...entry,
      createdAt: entry.createdAt ?? new Date().toISOString(),
    });
  }

  seedFutureConfirmedReservation(
    instanceId: string,
    reservation: Omit<WorkspaceStatusImpactReservation, 'candidateId' | 'reservationStatus'>
  ) {
    const existing = this.reservationImpacts.get(instanceId) ?? [];
    existing.push({
      ...reservation,
      candidateId: `${instanceId}:${reservation.reservationId}`,
      reservationStatus: 'CONFIRMED',
    });
    this.reservationImpacts.set(instanceId, existing);
  }

  async listAuditLogs(limit?: number): Promise<WorkspaceAuditLogEntry[]> {
    const sorted = [...this.auditLogs].sort((a, b) => {
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return timeB - timeA;
    });
    return typeof limit === 'number' ? sorted.slice(0, limit) : sorted;
  }

  private refreshInstanceTemplate(templateId: string) {
    const template = this.requireTemplate(templateId);
    for (const [id, instance] of this.instances) {
      if (instance.templateId === templateId) {
        this.instances.set(id, { ...instance, template });
      }
    }
  }

  private requireUniqueCode(instanceCode: string) {
    const exists = Array.from(this.instances.values()).some(
      (instance) => instance.instanceCode.toLowerCase() === instanceCode.toLowerCase()
    );
    if (exists) throw new WorkspaceConflictError(`Instance code already exists: ${instanceCode}`);
  }

  private requireTemplate(id: string): WorkspaceTemplate {
    const template = this.templates.get(id);
    if (!template) throw new Error(`Template not found: ${id}`);
    return template;
  }

  private requireFloor(id: string): Floor {
    const floor = this.floors.get(id);
    if (!floor) throw new Error(`Floor not found: ${id}`);
    return floor;
  }

  private requireInstance(id: string): WorkspaceInstanceDetails {
    const instance = this.instances.get(id);
    if (!instance) throw new Error(`Instance not found: ${id}`);
    return instance;
  }
}
