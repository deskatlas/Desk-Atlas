import { NextResponse } from 'next/server';
import { getAdminWorkspaceService } from '../../_lib/workspaceService';
import { workspaceErrorResponse } from '../../_lib/errors';

export const runtime = 'nodejs';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ templateId: string }> }
) {
  try {
    const { templateId } = await context.params;
    const template = await getAdminWorkspaceService().updateTemplate(templateId, await request.json());
    return NextResponse.json({ template });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ templateId: string }> }
) {
  try {
    const { templateId } = await context.params;
    const result = await getAdminWorkspaceService().deleteTemplate(templateId);
    return NextResponse.json(result);
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
