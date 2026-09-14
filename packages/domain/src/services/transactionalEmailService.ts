/**
 * DeskAtlas Resend Transactional Email Service
 * 
 * Provides server-side transactional email capabilities for:
 * - Payment session link dispatch
 * - Booking confirmation dispatch (with digital access QR link)
 * - Payment proof received / under review notification
 * - Payment proof rejected notification
 * - Reservation tracking link dispatch
 */

export interface ResendEmailConfig {
  apiKey?: string;
  fromEmail?: string;
  webhookUrl?: string;
  fetcher?: typeof fetch;
}

export interface EmailSendResult {
  success: boolean;
  id?: string;
  error?: string;
}

export function normalizeCustomerTrackingUrl(trackingUrl?: string): string | undefined {
  if (!trackingUrl) return undefined;
  const trimmed = trackingUrl.trim();
  if (!trimmed) return undefined;
  try {
    const url = new URL(trimmed);
    if (url.port === '3000' || url.port === '3002' || url.port === '3003') {
      url.port = '3001';
      return url.toString();
    }
  } catch {
    return trimmed.replace(/:(?:3000|3002|3003)(?=\/|\?|$)/, ':3001');
  }
  return trimmed;
}

export function buildReservationTrackingUrl(baseUrl: string, referenceCode: string): string {
  let cleanBase = (baseUrl || '').trim().replace(/\/$/, '');
  try {
    const url = new URL(cleanBase);
    if (url.port === '3000' || url.port === '3002' || url.port === '3003') {
      url.port = '3001';
      cleanBase = url.origin;
    }
  } catch {
    cleanBase = cleanBase.replace(/:(?:3000|3002|3003)(?=\/|$)/, ':3001');
  }
  const encodedRef = encodeURIComponent(referenceCode.trim().toUpperCase());
  return `${cleanBase}/track?code=${encodedRef}`;
}

const DEFAULT_TIMEZONE = 'Asia/Manila';

function convert24HourTo12Hour(hour: number, minute: string): string {
  const ampm = hour >= 12 && hour < 24 ? 'PM' : 'AM';
  let h12 = hour % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}:${minute} ${ampm}`;
}

/**
 * Formats a date/time or time string for transactional emails in 12-hour AM/PM format.
 * - If already formatted with AM/PM (e.g. "Sep 12, 10:00 AM", "10:00 AM"), it is preserved.
 * - If simple military time (e.g. "14:00", "14:00:00", "09:00"), converted to "2:00 PM", "9:00 AM".
 * - If date with military time (e.g. "Sep 12, 14:00"), converted to "Sep 12, 2:00 PM".
 * - If ISO timestamp (e.g. "2026-09-12T02:00:00.000Z"), formatted in timezone with date & 12-hour AM/PM time.
 */
export function formatEmailTime(value?: string | null, timezone: string = DEFAULT_TIMEZONE): string {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed) return '';

  // 1. If already formatted with AM/PM, preserve it
  if (/\b(?:am|pm)\b/i.test(trimmed)) {
    return trimmed;
  }

  // 2. Pure 24-hour military time string (e.g. "14:00", "14:00:00", "09:30")
  const timeOnlyMatch = trimmed.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (timeOnlyMatch) {
    const hour = parseInt(timeOnlyMatch[1], 10);
    const minute = timeOnlyMatch[2];
    if (hour >= 0 && hour <= 24 && parseInt(minute, 10) >= 0 && parseInt(minute, 10) < 60) {
      return convert24HourTo12Hour(hour, minute);
    }
  }

  // 3. Date-prefixed non-ISO military time (e.g. "Sep 12, 14:00" or "Sep 12 14:00")
  const datePrefixMatch = trimmed.match(/^(.*?\b)(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (datePrefixMatch && !trimmed.includes('T')) {
    const prefix = datePrefixMatch[1];
    const hour = parseInt(datePrefixMatch[2], 10);
    const minute = datePrefixMatch[3];
    if (hour >= 0 && hour <= 24 && parseInt(minute, 10) >= 0 && parseInt(minute, 10) < 60) {
      return `${prefix}${convert24HourTo12Hour(hour, minute)}`;
    }
  }

  // 4. ISO 8601 or parseable date string
  const d = new Date(trimmed);
  if (!isNaN(d.getTime())) {
    try {
      const dateStr = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }).format(d);

      const timeStr = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      }).format(d);

      return `${dateStr}, ${timeStr}`;
    } catch {
      // Fallback
    }
  }

  return trimmed;
}

/**
 * Formats only the time component in 12-hour AM/PM format (e.g. "10:00 AM", "2:00 PM").
 */
export function formatEmailTimeOnly(value?: string | null, timezone: string = DEFAULT_TIMEZONE): string {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed) return '';

  // 1. Pure military time
  const timeOnlyMatch = trimmed.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (timeOnlyMatch) {
    const hour = parseInt(timeOnlyMatch[1], 10);
    const minute = timeOnlyMatch[2];
    if (hour >= 0 && hour <= 24 && parseInt(minute, 10) >= 0 && parseInt(minute, 10) < 60) {
      return convert24HourTo12Hour(hour, minute);
    }
  }

  // 2. Already contains AM/PM
  const ampmMatch = trimmed.match(/\b(\d{1,2}):(\d{2})\s*(am|pm)\b/i);
  if (ampmMatch) {
    return `${parseInt(ampmMatch[1], 10)}:${ampmMatch[2]} ${ampmMatch[3].toUpperCase()}`;
  }

  // 3. ISO string
  const d = new Date(trimmed);
  if (!isNaN(d.getTime())) {
    try {
      return new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      }).format(d);
    } catch {
      // Fallback
    }
  }

  return formatEmailTime(trimmed, timezone);
}

/**
 * Formats schedule range strings (e.g. "Sep 15, 09:00 - 11:00", "14:00 - 16:00")
 * ensuring all military times are converted to 12-hour AM/PM format.
 */
export function formatEmailSchedule(value?: string | null, timezone: string = DEFAULT_TIMEZONE): string {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed) return '';

  return trimmed.replace(/\b(\d{1,2}):(\d{2})(?::\d{2})?\b(?!\s*(?:am|pm))/gi, (_, hStr, mStr) => {
    const hour = parseInt(hStr, 10);
    const minute = mStr;
    if (hour >= 0 && hour <= 24 && parseInt(minute, 10) >= 0 && parseInt(minute, 10) < 60) {
      return convert24HourTo12Hour(hour, minute);
    }
    return `${hStr}:${mStr}`;
  });
}

export interface PaymentLinkEmailInput {
  to: string;
  customerFirstName?: string;
  customerLastName?: string;
  referenceCode: string;
  amountDue: number;
  currency: string;
  paymentUrl: string;
  expiresAt: string;
  trackingUrl?: string;
  workspaceTemplateName?: string;
  bookingDate?: string;
}

export interface BookingConfirmationEmailInput {
  to: string;
  customerFirstName?: string;
  customerLastName?: string;
  referenceCode: string;
  workspaceDisplayName: string;
  workspaceTemplateName: string;
  floorName: string;
  bookingStartAt: string;
  bookingEndAt: string;
  bookingAccessUrl: string;
  bookingToken: string;
  qrIssuedAt: string;
  trackingUrl?: string;
  qrImageUrl?: string;
}

export interface ManualResolutionEmailInput {
  to: string;
  customerFirstName?: string;
  customerLastName?: string;
  referenceCode: string;
  businessName?: string;
  businessEmail?: string;
  businessPhone?: string;
  trackingUrl?: string;
}

export interface PaymentProofReceivedEmailInput {
  to: string;
  customerFirstName?: string;
  customerLastName?: string;
  referenceCode: string;
  trackingUrl?: string;
}

export interface PaymentProofRejectedEmailInput {
  to: string;
  customerFirstName?: string;
  customerLastName?: string;
  referenceCode: string;
  rejectionReason?: string;
  paymentUrl?: string;
  trackingUrl?: string;
  businessName?: string;
  businessEmail?: string;
  businessPhone?: string;
}

export interface ReservationTrackingCandidate {
  rank: number;
  workspaceDisplayName?: string;
  workspaceTemplateName?: string;
  floorName?: string;
  startAt?: string;
  endAt?: string;
}

export interface ReservationTrackingEmailInput {
  to?: string;
  customerFirstName?: string;
  customerLastName?: string;
  referenceCode: string;
  trackingUrl: string;
  status?: string;
  candidates?: ReservationTrackingCandidate[];
  supportEmail?: string;
}

export interface BookingEndedSurveyEmailInput {
  to?: string;
  customerFirstName?: string;
  customerLastName?: string;
  referenceCode: string;
  workspaceDisplayName?: string;
  workspaceTemplateName?: string;
  floorName?: string;
  bookingStartAt?: string;
  bookingEndAt?: string;
  surveyUrl?: string;
  bookAgainUrl?: string;
  trackingUrl?: string;
}

export interface StaffInvitationEmailInput {
  to: string;
  displayName: string;
  role: string;
  invitationUrl: string;
  verificationCode?: string;
  expiresAt: string;
}

export interface AdminPasswordResetEmailInput {
  to: string;
  displayName?: string;
  resetUrl: string;
  expiresAt: string;
}

export interface ReservationCancelledEmailInput {
  to: string;
  customerFirstName?: string;
  customerLastName?: string;
  referenceCode: string;
  cancellationReason: string;
  cancellationNotes?: string;
  schedule?: string;
  workspaceDisplayName?: string;
  trackingUrl?: string;
}

export interface ReservationRescheduledEmailInput {
  to: string;
  customerFirstName?: string;
  customerLastName?: string;
  referenceCode: string;
  oldSchedule: string;
  newSchedule: string;
  workspaceDisplayName: string;
  workspaceTemplateName?: string;
  floorName?: string;
  bookingAccessUrl?: string;
  bookingToken?: string;
  trackingUrl?: string;
  qrImageUrl?: string;
}

export interface RawEmailInput {
  to: string | string[];
  from?: string;
  subject: string;
  html: string;
  text?: string;
}

export function renderPaymentLinkEmail(input: PaymentLinkEmailInput): { subject: string; html: string; text: string } {
  const customerName = [input.customerFirstName, input.customerLastName].filter(Boolean).join(' ') || 'Customer';
  const subject = `DeskAtlas Reservation Payment - Ref #${input.referenceCode}`;
  const formattedAmount = `${input.currency.toUpperCase()} ${Number(input.amountDue).toFixed(2)}`;
  const expiresFormatted = new Date(input.expiresAt).toLocaleString('en-US', {
    timeZone: 'UTC',
    dateStyle: 'medium',
    timeStyle: 'short',
    hour12: true,
  }) + ' UTC';

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b; margin: 0; padding: 24px; }
    .card { background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; max-width: 560px; margin: 0 auto; padding: 32px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); }
    .header { margin-bottom: 24px; border-bottom: 1px solid #f1f5f9; padding-bottom: 16px; }
    .title { font-size: 20px; font-weight: 700; color: #0f172a; margin: 0 0 8px 0; }
    .reference-badge { display: inline-block; background-color: #f1f5f9; color: #334155; padding: 4px 10px; border-radius: 6px; font-family: monospace; font-size: 14px; font-weight: 600; }
    .content { font-size: 15px; line-height: 1.6; color: #334155; }
    .amount-box { background-color: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 8px; padding: 16px; margin: 20px 0; text-align: center; }
    .amount-label { font-size: 13px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; }
    .amount-val { font-size: 24px; font-weight: 700; color: #0f172a; margin-top: 4px; }
    .instruction-box { background-color: #f1f5f9; border-radius: 8px; padding: 16px; margin: 20px 0; font-size: 14px; line-height: 1.5; color: #334155; }
    .instruction-title { font-weight: 700; color: #0f172a; margin-bottom: 8px; text-transform: uppercase; font-size: 12px; letter-spacing: 0.5px; }
    .btn { display: inline-block; background-color: #0284c7; color: #ffffff !important; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 600; font-size: 15px; margin: 16px 0; text-align: center; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #f1f5f9; font-size: 12px; color: #94a3b8; }
    .warning { color: #d97706; font-size: 13px; margin-top: 12px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="title">DeskAtlas Reservation Payment</div>
      <div>Reference: <span class="reference-badge">${escapeHtml(input.referenceCode)}</span></div>
    </div>
    <div class="content">
      <p>Hello ${escapeHtml(customerName)},</p>
      <p>Your workspace reservation request has been created. Please complete your payment and submit proof to secure your spot.</p>
      
      <div class="amount-box">
        <div class="amount-label">Amount Due</div>
        <div class="amount-val">${escapeHtml(formattedAmount)}</div>
      </div>

      <div style="text-align: center;">
        <a href="${escapeHtml(input.paymentUrl)}" class="btn">Proceed to Payment</a>
      </div>

      <div class="instruction-box">
        <div class="instruction-title">Payment Instructions (GCash &amp; Bank Transfer)</div>
        <p style="margin: 0 0 6px 0;">1. Click the button above to view the official DeskAtlas payment QR code and account details.</p>
        <p style="margin: 0 0 6px 0;">2. Open your GCash app or mobile banking to transfer the exact amount of <strong>${escapeHtml(formattedAmount)}</strong>.</p>
        <p style="margin: 0;">3. Upload a screenshot or photo of your payment receipt before the session expires.</p>
      </div>

      <p class="warning">⚠️ <strong>1-Hour Session:</strong> Payment link expires at <strong>${escapeHtml(expiresFormatted)}</strong>. DeskAtlas No-Hold Policy: Submitting a reservation does not reserve physical inventory until payment proof is verified and approved by admin.</p>

      <p style="font-size: 13px; color: #64748b; margin-top: 20px;">
        If the button above does not work, copy and paste this link into your browser:<br>
        <a href="${escapeHtml(input.paymentUrl)}" style="color: #0284c7; word-break: break-all;">${escapeHtml(input.paymentUrl)}</a>
      </p>
    </div>
    <div class="footer">
      DeskAtlas Workspace Reservation System &bull; This is an automated transactional message.
    </div>
  </div>
</body>
</html>
  `.trim();

  const text = `
DeskAtlas Reservation Payment - Ref #${input.referenceCode}

Hello ${customerName},

Your workspace reservation request has been created. Please complete your payment and submit proof to secure your spot.

Amount Due: ${formattedAmount}
Payment URL: ${input.paymentUrl}

Session Expiry: ${expiresFormatted} (1 hour)

Payment Instructions:
1. Open your GCash app or mobile banking to transfer the exact amount (${formattedAmount}).
2. Upload your payment receipt screenshot before the timer ends.

Note: Selecting a spot or submitting a request does not hold inventory. Spot allocation is finalized only after payment proof approval.

DeskAtlas Workspace Reservation System
  `.trim();

  return { subject, html, text };
}

export function renderBookingConfirmationEmail(input: BookingConfirmationEmailInput): { subject: string; html: string; text: string } {
  const customerName = [input.customerFirstName, input.customerLastName].filter(Boolean).join(' ') || 'Customer';
  const subject = `Booking Confirmed! - DeskAtlas Ref #${input.referenceCode}`;
  const trackingUrl = normalizeCustomerTrackingUrl(input.trackingUrl);
  const qrImageUrl =
    input.qrImageUrl ||
    `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(
      input.bookingAccessUrl || input.bookingToken
    )}`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b; margin: 0; padding: 24px; }
    .card { background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; max-width: 560px; margin: 0 auto; padding: 32px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); }
    .header { margin-bottom: 24px; border-bottom: 1px solid #f1f5f9; padding-bottom: 16px; }
    .title { font-size: 20px; font-weight: 700; color: #0f172a; margin: 0 0 8px 0; }
    .confirmed-badge { display: inline-block; background-color: #dcfce7; color: #15803d; padding: 4px 10px; border-radius: 6px; font-size: 13px; font-weight: 700; }
    .content { font-size: 15px; line-height: 1.6; color: #334155; }
    .details-table { width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 14px; }
    .details-table td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; }
    .details-table td:first-child { color: #64748b; font-weight: 500; width: 35%; }
    .details-table td:last-child { color: #0f172a; font-weight: 600; }
    .qr-card { text-align: center; margin: 24px 0; background-color: #f8fafc; padding: 20px; border-radius: 12px; border: 1px dashed #cbd5e1; }
    .qr-label { font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px; }
    .qr-code-text { font-family: monospace; font-size: 15px; font-weight: 700; color: #0f172a; margin-top: 10px; margin-bottom: 4px; }
    .btn { display: inline-block; background-color: #15803d; color: #ffffff !important; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 600; font-size: 15px; margin: 16px 0; text-align: center; }
    .guidelines-box { background-color: #f8fafc; border-radius: 8px; padding: 16px; margin: 24px 0 16px 0; border: 1px solid #e2e8f0; }
    .guidelines-title { font-weight: 700; color: #0f172a; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 10px; }
    .guideline-item { font-size: 13px; color: #475569; margin: 6px 0; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #f1f5f9; font-size: 12px; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="title">Booking Confirmed! 🎉</div>
      <span class="confirmed-badge">CONFIRMED</span>
    </div>
    <div class="content">
      <p>Hello ${escapeHtml(customerName)},</p>
      <p>Your workspace reservation has been approved and confirmed. Here are your booking details:</p>
      
      <table class="details-table">
        <tr>
          <td>Reference Code</td>
          <td><code>${escapeHtml(input.referenceCode)}</code></td>
        </tr>
        <tr>
          <td>Assigned Spot</td>
          <td>${escapeHtml(input.workspaceDisplayName)} (${escapeHtml(input.workspaceTemplateName)})</td>
        </tr>
        <tr>
          <td>Floor</td>
          <td>${escapeHtml(input.floorName)}</td>
        </tr>
        <tr>
          <td>Start Time</td>
          <td>${escapeHtml(formatEmailTime(input.bookingStartAt))}</td>
        </tr>
        <tr>
          <td>End Time</td>
          <td>${escapeHtml(formatEmailTime(input.bookingEndAt))}</td>
        </tr>
      </table>

      <div class="qr-card">
        <div class="qr-label">Digital Access QR Pass</div>
        <img src="${escapeHtml(qrImageUrl)}" alt="Digital Pass QR Code" width="200" height="200" style="display: block; margin: 0 auto; border-radius: 8px; border: 1px solid #e2e8f0; background: #ffffff; padding: 6px;" />
        <div class="qr-code-text">${escapeHtml(input.referenceCode)}</div>
        <p style="font-size: 12px; color: #64748b; margin: 0;">Present this QR code upon arrival at the workspace reception desk or kiosk.</p>
      </div>

      <div class="guidelines-box">
        <div class="guidelines-title">Facility Guidelines &amp; Amenities</div>
        <div class="guideline-item">📶 <strong>High-Speed WiFi:</strong> Network connection credentials are provided upon check-in.</div>
        <div class="guideline-item">🏷️ <strong>Facility Access:</strong> Present your booking QR code at the reception desk for initial check-in and subsequent re-entry during your session.</div>
        <div class="guideline-item">🤫 <strong>Quiet &amp; Focus Zones:</strong> Please keep voices down in open workspaces and use dedicated phone booths for phone and video calls.</div>
      </div>

      ${trackingUrl ? `
      <p style="font-size: 13px; color: #475569; margin-top: 16px; border-top: 1px dashed #e2e8f0; padding-top: 12px;">
        Track live reservation status: <a href="${escapeHtml(trackingUrl)}" style="color: #15803d; text-decoration: underline;">${escapeHtml(trackingUrl)}</a>
      </p>
      ` : ''}
    </div>
    <div class="footer">
      DeskAtlas Workspace Reservation System &bull; This is an automated transactional message.
    </div>
  </div>
</body>
</html>
  `.trim();

  const text = `
Booking Confirmed! - DeskAtlas Ref #${input.referenceCode}

Hello ${customerName},

Your workspace reservation has been confirmed.

Assigned Spot: ${input.workspaceDisplayName} (${input.workspaceTemplateName})
Floor: ${input.floorName}
Start Time: ${formatEmailTime(input.bookingStartAt)}
End Time: ${formatEmailTime(input.bookingEndAt)}

QR Code Image: ${qrImageUrl}
${trackingUrl ? `Track Reservation: ${trackingUrl}\n` : ''}
Facility Guidelines:
- High-Speed WiFi credentials available at reception.
- Present your QR pass at reception or kiosk for check-in and re-entry.
- Please use designated call booths for phone calls.

DeskAtlas Workspace Reservation System
  `.trim();

  return { subject, html, text };
}

export function renderManualResolutionEmail(input: ManualResolutionEmailInput): { subject: string; html: string; text: string } {
  const customerName = [input.customerFirstName, input.customerLastName].filter(Boolean).join(' ') || 'Customer';
  const businessName = input.businessName || 'DeskAtlas';
  const businessEmail = input.businessEmail || 'support@deskatlas.com';
  const subject = `Reservation Update: Manual Resolution Needed [${input.referenceCode}]`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b; margin: 0; padding: 24px; }
    .card { background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; max-width: 560px; margin: 0 auto; padding: 32px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); }
    .header { margin-bottom: 24px; border-bottom: 1px solid #f1f5f9; padding-bottom: 16px; }
    .title { font-size: 20px; font-weight: 700; color: #0f172a; margin: 0 0 8px 0; }
    .badge { display: inline-block; background-color: #fef3c7; color: #b45309; padding: 4px 10px; border-radius: 6px; font-size: 13px; font-weight: 700; }
    .content { font-size: 15px; line-height: 1.6; color: #334155; }
    .contact-box { background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 20px; margin: 20px 0; }
    .contact-title { font-size: 14px; font-weight: 700; color: #0f172a; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
    .contact-item { margin: 8px 0; font-size: 14px; }
    .contact-label { color: #64748b; font-weight: 500; display: inline-block; width: 130px; }
    .contact-value { color: #0f172a; font-weight: 600; }
    .btn { display: inline-block; background-color: #0284c7; color: #ffffff !important; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 600; font-size: 15px; margin: 16px 0; text-align: center; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #f1f5f9; font-size: 12px; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="title">Reservation Update</div>
      <span class="badge">MANUAL RESOLUTION REQUIRED</span>
    </div>
    <div class="content">
      <p>Hello ${escapeHtml(customerName)},</p>
      <p>Thank you for completing your payment for reservation <strong>${escapeHtml(input.referenceCode)}</strong>.</p>
      <p>Your payment has been successfully recorded. However, due to high demand or scheduling conflicts, your requested workspace spot could not be automatically assigned and is currently queued for manual resolution by our team.</p>
      
      <p>Please reach out to the business using the registered contact details below to confirm or select an alternate workspace:</p>

      <div class="contact-box">
        <div class="contact-title">${escapeHtml(businessName)} Contact Details</div>
        <div class="contact-item">
          <span class="contact-label">Business Email:</span>
          <span class="contact-value"><a href="mailto:${escapeHtml(businessEmail)}" style="color: #0284c7; text-decoration: underline;">${escapeHtml(businessEmail)}</a></span>
        </div>
        ${input.businessPhone ? `
        <div class="contact-item">
          <span class="contact-label">Business Phone:</span>
          <span class="contact-value">${escapeHtml(input.businessPhone)}</span>
        </div>
        ` : ''}
        <div class="contact-item">
          <span class="contact-label">Reference Code:</span>
          <span class="contact-value"><code style="background: #e2e8f0; padding: 2px 6px; border-radius: 4px;">${escapeHtml(input.referenceCode)}</code></span>
        </div>
      </div>

      ${input.trackingUrl ? `
      <div style="text-align: center;">
        <a href="${escapeHtml(input.trackingUrl)}" class="btn">Track Reservation Status</a>
      </div>
      <p style="font-size: 13px; color: #64748b; margin-top: 16px;">
        Live Tracking Link: <a href="${escapeHtml(input.trackingUrl)}" style="color: #0284c7; word-break: break-all;">${escapeHtml(input.trackingUrl)}</a>
      </p>
      ` : ''}
    </div>
    <div class="footer">
      DeskAtlas Workspace Reservation System &bull; This is an automated transactional message.
    </div>
  </div>
</body>
</html>
  `.trim();

  const text = `
DeskAtlas Reservation Update: Manual Resolution Needed
Reference: ${input.referenceCode}

Hello ${customerName},

Thank you for your payment for reservation ${input.referenceCode}.
Your payment has been received, but your requested workspace spot could not be automatically assigned and requires manual resolution.

Please contact ${businessName} directly using the registered business details:
Business Email: ${businessEmail}
${input.businessPhone ? `Business Phone: ${input.businessPhone}\n` : ''}Reference Code: ${input.referenceCode}

${input.trackingUrl ? `Track Reservation: ${input.trackingUrl}\n` : ''}
DeskAtlas Workspace Reservation System
  `.trim();

  return { subject, html, text };
}

export function renderPaymentProofReceivedEmail(input: PaymentProofReceivedEmailInput): { subject: string; html: string; text: string } {
  const customerName = [input.customerFirstName, input.customerLastName].filter(Boolean).join(' ') || 'Customer';
  const subject = `Payment Proof Received - Waiting for Admin Approval (Ref #${input.referenceCode})`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b; margin: 0; padding: 24px; }
    .card { background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; max-width: 560px; margin: 0 auto; padding: 32px; }
    .header { margin-bottom: 20px; border-bottom: 1px solid #f1f5f9; padding-bottom: 16px; }
    .title { font-size: 18px; font-weight: 700; color: #0f172a; margin: 0; }
    .content { font-size: 15px; line-height: 1.6; color: #334155; }
    .badge { display: inline-block; background-color: #fef3c7; color: #b45309; padding: 4px 10px; border-radius: 6px; font-size: 13px; font-weight: 700; }
    .btn { display: inline-block; background-color: #0284c7; color: #ffffff !important; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 600; font-size: 15px; margin: 16px 0; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #f1f5f9; font-size: 12px; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="title">Payment Proof Received</div>
      <span class="badge" style="margin-top: 6px;">UNDER REVIEW</span>
    </div>
    <div class="content">
      <p>Hello ${escapeHtml(customerName)},</p>
      <p>We have successfully received your proof of payment for reservation <strong>${escapeHtml(input.referenceCode)}</strong>.</p>
      <p>Your 1-hour payment session timer has stopped and your reservation is now in <strong>PAYMENT_UNDER_REVIEW</strong> status. Our administration team is currently reviewing your payment proof.</p>
      <p>Once verified, your workspace spot will be allocated and you will receive a Booking Confirmation email with your digital access pass and check-in QR code.</p>

      ${input.trackingUrl ? `
      <div style="text-align: center;">
        <a href="${escapeHtml(input.trackingUrl)}" class="btn">Track Reservation Status</a>
      </div>
      <p style="font-size: 13px; color: #475569; margin-top: 16px; border-top: 1px dashed #e2e8f0; padding-top: 12px;">
        Live Tracking Link: <a href="${escapeHtml(input.trackingUrl)}" style="color: #0284c7; text-decoration: underline;">${escapeHtml(input.trackingUrl)}</a>
      </p>
      ` : ''}
    </div>
    <div class="footer">
      DeskAtlas Workspace Reservation System &bull; This is an automated transactional message.
    </div>
  </div>
</body>
</html>
  `.trim();

  const text = `
Payment Proof Received - Waiting for Admin Approval (Ref #${input.referenceCode})

Hello ${customerName},

We have received your payment proof for reservation ${input.referenceCode}.
Your 1-hour session timer has stopped. Our team is reviewing the submission. You will receive a booking confirmation email once approved.

${input.trackingUrl ? `Track Reservation: ${input.trackingUrl}\n` : ''}
DeskAtlas Workspace Reservation System
  `.trim();

  return { subject, html, text };
}

export function renderPaymentProofRejectedEmail(input: PaymentProofRejectedEmailInput): { subject: string; html: string; text: string } {
  const customerName = [input.customerFirstName, input.customerLastName].filter(Boolean).join(' ') || 'Customer';
  const subject = `Payment Proof Rejected - Reservation ${input.referenceCode}`;
  const reason = input.rejectionReason || 'The payment proof could not be verified by the admin team.';

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b; margin: 0; padding: 24px; }
    .card { background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; max-width: 560px; margin: 0 auto; padding: 32px; }
    .header { margin-bottom: 20px; border-bottom: 1px solid #f1f5f9; padding-bottom: 16px; }
    .title { font-size: 18px; font-weight: 700; color: #dc2626; margin: 0; }
    .content { font-size: 15px; line-height: 1.6; color: #334155; }
    .reason-box { background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 14px; margin: 16px 0; color: #991b1b; }
    .btn { display: inline-block; background-color: #0284c7; color: #ffffff !important; text-decoration: none; padding: 10px 24px; border-radius: 6px; font-weight: 600; font-size: 14px; margin: 12px 0; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #f1f5f9; font-size: 12px; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="title">Payment Proof Rejected</div>
    </div>
    <div class="content">
      <p>Hello ${escapeHtml(customerName)},</p>
      <p>Your payment proof for reservation <strong>${escapeHtml(input.referenceCode)}</strong> could not be verified and has been rejected.</p>
      
      <div class="reason-box">
        <strong>Reason for Rejection:</strong><br>
        ${escapeHtml(reason)}
      </div>

      ${(input.businessEmail || input.businessPhone) ? `
      <div class="contact-box" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 16px 0;">
        <div style="font-weight: 700; color: #0f172a; margin-bottom: 8px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">Have Inquiries?</div>
        <p style="margin: 0 0 10px 0; font-size: 14px; color: #334155;">If you have inquiries regarding your reservation or payment, please contact us:</p>
        ${input.businessEmail ? `
        <div style="margin: 6px 0; font-size: 14px;">
          <span style="color: #64748b; font-weight: 500;">Email:</span>
          <a href="mailto:${escapeHtml(input.businessEmail)}" style="color: #0284c7; text-decoration: underline; font-weight: 600; margin-left: 6px;">${escapeHtml(input.businessEmail)}</a>
        </div>
        ` : ''}
        ${input.businessPhone ? `
        <div style="margin: 6px 0; font-size: 14px;">
          <span style="color: #64748b; font-weight: 500;">Call / Text:</span>
          <span style="color: #0f172a; font-weight: 600; margin-left: 6px;">${escapeHtml(input.businessPhone)}</span>
        </div>
        ` : ''}
      </div>
      ` : ''}

      ${input.paymentUrl ? `
      <p>If your 1-hour session is still active, you may re-submit a valid payment proof using the link below:</p>
      <div style="text-align: center;">
        <a href="${escapeHtml(input.paymentUrl)}" class="btn">Re-submit Payment Proof</a>
      </div>
      ` : ''}

      ${input.trackingUrl ? `
      <p style="font-size: 13px; color: #475569; margin-top: 16px; border-top: 1px dashed #e2e8f0; padding-top: 12px;">
        Track reservation status: <a href="${escapeHtml(input.trackingUrl)}" style="color: #0284c7; text-decoration: underline;">${escapeHtml(input.trackingUrl)}</a>
      </p>
      ` : ''}
    </div>
    <div class="footer">
      DeskAtlas Workspace Reservation System
    </div>
  </div>
</body>
</html>
  `.trim();

  const text = `
Payment Proof Rejected - DeskAtlas
Reference: ${input.referenceCode}

Hello ${customerName},

Your payment proof for reservation ${input.referenceCode} could not be verified and has been rejected.

Reason: ${reason}
${input.paymentUrl ? `\nRe-submit proof (if session is active): ${input.paymentUrl}\n` : ''}${(input.businessEmail || input.businessPhone) ? `\nIf you have inquiries, please contact us:\n${input.businessEmail ? `Email: ${input.businessEmail}\n` : ''}${input.businessPhone ? `Call / Text: ${input.businessPhone}\n` : ''}` : ''}${input.trackingUrl ? `\nTrack Reservation: ${input.trackingUrl}\n` : ''}
DeskAtlas Workspace Reservation System
  `.trim();

  return { subject, html, text };
}

export function renderReservationTrackingEmail(input: ReservationTrackingEmailInput): { subject: string; html: string; text: string } {
  const customerName = [input.customerFirstName, input.customerLastName].filter(Boolean).join(' ') || 'Customer';
  const subject = `DeskAtlas Reservation Status - Ref #${input.referenceCode}`;
  const statusLabel = input.status || 'PENDING_PAYMENT';
  const supportEmail = input.supportEmail || 'support@deskatlas.com';

  const candidatesHtml = input.candidates && input.candidates.length > 0 ? `
    <div style="margin: 20px 0; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px;">
      <div style="font-size: 13px; font-weight: 700; color: #0f172a; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.5px;">Selected Workspace Candidates</div>
      <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
        ${input.candidates.map((c) => {
          const rankLabel = c.rank === 0 ? 'Main Spot' : `Backup Choice ${c.rank}`;
          const spotInfo = c.workspaceDisplayName || c.workspaceTemplateName || `Spot #${c.rank + 1}`;
          const floorInfo = c.floorName ? ` (${c.floorName})` : '';
          const startTimeStr = formatEmailTimeOnly(c.startAt);
          const endTimeStr = formatEmailTimeOnly(c.endAt);
          const timeInfo = startTimeStr && endTimeStr ? ` - ${startTimeStr} to ${endTimeStr}` : '';
          return `
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 6px 0; font-weight: 600; color: ${c.rank === 0 ? '#0284c7' : '#64748b'}; width: 35%;">${escapeHtml(rankLabel)}</td>
            <td style="padding: 6px 0; color: #1e293b;">${escapeHtml(spotInfo + floorInfo + timeInfo)}</td>
          </tr>
          `;
        }).join('')}
      </table>
    </div>
  ` : '';

  const candidatesText = input.candidates && input.candidates.length > 0 ? `
Selected Candidates:
${input.candidates.map((c) => {
  const rankLabel = c.rank === 0 ? 'Main Spot' : `Backup Choice ${c.rank}`;
  const spotInfo = c.workspaceDisplayName || c.workspaceTemplateName || `Option ${c.rank + 1}`;
  const startTimeStr = formatEmailTimeOnly(c.startAt);
  const endTimeStr = formatEmailTimeOnly(c.endAt);
  const timeInfo = startTimeStr && endTimeStr ? ` (${startTimeStr} to ${endTimeStr})` : '';
  return `- ${rankLabel}: ${spotInfo}${timeInfo}`;
}).join('\n')}
  `.trim() : '';

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b; margin: 0; padding: 24px; }
    .card { background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; max-width: 560px; margin: 0 auto; padding: 32px; }
    .header { margin-bottom: 20px; border-bottom: 1px solid #f1f5f9; padding-bottom: 16px; }
    .title { font-size: 18px; font-weight: 700; color: #0f172a; margin: 0; }
    .content { font-size: 15px; line-height: 1.6; color: #334155; }
    .badge { display: inline-block; background-color: #f1f5f9; color: #334155; padding: 4px 10px; border-radius: 6px; font-size: 13px; font-weight: 700; }
    .btn { display: inline-block; background-color: #0284c7; color: #ffffff !important; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 600; font-size: 15px; margin: 16px 0; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #f1f5f9; font-size: 12px; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="title">DeskAtlas Reservation Status</div>
      <div style="margin-top: 6px;">Reference: <strong>${escapeHtml(input.referenceCode)}</strong> &bull; <span class="badge">${escapeHtml(statusLabel)}</span></div>
    </div>
    <div class="content">
      <p>Hello ${escapeHtml(customerName)},</p>
      <p>You can track the live status and allocation progress of your reservation at any time using the link below:</p>
      
      ${candidatesHtml}

      <div style="text-align: center;">
        <a href="${escapeHtml(input.trackingUrl)}" class="btn">Track Reservation Status</a>
      </div>

      <p style="font-size: 13px; color: #64748b; margin-top: 20px;">
        Tracking Link: <a href="${escapeHtml(input.trackingUrl)}" style="color: #0284c7; word-break: break-all;">${escapeHtml(input.trackingUrl)}</a>
      </p>

      <p style="font-size: 12px; color: #64748b; margin-top: 16px; border-top: 1px dashed #e2e8f0; padding-top: 10px;">
        Need assistance? Reach out to support at <a href="mailto:${escapeHtml(supportEmail)}" style="color: #0284c7;">${escapeHtml(supportEmail)}</a>.
      </p>
    </div>
    <div class="footer">
      DeskAtlas Workspace Reservation System &bull; This is an automated transactional message.
    </div>
  </div>
</body>
</html>
  `.trim();

  const text = `
DeskAtlas Reservation Status - Ref #${input.referenceCode}

Hello ${customerName},

Track the live status of your reservation here:
${input.trackingUrl}

Status: ${statusLabel}
${candidatesText ? `\n${candidatesText}\n` : ''}
Need help? Contact support at: ${supportEmail}

DeskAtlas Workspace Reservation System
  `.trim();

  return { subject, html, text };
}

export function renderBookingEndedSurveyEmail(input: BookingEndedSurveyEmailInput): { subject: string; html: string; text: string } {
  const customerName = [input.customerFirstName, input.customerLastName].filter(Boolean).join(' ') || 'Customer';
  const subject = `Your DeskAtlas Booking Has Ended — We Value Your Feedback!`;
  const defaultSurveyUrl = process.env.SURVEY_FORM_URL || process.env.NEXT_PUBLIC_SURVEY_FORM_URL || 'https://forms.google.com/deskatlas-feedback';
  const surveyUrl = input.surveyUrl || defaultSurveyUrl;
  const bookAgainUrl = input.bookAgainUrl || process.env.DESKATLAS_PUBLIC_APP_URL || 'https://deskatlas.com';

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b; margin: 0; padding: 24px; }
    .card { background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; max-width: 560px; margin: 0 auto; padding: 32px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); }
    .header { margin-bottom: 24px; border-bottom: 1px solid #f1f5f9; padding-bottom: 16px; }
    .title { font-size: 20px; font-weight: 700; color: #0f172a; margin: 0 0 8px 0; }
    .content { font-size: 15px; line-height: 1.6; color: #334155; }
    .summary-box { background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0; font-size: 14px; }
    .summary-row { margin: 6px 0; }
    .summary-label { color: #64748b; font-weight: 500; display: inline-block; width: 120px; }
    .summary-val { color: #0f172a; font-weight: 600; }
    .btn-survey { display: inline-block; background-color: #064E3B; color: #ffffff !important; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 700; font-size: 15px; margin: 18px 0; text-align: center; }
    .btn-secondary { display: inline-block; background-color: #f1f5f9; color: #334155 !important; text-decoration: none; padding: 10px 20px; border-radius: 6px; font-weight: 600; font-size: 13px; margin-top: 10px; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #f1f5f9; font-size: 12px; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="title">Thank you for visiting DeskAtlas! 🙌</div>
      <div style="font-size: 13px; color: #64748b;">Reference: <strong>${escapeHtml(input.referenceCode)}</strong></div>
    </div>
    <div class="content">
      <p>Hello ${escapeHtml(customerName)},</p>
      <p>Your workspace reservation has now ended. We hope you enjoyed your visit and had a highly productive session!</p>

      <div class="summary-box">
        <div class="summary-row">
          <span class="summary-label">Reference:</span>
          <span class="summary-val">${escapeHtml(input.referenceCode)}</span>
        </div>
        ${input.workspaceDisplayName ? `
        <div class="summary-row">
          <span class="summary-label">Workspace:</span>
          <span class="summary-val">${escapeHtml(input.workspaceDisplayName)}${input.workspaceTemplateName ? ` (${escapeHtml(input.workspaceTemplateName)})` : ''}</span>
        </div>
        ` : ''}
        ${input.floorName ? `
        <div class="summary-row">
          <span class="summary-label">Floor:</span>
          <span class="summary-val">${escapeHtml(input.floorName)}</span>
        </div>
        ` : ''}
        ${input.bookingStartAt && input.bookingEndAt ? `
        <div class="summary-row">
          <span class="summary-label">Session Time:</span>
          <span class="summary-val">${escapeHtml(formatEmailTime(input.bookingStartAt))} &ndash; ${escapeHtml(formatEmailTime(input.bookingEndAt))}</span>
        </div>
        ` : ''}
      </div>

      <p>To help us continuously improve the DeskAtlas workspace experience, could you please take 1 minute to share your thoughts?</p>

      <div style="text-align: center;">
        <a href="${escapeHtml(surveyUrl)}" class="btn-survey">Share Your Feedback (1-Min Survey)</a>
      </div>

      <p style="font-size: 13px; color: #64748b; text-align: center; margin: 12px 0 20px 0;">
        If the button above does not work, access the feedback form directly:<br>
        <a href="${escapeHtml(surveyUrl)}" style="color: #064E3B; word-break: break-all;">${escapeHtml(surveyUrl)}</a>
      </p>

      <div style="text-align: center; margin-top: 16px;">
        <p style="font-size: 13px; color: #64748b; margin-bottom: 6px;">Need a desk again soon?</p>
        <a href="${escapeHtml(bookAgainUrl)}" class="btn-secondary">Book Another Workspace</a>
      </div>

      ${input.trackingUrl ? `
      <p style="font-size: 12px; color: #94a3b8; margin-top: 24px; border-top: 1px dashed #e2e8f0; padding-top: 12px;">
        View past booking details: <a href="${escapeHtml(input.trackingUrl)}" style="color: #064E3B; text-decoration: underline;">${escapeHtml(input.trackingUrl)}</a>
      </p>
      ` : ''}
    </div>
    <div class="footer">
      DeskAtlas Workspace Reservation System &bull; Customer Experience &amp; Feedback
    </div>
  </div>
</body>
</html>
  `.trim();

  const text = `
Your DeskAtlas Booking Has Ended — We Value Your Feedback!
Reference: ${input.referenceCode}

Hello ${customerName},

Thank you for working at DeskAtlas! We hope you had a productive session.

Session Summary:
- Reference: ${input.referenceCode}
${input.workspaceDisplayName ? `- Workspace: ${input.workspaceDisplayName}\n` : ''}${input.bookingStartAt ? `- Start Time: ${formatEmailTime(input.bookingStartAt)}\n` : ''}${input.bookingEndAt ? `- End Time: ${formatEmailTime(input.bookingEndAt)}\n` : ''}
Please take a minute to share your feedback with us:
Survey Link: ${surveyUrl}

Ready to book another workspace? Visit:
${bookAgainUrl}

DeskAtlas Workspace Reservation System
  `.trim();

  return { subject, html, text };
}

function escapeHtml(str: string): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export class TransactionalEmailService {
  private readonly apiKey?: string;
  private readonly fromEmail: string;
  private readonly webhookUrl?: string;
  private readonly fetcher: typeof fetch;

  constructor(config?: ResendEmailConfig) {
    this.apiKey = config?.apiKey ?? process.env.RESEND_API_KEY;
    this.fromEmail = config?.fromEmail ?? process.env.RESEND_FROM_EMAIL ?? 'DeskAtlas <noreply@deskatlas.com>';
    this.webhookUrl = config?.webhookUrl ?? process.env.TRANSACTIONAL_EMAIL_WEBHOOK_URL;
    this.fetcher = config?.fetcher ?? fetch;
  }

  async sendEmail(input: RawEmailInput): Promise<EmailSendResult> {
    const to = Array.isArray(input.to) ? input.to : [input.to];
    const from = input.from || this.fromEmail;

    // 1. Resend API mode if RESEND_API_KEY is configured
    if (this.apiKey) {
      try {
        const response = await this.fetcher('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from,
            to,
            subject: input.subject,
            html: input.html,
            text: input.text,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`[TransactionalEmail] Resend API error (${response.status}):`, errorText);
          return { success: false, error: `Resend error (${response.status}): ${errorText}` };
        }

        const data: any = await response.json();
        return { success: true, id: data?.id };
      } catch (err: any) {
        console.error('[TransactionalEmail] Failed to send via Resend:', err.message);
        return { success: false, error: err.message };
      }
    }

    // 2. Backward-compatible Webhook mode if TRANSACTIONAL_EMAIL_WEBHOOK_URL is configured
    if (this.webhookUrl) {
      try {
        const response = await this.fetcher(this.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to,
            from,
            subject: input.subject,
            html: input.html,
            text: input.text,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.warn(`[TransactionalEmail] Webhook error (${response.status}):`, errorText);
          return { success: false, error: `Webhook error: ${errorText}` };
        }

        return { success: true, id: 'webhook-dispatched' };
      } catch (err: any) {
        console.warn('[TransactionalEmail] Failed to dispatch email webhook:', err.message);
        return { success: false, error: err.message };
      }
    }

    // 3. Fallback logged mode for local development without credentials
    console.info(`[TransactionalEmail] Skipped sending "${input.subject}" to [${to.join(', ')}]; no RESEND_API_KEY or TRANSACTIONAL_EMAIL_WEBHOOK_URL configured.`);
    return { success: true, id: 'mock-local-skipped' };
  }

  async sendPaymentLinkEmail(input: PaymentLinkEmailInput): Promise<EmailSendResult> {
    const rendered = renderPaymentLinkEmail(input);

    // If webhookUrl is configured without Resend API key, maintain backward-compatible payload schema
    if (!this.apiKey && this.webhookUrl) {
      try {
        await this.fetcher(this.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            template: 'payment-session',
            ...input,
          }),
        });
        return { success: true, id: 'webhook-payment-session' };
      } catch (err: any) {
        console.warn('[TransactionalEmail] Payment link webhook dispatch error:', err.message);
      }
    }

    return this.sendEmail({
      to: input.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  }

  async sendBookingConfirmationEmail(input: BookingConfirmationEmailInput): Promise<EmailSendResult> {
    const rendered = renderBookingConfirmationEmail(input);

    // If webhookUrl is configured without Resend API key, maintain backward-compatible payload schema
    if (!this.apiKey && this.webhookUrl) {
      try {
        await this.fetcher(this.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            template: 'booking-confirmed',
            ...input,
          }),
        });
        return { success: true, id: 'webhook-booking-confirmed' };
      } catch (err: any) {
        console.warn('[TransactionalEmail] Booking confirmed webhook dispatch error:', err.message);
      }
    }

    return this.sendEmail({
      to: input.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  }

  async sendManualResolutionEmail(input: ManualResolutionEmailInput): Promise<EmailSendResult> {
    const rendered = renderManualResolutionEmail(input);

    if (!this.apiKey && this.webhookUrl) {
      try {
        await this.fetcher(this.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            template: 'manual-resolution',
            ...input,
          }),
        });
        return { success: true, id: 'webhook-manual-resolution' };
      } catch (err: any) {
        console.warn('[TransactionalEmail] Manual resolution webhook dispatch error:', err.message);
      }
    }

    return this.sendEmail({
      to: input.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  }

  async sendPaymentProofReceivedEmail(input: PaymentProofReceivedEmailInput): Promise<EmailSendResult> {
    const rendered = renderPaymentProofReceivedEmail(input);
    return this.sendEmail({
      to: input.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  }

  async sendPaymentProofRejectedEmail(input: PaymentProofRejectedEmailInput): Promise<EmailSendResult> {
    const rendered = renderPaymentProofRejectedEmail(input);
    return this.sendEmail({
      to: input.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  }

  async sendReservationTrackingEmail(input: ReservationTrackingEmailInput): Promise<EmailSendResult> {
    const rendered = renderReservationTrackingEmail(input);
    return this.sendEmail({
      to: input.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  }

  async sendStaffInvitationEmail(input: StaffInvitationEmailInput): Promise<EmailSendResult> {
    const rendered = renderStaffInvitationEmail(input);
    return this.sendEmail({
      to: input.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  }

  async sendAdminPasswordResetEmail(input: AdminPasswordResetEmailInput): Promise<EmailSendResult> {
    const rendered = renderAdminPasswordResetEmail(input);
    return this.sendEmail({
      to: input.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  }

  async sendReservationCancelledEmail(input: ReservationCancelledEmailInput): Promise<EmailSendResult> {
    const rendered = renderReservationCancelledEmail(input);
    return this.sendEmail({
      to: input.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  }

  async sendReservationRescheduledEmail(input: ReservationRescheduledEmailInput): Promise<EmailSendResult> {
    const rendered = renderReservationRescheduledEmail(input);
    return this.sendEmail({
      to: input.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  }

  async sendBookingEndedSurveyEmail(input: BookingEndedSurveyEmailInput): Promise<EmailSendResult> {
    const rendered = renderBookingEndedSurveyEmail(input);
    return this.sendEmail({
      to: input.to || '',
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  }
}

export function renderStaffInvitationEmail(input: StaffInvitationEmailInput): { subject: string; html: string; text: string } {
  const subject = `You've been invited to join DeskAtlas as ${input.role === 'ADMIN' ? 'an Administrator' : 'Staff'}`;
  const roleLabel = input.role === 'ADMIN' ? 'Administrator' : 'Staff Member';
  const expiresFormatted = new Date(input.expiresAt).toLocaleString('en-US', {
    timeZone: 'Asia/Manila',
    dateStyle: 'medium',
    timeStyle: 'short',
    hour12: true,
  });

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0f172a; color: #1e293b; margin: 0; padding: 24px; }
    .card { background-color: #ffffff; border-radius: 14px; border: 1px solid #e2e8f0; max-width: 560px; margin: 0 auto; padding: 36px; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.2); }
    .header { margin-bottom: 24px; border-bottom: 1px solid #f1f5f9; padding-bottom: 16px; display: flex; align-items: center; justify-content: space-between; }
    .brand { font-size: 20px; font-weight: 800; color: #064E3B; letter-spacing: -0.5px; }
    .title { font-size: 22px; font-weight: 800; color: #0f172a; margin: 16px 0 8px 0; }
    .badge { display: inline-block; background-color: #d1fae5; color: #065f46; padding: 4px 10px; border-radius: 6px; font-size: 12px; font-weight: 700; text-transform: uppercase; }
    .content { font-size: 15px; line-height: 1.6; color: #334155; }
    .notice-box { background: #f8fafc; border: 1px solid #e2e8f0; border-left: 4px solid #064E3B; border-radius: 8px; padding: 16px 20px; margin: 24px 0; text-align: left; }
    .notice-title { font-size: 13px; font-weight: 700; color: #064E3B; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
    .notice-desc { font-size: 13px; color: #334155; margin: 0; line-height: 1.5; }
    .btn { display: inline-block; background: linear-gradient(180deg, #064E3B 0%, #043629 100%); color: #ffffff !important; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 700; font-size: 15px; margin: 18px 0; text-align: center; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #f1f5f9; font-size: 12px; color: #94a3b8; text-align: center; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="brand">DeskAtlas</div>
      <span class="badge">Team Invitation</span>
    </div>
    <div class="content">
      <div class="title">Welcome to DeskAtlas!</div>
      <p>Hello <strong>${escapeHtml(input.displayName)}</strong>,</p>
      <p>You have been invited to join the workspace operations team as a <strong>${escapeHtml(roleLabel)}</strong>.</p>
      
      <p>To finalize and activate your account, click the button below to open the confirmation page. You will be prompted to enter your 6-digit Two-Factor Authentication (2FA) verification code to complete activation.</p>

      <div style="text-align: center;">
        <a href="${escapeHtml(input.invitationUrl)}" class="btn">Confirm & Activate Account</a>
      </div>

      <div class="notice-box">
        <div class="notice-title">Security Verification Required</div>
        <p class="notice-desc">
          For security reasons, your 2FA verification code is not included in this email. Please contact your workspace owner or administrator to obtain your 6-digit 2FA confirmation code.
        </p>
      </div>

      <p style="font-size: 13px; color: #64748b;">
        This invitation link expires on <strong>${escapeHtml(expiresFormatted)}</strong>.
      </p>

      <p style="font-size: 12px; color: #94a3b8; margin-top: 20px;">
        If the button above does not work, copy and paste this URL into your browser:<br>
        <a href="${escapeHtml(input.invitationUrl)}" style="color: #064E3B; word-break: break-all;">${escapeHtml(input.invitationUrl)}</a>
      </p>
    </div>
    <div class="footer">
      DeskAtlas Workspace Reservation System &bull; Automated Staff Onboarding
    </div>
  </div>
</body>
</html>
  `.trim();

  const text = `
DeskAtlas Team Invitation

Hello ${input.displayName},

You have been invited to join the DeskAtlas team as a ${roleLabel}.

To finalize and activate your account, visit the link below:
${input.invitationUrl}

Two-Factor Authentication (2FA) Notice:
For security reasons, your 2FA verification code is not included in this email.
Please ask your workspace owner or administrator for your 6-digit 2FA confirmation code.

This invitation expires on ${expiresFormatted}.

DeskAtlas Workspace Reservation System
  `.trim();

  return { subject, html, text };
}

export function renderAdminPasswordResetEmail(input: AdminPasswordResetEmailInput): { subject: string; html: string; text: string } {
  const subject = 'Reset Your DeskAtlas Admin Password';
  const name = input.displayName || 'Administrator';
  const expiresFormatted = new Date(input.expiresAt).toLocaleString('en-US', {
    timeZone: 'Asia/Manila',
    dateStyle: 'medium',
    timeStyle: 'short',
    hour12: true,
  });

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0f172a; color: #1e293b; margin: 0; padding: 24px; }
    .card { background-color: #ffffff; border-radius: 14px; border: 1px solid #e2e8f0; max-width: 560px; margin: 0 auto; padding: 36px; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.2); }
    .header { margin-bottom: 24px; border-bottom: 1px solid #f1f5f9; padding-bottom: 16px; display: flex; align-items: center; justify-content: space-between; }
    .brand { font-size: 20px; font-weight: 800; color: #064E3B; letter-spacing: -0.5px; }
    .title { font-size: 22px; font-weight: 800; color: #0f172a; margin: 16px 0 8px 0; }
    .badge { display: inline-block; background-color: #fee2e2; color: #991b1b; padding: 4px 10px; border-radius: 6px; font-size: 12px; font-weight: 700; text-transform: uppercase; }
    .content { font-size: 15px; line-height: 1.6; color: #334155; }
    .btn { display: inline-block; background: linear-gradient(180deg, #064E3B 0%, #043629 100%); color: #ffffff !important; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 700; font-size: 15px; margin: 20px 0; text-align: center; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #f1f5f9; font-size: 12px; color: #94a3b8; text-align: center; }
    .warning { color: #d97706; font-size: 13px; margin-top: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="brand">DeskAtlas</div>
      <span class="badge">Security Recovery</span>
    </div>
    <div class="content">
      <div class="title">Reset Your Password</div>
      <p>Hello <strong>${escapeHtml(name)}</strong>,</p>
      <p>We received a request to reset the password for your DeskAtlas administrative account.</p>
      <p>Click the button below to set a new password:</p>

      <div style="text-align: center;">
        <a href="${escapeHtml(input.resetUrl)}" class="btn">Reset Admin Password</a>
      </div>

      <p class="warning">⚠️ <strong>1-Hour Expiry:</strong> This password reset link will expire on <strong>${escapeHtml(expiresFormatted)}</strong>.</p>

      <p style="font-size: 13px; color: #64748b; margin-top: 16px;">
        If you did not request a password reset, you can safely ignore this email. Your current credentials remain active and unchanged.
      </p>

      <p style="font-size: 12px; color: #94a3b8; margin-top: 20px;">
        If the button above does not work, copy and paste this URL into your browser:<br>
        <a href="${escapeHtml(input.resetUrl)}" style="color: #064E3B; word-break: break-all;">${escapeHtml(input.resetUrl)}</a>
      </p>
    </div>
    <div class="footer">
      DeskAtlas Workspace Reservation System &bull; Administrative Security Alert
    </div>
  </div>
</body>
</html>
  `.trim();

  const text = `
DeskAtlas Admin Password Reset

Hello ${name},

We received a request to reset the password for your DeskAtlas administrative account.

To reset your password, visit the link below:
${input.resetUrl}

This link expires on ${expiresFormatted} (1 hour).

If you did not request this, please ignore this email.

DeskAtlas Workspace Reservation System
  `.trim();

  return { subject, html, text };
}

export function renderReservationCancelledEmail(input: ReservationCancelledEmailInput): { subject: string; html: string; text: string } {
  const customerName = [input.customerFirstName, input.customerLastName].filter(Boolean).join(' ') || 'Customer';
  const subject = `Your DeskAtlas Reservation Has Been Cancelled [${input.referenceCode}]`;
  const reasonText = input.cancellationNotes ? `${input.cancellationReason} - ${input.cancellationNotes}` : input.cancellationReason;
  const formattedSchedule = input.schedule ? formatEmailSchedule(input.schedule) : undefined;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b; margin: 0; padding: 24px; }
    .card { background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; max-width: 560px; margin: 0 auto; padding: 32px; }
    .header { margin-bottom: 20px; border-bottom: 1px solid #f1f5f9; padding-bottom: 16px; }
    .title { font-size: 18px; font-weight: 700; color: #991b1b; margin: 0 0 6px 0; }
    .content { font-size: 15px; line-height: 1.6; color: #334155; }
    .reason-box { background-color: #fef2f2; border-left: 4px solid #ef4444; padding: 12px 16px; margin: 16px 0; border-radius: 4px; font-size: 14px; color: #991b1b; }
    .info-box { background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; margin: 16px 0; font-size: 13px; color: #475569; }
    .btn { display: inline-block; background-color: #0284c7; color: #ffffff !important; text-decoration: none; padding: 10px 22px; border-radius: 8px; font-weight: 600; font-size: 14px; margin: 16px 0; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #f1f5f9; font-size: 12px; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="title">Reservation Cancellation Notice</div>
      <div style="font-size: 13px; color: #64748b;">Reference: <strong>${escapeHtml(input.referenceCode)}</strong></div>
    </div>
    <div class="content">
      <p>Hello ${escapeHtml(customerName)},</p>
      <p>Your workspace reservation <strong>${escapeHtml(input.referenceCode)}</strong> has been cancelled.</p>
      
      <div class="reason-box">
        <strong>Reason for cancellation:</strong><br>
        ${escapeHtml(reasonText)}
      </div>

      ${formattedSchedule || input.workspaceDisplayName ? `
      <div class="info-box">
        ${input.workspaceDisplayName ? `<div><strong>Workspace:</strong> ${escapeHtml(input.workspaceDisplayName)}</div>` : ''}
        ${formattedSchedule ? `<div><strong>Original Schedule:</strong> ${escapeHtml(formattedSchedule)}</div>` : ''}
      </div>
      ` : ''}

      <p>If you made a payment that requires a refund or have any questions regarding this cancellation, please contact our support desk.</p>

      ${input.trackingUrl ? `
      <div style="text-align: center;">
        <a href="${escapeHtml(input.trackingUrl)}" class="btn">View Reservation Status</a>
      </div>
      ` : ''}
    </div>
    <div class="footer">
      DeskAtlas Workspace Reservation System
    </div>
  </div>
</body>
</html>
  `.trim();

  const text = `
Reservation Cancellation Notice - DeskAtlas
Reference: ${input.referenceCode}

Hello ${customerName},

Your workspace reservation ${input.referenceCode} has been cancelled.

Reason: ${reasonText}
${input.workspaceDisplayName ? `Workspace: ${input.workspaceDisplayName}\n` : ''}${formattedSchedule ? `Original Schedule: ${formattedSchedule}\n` : ''}${input.trackingUrl ? `Status Link: ${input.trackingUrl}\n` : ''}
DeskAtlas Workspace Reservation System
  `.trim();

  return { subject, html, text };
}

export function renderReservationRescheduledEmail(input: ReservationRescheduledEmailInput): { subject: string; html: string; text: string } {
  const customerName = [input.customerFirstName, input.customerLastName].filter(Boolean).join(' ') || 'Customer';
  const subject = `Your DeskAtlas Reservation Has Been Rescheduled [${input.referenceCode}]`;
  const formattedNewSchedule = formatEmailSchedule(input.newSchedule);
  const formattedOldSchedule = formatEmailSchedule(input.oldSchedule);
  const qrImageUrl =
    input.qrImageUrl ||
    `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(
      input.bookingAccessUrl || input.bookingToken || input.referenceCode
    )}`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b; margin: 0; padding: 24px; }
    .card { background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; max-width: 560px; margin: 0 auto; padding: 32px; }
    .header { margin-bottom: 20px; border-bottom: 1px solid #f1f5f9; padding-bottom: 16px; }
    .title { font-size: 18px; font-weight: 700; color: #0284c7; margin: 0 0 6px 0; }
    .content { font-size: 15px; line-height: 1.6; color: #334155; }
    .schedule-box { background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; margin: 18px 0; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #f1f5f9; font-size: 12px; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="title">Reservation Schedule Updated</div>
      <div style="font-size: 13px; color: #64748b;">Reference: <strong>${escapeHtml(input.referenceCode)}</strong></div>
    </div>
    <div class="content">
      <p>Hello ${escapeHtml(customerName)},</p>
      <p>Your workspace reservation <strong>${escapeHtml(input.referenceCode)}</strong> has been rescheduled by the administration.</p>
      
      <div class="schedule-box">
        <div style="font-size: 12px; font-weight: 700; color: #166534; text-transform: uppercase; margin-bottom: 8px;">Updated Schedule Details</div>
        <div><strong>New Schedule:</strong> ${escapeHtml(formattedNewSchedule)}</div>
        <div style="font-size: 12px; color: #64748b; margin-top: 4px;"><strong>Previous Schedule:</strong> ${escapeHtml(formattedOldSchedule)}</div>
        <div style="margin-top: 8px;"><strong>Allocated Spot:</strong> ${escapeHtml(input.workspaceDisplayName)}${input.floorName ? ` (${escapeHtml(input.floorName)})` : ''}</div>
      </div>

      <div style="text-align: center; margin: 24px 0; background-color: #f8fafc; padding: 20px; border-radius: 12px; border: 1px dashed #cbd5e1;">
        <div style="font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px;">Digital Access QR Pass</div>
        <img src="${escapeHtml(qrImageUrl)}" alt="Digital Pass QR Code" width="200" height="200" style="display: block; margin: 0 auto; border-radius: 8px; border: 1px solid #e2e8f0; background: #ffffff; padding: 6px;" />
        <div style="font-family: monospace; font-size: 15px; font-weight: 700; color: #0f172a; margin-top: 10px; margin-bottom: 4px;">${escapeHtml(input.referenceCode)}</div>
        <p style="font-size: 12px; color: #64748b; margin: 0;">Present this QR code upon arrival at the workspace reception desk or kiosk.</p>
      </div>

      ${input.trackingUrl ? `
      <p style="font-size: 13px; color: #64748b; margin-top: 16px;">
        Track Reservation: <a href="${escapeHtml(input.trackingUrl)}" style="color: #0284c7;">${escapeHtml(input.trackingUrl)}</a>
      </p>
      ` : ''}
    </div>
    <div class="footer">
      DeskAtlas Workspace Reservation System
    </div>
  </div>
</body>
</html>
  `.trim();

  const text = `
Reservation Schedule Updated - DeskAtlas
Reference: ${input.referenceCode}

Hello ${customerName},

Your reservation has been rescheduled:
New Schedule: ${formattedNewSchedule}
Previous Schedule: ${formattedOldSchedule}
Allocated Spot: ${input.workspaceDisplayName}
Digital Access QR Pass: ${qrImageUrl}
${input.trackingUrl ? `Tracking Link: ${input.trackingUrl}\n` : ''}
DeskAtlas Workspace Reservation System
  `.trim();

  return { subject, html, text };
}

export function createTransactionalEmailService(config?: ResendEmailConfig): TransactionalEmailService {
  return new TransactionalEmailService(config);
}
