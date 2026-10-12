/**
 * Internal Rewards & Notification Outbox Worker Handler
 * Traceability: SPEC-1 Section 3.3, SDD-C13, PRD-F22
 */

import { NextRequest, NextResponse } from "next/server";
import {
  CustomerSupabaseRepository,
  createCustomerService,
  createTransactionalEmailService,
} from "@deskatlas/domain";

export const runtime = "nodejs";

async function handleWorker(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    const expectedSecret = process.env.REWARDS_WORKER_SECRET;

    if (!expectedSecret || token !== expectedSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        { error: "Supabase configuration is missing." },
        { status: 500 }
      );
    }

    const repository = new CustomerSupabaseRepository({
      supabaseUrl,
      serviceRoleKey,
    });

    const emailService = createTransactionalEmailService({
      apiKey: process.env.RESEND_API_KEY,
      fromEmail: process.env.RESEND_FROM_EMAIL,
      webhookUrl: process.env.TRANSACTIONAL_EMAIL_WEBHOOK_URL,
    });

    const customerService = createCustomerService(repository, emailService);

    const outboxResult = await customerService.processOutboxBatch({
      limit: 50,
      leaseSeconds: 60,
      requireSenderConfig: true,
    });

    // Process SPEC-2 campaign rewards work queue
    const { getAdminCampaignService } = await import('../../../admin/campaigns/_lib/campaignServiceHelper');
    const campaignService = getAdminCampaignService();
    const campaignResult = await campaignService.runWorkerCycle(50, 60);

    return NextResponse.json({
      outbox: outboxResult,
      campaigns: campaignResult,
    }, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal Server Error";
    console.error("[RewardsWorker] Processing error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handleWorker(request);
}

export async function POST(request: NextRequest) {
  return handleWorker(request);
}
