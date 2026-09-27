import type {
  AdminWorkspaceSpace,
  AdminWorkspaceStatus,
  WorkspaceAuditLogEntry,
  AdminWorkspaceType,
  CreateFloorInput,
  CreateWorkspaceInstanceInput,
  CreateWorkspaceInstanceFromTemplateInput,
  CreateWorkspaceTemplateInput,
  DuplicateWorkspaceInstanceInput,
  WorkspaceAvailabilityStatus,
  WorkspaceManagedUpdateResult,
  WorkspaceStatusImpactReservation,
  UpdateWorkspaceInstanceInput,
  UpdateWorkspaceTemplateInput,
  WorkspaceCatalog,
  WorkspaceInstanceDetails,
  WorkspaceOperationalStatus,
  WorkspaceRepository,
  WorkspaceTemplate,
} from '../models/workspace';
import { normalizeAmenityTag } from '../models/amenities';

const VALID_OPERATIONAL_STATUSES: WorkspaceOperationalStatus[] = [
  'ACTIVE',
  'UNAVAILABLE',
  'MAINTENANCE',
  'BROKEN',
  'INACTIVE',
];

const DEFAULT_AUDIT_ACTOR: Pick<WorkspaceAuditLogEntry, 'actorRole' | 'actorUserId'> = {
  actorRole: 'SYSTEM',
  actorUserId: null,
};

export class WorkspaceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceValidationError';
    Object.setPrototypeOf(this, WorkspaceValidationError.prototype);
  }
}

export class WorkspaceConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceConflictError';
    Object.setPrototypeOf(this, WorkspaceConflictError.prototype);
  }
}

export function normalizeCreateFloorInput(input: CreateFloorInput): CreateFloorInput {
  return {
    name: requireNonBlank(input.name, 'Floor name'),
  };
}

export function normalizeCreateTemplateInput(
  input: CreateWorkspaceTemplateInput
): CreateWorkspaceTemplateInput {
  const name = requireNonBlank(input.name, 'Template name');
  const capacity = requirePositiveInteger(input.capacity, 'Template capacity');
  const rateAmount = requireNonNegativeNumber(input.rateAmount, 'Template rate');
  const defaultShape = requireNonBlank(input.defaultShape ?? inferShapeFromName(name), 'Default shape');
  const defaultColor = requireNonBlank(input.defaultColor ?? '#009689', 'Default color');

  const hasDayPass = Boolean(input.hasDayPass);
  let dayPassPrice = input.dayPassPrice !== undefined && input.dayPassPrice !== null ? Number(input.dayPassPrice) : null;
  if (hasDayPass) {
    if (dayPassPrice === null || isNaN(dayPassPrice) || dayPassPrice < 0) {
      throw new WorkspaceValidationError('Day pass price must be non-negative when day pass is enabled');
    }
  } else {
    dayPassPrice = dayPassPrice !== null && dayPassPrice >= 0 ? dayPassPrice : null;
  }

  const hasNightPass = Boolean(input.hasNightPass);
  let nightPassPrice = input.nightPassPrice !== undefined && input.nightPassPrice !== null ? Number(input.nightPassPrice) : null;
  if (hasNightPass) {
    if (nightPassPrice === null || isNaN(nightPassPrice) || nightPassPrice < 0) {
      throw new WorkspaceValidationError('Night pass price must be non-negative when night pass is enabled');
    }
  } else {
    nightPassPrice = nightPassPrice !== null && nightPassPrice >= 0 ? nightPassPrice : null;
  }

  const hasWholeDayPass = Boolean(input.hasWholeDayPass);
  let wholeDayPassPrice = input.wholeDayPassPrice !== undefined && input.wholeDayPassPrice !== null ? Number(input.wholeDayPassPrice) : null;
  if (hasWholeDayPass) {
    if (wholeDayPassPrice === null || isNaN(wholeDayPassPrice) || wholeDayPassPrice < 0) {
      throw new WorkspaceValidationError('Whole day pass price must be non-negative when whole day pass is enabled');
    }
  } else {
    wholeDayPassPrice = wholeDayPassPrice !== null && wholeDayPassPrice >= 0 ? wholeDayPassPrice : null;
  }

  const hasHalfDayPass = Boolean(input.hasHalfDayPass);
  let halfDayPassPrice = input.halfDayPassPrice !== undefined && input.halfDayPassPrice !== null ? Number(input.halfDayPassPrice) : null;
  if (hasHalfDayPass) {
    if (halfDayPassPrice === null || isNaN(halfDayPassPrice) || halfDayPassPrice < 0) {
      throw new WorkspaceValidationError('Half day pass price must be non-negative when half day pass is enabled');
    }
  } else {
    halfDayPassPrice = halfDayPassPrice !== null && halfDayPassPrice >= 0 ? halfDayPassPrice : null;
  }

  return {
    ...input,
    name,
    description: normalizeNullableText(input.description),
    photoPath: normalizeNullableText(input.photoPath),
    capacity,
    rateAmount,
    pricingUnit: 'HOURLY',
    hasDayPass,
    dayPassPrice,
    hasNightPass,
    nightPassPrice,
    hasWholeDayPass,
    wholeDayPassPrice,
    hasHalfDayPass,
    halfDayPassPrice,
    defaultShape,
    defaultColor,
    defaultStyle: requirePlainObject(input.defaultStyle ?? {}),
    isActive: input.isActive ?? true,
  };
}

export function normalizeUpdateTemplateInput(
  input: UpdateWorkspaceTemplateInput
): UpdateWorkspaceTemplateInput {
  const normalized: UpdateWorkspaceTemplateInput = {};

  if (input.name !== undefined) normalized.name = requireNonBlank(input.name, 'Template name');
  if (input.description !== undefined) normalized.description = normalizeNullableText(input.description);
  if (input.photoPath !== undefined) normalized.photoPath = normalizeNullableText(input.photoPath);
  if (input.capacity !== undefined) {
    normalized.capacity = requirePositiveInteger(input.capacity, 'Template capacity');
  }
  if (input.rateAmount !== undefined) {
    normalized.rateAmount = requireNonNegativeNumber(input.rateAmount, 'Template rate');
  }

  if (input.hasDayPass !== undefined) {
    normalized.hasDayPass = Boolean(input.hasDayPass);
  }
  if (input.dayPassPrice !== undefined) {
    normalized.dayPassPrice = input.dayPassPrice !== null ? requireNonNegativeNumber(input.dayPassPrice, 'Day pass price') : null;
  }
  if (normalized.hasDayPass || (input.hasDayPass === undefined && input.dayPassPrice !== undefined)) {
    if (input.dayPassPrice !== undefined && input.dayPassPrice !== null && (isNaN(Number(input.dayPassPrice)) || Number(input.dayPassPrice) < 0)) {
      throw new WorkspaceValidationError('Day pass price must be non-negative when day pass is enabled');
    }
  }

  if (input.hasNightPass !== undefined) {
    normalized.hasNightPass = Boolean(input.hasNightPass);
  }
  if (input.nightPassPrice !== undefined) {
    normalized.nightPassPrice = input.nightPassPrice !== null ? requireNonNegativeNumber(input.nightPassPrice, 'Night pass price') : null;
  }
  if (normalized.hasNightPass || (input.hasNightPass === undefined && input.nightPassPrice !== undefined)) {
    if (input.nightPassPrice !== undefined && input.nightPassPrice !== null && (isNaN(Number(input.nightPassPrice)) || Number(input.nightPassPrice) < 0)) {
      throw new WorkspaceValidationError('Night pass price must be non-negative when night pass is enabled');
    }
  }

  if (input.hasWholeDayPass !== undefined) {
    normalized.hasWholeDayPass = Boolean(input.hasWholeDayPass);
  }
  if (input.wholeDayPassPrice !== undefined) {
    normalized.wholeDayPassPrice = input.wholeDayPassPrice !== null ? requireNonNegativeNumber(input.wholeDayPassPrice, 'Whole day pass price') : null;
  }
  if (normalized.hasWholeDayPass || (input.hasWholeDayPass === undefined && input.wholeDayPassPrice !== undefined)) {
    if (input.wholeDayPassPrice !== undefined && input.wholeDayPassPrice !== null && (isNaN(Number(input.wholeDayPassPrice)) || Number(input.wholeDayPassPrice) < 0)) {
      throw new WorkspaceValidationError('Whole day pass price must be non-negative when whole day pass is enabled');
    }
  }

  if (input.hasHalfDayPass !== undefined) {
    normalized.hasHalfDayPass = Boolean(input.hasHalfDayPass);
  }
  if (input.halfDayPassPrice !== undefined) {
    normalized.halfDayPassPrice = input.halfDayPassPrice !== null ? requireNonNegativeNumber(input.halfDayPassPrice, 'Half day pass price') : null;
  }
  if (normalized.hasHalfDayPass || (input.hasHalfDayPass === undefined && input.halfDayPassPrice !== undefined)) {
    if (input.halfDayPassPrice !== undefined && input.halfDayPassPrice !== null && (isNaN(Number(input.halfDayPassPrice)) || Number(input.halfDayPassPrice) < 0)) {
      throw new WorkspaceValidationError('Half day pass price must be non-negative when half day pass is enabled');
    }
  }

  if (input.defaultShape !== undefined) {
    normalized.defaultShape = requireNonBlank(input.defaultShape, 'Default shape');
  }
  if (input.defaultColor !== undefined) {
    normalized.defaultColor = requireNonBlank(input.defaultColor, 'Default color');
  }
  if (input.defaultStyle !== undefined) {
    normalized.defaultStyle = requirePlainObject(input.defaultStyle);
  }
  if (input.isActive !== undefined) normalized.isActive = Boolean(input.isActive);

  return normalized;
}

export function normalizeCreateInstanceInput(
  input: CreateWorkspaceInstanceInput
): CreateWorkspaceInstanceInput {
  const operationalStatus = normalizeOperationalStatus(input.operationalStatus ?? 'ACTIVE');
  return {
    templateId: requireNonBlank(input.templateId, 'Template id'),
    floorId: requireNonBlank(input.floorId, 'Floor id'),
    instanceCode: normalizeInstanceCode(input.instanceCode),
    displayName: requireNonBlank(input.displayName, 'Instance display name'),
    operationalStatus,
    maintenanceNote: operationalStatus === 'MAINTENANCE' ? normalizeMaintenanceNote(input.maintenanceNote) : null,
  };
}

export function normalizeCreateInstanceFromTemplateInput(
  input: CreateWorkspaceInstanceFromTemplateInput
): CreateWorkspaceInstanceFromTemplateInput {
  const operationalStatus = input.operationalStatus ? normalizeOperationalStatus(input.operationalStatus) : undefined;
  return {
    templateId: requireNonBlank(input.templateId, 'Template id'),
    floorId: requireNonBlank(input.floorId, 'Floor id'),
    operationalStatus,
    maintenanceNote: operationalStatus === 'MAINTENANCE' ? normalizeMaintenanceNote(input.maintenanceNote) : (operationalStatus !== undefined ? null : undefined),
  };
}

export function normalizeUpdateInstanceInput(
  input: UpdateWorkspaceInstanceInput
): UpdateWorkspaceInstanceInput {
  const normalized: UpdateWorkspaceInstanceInput = {};

  if (input.displayName !== undefined) {
    normalized.displayName = requireNonBlank(input.displayName, 'Instance display name');
  }
  if (input.operationalStatus !== undefined) {
    normalized.operationalStatus = normalizeOperationalStatus(input.operationalStatus);
  }
  if (input.operationalStatus === 'MAINTENANCE') {
    normalized.maintenanceNote = normalizeMaintenanceNote(input.maintenanceNote);
  } else if (input.operationalStatus !== undefined) {
    normalized.maintenanceNote = null;
  } else if (input.maintenanceNote !== undefined) {
    normalized.maintenanceNote = normalizeMaintenanceNote(input.maintenanceNote);
  }

  return normalized;
}

export function normalizeMaintenanceNote(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 300) : null;
}

export function normalizeDuplicateInstanceInput(
  input: DuplicateWorkspaceInstanceInput
): DuplicateWorkspaceInstanceInput {
  return {
    instanceCode: normalizeInstanceCode(input.instanceCode),
    displayName: requireNonBlank(input.displayName, 'Instance display name'),
  };
}

export function compareWorkspaceInstances(
  a: {
    displayName?: string;
    name?: string;
    instanceCode?: string;
    createdAt?: string;
    id?: string;
  },
  b: {
    displayName?: string;
    name?: string;
    instanceCode?: string;
    createdAt?: string;
    id?: string;
  }
): number {
  const nameA = a.displayName ?? a.name ?? '';
  const nameB = b.displayName ?? b.name ?? '';
  const nameComp = nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
  if (nameComp !== 0) return nameComp;

  const codeA = a.instanceCode ?? '';
  const codeB = b.instanceCode ?? '';
  const codeComp = codeA.localeCompare(codeB, undefined, { numeric: true, sensitivity: 'base' });
  if (codeComp !== 0) return codeComp;

  const createdA = a.createdAt ?? '';
  const createdB = b.createdAt ?? '';
  const createdComp = createdA.localeCompare(createdB);
  if (createdComp !== 0) return createdComp;

  return (a.id ?? '').localeCompare(b.id ?? '');
}

export function sortWorkspaceInstances<
  T extends {
    displayName?: string;
    name?: string;
    instanceCode?: string;
    createdAt?: string;
    id?: string;
  },
>(instances: T[]): T[] {
  return [...instances].sort(compareWorkspaceInstances);
}

export function mapCatalogToAdminSpaces(catalog: WorkspaceCatalog): AdminWorkspaceSpace[] {
  return sortWorkspaceInstances(catalog.instances)
    .filter((instance) => instance.operationalStatus !== 'INACTIVE')
    .map(mapInstanceToAdminSpace);
}

export function mapInstanceToAdminSpace(instance: WorkspaceInstanceDetails): AdminWorkspaceSpace {
  return {
    id: instance.id,
    templateId: instance.templateId,
    floorId: instance.floorId,
    instanceCode: instance.instanceCode,
    name: instance.displayName,
    type: inferAdminType(instance.template),
    zone: instance.floor.name,
    capacity: instance.template.capacity,
    hourlyRate: instance.template.rateAmount,
    dayRate: (instance.template.hasDayPass && instance.template.dayPassPrice !== null && instance.template.dayPassPrice !== undefined)
      ? Number(instance.template.dayPassPrice)
      : instance.template.rateAmount * 8,
    hasDayPass: instance.template.hasDayPass,
    dayPassPrice: instance.template.dayPassPrice,
    hasNightPass: instance.template.hasNightPass,
    nightPassPrice: instance.template.nightPassPrice,
    hasWholeDayPass: instance.template.hasWholeDayPass,
    wholeDayPassPrice: instance.template.wholeDayPassPrice,
    hasHalfDayPass: instance.template.hasHalfDayPass,
    halfDayPassPrice: instance.template.halfDayPassPrice,
    status: mapOperationalStatusToAdminStatus(instance.operationalStatus),
    recommendations: extractRecommendationTags(instance.template.defaultStyle),
  };
}

export function mapAdminStatusToOperationalStatus(
  status: AdminWorkspaceStatus
): WorkspaceOperationalStatus {
  if (status === 'available') return 'ACTIVE';
  if (status === 'maintenance') return 'MAINTENANCE';
  return 'UNAVAILABLE';
}

export function mapOperationalStatusToAdminStatus(
  status: WorkspaceOperationalStatus
): AdminWorkspaceStatus {
  if (status === 'ACTIVE') return 'available';
  if (status === 'MAINTENANCE' || status === 'BROKEN') return 'maintenance';
  return 'occupied';
}

export function isOperationalStatusBookable(status: WorkspaceOperationalStatus): boolean {
  return status === 'ACTIVE';
}

export function getWorkspaceAvailabilityStatus(
  instance: WorkspaceInstanceDetails
): WorkspaceAvailabilityStatus {
  if (!instance.template.isActive) {
    return {
      workspaceInstanceId: instance.id,
      templateId: instance.templateId,
      operationalStatus: instance.operationalStatus,
      templateIsActive: false,
      isBookable: false,
      blockingReason: 'TEMPLATE_INACTIVE',
    };
  }

  if (!isOperationalStatusBookable(instance.operationalStatus)) {
    return {
      workspaceInstanceId: instance.id,
      templateId: instance.templateId,
      operationalStatus: instance.operationalStatus,
      templateIsActive: true,
      isBookable: false,
      blockingReason: 'OPERATIONAL_STATUS_BLOCKED',
    };
  }

  return {
    workspaceInstanceId: instance.id,
    templateId: instance.templateId,
    operationalStatus: instance.operationalStatus,
    templateIsActive: true,
    isBookable: true,
    blockingReason: null,
  };
}

export function inferAdminType(template: WorkspaceTemplate): AdminWorkspaceType {
  const name = `${template.name} ${template.defaultShape}`.toLowerCase();
  if (name.includes('meeting') || name.includes('room')) return 'meeting-room';
  if (name.includes('booth') || name.includes('phone')) return 'phone-booth';
  return 'desk';
}

export function createWorkspaceService(repository: WorkspaceRepository) {
  return {
    async listCatalog() {
      const catalog = await repository.listCatalog();
      return {
        ...catalog,
        instances: sortWorkspaceInstances(catalog.instances),
      };
    },
    async listAdminSpaces() {
      return mapCatalogToAdminSpaces(await repository.listCatalog());
    },
    async createFloor(input: CreateFloorInput) {
      return repository.createFloor(normalizeCreateFloorInput(input));
    },
    async deleteFloor(
      id: string,
      actor: Pick<WorkspaceAuditLogEntry, 'actorRole' | 'actorUserId'> = DEFAULT_AUDIT_ACTOR
    ) {
      const floorId = requireNonBlank(id, 'Floor id');
      const catalog = await repository.listCatalog();
      const floor = catalog.floors.find((f) => f.id === floorId);
      const result = await repository.deleteFloor(floorId);
      await repository.appendAuditLog({
        actorRole: actor.actorRole,
        actorUserId: actor.actorUserId,
        action: 'FLOOR_DELETED',
        entityType: 'floor',
        entityId: floorId,
        metadata: {
          floorId,
          floorName: floor?.name ?? 'Floor',
          removedInstancesCount: result.removedInstancesCount ?? 0,
        },
      });
      return result;
    },
    async createTemplate(input: CreateWorkspaceTemplateInput) {
      return repository.createTemplate(normalizeCreateTemplateInput(input));
    },
    async updateTemplate(id: string, input: UpdateWorkspaceTemplateInput) {
      return repository.updateTemplate(requireNonBlank(id, 'Template id'), normalizeUpdateTemplateInput(input));
    },
    async deleteTemplate(id: string) {
      return repository.deleteTemplate(requireNonBlank(id, 'Template id'));
    },
    async createInstance(input: CreateWorkspaceInstanceInput) {
      return repository.createInstance(normalizeCreateInstanceInput(input));
    },
    async createInstanceFromTemplate(input: CreateWorkspaceInstanceFromTemplateInput) {
      const normalizedInput = normalizeCreateInstanceFromTemplateInput(input);
      const catalog = await repository.listCatalog();
      const template = catalog.templates.find(t => t.id === normalizedInput.templateId);
      if (!template) {
        throw new WorkspaceConflictError(`Template not found: ${normalizedInput.templateId}`);
      }

      const templateName = template.name.trim();
      const baseName = deriveTemplatePlacementBaseName(templateName);
      const templateInstances = catalog.instances.filter((entry) => entry.templateId === template.id);
      let highestSequence = 0;
      for (const instance of templateInstances) {
        const match = new RegExp(`^(?:${escapeForRegExp(templateName)}|${escapeForRegExp(baseName)})\\s+(\\d+)$`, 'i').exec(instance.displayName);
        if (match) {
          highestSequence = Math.max(highestSequence, Number.parseInt(match[1], 10));
        }
      }

      const usesBaseNameOnly =
        templateInstances.length > 0 &&
        templateInstances.every((inst) =>
          new RegExp(`^${escapeForRegExp(baseName)}\\s+\\d+$`, 'i').test(inst.displayName)
        ) &&
        !templateInstances.some((inst) =>
          new RegExp(`^${escapeForRegExp(templateName)}\\s+\\d+$`, 'i').test(inst.displayName)
        );
      const prefix = usesBaseNameOnly && baseName !== templateName ? baseName : templateName;

      let nextNum = highestSequence + 1;
      let newName = `${prefix} ${nextNum}`;
      const existingNames = new Set(
        templateInstances.map((entry) => entry.displayName.trim().toLowerCase())
      );
      while (existingNames.has(newName.toLowerCase())) {
        nextNum += 1;
        newName = `${prefix} ${nextNum}`;
      }
      
      return repository.createInstance({
        templateId: template.id,
        floorId: normalizedInput.floorId,
        instanceCode: `V-${nextNum.toString().padStart(2, '0')}-${Math.floor(1000 + Math.random() * 9000)}`,
        displayName: newName,
        operationalStatus: normalizedInput.operationalStatus ?? 'ACTIVE',
      });
    },
    async updateInstance(id: string, input: UpdateWorkspaceInstanceInput) {
      return repository.updateInstance(requireNonBlank(id, 'Instance id'), normalizeUpdateInstanceInput(input));
    },
    async updateManagedInstance(
      id: string,
      input: UpdateWorkspaceInstanceInput,
      actor: Pick<WorkspaceAuditLogEntry, 'actorRole' | 'actorUserId'> = DEFAULT_AUDIT_ACTOR
    ): Promise<WorkspaceManagedUpdateResult> {
      const instanceId = requireNonBlank(id, 'Instance id');
      const normalizedInput = normalizeUpdateInstanceInput(input);
      const existing = await repository.getInstance(instanceId);
      const isRestoration =
        existing.operationalStatus === 'INACTIVE' && normalizedInput.operationalStatus === 'ACTIVE';

      if (isRestoration && existing.template && existing.template.isActive === false) {
        throw new WorkspaceValidationError(
          `Cannot restore physical workspace '${existing.displayName}' because its parent template '${existing.template.name}' is archived. Please activate the template first.`
        );
      }

      const updated = await repository.updateInstance(instanceId, normalizedInput);
      const affectedFutureReservations = await getAffectedFutureReservationsIfNeeded(
        repository,
        existing,
        updated
      );

      const shouldAudit =
        normalizedInput.displayName !== undefined || normalizedInput.operationalStatus !== undefined;

      if (shouldAudit) {
        const action = isRestoration ? 'workspace_instance_restored' : 'workspace.instance.updated';
        await repository.appendAuditLog({
          actorRole: actor.actorRole,
          actorUserId: actor.actorUserId,
          action,
          entityType: 'workspace_instance',
          entityId: instanceId,
          metadata: buildWorkspaceAuditMetadata(existing, updated, affectedFutureReservations),
        });
      }

      return {
        instance: updated,
        availability: getWorkspaceAvailabilityStatus(updated),
        affectedFutureReservations,
        auditLogged: shouldAudit,
      };
    },
    async deactivateInstance(id: string) {
      return repository.deactivateInstance(requireNonBlank(id, 'Instance id'));
    },
    async deleteInstance(id: string) {
      const instanceId = requireNonBlank(id, 'Instance id');
      if (repository.deleteInstance) {
        return repository.deleteInstance(instanceId);
      }
      const instance = await repository.deactivateInstance(instanceId);
      return { deleted: false, archived: true, instance };
    },
    async duplicateInstance(id: string, input: DuplicateWorkspaceInstanceInput) {
      return repository.duplicateInstance(
        requireNonBlank(id, 'Instance id'),
        normalizeDuplicateInstanceInput(input)
      );
    },
    async getMapPlacedInstanceIds(): Promise<Set<string>> {
      if (repository.getMapPlacedInstanceIds) {
        return repository.getMapPlacedInstanceIds();
      }
      const catalog = await repository.listCatalog();
      return new Set(
        catalog.instances
          .filter((i) => i.operationalStatus === 'ACTIVE')
          .map((i) => i.id)
      );
    },
  };
}

async function getAffectedFutureReservationsIfNeeded(
  repository: WorkspaceRepository,
  existing: WorkspaceInstanceDetails,
  updated: WorkspaceInstanceDetails
): Promise<WorkspaceStatusImpactReservation[]> {
  if (!isNewlyBlockingTransition(existing.operationalStatus, updated.operationalStatus)) {
    return [];
  }

  return repository.listFutureConfirmedReservations(updated.id, new Date().toISOString());
}

function isNewlyBlockingTransition(
  previousStatus: WorkspaceOperationalStatus,
  nextStatus: WorkspaceOperationalStatus
): boolean {
  return isOperationalStatusBookable(previousStatus) && !isOperationalStatusBookable(nextStatus);
}

function buildWorkspaceAuditMetadata(
  existing: WorkspaceInstanceDetails,
  updated: WorkspaceInstanceDetails,
  affectedFutureReservations: WorkspaceStatusImpactReservation[]
): Record<string, unknown> {
  return {
    previousDisplayName: existing.displayName,
    newDisplayName: updated.displayName,
    previousOperationalStatus: existing.operationalStatus,
    newOperationalStatus: updated.operationalStatus,
    previousMaintenanceNote: existing.maintenanceNote ?? null,
    newMaintenanceNote: updated.maintenanceNote ?? null,
    availability: getWorkspaceAvailabilityStatus(updated),
    affectedFutureReservationCount: affectedFutureReservations.length,
    affectedFutureReservations,
  };
}

function extractRecommendationTags(defaultStyle: Record<string, unknown> | null | undefined): string[] | undefined {
  if (!defaultStyle) return undefined;
  const tags = defaultStyle.recommendationTags ?? defaultStyle.recommendations ?? defaultStyle.tags;
  if (Array.isArray(tags)) {
    const list = tags
      .filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0)
      .map((tag) => normalizeAmenityTag(tag));
    return list.length > 0 ? list : undefined;
  }
  return undefined;
}

function inferShapeFromName(name: string): string {
  const normalized = name.toLowerCase();
  if (normalized.includes('room')) return 'rectangle';
  if (normalized.includes('booth')) return 'square';
  return 'desk';
}

function normalizeInstanceCode(value: string): string {
  return requireNonBlank(value, 'Instance code').toUpperCase();
}

function normalizeOperationalStatus(value: WorkspaceOperationalStatus): WorkspaceOperationalStatus {
  if (!VALID_OPERATIONAL_STATUSES.includes(value)) {
    throw new WorkspaceValidationError(`Unsupported operational status: ${value}`);
  }
  return value;
}

function requireNonBlank(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new WorkspaceValidationError(`${label} is required`);
  }
  return value.trim();
}

function normalizeNullableText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function requirePositiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new WorkspaceValidationError(`${label} must be a positive integer`);
  }
  return value;
}

function requireNonNegativeNumber(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new WorkspaceValidationError(`${label} must be non-negative`);
  }
  return Math.round(value * 100) / 100;
}

function requirePlainObject(value: Record<string, unknown>): Record<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new WorkspaceValidationError('Default style must be an object');
  }
  return value;
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function deriveTemplatePlacementBaseName(templateName: string): string {
  const words = templateName.trim().split(/\s+/);
  const trailingGenericWords = new Set(['table', 'desk', 'seat', 'spot', 'workspace']);

  if (words.length > 1 && trailingGenericWords.has(words[words.length - 1].toLowerCase())) {
    return words.slice(0, -1).join(' ');
  }

  return templateName.trim();
}
