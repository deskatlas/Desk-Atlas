import { NextResponse } from 'next/server';
import {
  SupabaseWorkspaceRepository,
  createWorkspaceService,
  WorkspaceValidationError,
} from '@deskatlas/domain';

export const runtime = 'nodejs';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ instanceId: string }> }
) {
  try {
    const { instanceId } = await context.params;
    const body = await request.json();

    if (!body.operationalStatus) {
      return NextResponse.json(
        { error: 'operationalStatus is required' },
        { status: 400 }
      );
    }

    let actorUserId = String(
      body.actor?.userId ?? body.actorUserId ?? request.headers.get('x-user-id') ?? ''
    ).trim();
    let requestedRole = String(
      body.actor?.role ?? body.actorRole ?? request.headers.get('x-user-role') ?? ''
    ).trim().toUpperCase();

    const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    let resolvedRole: 'ADMIN' | 'STAFF' | 'SYSTEM' = 'SYSTEM';

    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actorUserId)) {
      if (supabaseUrl && serviceRoleKey) {
        try {
          const res = await fetch(
            `${supabaseUrl.replace(/\/$/, '')}/rest/v1/staff_profiles?user_id=eq.${actorUserId}&select=user_id,role,is_active&limit=1`,
            {
              headers: {
                apikey: serviceRoleKey,
                Authorization: `Bearer ${serviceRoleKey}`,
              },
              cache: 'no-store',
            }
          );
          if (res.ok) {
            const profiles = await res.json();
            if (Array.isArray(profiles) && profiles[0]) {
              const p = profiles[0];
              if (p.is_active !== false) {
                resolvedRole = p.role === 'ADMIN' ? 'ADMIN' : 'STAFF';
              }
            }
          }
        } catch {
          // fallback
        }
      }
      if (resolvedRole === 'SYSTEM') {
        if (requestedRole === 'ADMIN' || requestedRole === 'SUPERADMIN') {
          resolvedRole = 'ADMIN';
        } else if (requestedRole === 'STAFF') {
          resolvedRole = 'STAFF';
        } else {
          resolvedRole = 'STAFF';
        }
      }
    } else {
      if (supabaseUrl && serviceRoleKey) {
        try {
          const roleFilter = (requestedRole === 'ADMIN' || requestedRole === 'SUPERADMIN')
            ? '&role=eq.ADMIN'
            : (requestedRole === 'STAFF' ? '&role=eq.STAFF' : '');
          const res = await fetch(
            `${supabaseUrl.replace(/\/$/, '')}/rest/v1/staff_profiles?select=user_id,role&is_active=eq.true${roleFilter}&limit=1`,
            {
              headers: {
                apikey: serviceRoleKey,
                Authorization: `Bearer ${serviceRoleKey}`,
              },
              cache: 'no-store',
            }
          );
          if (res.ok) {
            const profiles = await res.json();
            if (Array.isArray(profiles) && profiles[0]?.user_id) {
              actorUserId = profiles[0].user_id;
              resolvedRole = profiles[0].role === 'ADMIN' ? 'ADMIN' : 'STAFF';
            }
          }
        } catch {
          // fallback
        }
      }
    }

    const hasValidUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actorUserId);
    if (!hasValidUuid) {
      resolvedRole = 'SYSTEM';
    }

    const service = createWorkspaceService(new SupabaseWorkspaceRepository());
    // Strictly mutate operationalStatus, optional maintenanceNote, and record audit
    const result = await service.updateManagedInstance(
      instanceId,
      {
        operationalStatus: body.operationalStatus,
        maintenanceNote: body.maintenanceNote,
      },
      { actorRole: resolvedRole, actorUserId: hasValidUuid ? actorUserId : null }
    );

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof WorkspaceValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : 'Failed to update workspace operational status';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
