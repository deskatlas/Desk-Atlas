import { NextResponse } from 'next/server';
import { getAdminMapService } from '../maps/_lib/mapService';
import { mapErrorResponse } from '../maps/_lib/errors';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const templates = await getAdminMapService().listCustomStructureTemplates();
    return NextResponse.json({ templates });
  } catch (error) {
    return mapErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const template = await getAdminMapService().createCustomStructureTemplate(body);
    return NextResponse.json({ template }, { status: 201 });
  } catch (error) {
    return mapErrorResponse(error);
  }
}
