import type { Floor, PublishedFloorMap } from '@deskatlas/domain';

export async function fetchPublishedMap(
  floorIdOrOptions?: string | { floorId?: string; includeAllFloors?: boolean }
): Promise<{
  floors: Floor[];
  published: PublishedFloorMap;
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
    throw new Error(body.error ?? `Published map request failed with status ${response.status}`);
  }

  return {
    floors: body.floors ?? [],
    published: body.published,
    allFloors: body.allFloors,
  };
}
