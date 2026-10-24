import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SupabaseWorkspaceRepository as AdminWorkspaceRepository } from '../apps/admin-portal/src/app/api/admin/workspaces/_lib/supabaseWorkspaceRepository';
import {
  CacheInvalidationRegistry,
  QueryCache,
  loadReferenceData,
  SupabaseAvailabilityRepository,
  SupabasePublishedMapRepository,
  SupabaseSettingsRepository,
  SupabaseWorkspaceRepository,
  ReservationSupabaseRepository,
  ActivityLogSupabaseRepository,
  registerReferenceDataRealtimeInvalidation,
  type PublishedFloorMap,
} from '@deskatlas/domain';

const root = resolve(import.meta.dirname, '..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('MS-35: database optimization and reference-data caching', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('QAD-TC35-01: provides the four forward migrations and safe constraint syntax', () => {
    const migrations = [21, 22, 23, 24].map((number) =>
      read(`supabase/archive/pre-consolidation/0${number}_${[
        'consolidate_temp_hotfixes',
        'drop_confirmed_redundant_indexes',
        'add_verified_performance_indexes',
        'enable_reference_data_realtime',
      ][number - 21]}.sql`)
    );
    expect(migrations.join('\n')).not.toMatch(/ADD\s+CONSTRAINT\s+IF\s+NOT\s+EXISTS/i);
    expect(migrations[1]).toContain('idx_reservation_candidates_availability');
    expect(migrations[1]).toContain('idx_reservation_candidates_reservation_id');
    expect(migrations[1]).toContain('idx_reservations_reference_code');
    expect(migrations[2]).toContain('idx_rc_assigned_workspace_window');
    expect(read('supabase/archive/pre-consolidation/temp.sql')).toContain('DEPRECATED: Absorbed into 021_consolidate_temp_hotfixes.sql');
    const baseline = JSON.parse(read('tests/fixtures/ms35-historical-migration-hashes.json')) as Record<string, string>;
    expect(Object.keys(baseline)).toHaveLength(19);
    for (const [name, hash] of Object.entries(baseline)) {
      expect(createHash('sha256').update(read(`supabase/archive/pre-consolidation/${name}`).replace(/\r\n/g, '\n')).digest('hex'), name).toBe(hash);
    }
  });

  it('QAD-TC35-02: expires entries, invalidates keys, and deduplicates in-flight loads', async () => {
    vi.useFakeTimers();
    const cache = new QueryCache<string>(300_000);
    const loader = vi.fn(async () => 'loaded');
    const [first, second] = await Promise.all([
      cache.getOrLoad('settings', loader),
      cache.getOrLoad('settings', loader),
    ]);
    expect([first, second]).toEqual(['loaded', 'loaded']);
    expect(loader).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(300_001);
    await cache.getOrLoad('settings', loader);
    expect(loader).toHaveBeenCalledTimes(2);
    cache.invalidate('settings');
    await cache.getOrLoad('settings', loader);
    expect(loader).toHaveBeenCalledTimes(3);
    cache.invalidateAll();
  });

  it('QAD-TC35-02b: invalidation prevents an older in-flight load from repopulating the cache', async () => {
    const cache = new QueryCache<string>(300_000);
    let finish: (value: string) => void = () => {};
    const old = cache.getOrLoad('settings', () => new Promise<string>((resolve) => { finish = resolve; }));
    await Promise.resolve();
    cache.invalidate('settings');
    expect(await cache.getOrLoad('settings', async () => 'new')).toBe('new');
    finish('old');
    await old;
    expect(await cache.getOrLoad('settings', async () => 'unexpected')).toBe('new');
  });

  it('QAD-TC35-02c: failed loads are retried and callers cannot mutate cached values', async () => {
    const cache = new QueryCache<{ value: string }>(300_000);
    await expect(cache.getOrLoad('key', async () => { throw new Error('offline'); })).rejects.toThrow('offline');
    const value = await cache.getOrLoad('key', async () => ({ value: 'original' }));
    value.value = 'changed';
    expect(await cache.getOrLoad('key', async () => ({ value: 'unexpected' }))).toEqual({ value: 'original' });
  });

  it('QAD-TC35-02d: a cache failure falls back to the live loader without retrying loader errors', async () => {
    const cache = new QueryCache<unknown>(300_000);
    vi.spyOn(cache, 'getOrLoad').mockRejectedValue(new Error('cache failure'));
    const loader = vi.fn(async () => 'fresh');
    expect(await loadReferenceData(cache, 'key', loader)).toBe('fresh');
    expect(loader).toHaveBeenCalledTimes(1);
    const failingLoader = vi.fn(async () => { throw new Error('database failure'); });
    const workingCache = new QueryCache<unknown>(300_000);
    await expect(loadReferenceData(workingCache, 'key', failingLoader)).rejects.toThrow('database failure');
    expect(failingLoader).toHaveBeenCalledTimes(1);
  });

  it('QAD-TC35-03b: a shared injectable cache never returns data from another project', async () => {
    const cache = new QueryCache<unknown>(300_000);
    const fetcher = vi.fn(async () => Response.json([]));
    vi.stubGlobal('fetch', fetcher);
    const first = new SupabaseWorkspaceRepository({ supabaseUrl: 'https://project-a.supabase.co', serviceRoleKey: 'test', cache });
    const second = new SupabaseWorkspaceRepository({ supabaseUrl: 'https://project-b.supabase.co', serviceRoleKey: 'test', cache });
    await first.listTemplates();
    await second.listTemplates();
    await first.listTemplates();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('QAD-TC35-04b: reservations, payments, assigned candidates, availability, and audit logs always read live', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      calls.push(String(input));
      return Response.json([]);
    }));
    const options = { supabaseUrl: 'https://live.supabase.co', serviceRoleKey: 'test' };
    const reservations = new ReservationSupabaseRepository(options);
    const activity = new ActivityLogSupabaseRepository(options);
    const availability = new SupabaseAvailabilityRepository(options);
    for (let attempt = 0; attempt < 2; attempt++) {
      await reservations.findCandidatesByReservationId('reservation-1');
      await reservations.findPaymentSessionByTokenHash('token');
      await reservations.listReportReservations();
      await activity.listActivityLogs({});
      await availability.listBlockingReservations('instance-1', '2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z');
    }
    expect(calls.filter((url) => url.includes('/payment_attempts'))).toHaveLength(2);
    expect(calls.filter((url) => url.includes('/reservations?'))).toHaveLength(2);
    expect(calls.filter((url) => url.includes('/audit_logs?'))).toHaveLength(2);
    // Pending candidates never block inventory; each live probe reads assigned rows only.
    expect(calls.filter((url) => url.includes('/reservation_candidates?'))).toHaveLength(4);
  });

  it('QAD-TC35-03: caches repository reference reads while keeping availability state live', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('/business_settings')) {
        return Response.json([{ timezone: 'Asia/Manila', booking_interval_minutes: 30, max_advance_booking_days: 90 }]);
      }
      if (url.includes('/operating_hours')) {
        return Response.json([{ id: 'oh-1', day_of_week: 1, opens_at: '08:00', closes_at: '18:00', is_active: true }]);
      }
      if (url.includes('/workspace_instances')) {
        return Response.json([]);
      }
      return Response.json([]);
    }));
    const cache = new QueryCache<
      Awaited<ReturnType<SupabaseAvailabilityRepository['getBusinessSettings']>> |
      Awaited<ReturnType<SupabaseAvailabilityRepository['listOperatingHours']>>
    >(300_000);
    const repo = new SupabaseAvailabilityRepository({
      supabaseUrl: 'https://one.supabase.co',
      serviceRoleKey: 'test-key',
      cache,
    });

    await repo.getBusinessSettings();
    await repo.getBusinessSettings();
    await repo.listOperatingHours(1);
    await repo.listOperatingHours(1);
    await repo.listWorkspaceInstancesByTemplate('template-1');
    await repo.listWorkspaceInstancesByTemplate('template-1');

    expect(calls.filter((url) => url.includes('/business_settings'))).toHaveLength(1);
    expect(calls.filter((url) => url.includes('/operating_hours'))).toHaveLength(1);
    expect(calls.filter((url) => url.includes('/workspace_instances'))).toHaveLength(2);
  });

  it('QAD-TC35-04: caches settings, payment methods, templates, and floors by project URL', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('/business_settings')) return Response.json([]);
      if (url.includes('/operating_hours')) return Response.json([]);
      if (url.includes('/payment_methods')) return Response.json([]);
      if (url.includes('/workspace_templates')) return Response.json([]);
      if (url.includes('/floors')) return Response.json([]);
      if (url.includes('/workspace_instances')) return Response.json([]);
      return Response.json([]);
    }));
    const settings = new SupabaseSettingsRepository({ supabaseUrl: 'https://two.supabase.co', serviceRoleKey: 'test-key' });
    const workspace = new SupabaseWorkspaceRepository({ supabaseUrl: 'https://two.supabase.co', serviceRoleKey: 'test-key' });
    await Promise.all([settings.getBusinessSettings(), settings.listOperatingHours(), settings.listPaymentMethods()]);
    await Promise.all([settings.getBusinessSettings(), settings.listOperatingHours(), settings.listPaymentMethods()]);
    await workspace.listCatalog();
    await workspace.listCatalog();
    expect(calls.filter((url) => url.includes('/business_settings'))).toHaveLength(1);
    expect(calls.filter((url) => url.includes('/operating_hours'))).toHaveLength(1);
    expect(calls.filter((url) => url.includes('/payment_methods'))).toHaveLength(1);
    expect(calls.filter((url) => url.includes('/workspace_templates'))).toHaveLength(1);
    expect(calls.filter((url) => url.includes('/floors'))).toHaveLength(1);
    expect(calls.filter((url) => url.includes('/workspace_instances'))).toHaveLength(2);
  });

  it('QAD-TC35-05: invalidates every configured Realtime table event', () => {
    const registry = new CacheInvalidationRegistry();
    const invalidations = new Map<string, number>();
    const callbacks = new Map<string, () => void>();
    for (const table of ['business_settings', 'operating_hours', 'payment_methods', 'workspace_templates', 'floors', 'map_versions', 'workspace_instances'] as const) {
      registry.register(table, () => invalidations.set(table, (invalidations.get(table) ?? 0) + 1));
    }
    const channel = {
      on: vi.fn((_event, filter: { table: string }, callback: () => void) => {
        callbacks.set(filter.table, callback);
        return channel;
      }),
      subscribe: vi.fn(() => channel),
    };
    registerReferenceDataRealtimeInvalidation({ channel: () => channel }, 'https://project.supabase.co', registry);
    for (const callback of callbacks.values()) callback();
    expect([...invalidations.values()]).toEqual([1, 1, 1, 1, 1, 1, 1]);
  });

  it('QAD-TC35-05b: settings mutations invalidate settings and availability reference reads', async () => {
    const calls: string[] = [];
    const registry = new CacheInvalidationRegistry();
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (!init?.method || init.method === 'GET') calls.push(url);
      if (url.includes('/business_settings')) return Response.json([{ id: 1, business_name: 'Venue', timezone: 'Asia/Manila', booking_interval_minutes: 30, payment_expiry_minutes: 60, contact_email: null, contact_phone: null, updated_at: null }]);
      if (url.includes('/operating_hours')) return Response.json([{ id: 'hours', day_of_week: 1, opens_at: '08:00', closes_at: '18:00', is_active: true }]);
      if (url.includes('/payment_methods')) return Response.json([{ id: 'cash', method_type: 'CASH', display_name: 'Cash', display_order: 1, allow_web: false, allow_kiosk: true, is_active: true }]);
      return Response.json([]);
    }));
    const options = { supabaseUrl: 'https://mutations.supabase.co', serviceRoleKey: 'test', invalidationRegistry: registry, cache: new QueryCache<unknown>(300_000) };
    const settings = new SupabaseSettingsRepository(options);
    const availability = new SupabaseAvailabilityRepository(options);
    await settings.getBusinessSettings();
    await availability.getBusinessSettings();
    await settings.updateBusinessSettings({ businessName: 'Venue', timezone: 'Asia/Manila', bookingIntervalMinutes: 30, paymentExpiryMinutes: 60 });
    await settings.getBusinessSettings();
    await availability.getBusinessSettings();
    expect(calls.filter((url) => url.includes('/business_settings'))).toHaveLength(4);
    await settings.listOperatingHours();
    await availability.listOperatingHours(1);
    await settings.replaceOperatingHours([{ dayOfWeek: 1, opensAt: '09:00', closesAt: '18:00' }]);
    await settings.listOperatingHours();
    await availability.listOperatingHours(1);
    expect(calls.filter((url) => url.includes('/operating_hours'))).toHaveLength(4);
    await settings.listPaymentMethods();
    const input = { methodType: 'CASH' as const, displayName: 'Cash', allowWeb: false, allowKiosk: true, displayOrder: 1 };
    await settings.createPaymentMethod(input);
    await settings.listPaymentMethods();
    await settings.updatePaymentMethod({ ...input, id: 'cash', isActive: true });
    await settings.listPaymentMethods();
    await settings.deletePaymentMethod('cash');
    await settings.listPaymentMethods();
    await settings.reorderPaymentMethods(['cash']);
    expect(calls.filter((url) => url.includes('/payment_methods'))).toHaveLength(5);
  });

  it.each([SupabaseWorkspaceRepository, AdminWorkspaceRepository])('QAD-TC35-05c: workspace mutations invalidate both workspace repository caches (%#)', async (Repository) => {
    const template = { id: 'template', name: 'Desk', description: null, photo_path: null, capacity: 1, rate_amount: 100, pricing_unit: 'HOURLY', default_shape: 'RECT', default_color: '#fff', default_style: {}, is_active: true };
    const floor = { id: 'floor', name: 'First', floor_number: 1, display_order: 1, is_active: true };
    const registry = new CacheInvalidationRegistry();
    const invalidate = vi.spyOn(registry, 'invalidate');
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/workspace_templates')) return Response.json([template]);
      if (url.includes('/floors')) return Response.json([floor]);
      if (url.includes('/workspace_instances')) return Response.json([{ id: 'instance', template_id: 'template', floor_id: 'floor', display_name: 'Desk 1', instance_code: 'D1', operational_status: 'ACTIVE', template, floor }]);
      return Response.json([]);
    }));
    const options = { supabaseUrl: 'https://workspace-mutations.supabase.co', serviceRoleKey: 'test', invalidationRegistry: registry, cache: new QueryCache<unknown>(300_000) };
    const repo = new Repository(options);
    await repo.listTemplates();
    await repo.listActiveFloors();
    await repo.updateTemplate('template', { name: 'Updated' });
    expect(invalidate).toHaveBeenCalledWith('workspace_templates');
    await repo.createFloor({ name: 'Second' });
    expect(invalidate).toHaveBeenCalledWith('floors');
    await repo.updateInstance('instance', { operationalStatus: 'MAINTENANCE', maintenanceNote: 'Repair' });
    expect(invalidate).toHaveBeenCalledWith('workspace_instances');
    const fetcher = vi.mocked(fetch);
    fetcher.mockClear();
    await repo.listTemplates();
    await repo.listActiveFloors();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('QAD-TC35-06: invalidates immutable map payloads and always hydrates live status', async () => {
    const map: PublishedFloorMap = {
      floor: { id: 'floor-1', name: 'First', floorNumber: 1, displayOrder: 1, isActive: true },
      version: { id: 'map-1', versionNumber: 1, canvasWidth: 100, canvasHeight: 100, gridSize: 10, publishedAt: null },
      elements: [{
        id: 'element-1', elementRole: 'WORKSPACE', elementType: 'DESK',
        x: 0, y: 0, width: 10, height: 10, rotation: 0, zIndex: 0, label: null, style: {},
        workspace: {
          workspaceInstanceId: 'instance-1', templateId: 'template-1', floorId: 'floor-1',
          instanceCode: 'D1', displayName: 'Desk', templateName: 'Desk', description: null,
          photoPath: null, capacity: 1, rateAmount: 100, pricingUnit: 'HOURLY',
          operationalStatus: 'ACTIVE', isBookable: true, blockingReason: null,
        },
      }],
    };
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('/map_versions')) return Response.json([{ compiled_map_cache: map }]);
      if (url.includes('/workspace_instances')) return Response.json([{ id: 'instance-1', operational_status: 'MAINTENANCE', maintenance_note: 'Repair' }]);
      return Response.json([]);
    }));
    const registry = new CacheInvalidationRegistry();
    const repo = new SupabasePublishedMapRepository({
      supabaseUrl: 'https://maps.supabase.co',
      serviceRoleKey: 'test-key',
      invalidationRegistry: registry,
      cache: new QueryCache<PublishedFloorMap | null>(600_000),
    });
    const hydrated = await repo.loadPublishedFloorMap('floor-1');
    expect(hydrated?.elements[0].workspace?.maintenanceNote).toBe('Repair');
    expect(map.elements[0].workspace?.operationalStatus).toBe('ACTIVE');
    await repo.loadPublishedFloorMap('floor-1');
    expect(calls.filter((url) => url.includes('/map_versions'))).toHaveLength(1);
    registry.invalidate('map_versions');
    await repo.loadPublishedFloorMap('floor-1');
    expect(calls.filter((url) => url.includes('/map_versions'))).toHaveLength(2);
    expect(calls.filter((url) => url.includes('/workspace_instances'))).toHaveLength(3);
  });

  it.skipIf(!process.env.SUPABASE_TEST_DB_URL)('QAD-TC35-07: captures baseline and optimized JSON plans in a disposable database', () => {
    const url = new URL(process.env.SUPABASE_TEST_DB_URL!);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !url.pathname.startsWith('/ms35_test')) {
      throw new Error('MS-35 database verification requires a local disposable database named ms35_test*');
    }
    const result = spawnSync('psql', ['-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-f', resolve(root, 'supabase/verification/ms35_candidate_query_plan.sql')], {
      encoding: 'utf8', timeout: 60_000,
      env: { ...process.env, PGHOST: url.hostname, PGPORT: url.port || '5432', PGDATABASE: decodeURIComponent(url.pathname.slice(1)), PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password) },
    });
    expect(result.status, 'psql verification must complete successfully').toBe(0);
    const plans = (result.stdout.match(/\[\s*\{[\s\S]*?\n\]/g) ?? []).map((plan) => JSON.parse(plan) as unknown);
    expect(plans).toHaveLength(2);
    expect(JSON.stringify(plans[0])).not.toContain('idx_rc_assigned_workspace_window');
    expect(JSON.stringify(plans[1])).toContain('idx_rc_assigned_workspace_window');
    expect(result.stdout).toContain('MS35_SEMANTIC_PARITY_OK');
  });

  it.skipIf(!process.env.SUPABASE_TEST_DB_URL)('QAD-TC35-08: forward migrations are idempotent on a disposable schema rebuilt through 020', () => {
    const url = new URL(process.env.SUPABASE_TEST_DB_URL!);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !url.pathname.startsWith('/ms35_test')) {
      throw new Error('MS-35 database verification requires a local disposable database named ms35_test*');
    }
    const environment = { ...process.env, PGHOST: url.hostname, PGPORT: url.port || '5432', PGDATABASE: decodeURIComponent(url.pathname.slice(1)), PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password) };
    const run = (args: string[]) => spawnSync('psql', ['-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', ...args], { encoding: 'utf8', timeout: 60_000, env: environment });
    const preflight = run(['-c', "SELECT current_setting('server_version_num')::integer BETWEEN 150000 AND 169999 AND to_regclass('public.reservations') IS NOT NULL"]);
    expect(preflight.status).toBe(0);
    expect(preflight.stdout.trim()).toBe('t');
    const migrations = ['021_consolidate_temp_hotfixes.sql', '022_drop_confirmed_redundant_indexes.sql', '023_add_verified_performance_indexes.sql', '024_enable_reference_data_realtime.sql'];
    for (let pass = 0; pass < 2; pass++) {
      for (const migration of migrations) {
        expect(run(['-f', resolve(root, 'supabase/archive/pre-consolidation', migration)]).status, migration).toBe(0);
      }
    }
    const catalog = run(['-c', `SELECT
      to_regclass('public.idx_reservation_candidates_availability') IS NULL
      AND to_regclass('public.idx_reservation_candidates_reservation_id') IS NULL
      AND to_regclass('public.idx_reservations_reference_code') IS NULL
      AND to_regclass('public.idx_rc_assigned_workspace_window') IS NOT NULL
      AND to_regclass('public.idx_map_elements_instance') IS NOT NULL
      AND to_regclass('public.idx_operating_hours_day_active') IS NOT NULL
      AND (SELECT count(*) FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
        AND tablename IN ('business_settings','operating_hours','payment_methods','workspace_templates','floors','map_versions','workspace_instances')) = 7
      AND NOT EXISTS (SELECT 1 FROM public.reservations WHERE booked_rate_per_hour IS NULL AND rate_snapshot IS NOT NULL)`]);
    expect(catalog.status).toBe(0);
    expect(catalog.stdout.trim()).toBe('t');
  });
});
