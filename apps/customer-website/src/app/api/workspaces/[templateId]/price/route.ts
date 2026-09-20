import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ templateId: string }> | { templateId: string } }
) {
  try {
    const params = await Promise.resolve(context.params);
    const templateId = params.templateId;

    if (!templateId || !templateId.trim()) {
      return NextResponse.json({ error: 'Template ID is required' }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ error: 'Database configuration missing' }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data: template, error } = await supabase
      .from('workspace_templates')
      .select('id, name, rate_amount, pricing_unit, is_active')
      .eq('id', templateId.trim())
      .single();

    if (error || !template) {
      return NextResponse.json({ error: 'Workspace template not found' }, { status: 404 });
    }

    const ratePerHour = Number(template.rate_amount);
    return NextResponse.json(
      {
        templateId: template.id,
        templateName: template.name,
        ratePerHour,
        rateAmount: ratePerHour,
        currency: 'PHP',
        pricingUnit: template.pricing_unit || 'HOURLY',
        isActive: template.is_active,
      },
      {
        headers: {
          'Cache-Control': 'no-store, max-age=0',
        },
      }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to fetch workspace price' },
      { status: 500 }
    );
  }
}
