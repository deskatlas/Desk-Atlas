import { NextResponse } from 'next/server';
import { getAdminMapService } from '../../maps/_lib/mapService';
import { mapErrorResponse } from '../../maps/_lib/errors';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const template = await getAdminMapService().getCustomStructureTemplate(id);
    if (!template) {
      return NextResponse.json({ error: 'Custom structure template not found' }, { status: 404 });
    }
    return NextResponse.json({ template });
  } catch (error) {
    return mapErrorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const template = await getAdminMapService().updateCustomStructureTemplate(id, body);
    return NextResponse.json({ template });
  } catch (error) {
    return mapErrorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    await getAdminMapService().deleteCustomStructureTemplate(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return mapErrorResponse(error);
  }
}
