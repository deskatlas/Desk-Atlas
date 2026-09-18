import type { Floor, PublishedFloorMap } from '@deskatlas/domain';

export async function fetchPublishedMap(floorId?: string): Promise<{
  floors: Floor[];
  published: PublishedFloorMap | null;
}> {
  const query = floorId ? `?floorId=${encodeURIComponent(floorId)}` : '';
  const response = await fetch(`/api/published-map${query}`, { cache: 'no-store' });
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
  };
}

export async function updateStaffInstanceOperationalStatus(
  instanceId: string,
  operationalStatus: string,
  actor?: { userId?: string; role?: string }
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
    headers['x-user-role'] = actor.role;
  }

  const response = await fetch(`/api/operations/workspaces/instances/${encodeURIComponent(instanceId)}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      operationalStatus,
      ...(actor ? { actor } : {}),
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error ?? `Failed to update workspace status (${response.status})`);
  }

  return body;
}

export async function fetchStaffOccupancy(): Promise<any[]> {
  const response = await fetch('/api/operations/occupancy', { cache: 'no-store' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    return [];
  }
  return body.occupancy || [];
}


