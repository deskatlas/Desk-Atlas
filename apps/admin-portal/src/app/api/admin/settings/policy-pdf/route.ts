import { NextRequest, NextResponse } from 'next/server';
import { getAdminSettingsService } from '../_lib/settingsService';

export const runtime = 'nodejs';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export async function GET() {
  try {
    const service = getAdminSettingsService();
    const overview = await service.getSettingsOverview();
    const settings = overview.businessSettings;

    return NextResponse.json({
      data: {
        policyPdfUrl: settings.cancellationPolicyPdfUrl ?? null,
        filename: settings.cancellationPolicyPdfFilename ?? null,
        updatedAt: settings.cancellationPolicyUpdatedAt ?? null,
      },
    });
  } catch (error: any) {
    const message = error instanceof Error ? error.message : 'Failed to load policy settings.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData().catch(() => null);
    if (!formData) {
      return NextResponse.json({ error: 'No form data received' }, { status: 400 });
    }

    const file = formData.get('file') as File | null;
    if (!file) {
      return NextResponse.json({ error: 'No PDF file provided' }, { status: 400 });
    }

    const isPdfMime = file.type === 'application/pdf';
    const hasPdfExtension = file.name.toLowerCase().endsWith('.pdf');

    if (!isPdfMime && !hasPdfExtension) {
      return NextResponse.json(
        { error: 'Only PDF documents (.pdf) are allowed.' },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: 'File size exceeds 10MB limit' },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Magic bytes validation for PDF (%PDF-)
    if (buffer.length >= 4) {
      const headerStr = buffer.slice(0, 5).toString('ascii');
      if (!headerStr.startsWith('%PDF')) {
        return NextResponse.json(
          { error: 'Only PDF documents (.pdf) are allowed.' },
          { status: 400 }
        );
      }
    }

    const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    let publicUrl = '';
    const cleanFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `policies/${Date.now()}-${cleanFileName}`;

    if (supabaseUrl && serviceRoleKey) {
      const cleanBaseUrl = supabaseUrl.replace(/\/$/, '');
      
      // Attempt upload to business-policies bucket first
      let uploadRes = await fetch(
        `${cleanBaseUrl}/storage/v1/object/business-policies/${storagePath}`,
        {
          method: 'POST',
          headers: {
            apikey: serviceRoleKey,
            Authorization: `Bearer ${serviceRoleKey}`,
            'Content-Type': 'application/pdf',
            'x-upsert': 'true',
          },
          body: buffer,
        }
      );

      if (!uploadRes.ok) {
        // Fallback to workspace-images bucket if business-policies bucket is not created yet
        uploadRes = await fetch(
          `${cleanBaseUrl}/storage/v1/object/workspace-images/${storagePath}`,
          {
            method: 'POST',
            headers: {
              apikey: serviceRoleKey,
              Authorization: `Bearer ${serviceRoleKey}`,
              'Content-Type': 'application/pdf',
              'x-upsert': 'true',
            },
            body: buffer,
          }
        );

        if (!uploadRes.ok) {
          const errData = await uploadRes.json().catch(() => ({}));
          return NextResponse.json(
            { error: errData.message || 'Failed to upload PDF policy document to storage' },
            { status: uploadRes.status }
          );
        }

        publicUrl = `${cleanBaseUrl}/storage/v1/object/public/workspace-images/${storagePath}`;
      } else {
        publicUrl = `${cleanBaseUrl}/storage/v1/object/public/business-policies/${storagePath}`;
      }
    } else {
      // In-memory or local mock fallback for tests / development
      publicUrl = `/uploads/policies/${Date.now()}-${cleanFileName}`;
    }

    const updatedAt = new Date().toISOString();
    const service = getAdminSettingsService();
    const currentOverview = await service.getSettingsOverview();
    const currentSettings = currentOverview.businessSettings;

    const actorUserId = request.headers.get('x-user-id') ?? undefined;

    const updated = await service.updateBusinessSettings(
      {
        ...currentSettings,
        cancellationPolicyPdfUrl: publicUrl,
        cancellationPolicyPdfFilename: file.name,
        cancellationPolicyUpdatedAt: updatedAt,
      },
      actorUserId ? { id: actorUserId, name: 'Admin', role: 'admin' } : null
    );

    return NextResponse.json({
      success: true,
      data: {
        url: publicUrl,
        filename: file.name,
        updatedAt: updatedAt,
        businessSettings: updated,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Error processing policy PDF upload' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const service = getAdminSettingsService();
    const currentOverview = await service.getSettingsOverview();
    const currentSettings = currentOverview.businessSettings;
    const actorUserId = request.headers.get('x-user-id') ?? undefined;

    const updated = await service.updateBusinessSettings(
      {
        ...currentSettings,
        cancellationPolicyPdfUrl: null,
        cancellationPolicyPdfFilename: null,
        cancellationPolicyUpdatedAt: null,
      },
      actorUserId ? { id: actorUserId, name: 'Admin', role: 'admin' } : null
    );

    return NextResponse.json({
      success: true,
      message: 'Cancellation and rescheduling policy PDF removed successfully',
      data: {
        businessSettings: updated,
      },
    });
  } catch (error: any) {
    const message = error instanceof Error ? error.message : 'Failed to delete policy PDF.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
