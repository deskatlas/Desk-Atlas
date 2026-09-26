import {
  type Floor,
  type OccupancyRecord,
  type PublishedFloorMap,
  type WorkspaceStatusColors,
  DEFAULT_WORKSPACE_STATUS_COLORS,
  normalizeWorkspaceStatusColors,
} from '@deskatlas/domain';

export async function fetchWorkspaceStatusColors(): Promise<WorkspaceStatusColors> {
  try {
    const res = await fetch('/api/settings', { cache: 'no-store' });
    if (res.ok) {
      const json = await res.json().catch(() => ({}));
      if (json.statusColors) {
        return normalizeWorkspaceStatusColors(json.statusColors);
      }
      if (json.data?.businessSettings?.statusColors) {
        return normalizeWorkspaceStatusColors(json.data.businessSettings.statusColors);
      }
      if (json.businessSettings?.statusColors) {
        return normalizeWorkspaceStatusColors(json.businessSettings.statusColors);
      }
    }
  } catch {
    // fallback
  }
  return DEFAULT_WORKSPACE_STATUS_COLORS;
}

export async function fetchStaffOccupancy(): Promise<OccupancyRecord[]> {
  try {
    const response = await fetch('/api/operations/occupancy', { cache: 'no-store' });
    if (!response.ok) {
      return [];
    }
    const data = await response.json().catch(() => ({}));
    return Array.isArray(data.occupancy) ? data.occupancy : [];
  } catch {
    return [];
  }
}

export async function fetchPublishedMap(
  floorIdOrOptions?: string | { floorId?: string; includeAllFloors?: boolean }
): Promise<{
  floors: Floor[];
  published: PublishedFloorMap | null;
  allFloors?: PublishedFloorMap[];
}> {
  const floorId = typeof floorIdOrOptions === 'string' ? floorIdOrOptions : floorIdOrOptions?.floorId;
  const includeAllFloors = typeof floorIdOrOptions === 'object' ? floorIdOrOptions?.includeAllFloors : false;
  const params = new URLSearchParams();
  if (floorId) params.set('floorId', floorId);
  if (includeAllFloors) params.set('includeAllFloors', 'true');
  const query = params.toString() ? `?${params.toString()}` : '';

  const response = await fetch(`/api/published-map${query}`);
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 404) {
      return {
        floors: body.floors ?? [],
        published: null,
      };
    }
    throw new Error(body.error ?? `Published map request failed with status ${response.status}`);
  }

  return {
    floors: body.floors ?? [],
    published: body.published ?? null,
    allFloors: body.allFloors,
  };
}

export async function updateStaffInstanceOperationalStatus(
  instanceId: string,
  operationalStatus: string,
  actor?: { userId?: string; role?: string },
  maintenanceNote?: string | null
): Promise<{
  instance: any;
  availability: any;
  affectedFutureReservations: any[];
  auditLogged: boolean;
}> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (actor?.userId) {
    headers['x-user-id'] = actor.userId;
  }
  if (actor?.role) {
    headers['x-user-role'] = actor.role.toUpperCase();
  }

  const response = await fetch(`/api/operations/workspaces/instances/${encodeURIComponent(instanceId)}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      operationalStatus,
      maintenanceNote: maintenanceNote !== undefined ? maintenanceNote : undefined,
      ...(actor?.userId || actor?.role ? { actor } : {}),
      ...(actor?.userId ? { actorUserId: actor.userId } : {}),
      ...(actor?.role ? { actorRole: actor.role.toUpperCase() } : {}),
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error ?? `Failed to update workspace status (${response.status})`);
  }

  return body;
}

