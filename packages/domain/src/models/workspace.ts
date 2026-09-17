export type PricingUnit = 'HOURLY';

export type WorkspaceOperationalStatus =
  | 'ACTIVE'
  | 'UNAVAILABLE'
  | 'MAINTENANCE'
  | 'BROKEN'
  | 'INACTIVE';

export interface WorkspaceTemplate {
  id: string;
  name: string;
  description: string | null;
  photoPath: string | null;
  capacity: number;
  rateAmount: number;
  pricingUnit: PricingUnit;
  defaultShape: string;
  defaultColor: string;
  defaultStyle: Record<string, unknown>;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface Floor {
  id: string;
  name: string;
  floorNumber: number | null;
  displayOrder: number;
  isActive: boolean;
}

export interface WorkspaceInstance {
  id: string;
  templateId: string;
  floorId: string;
  instanceCode: string;
  displayName: string;
  operationalStatus: WorkspaceOperationalStatus;
  createdAt?: string;
  updatedAt?: string;
}

export interface WorkspaceInstanceDetails extends WorkspaceInstance {
  template: WorkspaceTemplate;
  floor: Floor;
}

export interface WorkspaceCatalog {
  templates: WorkspaceTemplate[];
  floors: Floor[];
  instances: WorkspaceInstanceDetails[];
}

export interface CreateWorkspaceTemplateInput {
  name: string;
  description?: string | null;
  photoPath?: string | null;
  capacity: number;
  rateAmount: number;
  pricingUnit?: PricingUnit;
  defaultShape?: string;
  defaultColor?: string;
  defaultStyle?: Record<string, unknown>;
  isActive?: boolean;
}

export interface UpdateWorkspaceTemplateInput {
  name?: string;
  description?: string | null;
  photoPath?: string | null;
  capacity?: number;
  rateAmount?: number;
  defaultShape?: string;
  defaultColor?: string;
  defaultStyle?: Record<string, unknown>;
  isActive?: boolean;
}

export interface CreateWorkspaceInstanceInput {
  templateId: string;
  floorId: string;
  instanceCode: string;
  displayName: string;
  operationalStatus?: WorkspaceOperationalStatus;
}

export interface CreateWorkspaceInstanceFromTemplateInput {
  templateId: string;
  floorId: string;
  operationalStatus?: WorkspaceOperationalStatus;
}

export interface UpdateWorkspaceInstanceInput {
  displayName?: string;
  operationalStatus?: WorkspaceOperationalStatus;
}

export type WorkspaceAvailabilityBlockReason = 'TEMPLATE_INACTIVE' | 'OPERATIONAL_STATUS_BLOCKED';

export interface WorkspaceAvailabilityStatus {
  workspaceInstanceId: string;
  templateId: string;
  operationalStatus: WorkspaceOperationalStatus;
  templateIsActive: boolean;
  isBookable: boolean;
  blockingReason: WorkspaceAvailabilityBlockReason | null;
}

export interface WorkspaceStatusImpactReservation {
  reservationId: string;
  reservationReferenceCode: string;
  candidateId: string;
  startAt: string;
  endAt: string;
  reservationStatus: 'CONFIRMED';
}

export type WorkspaceAuditActorRole = 'ADMIN' | 'STAFF' | 'SYSTEM';

export interface WorkspaceAuditLogEntry {
  actorUserId: string | null;
  actorRole: WorkspaceAuditActorRole;
  action: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown>;
  createdAt?: string;
}

export interface WorkspaceManagedUpdateResult {
  instance: WorkspaceInstanceDetails;
  availability: WorkspaceAvailabilityStatus;
  affectedFutureReservations: WorkspaceStatusImpactReservation[];
  auditLogged: boolean;
}

export interface DuplicateWorkspaceInstanceInput {
  instanceCode: string;
  displayName: string;
}

export interface CreateFloorInput {
  name: string;
}

export type AdminWorkspaceType = 'desk' | 'meeting-room' | 'phone-booth';
export type AdminWorkspaceStatus = 'available' | 'occupied' | 'maintenance';

export interface AdminWorkspaceSpace {
  id: string;
  templateId: string;
  floorId: string;
  instanceCode: string;
  name: string;
  type: AdminWorkspaceType;
  zone: string;
  capacity?: number;
  hourlyRate: number;
  dayRate: number;
  status: AdminWorkspaceStatus;
  recommendations?: string[];
}

export interface WorkspaceRepository {
  listCatalog(): Promise<WorkspaceCatalog>;
  getInstance(id: string): Promise<WorkspaceInstanceDetails>;
  createFloor(input: CreateFloorInput): Promise<Floor>;
  createTemplate(input: CreateWorkspaceTemplateInput): Promise<WorkspaceTemplate>;
  updateTemplate(id: string, input: UpdateWorkspaceTemplateInput): Promise<WorkspaceTemplate>;
  deleteTemplate(id: string): Promise<{ deleted: boolean; deactivated?: boolean }>;
  createInstance(input: CreateWorkspaceInstanceInput): Promise<WorkspaceInstanceDetails>;
  updateInstance(id: string, input: UpdateWorkspaceInstanceInput): Promise<WorkspaceInstanceDetails>;
  deactivateInstance(id: string): Promise<WorkspaceInstanceDetails>;
  duplicateInstance(id: string, input: DuplicateWorkspaceInstanceInput): Promise<WorkspaceInstanceDetails>;
  listFutureConfirmedReservations(
    instanceId: string,
    fromIso: string
  ): Promise<WorkspaceStatusImpactReservation[]>;
  appendAuditLog(entry: WorkspaceAuditLogEntry): Promise<void>;
  listAuditLogs?(limit?: number): Promise<WorkspaceAuditLogEntry[]>;
}
