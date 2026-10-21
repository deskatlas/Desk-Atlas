import { knowledgeValidation as z } from '@deskatlas/validation';
import { createAvailabilityService, SupabaseAvailabilityRepository, QueryCache, calculateReservationPrice,
  type BusinessAvailabilitySettings, type OperatingHoursInterval, type PublicSpot, type SpotDecisionRepository } from '@deskatlas/domain';
import { createPublishedMapService, SupabasePublishedMapRepository, type PublishedFloorMap } from '@deskatlas/domain';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CustomerDiscoveryContext } from '@deskatlas/validation';

const spotSchema = z.object({ workspace_id: z.string().uuid(), template_id: z.string().uuid(), floor_id: z.string().uuid(),
  map_version_id: z.string().uuid(), name: z.string().max(200), capacity: z.number().int().positive(), hourly_rate: z.coerce.number().finite().nonnegative() }).strict();
// Zero lifetime keeps reads authoritative while avoiding per-request registry bindings.
const currentSettings = new QueryCache<BusinessAvailabilitySettings | OperatingHoursInterval[]>(0);
const publishedMaps = new QueryCache<PublishedFloorMap | null>(0);
const maps = () => createPublishedMapService(new SupabasePublishedMapRepository({ cache: publishedMaps }));
export async function resolvePublicComparison(names: string[]): Promise<string[] | null> {
  const published = await maps().loadAllPublishedFloorMaps({ audience: 'CUSTOMER' });
  const workspaces = published.flatMap(map => map.elements.flatMap(element => element.workspace ? [element.workspace] : []));
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const ids: string[] = [];
  for (const name of names) {
    const target = normalize(name);
    const exact = workspaces.filter(spot => normalize(spot.displayName) === target || normalize(spot.instanceCode) === target);
    const matches = exact.length ? exact : /^spot\d+$/.test(target) ? workspaces.filter(spot => normalize(spot.displayName).endsWith(target)) : [];
    const unique = [...new Set(matches.map(spot => spot.workspaceInstanceId))];
    if (unique.length !== 1) return null;
    ids.push(unique[0]);
  }
  return [...new Set(ids)];
}
export function publicSpotRepository(db: SupabaseClient, signal: AbortSignal): SpotDecisionRepository {
  const repository = new SupabaseAvailabilityRepository({ cache: currentSettings, signal });
  const availability = createAvailabilityService(repository);
  return {
    async candidates(context) {
      const { data, error } = await db.rpc('customer_spot_candidates', {
        p_ids: context.compared_ids?.length ? context.compared_ids : context.workspace_id ? [context.workspace_id] : null,
        p_template: context.compared_ids?.length ? null : context.template_id ?? null, p_floor: context.compared_ids?.length ? null : context.floor_id ?? null,
      });
      if (error) throw new Error('SPOT_DATA_UNAVAILABLE');
      const parsed = z.object({ spots: z.array(spotSchema).max(13), has_more: z.boolean() }).strict().parse(data);
      if (parsed.has_more) return { has_more: true, spots: [] };
      const floorMaps = await Promise.all([...new Set(parsed.spots!.map(spot => spot.floor_id!))].map(floor => maps().loadPublishedFloorMap(floor, { audience: 'CUSTOMER' })));
      return { has_more: parsed.has_more!, spots: parsed.spots!.map(s => ({ workspace_id: s.workspace_id!, template_id: s.template_id!,
        floor_id: s.floor_id!, map_version_id: s.map_version_id!, name: s.name!, capacity: s.capacity!, hourly_rate: s.hourly_rate!,
        ...(() => { const map = floorMaps.find(map => map.version.id === s.map_version_id);
          const spot = map?.elements.find(element => element.workspace?.workspaceInstanceId === s.workspace_id)?.workspace;
          return spot ? { template_name: spot.templateName, tags: spot.tags } : {}; })(),
      })) };
    },
    async availability(spots: PublicSpot[], context: CustomerDiscoveryContext) {
      const now = new Date().toISOString();
      const checks = await Promise.all(spots.map(async spot => {
        if (signal.aborted) throw new Error('REQUEST_CANCELLED');
        const result = await availability.listTimeAvailability({ workspaceInstanceId: spot.workspace_id,
          date: context.date!, durationMinutes: context.duration_minutes!, nowIso: now, channel: 'ONLINE', minimumLeadMinutes: 30 });
        return result.workspaceIsBookable && result.slots.some(s => s.startTime === context.start_time && s.isAvailable) ? spot.workspace_id : null;
      }));
      return new Set(checks.filter((id): id is string => id !== null));
    },
    async prices(spots, context) {
      return new Map(spots.flatMap(s => {
        try { return [[s.workspace_id, calculateReservationPrice('HOURLY', { hourlyRate: s.hourly_rate }, context.duration_minutes! / 60).totalAmount] as const]; }
        catch { return []; }
      }));
    },
  };
}
