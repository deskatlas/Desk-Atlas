import { createClient } from '@supabase/supabase-js';

// MS-35 / QAD-TC35: Best-effort cache for low-volatility reference data only.
export type ReferenceDataTable =
  | 'business_settings'
  | 'operating_hours'
  | 'payment_methods'
  | 'workspace_templates'
  | 'floors'
  | 'map_versions'
  | 'workspace_instances';

type CacheEntry<T> = { value: T; loadedAt: number };

export class QueryCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private readonly inFlight = new Map<string, Promise<T>>();

  constructor(
    readonly maximumAgeMs: number,
    private readonly now: () => number = Date.now
  ) {
    if (!Number.isFinite(maximumAgeMs) || maximumAgeMs < 0) {
      throw new Error('QueryCache maximum age must be a non-negative finite number');
    }
  }

  async getOrLoad(key: string, loader: () => Promise<T>): Promise<T> {
    const cached = this.entries.get(key);
    if (cached && this.now() - cached.loadedAt < this.maximumAgeMs) {
      try { return structuredClone(cached.value); } catch { this.entries.delete(key); }
    }

    const pending = this.inFlight.get(key);
    if (pending) {
      const value = await pending;
      try { return structuredClone(value); } catch { return value; }
    }

    const load = Promise.resolve().then(loader)
      .then((value) => {
        if (this.inFlight.get(key) === load) {
          try {
            this.entries.set(key, { value: structuredClone(value), loadedAt: this.now() });
          } catch {
            // Serialization failures bypass caching and preserve the loader result.
          }
        }
        return value;
      })
      .finally(() => {
        if (this.inFlight.get(key) === load) this.inFlight.delete(key);
      });
    this.inFlight.set(key, load);
    return load;
  }

  invalidate(key: string): void {
    this.entries.delete(key);
    this.inFlight.delete(key);
  }

  invalidateMatching(predicate: (key: string) => boolean): void {
    for (const key of new Set([...this.entries.keys(), ...this.inFlight.keys()])) {
      if (predicate(key)) this.invalidate(key);
    }
  }

  invalidateAll(): void {
    this.entries.clear();
    this.inFlight.clear();
  }
}

export class CacheInvalidationRegistry {
  private readonly handlers = new Map<ReferenceDataTable, Set<() => void>>();
  private readonly bindings = new WeakMap<object, Set<string>>();

  registerCache<T>(table: ReferenceDataTable, cache: QueryCache<T>, prefix: string): void {
    const bindings = this.bindings.get(cache) ?? new Set<string>();
    const identity = `${table}:${prefix}`;
    if (bindings.has(identity)) return;
    bindings.add(identity);
    this.bindings.set(cache, bindings);
    this.register(table, () => cache.invalidateMatching((key) => key.startsWith(prefix)));
  }

  register(table: ReferenceDataTable, handler: () => void): () => void {
    const handlers = this.handlers.get(table) ?? new Set<() => void>();
    handlers.add(handler);
    this.handlers.set(table, handlers);
    return () => handlers.delete(handler);
  }

  invalidate(table: ReferenceDataTable): void {
    for (const handler of this.handlers.get(table) ?? []) {
      try { handler(); } catch { /* Cache failures cannot fail a successful mutation. */ }
    }
  }
}

export async function loadReferenceData<T>(
  cache: QueryCache<unknown>,
  key: string,
  loader: () => Promise<T>
): Promise<T> {
  let request: Promise<T> | undefined;
  const load = () => request ??= Promise.resolve().then(loader);
  try {
    return await cache.getOrLoad(key, load) as T;
  } catch {
    // Reuse the original request on loader failure; bypass a broken cache otherwise.
    return request ?? load();
  }
}

export const REFERENCE_DATA_MAX_AGE_MS = 5 * 60 * 1000;
export const PUBLISHED_MAP_MAX_AGE_MS = 10 * 60 * 1000;

export type ProjectReferenceCaches = {
  referenceData: QueryCache<unknown>;
  publishedMaps: QueryCache<unknown>;
  invalidationRegistry: CacheInvalidationRegistry;
};

const projectCaches = new Map<string, ProjectReferenceCaches>();
const realtimeProjects = new Set<string>();

export function normalizeSupabaseProjectUrl(url: string): string {
  return url.replace(/\/$/, '');
}

export function getProjectReferenceCaches(projectUrl: string): ProjectReferenceCaches {
  const normalizedUrl = normalizeSupabaseProjectUrl(projectUrl);
  const existing = projectCaches.get(normalizedUrl);
  if (existing) return existing;

  const created: ProjectReferenceCaches = {
    referenceData: new QueryCache<unknown>(REFERENCE_DATA_MAX_AGE_MS),
    publishedMaps: new QueryCache<unknown>(PUBLISHED_MAP_MAX_AGE_MS),
    invalidationRegistry: new CacheInvalidationRegistry(),
  };
  projectCaches.set(normalizedUrl, created);
  return created;
}

export type RealtimePayload = { table?: string; new?: Record<string, unknown> };

export type RealtimeChannel = {
  on(
    event: 'postgres_changes',
    filter: { event: '*'; schema: 'public'; table: string },
    callback: (payload: RealtimePayload) => void
  ): RealtimeChannel;
  subscribe(): RealtimeChannel;
};

export type RealtimeClient = { channel(name: string): RealtimeChannel };

export function registerReferenceDataRealtimeInvalidation(
  client: RealtimeClient,
  projectUrl: string,
  registry = getProjectReferenceCaches(projectUrl).invalidationRegistry
): RealtimeChannel {
  const channel = client.channel(`ms35-reference-data-${encodeURIComponent(projectUrl)}`);
  const tables: ReferenceDataTable[] = [
    'business_settings',
    'operating_hours',
    'payment_methods',
    'workspace_templates',
    'floors',
    'map_versions',
    'workspace_instances',
  ];
  for (const table of tables) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
      registry.invalidate(table);
    });
  }
  return channel.subscribe();
}

export function ensureReferenceDataRealtimeInvalidation(
  projectUrl: string,
  serviceRoleKey: string,
  registry = getProjectReferenceCaches(projectUrl).invalidationRegistry
): void {
  if (process.env.NODE_ENV === 'test') return;
  const normalizedUrl = normalizeSupabaseProjectUrl(projectUrl);
  if (realtimeProjects.has(normalizedUrl)) return;
  realtimeProjects.add(normalizedUrl);

  try {
  const client = createClient(normalizedUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const channel = client.channel(`ms35-reference-data-${encodeURIComponent(normalizedUrl)}`);
  const tables: ReferenceDataTable[] = [
    'business_settings',
    'operating_hours',
    'payment_methods',
    'workspace_templates',
    'floors',
    'map_versions',
    'workspace_instances',
  ];
  for (const table of tables) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
      registry.invalidate(table);
    });
  }
  // The client reconnects its existing channel. Keep a single listener per process.
  channel.subscribe();
  } catch {
    realtimeProjects.delete(normalizedUrl);
    // Maximum age remains the fallback if Realtime cannot be initialized.
  }
}
