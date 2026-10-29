import { knowledgeValidation as z } from '@deskatlas/validation';
import { createAvailabilityService, SupabaseAvailabilityRepository, QueryCache, calculateReservationPrice,
  type BusinessAvailabilitySettings, type OperatingHoursInterval, type PublicSpot, type SpotDecisionRepository } from '@deskatlas/domain';
import { createPublishedMapService, SupabasePublishedMapRepository, type PublishedFloorMap } from '@deskatlas/domain';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CustomerDiscoveryContext } from '@deskatlas/validation';

// PRD-F1-F4/F26 / MS77-TC05/08: names resolve only against the current public map.
const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
export function resolveWorkspaceNames(published: PublishedFloorMap[], context: CustomerDiscoveryContext,
  templateName?: string, floorName?: string, comparisonNames: string[] = [], currentMessage?: string): { context: CustomerDiscoveryContext; clarification?: string; floor_choices?: string[]; offered_names?: string[] } {
  const next = { ...context };
  const workspaces = published.flatMap(map => map.elements.flatMap(element => element.workspace ? [element.workspace] : []));
  const types = [...new Map(workspaces.map(spot => [spot.templateId, spot])).values()];
  const choices = types.map(spot => spot.templateName).sort();
  const matchesType = (name: string) => types.filter(spot => normalized(spot.templateName) === normalized(name)
    || `${normalized(spot.templateName)}s` === normalized(name));
  // A short literal reply to a published choice takes precedence over a stale
  // model interpretation. No fuzzy or inferred floor/category assignment.
  const reply = currentMessage?.trim().replace(/^(?:on|at|use|the)\s+/i, '').replace(/\s+please[.!?]*$/i, '').replace(/[.!?]+$/, '').trim();
  if (reply && published.filter(map => normalized(map.floor.name) === normalized(reply)).length === 1) floorName = reply;
  if (reply && matchesType(reply).length === 1) templateName = reply;
  if (templateName) {
    const matches = matchesType(templateName);
    if (matches.length !== 1) return { context: next, clarification: `Which workspace type did you mean? Published choices: ${choices.join(', ')}.` };
    next.template_id = matches[0].templateId;
    delete next.workspace_id; delete next.compared_ids;
  }
  if (floorName) {
    const exact = published.filter(map => normalized(map.floor.name) === normalized(floorName));
    const floorLabel = (name: string) => normalized(name).replace(/^floor|floor$/g, '');
    const matches = exact.length ? exact : published.filter(map => floorLabel(map.floor.name) === floorLabel(floorName!));
    if (matches.length !== 1) return { context: next, clarification: `Which floor did you mean? Published choices: ${published.map(map => map.floor.name).sort().join(', ')}.` };
    next.floor_id = matches[0].floor.id;
    delete next.workspace_id; delete next.compared_ids;
  }
  if (comparisonNames.length) {
    const ids: string[] = [];
    for (const name of comparisonNames) {
      const exact = workspaces.filter(spot => normalized(spot.displayName) === normalized(name) || normalized(spot.instanceCode) === normalized(name));
      const matches = exact.length ? exact : /^spot\d+$/.test(normalized(name)) ? workspaces.filter(spot => normalized(spot.displayName).endsWith(normalized(name))) : [];
      const unique = [...new Set(matches.map(spot => spot.workspaceInstanceId))];
      if (unique.length === 1) ids.push(unique[0]);
      else if (comparisonNames.length === 1 && matchesType(name).length === 1) {
        // Compatibility with planners that put a category in comparison_names.
        next.template_id = matchesType(name)[0].templateId;
        delete next.workspace_id; delete next.compared_ids;
      } else return { context: next, clarification: `I could not identify a unique map spot called "${name}". You can choose a workspace type (${choices.join(', ')}) or compare up to three exact map labels.` };
    }
    if (ids.length) next.compared_ids = [...new Set(ids)];
  }
  const offers = [...new Map(workspaces.filter(spot => (!next.template_id || spot.templateId === next.template_id)
    && (!next.floor_id || spot.floorId === next.floor_id)).map(spot => [spot.workspaceInstanceId, spot])).values()]
    .sort((a, b) => a.workspaceInstanceId.localeCompare(b.workspaceInstanceId)).map(spot =>
      new Set(workspaces.filter(other => normalized(other.displayName) === normalized(spot.displayName)).map(other => other.workspaceInstanceId)).size === 1
        ? spot.displayName : spot.instanceCode).filter(name => name.length <= 200).slice(0, 3);
  return { context: next, offered_names: offers, floor_choices: published.filter(map => map.elements.some(element => element.workspace
    && (!next.template_id || element.workspace.templateId === next.template_id))).map(map => map.floor.name).sort() };
}
export async function resolvePublicWorkspaceContext(context: CustomerDiscoveryContext, templateName?: string, floorName?: string, names?: string[], currentMessage?: string) {
  return resolveWorkspaceNames(await maps().loadAllPublishedFloorMaps({ audience: 'CUSTOMER' }), context, templateName, floorName, names, currentMessage);
}
export async function publicWorkspaceOverview(): Promise<string> {
  const types = await publicWorkspaceTypes();
  return types.length ? `Published workspace types and base rates:\n${types.map(spot => `${spot.name}: capacity ${spot.capacity}; PHP ${spot.hourly_rate} per hour.`).join('\n')}\nThese are published base rates, not a quote or a live availability check. Which type and schedule would you like to check?`
    : 'There are no workspace types on the current published customer map. Please contact the front desk.';
}
// PRD-F1-F4/F26: typed current facts, separate from historical document evidence.
export async function publicWorkspaceTypes() {
  const published = await maps().loadAllPublishedFloorMaps({ audience: 'CUSTOMER' });
  const types = [...new Map(published.flatMap(map => map.elements.flatMap(element => element.workspace ? [element.workspace] : []))
    .map(spot => [spot.templateId, spot])).values()].sort((a, b) => a.templateName.localeCompare(b.templateName));
  return types.map(spot => ({ template_id: spot.templateId, name: spot.templateName, capacity: spot.capacity, hourly_rate: spot.rateAmount }));
}

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
