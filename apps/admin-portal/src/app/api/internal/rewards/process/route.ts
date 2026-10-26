/**
 * Internal Rewards & Notification Outbox Worker Handler
 * Traceability: SPEC-1 Section 3.3, SDD-C13, PRD-F22
 */

import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import {
  CustomerSupabaseRepository,
  createCustomerService,
  createTransactionalEmailService,
} from "@deskatlas/domain";

export const runtime = "nodejs";
export const maxDuration = 60;
const headers = { "Cache-Control": "no-store, private" };

// MS83-R02 / SDD-C11: Vercel injects CRON_SECRET; manual callers keep their key.
function authorized(token: string): boolean {
  if (!token) return false;
  const supplied = createHash('sha256').update(token).digest();
  return [process.env.CRON_SECRET, process.env.REWARDS_WORKER_SECRET].some(secret =>
    Boolean(secret) && timingSafeEqual(supplied, createHash('sha256').update(secret!).digest()));
}

async function handleWorker(request: Request) {
  try {
    const authHeader = request.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!authorized(token)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        { error: "Supabase configuration is missing." },
        { status: 503, headers }
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
      limit: 10,
      leaseSeconds: 120,
      requireSenderConfig: true,
    });

    // Process SPEC-2 campaign rewards work queue
    const { getAdminCampaignService } = await import('../../../admin/campaigns/_lib/campaignServiceHelper');
    const campaignService = getAdminCampaignService();
    const campaignResult = await campaignService.runWorkerCycle(50, 60);

    return NextResponse.json({
      outbox: outboxResult,
      campaigns: campaignResult,
    }, { status: 200, headers });
  } catch {
    console.error("[RewardsWorker] Processing failed; pending jobs remain retryable.");
    return NextResponse.json({ error: "Notification worker unavailable. Retry on the next scheduled invocation." }, { status: 503, headers });
  }
}

export async function GET(request: Request) {
  return handleWorker(request);
}

export async function POST(request: Request) {
  return handleWorker(request);
}
