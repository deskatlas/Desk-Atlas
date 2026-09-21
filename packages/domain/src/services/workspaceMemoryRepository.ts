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
import { WorkspaceConflictError, WorkspaceValidationError, sortWorkspaceInstances } from './workspaceService';

export class InMemoryWorkspaceRepository implements WorkspaceRepository {
  private templates = new Map<string, WorkspaceTemplate>();
  private floors = new Map<string, Floor>();
  private instances = new Map<string, WorkspaceInstanceDetails>();
  private reservationImpacts = new Map<string, WorkspaceStatusImpactReservation[]>();
  private auditLogs: WorkspaceAuditLogEntry[] = [];
  private mapPlacedInstanceIds: Set<string> | null = null;
  private sequence = 1;

  constructor(input?: { mapPlacedInstanceIds?: string[] | Set<string> }) {
    if (input?.mapPlacedInstanceIds) {
      this.mapPlacedInstanceIds = new Set(input.mapPlacedInstanceIds);
    }
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
      floors: Array.from(this.floors.values()).filter((f) => f.isActive !== false),
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

  async deleteFloor(id: string): Promise<{ deleted: boolean; deactivated?: boolean; removedInstancesCount?: number }> {
    const floor = this.requireFloor(id);
    const activeFloors = Array.from(this.floors.values()).filter((f) => f.isActive !== false);
    if (activeFloors.length <= 1) {
      throw new WorkspaceValidationError('Cannot delete floor: DeskAtlas requires at least one floor to remain active.');
    }

    const instances = Array.from(this.instances.values()).filter((i) => i.floorId === id);

    const nowIso = new Date().toISOString();
    let activeReservationsCount = 0;
    for (const instance of instances) {
      const futureReservations = await this.listFutureConfirmedReservations(instance.id, nowIso);
      activeReservationsCount += futureReservations.length;
    }

    if (activeReservationsCount > 0) {
      throw new WorkspaceConflictError(
        `Cannot delete floor '${floor.name}': There are ${activeReservationsCount} active or upcoming reservations on this floor. Please cancel, complete, or reallocate these reservations before deleting the floor.`
      );
    }

    if (instances.length === 0) {
      this.floors.delete(id);
      return { deleted: true, removedInstancesCount: 0 };
    }

    this.floors.set(id, { ...floor, isActive: false });
    for (const instance of instances) {
      this.instances.set(instance.id, {
        ...instance,
        operationalStatus: 'INACTIVE',
        floor: { ...floor, isActive: false },
      });
    }

    return { deleted: true, deactivated: true, removedInstancesCount: instances.length };
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
    this.requireUniqueDisplayName(template.id, input.displayName);
    const floor = this.requireFloor(input.floorId);
    const operationalStatus = input.operationalStatus ?? 'ACTIVE';
    const instance: WorkspaceInstanceDetails = {
      id: `instance-${this.sequence++}`,
      templateId: template.id,
      floorId: floor.id,
      instanceCode: input.instanceCode,
      displayName: input.displayName,
      operationalStatus,
      maintenanceNote: operationalStatus === 'MAINTENANCE' ? (input.maintenanceNote ?? null) : null,
      template,
      floor,
    };
    this.instances.set(instance.id, instance);
    return instance;
  }

  async updateInstance(id: string, input: UpdateWorkspaceInstanceInput): Promise<WorkspaceInstanceDetails> {
    const existing = this.requireInstance(id);
    if (input.displayName !== undefined && input.displayName.trim().toLowerCase() !== existing.displayName.trim().toLowerCase()) {
      this.requireUniqueDisplayName(existing.templateId, input.displayName, existing.id);
    }
    const newStatus = input.operationalStatus ?? existing.operationalStatus;
    let newNote = existing.maintenanceNote ?? null;
    if (newStatus === 'MAINTENANCE') {
      if (input.maintenanceNote !== undefined) {
        newNote = input.maintenanceNote;
      }
    } else {
      newNote = null;
    }

    const updated: WorkspaceInstanceDetails = {
      ...existing,
      displayName: input.displayName ?? existing.displayName,
      operationalStatus: newStatus,
      maintenanceNote: newNote,
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

  setMapPlacedInstanceIds(ids: string[] | Set<string> | null): void {
    if (ids === null) {
      this.mapPlacedInstanceIds = null;
    } else {
      this.mapPlacedInstanceIds = new Set(ids);
    }
  }

  addMapPlacedInstanceId(id: string): void {
    if (this.mapPlacedInstanceIds === null) {
      this.mapPlacedInstanceIds = new Set();
    }
    this.mapPlacedInstanceIds.add(id);
  }

  removeMapPlacedInstanceId(id: string): void {
    if (this.mapPlacedInstanceIds !== null) {
      this.mapPlacedInstanceIds.delete(id);
    }
  }

  async getMapPlacedInstanceIds(): Promise<Set<string>> {
    if (this.mapPlacedInstanceIds !== null) {
      return new Set(this.mapPlacedInstanceIds);
    }
    return new Set(
      Array.from(this.instances.values())
        .filter((i) => i.operationalStatus === 'ACTIVE')
        .map((i) => i.id)
    );
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
    if (!floor) throw new WorkspaceValidationError(`Floor not found: ${id}`);
    return floor;
  }

  private requireUniqueDisplayName(templateId: string, displayName: string, excludeId?: string) {
    const exists = Array.from(this.instances.values()).some(
      (instance) =>
        instance.templateId === templateId &&
        instance.id !== excludeId &&
        instance.displayName.trim().toLowerCase() === displayName.trim().toLowerCase()
    );
    if (exists) {
      throw new WorkspaceConflictError(`Instance name '${displayName}' already exists for this template`);
    }
  }

  private requireInstance(id: string): WorkspaceInstanceDetails {
    const instance = this.instances.get(id);
    if (!instance) throw new Error(`Instance not found: ${id}`);
    return instance;
  }
}
