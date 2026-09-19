import type {
  AdminWorkspaceStatus,
  AdminWorkspaceSpace,
  CreateWorkspaceInstanceFromTemplateInput,
  CreateWorkspaceInstanceInput,
  CreateWorkspaceTemplateInput,
  UpdateWorkspaceTemplateInput,
  WorkspaceCatalog,
  WorkspaceManagedUpdateResult,
  WorkspaceInstanceDetails,
  WorkspaceOperationalStatus,
  WorkspaceTemplate,
} from '@deskatlas/domain';
import { inferAdminType, sortWorkspaceInstances } from '@deskatlas/domain';

export interface AdminWorkspaceCatalogPayload {
  spaces: AdminWorkspaceSpace[];
  templates: WorkspaceCatalog['templates'];
  floors: WorkspaceCatalog['floors'];
  instances: WorkspaceCatalog['instances'];
}

export async function fetchAdminWorkspaceSpaces(): Promise<AdminWorkspaceSpace[]> {
  const response = await fetch('/api/admin/workspaces', { cache: 'no-store' });
  const body = await parseJson(response);
  return sortWorkspaceInstances(body.spaces ?? []);
}

export async function fetchAdminWorkspaceCatalog(): Promise<AdminWorkspaceCatalogPayload> {
  const response = await fetch('/api/admin/workspaces', { cache: 'no-store' });
  const body = await parseJson(response);

  return {
    spaces: sortWorkspaceInstances(body.spaces ?? []),
    templates: body.templates ?? [],
    floors: body.floors ?? [],
    instances: sortWorkspaceInstances(body.instances ?? []),
  };
}

export async function createAdminFloor(name: string): Promise<WorkspaceCatalog['floors'][number]> {
  const response = await fetch('/api/admin/workspaces/floors', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  const body = await parseJson(response);
  return body;
}

export async function deleteAdminFloor(
  floorId: string
): Promise<{ deleted: boolean; deactivated?: boolean; removedInstancesCount?: number }> {
  const response = await fetch(`/api/admin/workspaces/floors/${encodeURIComponent(floorId)}`, {
    method: 'DELETE',
  });
  const body = await parseJson(response);
  return body;
}


export async function createAdminWorkspaceTemplate(
  input: CreateWorkspaceTemplateInput
): Promise<WorkspaceTemplate> {
  const response = await fetch('/api/admin/workspaces/templates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = await parseJson(response);
  return body.template;
}

export async function updateAdminWorkspaceTemplate(
  templateId: string,
  input: UpdateWorkspaceTemplateInput
): Promise<WorkspaceTemplate> {
  return updateTemplate(templateId, input);
}

export async function createAdminWorkspaceInstance(
  input: CreateWorkspaceInstanceInput
): Promise<WorkspaceInstanceDetails> {
  const response = await fetch('/api/admin/workspaces/instances', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = await parseJson(response);
  return body.instance;
}

export async function createAdminWorkspaceInstanceFromTemplate(
  input: CreateWorkspaceInstanceFromTemplateInput
): Promise<AdminWorkspaceSpace> {
  const response = await fetch('/api/admin/workspaces/instances/from-template', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = await parseJson(response);
  return mapInstanceToAdminSpace(body.instance);
}

export async function updateAdminWorkspaceSpace(
  space: AdminWorkspaceSpace,
  input: {
    name: string;
    hourlyRate: number;
    capacity: number;
    operationalStatus: WorkspaceOperationalStatus;
    recommendations?: string[];
  }
): Promise<WorkspaceManagedUpdateResult & { adminSpace: AdminWorkspaceSpace }> {
  await updateTemplate(space.templateId, {
    rateAmount: input.hourlyRate,
    capacity: input.capacity > 0 ? input.capacity : 1,
    defaultStyle: { recommendations: input.recommendations ?? [] },
  });

  const result = await updateInstance(space.id, {
    displayName: input.name,
    operationalStatus: input.operationalStatus,
  });

  return {
    ...result,
    adminSpace: {
      ...space,
      name: result.instance.displayName,
      hourlyRate: input.hourlyRate,
      dayRate: input.hourlyRate * 8,
      capacity: input.capacity > 0 ? input.capacity : undefined,
      status: mapOperationalStatus(result.instance.operationalStatus),
      recommendations: input.recommendations,
    },
  };
}

export async function duplicateAdminWorkspaceSpace(
  space: AdminWorkspaceSpace,
  input: { instanceCode: string; displayName: string }
): Promise<AdminWorkspaceSpace> {
  const response = await fetch(`/api/admin/workspaces/instances/${encodeURIComponent(space.id)}/duplicate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = await parseJson(response);
  const instance = body.instance;

  return {
    ...space,
    id: instance.id,
    instanceCode: instance.instanceCode,
    name: instance.displayName,
    status: mapOperationalStatus(instance.operationalStatus),
  };
}

export async function deactivateAdminWorkspaceSpace(spaceId: string): Promise<void> {
  const response = await fetch(`/api/admin/workspaces/instances/${encodeURIComponent(spaceId)}`, {
    method: 'DELETE',
  });
  await parseJson(response);
}

async function updateTemplate(
  templateId: string,
  body: UpdateWorkspaceTemplateInput | Record<string, unknown>
): Promise<WorkspaceTemplate> {
  const response = await fetch(`/api/admin/workspaces/templates/${encodeURIComponent(templateId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = await parseJson(response);
  return result.template;
}

async function updateInstance(
  instanceId: string,
  body: { displayName: string; operationalStatus: WorkspaceOperationalStatus }
): Promise<WorkspaceManagedUpdateResult> {
  const response = await fetch(`/api/admin/workspaces/instances/${encodeURIComponent(instanceId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return parseJson(response);
}

async function parseJson(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error ?? `Workspace API request failed with status ${response.status}`);
  }
  return body;
}

function mapOperationalStatus(status: WorkspaceOperationalStatus): AdminWorkspaceStatus {
  if (status === 'ACTIVE') return 'available';
  if (status === 'MAINTENANCE' || status === 'BROKEN') return 'maintenance';
  return 'occupied';
}

function mapInstanceToAdminSpace(instance: WorkspaceInstanceDetails): AdminWorkspaceSpace {
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
    status: mapOperationalStatus(instance.operationalStatus),
  };
}
