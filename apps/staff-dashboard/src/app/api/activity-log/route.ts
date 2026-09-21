import { NextRequest, NextResponse } from "next/server";
import {
  ActivityLogService,
  ActivityLogSupabaseRepository,
} from "@deskatlas/domain";

export const runtime = "nodejs";

function getActivityLogService() {
  const repo = new ActivityLogSupabaseRepository();
  return new ActivityLogService(repo);
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const actorId = searchParams.get("actorId") || undefined;
    const action = searchParams.get("action") || undefined;
    const actionTypesParam = searchParams.get("actionTypes");
    const actionTypes = actionTypesParam
      ? actionTypesParam.split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;
    const entityType = searchParams.get("entityType") || undefined;
    const from = searchParams.get("from") || undefined;
    const to = searchParams.get("to") || undefined;
    const pageParam = searchParams.get("page");
    const limitParam = searchParams.get("limit");

    const page = pageParam ? Math.max(1, parseInt(pageParam, 10)) : 1;
    const limit = limitParam ? Math.max(1, Math.min(100, parseInt(limitParam, 10))) : 20;

    const service = getActivityLogService();

    let result;
    if (actorId) {
      result = await service.listStaffActivityLog(actorId, {
        action,
        actionTypes,
        entityType,
        from,
        to,
        page,
        limit,
      });
    } else {
      result = await service.listActivityLog(undefined, {
        action,
        actionTypes,
        entityType,
        from,
        to,
        page,
        limit,
      });
    }

    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load staff activity logs.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
