import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  buildReservationTrackingUrl,
  createPaymentSessionService,
  createReservationService,
  createTransactionalEmailService,
  CreateReservationRequest,
  ReservationError,
  ReservationSupabaseRepository,
} from '@deskatlas/domain';

export const runtime = 'nodejs';

// A simple Supabase-based workspace repository for validation lookups
class CustomerWorkspaceRepo {
  constructor(private supabase: any) {}

  async listCatalog() {
    const { data: instancesData, error: instError } = await this.supabase.from('workspace_instances').select('*');
    if (instError) throw new Error(instError.message);
    
    const { data: templatesData, error: tplError } = await this.supabase.from('workspace_templates').select('*');
    if (tplError) throw new Error(tplError.message);

    const instances = instancesData.map((d: any) => ({
      id: d.id,
      templateId: d.template_id,
      floorId: d.floor_id,
      instanceCode: d.instance_code,
      displayName: d.display_name,
      operationalStatus: d.operational_status,
    }));

    const templates = templatesData.map((d: any) => ({
      id: d.id,
      name: d.name,
      capacity: d.capacity,
      rateAmount: Number(d.rate_amount),
      pricingUnit: d.pricing_unit,
      isActive: d.is_active,
    }));

    return { instances, templates, floors: [] };
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase configuration is missing.');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const reservationRepo = new ReservationSupabaseRepository({ supabaseUrl, serviceRoleKey: supabaseKey });
    const workspaceRepo = new CustomerWorkspaceRepo(supabase);
    const paymentSessionService = createPaymentSessionService(reservationRepo);
    const service = createReservationService(
      reservationRepo,
      workspaceRepo as any,
      reservationRepo,
      paymentSessionService
    );

    const body: CreateReservationRequest = await request.json();
    const paymentLinkBaseUrl =
      process.env.PAYMENT_SESSION_BASE_URL ??
      `${request.nextUrl.origin.replace(/\/$/, '')}/pay`;
    const trackingBaseUrl =
      process.env.TRACKING_BASE_URL ??
      process.env.DESKATLAS_PUBLIC_APP_URL ??
      request.nextUrl.origin.replace(/\/$/, '');

    const reservation = await service.createReservation(body, {
      paymentLinkBaseUrl,
    });

    const trackingUrl = buildReservationTrackingUrl(trackingBaseUrl, reservation.referenceCode);
    const emailService = createTransactionalEmailService();

    if (reservation.paymentSession) {
      await emailService.sendPaymentLinkEmail({
        to: reservation.customerEmail,
        customerFirstName: reservation.customerFirstName,
        customerLastName: reservation.customerLastName,
        referenceCode: reservation.referenceCode,
        amountDue: reservation.amountDue,
        currency: reservation.currency,
        paymentUrl: reservation.paymentSession.paymentUrl,
        expiresAt: reservation.paymentSession.expiresAt,
        trackingUrl,
        workspaceTemplateName: reservation.candidates?.[0]?.workspaceTemplateName,
        bookingDate: reservation.candidates?.[0]?.startAt,
      });
    }

    await emailService.sendReservationTrackingEmail({
      to: reservation.customerEmail,
      customerFirstName: reservation.customerFirstName,
      customerLastName: reservation.customerLastName,
      referenceCode: reservation.referenceCode,
      trackingUrl,
      candidates: reservation.candidates?.map((c) => ({
        rank: c.rank,
        workspaceDisplayName: c.workspaceDisplayName,
        workspaceTemplateName: c.workspaceTemplateName,
        floorName: c.floorName,
        startAt: c.startAt,
        endAt: c.endAt,
      })),
    });

    return NextResponse.json(reservation, { status: 201 });
  } catch (error) {
    if (error instanceof ReservationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : 'Unable to create reservation';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
