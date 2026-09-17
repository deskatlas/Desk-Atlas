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
  }
}

export class WorkspaceConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceConflictError';
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

  return {
    ...input,
    name,
    description: normalizeNullableText(input.description),
    photoPath: normalizeNullableText(input.photoPath),
    capacity,
    rateAmount,
    pricingUnit: 'HOURLY',
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
  return {
    templateId: requireNonBlank(input.templateId, 'Template id'),
    floorId: requireNonBlank(input.floorId, 'Floor id'),
    instanceCode: normalizeInstanceCode(input.instanceCode),
    displayName: requireNonBlank(input.displayName, 'Instance display name'),
    operationalStatus: normalizeOperationalStatus(input.operationalStatus ?? 'ACTIVE'),
  };
}

export function normalizeCreateInstanceFromTemplateInput(
  input: CreateWorkspaceInstanceFromTemplateInput
): CreateWorkspaceInstanceFromTemplateInput {
  return {
    templateId: requireNonBlank(input.templateId, 'Template id'),
    floorId: requireNonBlank(input.floorId, 'Floor id'),
    operationalStatus: input.operationalStatus ? normalizeOperationalStatus(input.operationalStatus) : undefined,
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

  return normalized;
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
    dayRate: instance.template.rateAmount * 8,
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

      const baseName = deriveTemplatePlacementBaseName(template.name);
      let highestSequence = 0;

      for (const instance of catalog.instances.filter((entry) => entry.templateId === template.id)) {
        const match = new RegExp(`^${escapeForRegExp(baseName)}\\s+(\\d+)$`, 'i').exec(instance.displayName);
        if (!match) continue;
        highestSequence = Math.max(highestSequence, Number.parseInt(match[1], 10));
      }

      const newName = `${baseName} ${highestSequence + 1}`;
      
      return repository.createInstance({
        templateId: template.id,
        floorId: normalizedInput.floorId,
        instanceCode: `V-${(highestSequence + 1).toString().padStart(2, '0')}-${Math.floor(1000 + Math.random() * 9000)}`,
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
      const updated = await repository.updateInstance(instanceId, normalizedInput);
      const affectedFutureReservations = await getAffectedFutureReservationsIfNeeded(
        repository,
        existing,
        updated
      );

      const shouldAudit =
        normalizedInput.displayName !== undefined || normalizedInput.operationalStatus !== undefined;

      if (shouldAudit) {
        await repository.appendAuditLog({
          actorRole: actor.actorRole,
          actorUserId: actor.actorUserId,
          action: 'workspace.instance.updated',
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
    async duplicateInstance(id: string, input: DuplicateWorkspaceInstanceInput) {
      return repository.duplicateInstance(
        requireNonBlank(id, 'Instance id'),
        normalizeDuplicateInstanceInput(input)
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
    availability: getWorkspaceAvailabilityStatus(updated),
    affectedFutureReservationCount: affectedFutureReservations.length,
    affectedFutureReservations,
  };
}

function extractRecommendationTags(defaultStyle: Record<string, unknown>): string[] | undefined {
  const tags = defaultStyle.recommendations;
  if (!Array.isArray(tags)) return undefined;
  return tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0);
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
