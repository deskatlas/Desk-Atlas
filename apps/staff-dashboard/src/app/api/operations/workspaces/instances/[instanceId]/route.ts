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
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actorUserId)) {
      const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
      const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (supabaseUrl && serviceRoleKey) {
        try {
          const res = await fetch(
            `${supabaseUrl.replace(/\/$/, '')}/rest/v1/staff_profiles?select=user_id&is_active=eq.true&limit=1`,
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
            }
          }
        } catch {
          // fallback
        }
      }
    }
    const hasValidUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actorUserId);
    const resolvedRole = hasValidUuid ? (body.actor?.role ?? body.actorRole ?? 'STAFF') : 'SYSTEM';

    const service = createWorkspaceService(new SupabaseWorkspaceRepository());
    // Strictly mutate only operationalStatus and record audit
    const result = await service.updateManagedInstance(
      instanceId,
      { operationalStatus: body.operationalStatus },
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
