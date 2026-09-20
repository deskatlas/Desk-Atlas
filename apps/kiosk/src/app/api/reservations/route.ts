import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  createReservationService,
  CreateReservationRequest,
  ReservationError,
  ReservationSupabaseRepository,
  SupabaseAvailabilityRepository,
  createAvailabilityService,
  zonedDateTimeToUtc,
  SupabaseSettingsRepository,
  InMemorySettingsRepository,
  createAdminSettingsService,
} from "@deskatlas/domain";

export const runtime = "nodejs";

class KioskWorkspaceRepo {
  constructor(private readonly supabase: any) {}

  async listCatalog() {
    const { data: instancesData, error: instanceError } = await this.supabase
      .from("workspace_instances")
      .select("*");
    if (instanceError) {
      throw new Error(instanceError.message);
    }

    const { data: templatesData, error: templateError } = await this.supabase
      .from("workspace_templates")
      .select("*");
    if (templateError) {
      throw new Error(templateError.message);
    }

    const instances = instancesData.map((row: any) => ({
      id: row.id,
      templateId: row.template_id,
      floorId: row.floor_id,
      instanceCode: row.instance_code,
      displayName: row.display_name,
      operationalStatus: row.operational_status,
    }));

    const templates = templatesData.map((row: any) => ({
      id: row.id,
      name: row.name,
      capacity: row.capacity,
      rateAmount: Number(row.rate_amount),
      pricingUnit: row.pricing_unit,
      isActive: row.is_active,
    }));

    return { instances, templates, floors: [] };
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error("Supabase configuration is missing.");
    }

    const body: any = await request.json();
    const supabase = createClient(supabaseUrl, supabaseKey);
    const reservationRepository = new ReservationSupabaseRepository({
      supabaseUrl,
      serviceRoleKey: supabaseKey,
    });
    const workspaceRepository = new KioskWorkspaceRepo(supabase);
    const reservationService = createReservationService(
      reservationRepository,
      workspaceRepository as any,
      reservationRepository
    );

    const activeKioskMethods = await reservationRepository.listActiveKioskPaymentMethods().catch(() => []);

    let paymentMethodId = body.paymentMethodId;
    if (paymentMethodId && activeKioskMethods.length > 0) {
      const match = activeKioskMethods.find(
        (m) =>
          m.id === paymentMethodId ||
          m.methodType.toUpperCase() === String(paymentMethodId).toUpperCase() ||
          (paymentMethodId === "pm-cash" && m.methodType === "CASH") ||
          (paymentMethodId === "pm-gcash" && m.methodType === "GCASH")
      );
      if (match) {
        paymentMethodId = match.id;
      } else {
        paymentMethodId = undefined;
      }
    }

    if (!paymentMethodId && body.paymentMethod && activeKioskMethods.length > 0) {
      const pMethod = String(body.paymentMethod).toUpperCase();
      const match = activeKioskMethods.find(
        (m) =>
          m.id === body.paymentMethod ||
          m.methodType.toUpperCase() === pMethod ||
          (pMethod.includes("CASH") && m.methodType === "CASH") ||
          (pMethod.includes("GCASH") && m.methodType === "GCASH") ||
          (pMethod.includes("QR") && m.methodType !== "CASH")
      );
      if (match) {
        paymentMethodId = match.id;
      }
    }

    if (!paymentMethodId && activeKioskMethods.length > 0) {
      const cashMethod = activeKioskMethods.find((m) => m.methodType === "CASH");
      paymentMethodId = cashMethod ? cashMethod.id : activeKioskMethods[0]?.id;
    }

    let createRequest: CreateReservationRequest;

    const contactNumber =
      body.customerContactNumber ?? (body as any).contactNumber ?? body.customer?.contactNumber ?? null;

    if (body.candidates && Array.isArray(body.candidates)) {
      createRequest = {
        source: "KIOSK",
        customerFirstName: body.customerFirstName ?? body.customer?.firstName,
        customerLastName: body.customerLastName ?? body.customer?.lastName,
        customerEmail: body.customerEmail ?? body.customer?.email,
        customerContactNumber: contactNumber,
        paymentMethodId,
        candidates: body.candidates,
      };
    } else {
      let allowanceMinutes = 5;
      try {
        const settingsRepo = supabaseUrl && supabaseKey
          ? new SupabaseSettingsRepository({ supabaseUrl, serviceRoleKey: supabaseKey })
          : new InMemorySettingsRepository();
        const settingsService = createAdminSettingsService(settingsRepo);
        const pubSettings = await settingsService.getPublicBusinessSettings();
        if (pubSettings?.kioskAllowanceMinutes !== undefined && pubSettings.kioskAllowanceMinutes !== null) {
          allowanceMinutes = Number(pubSettings.kioskAllowanceMinutes);
        }
      } catch {
        allowanceMinutes = 5;
      }
      const now = new Date(Date.now() + allowanceMinutes * 60 * 1000);
      const durationMin = Number(body.durationMinutes) || (Number(body.durationHours) * 60) || 120;
      let startAt: string;
      if (body.startAt) {
        startAt = new Date(body.startAt).toISOString();
      } else if (body.date && body.startTime) {
        startAt = zonedDateTimeToUtc(body.date, body.startTime, 'Asia/Manila').toISOString();
      } else {
        startAt = now.toISOString();
      }
      const endAt = body.endAt
        ? new Date(body.endAt).toISOString()
        : new Date(new Date(startAt).getTime() + durationMin * 60000).toISOString();

      createRequest = {
        source: "KIOSK",
        customerFirstName: body.customerFirstName ?? body.customer?.firstName,
        customerLastName: body.customerLastName ?? body.customer?.lastName,
        customerEmail: body.customerEmail ?? body.customer?.email,
        customerContactNumber: contactNumber,
        paymentMethodId,
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: body.workspaceInstanceId,
            startAt,
            endAt,
          },
        ],
      };
    }

    const availabilityRepo = new SupabaseAvailabilityRepository({
      supabaseUrl,
      serviceRoleKey: supabaseKey,
    });
    const availabilityService = createAvailabilityService(availabilityRepo);

    for (const cand of createRequest.candidates) {
      const validation = await availabilityService.validateReservationWindow({
        workspaceInstanceId: cand.workspaceInstanceId,
        startAt: cand.startAt,
        endAt: cand.endAt,
        maxDurationMinutes: 24 * 60,
      });

      if (!validation.isValid) {
        return NextResponse.json(
          { error: validation.errorMessage || "The requested time window is unavailable." },
          { status: 409 }
        );
      }
    }

    const reservation = await reservationService.createReservation(createRequest);

    return NextResponse.json(reservation, { status: 201 });
  } catch (error) {
    if (error instanceof ReservationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const message = error instanceof Error ? error.message : "Unable to create kiosk reservation";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
