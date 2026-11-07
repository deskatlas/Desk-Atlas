// MS-104: Real-Time Admin Push Notification Email Mirroring Route
// Traceability: PRD-F9, PRD-F13, SDD-C4, SDD-C11, SDD-C13, MS104-TC05, MS104-TC06

import { NextResponse } from "next/server";
import {
  createTransactionalEmailService,
  mirrorAdminNotificationToEmail,
} from "@deskatlas/domain";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "Invalid JSON request body." },
        { status: 400 }
      );
    }

    const title = typeof body.title === "string" ? body.title.trim() : "";
    const description = typeof body.description === "string" ? body.description.trim() : "";

    if (!title || !description) {
      return NextResponse.json(
        { error: "Notification title and description are required." },
        { status: 400 }
      );
    }

    const emailService = createTransactionalEmailService({
      apiKey: process.env.RESEND_API_KEY,
      fromEmail: process.env.RESEND_FROM_EMAIL,
      webhookUrl: process.env.TRANSACTIONAL_EMAIL_WEBHOOK_URL,
    });

    const origin = new URL(request.url).origin.replace(/\/$/, "");
    const actionBaseUrl =
      process.env.ADMIN_PORTAL_URL ??
      process.env.DESKATLAS_ADMIN_URL ??
      origin;

    const result = await mirrorAdminNotificationToEmail({
      notificationId: body.notificationId || body.id,
      id: body.id,
      title,
      description,
      type: body.type,
      link: body.link || body.url || body.actionUrl,
      time: body.time || body.timestamp,
      timestamp: body.timestamp || body.time,
      to: body.to,
      adminName: body.adminName,
      emailService,
      actionBaseUrl,
    });

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "Failed to mirror notification to email." },
        { status: 500 }
      );
    }

    return NextResponse.json(result, { status: 200 });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Internal Server Error";
    console.error("[NotificationMirror] Error mirroring notification to email:", err);
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
