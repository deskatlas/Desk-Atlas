import { NextRequest, NextResponse } from "next/server";
import { getAdminNotificationService } from "./_lib/notificationService";
import { authorizeKnowledge } from '../knowledge/_lib/server';
import { knowledgeProcessingRemedy } from '@deskatlas/domain';
import type { AdminNotificationItem } from '@deskatlas/domain';

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const limitParam = request.nextUrl.searchParams.get("limit");
    const limit = limitParam ? parseInt(limitParam, 10) : 50;
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 100) : 50;

    const service = getAdminNotificationService();
    const result = await service.listNotifications(safeLimit);
    // SPEC-5: persistent recipient-bound events require fresh verified admin identity.
    if (request.headers.has('authorization') && process.env.KB_SCOPE_ID) {
      const { client, actor, scope } = await authorizeKnowledge(request);
      const notices = await client.from('kb_notifications').select('*,document:kb_documents!inner(scope_id)').eq('recipient_user_id', actor).eq('document.scope_id', scope).order('created_at', { ascending: false }).limit(safeLimit);
      if (!notices.error) {
        const items: AdminNotificationItem[] = (notices.data ?? []).map(n => ({ id: `kb:${n.id}`, type: 'KNOWLEDGE_RESULT', title: n.kind === 'AVAILABLE' ? 'Knowledge document available' : n.kind === 'READY_FOR_REVIEW' ? 'Knowledge file needs resubmission' : 'Knowledge processing needs attention', description: n.error_code ? knowledgeProcessingRemedy(n.error_code) : n.kind === 'AVAILABLE' ? 'Your document is available to its selected audience.' : 'Open Knowledge Base to see the file status.', link: '/manage/settings?tab=knowledge', timestamp: n.created_at, read: Boolean(n.read_at) }));
        result.notifications = [...result.notifications, ...items].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, safeLimit);
        result.total += items.length;
      }
    }
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load notifications.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
