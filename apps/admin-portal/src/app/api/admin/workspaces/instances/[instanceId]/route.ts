import { NextResponse } from 'next/server';
import { getAdminWorkspaceService } from '../../_lib/workspaceService';
import { workspaceErrorResponse } from '../../_lib/errors';

export const runtime = 'nodejs';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ instanceId: string }> }
) {
  try {
    const { instanceId } = await context.params;
    const body = await request.json();
    let actorUserId = String(
      request.headers.get('x-user-id') ?? body.actorUserId ?? body.actor?.userId ?? ''
    ).trim();

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actorUserId)) {
      const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
      const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (supabaseUrl && serviceRoleKey) {
        try {
          const res = await fetch(
            `${supabaseUrl.replace(/\/$/, '')}/rest/v1/staff_profiles?role=eq.ADMIN&is_active=eq.true&limit=1`,
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
    const resolvedRole = hasValidUuid
      ? ((request.headers.get('x-user-role') ?? body.actorRole ?? 'ADMIN') as 'ADMIN' | 'STAFF')
      : 'SYSTEM';

    const result = await getAdminWorkspaceService().updateManagedInstance(instanceId, body, {
      actorRole: resolvedRole,
      actorUserId: hasValidUuid ? actorUserId : null,
    });
    return NextResponse.json(result);
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ instanceId: string }> }
) {
  try {
    const { instanceId } = await context.params;
    const instance = await getAdminWorkspaceService().deactivateInstance(instanceId);
    return NextResponse.json({ instance });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
