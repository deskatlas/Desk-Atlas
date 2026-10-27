/**
 * Internal Automated Quarterly Retention Purge Worker Handler
 * Traceability: MS87-R02, MS87-R03, MS87-R04, MS87-R05, SDD-C25, PRD-F28, ERD-E10
 */

import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import {
  RetentionPurgeSupabaseRepository,
  createRetentionPurgeService,
  createTransactionalEmailService,
} from "@deskatlas/domain";

export const runtime = "nodejs";
export const maxDuration = 300;
const headers = { "Cache-Control": "no-store, private" };

function authorized(token: string): boolean {
  if (!token) return false;
  const supplied = createHash('sha256').update(token).digest();
  return [process.env.CRON_SECRET, process.env.RETENTION_WORKER_SECRET].some(secret =>
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

    let payload: {
      targetDate?: string;
      dryRun?: boolean;
      forceRecipientEmail?: string;
    } = {};

    if (request.method === "POST") {
      try {
        payload = await request.json();
      } catch {
        // empty body is acceptable
      }
    }

    const repository = new RetentionPurgeSupabaseRepository({
      supabaseUrl,
      serviceRoleKey,
    });

    const emailService = createTransactionalEmailService({
      apiKey: process.env.RESEND_API_KEY,
      fromEmail: process.env.RESEND_FROM_EMAIL,
      webhookUrl: process.env.TRANSACTIONAL_EMAIL_WEBHOOK_URL,
    });

    const purgeService = createRetentionPurgeService(repository, emailService);

    const result = await purgeService.executeQuarterlyPurge({
      targetDate: payload.targetDate ? new Date(payload.targetDate) : undefined,
      dryRun: Boolean(payload.dryRun),
      forceRecipientEmail: payload.forceRecipientEmail,
    });

    if (!result.success) {
      return NextResponse.json(result, { status: 500, headers });
    }

    return NextResponse.json(result, { status: 200, headers });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[QuarterlyPurgeWorker] Execution failed:", errorMsg);
    return NextResponse.json(
      { error: "PURGE_EXECUTION_FAILED", details: errorMsg },
      { status: 500, headers }
    );
  }
}

export async function GET(request: Request) {
  return handleWorker(request);
}

export async function POST(request: Request) {
  return handleWorker(request);
}

