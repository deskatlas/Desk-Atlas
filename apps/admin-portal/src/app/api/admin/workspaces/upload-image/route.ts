import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No image file provided' }, { status: 400 });
    }

    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: 'Invalid file type. Allowed formats: PNG, JPG, JPEG, WebP' },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: 'File size exceeds 5MB limit' },
        { status: 400 }
      );
    }

    const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        { error: 'Supabase storage is not configured' },
        { status: 500 }
      );
    }

    const cleanBaseUrl = supabaseUrl.replace(/\/$/, '');
    const extension = file.name.split('.').pop() || 'png';
    const uniqueFileName = `templates/${Date.now()}-${Math.random().toString(36).substring(2, 9)}.${extension}`;

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Upload object to Supabase Storage via REST
    const uploadRes = await fetch(
      `${cleanBaseUrl}/storage/v1/object/workspace-images/${uniqueFileName}`,
      {
        method: 'POST',
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          'Content-Type': file.type,
          'cache-control': '31536000',
          'x-upsert': 'true',
        },
        body: buffer,
      }
    );

    if (!uploadRes.ok) {
      const errData = await uploadRes.json().catch(() => ({}));
      return NextResponse.json(
        { error: errData.message || 'Failed to upload image to storage' },
        { status: uploadRes.status }
      );
    }

    const publicUrl = `${cleanBaseUrl}/storage/v1/object/public/workspace-images/${uniqueFileName}`;

    return NextResponse.json({
      url: publicUrl,
      path: uniqueFileName,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Error processing image upload' },
      { status: 500 }
    );
  }
}
