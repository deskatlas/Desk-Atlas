/**
 * DeskAtlas Resend Transactional Email Service
 * 
 * Provides server-side transactional email capabilities for:
 * - Payment session link dispatch
 * - Booking confirmation dispatch (with digital access QR link)
 * - Payment proof received / under review notification
 * - Payment proof rejected notification
 * - Reservation tracking link dispatch
 * - Lifecycle survey dispatch
 * - Staff invitations and account status alerts
 * - Reservation cancellation, rescheduling, relocation, and extension notifications
 */

import type { SettingsRepository } from './settingsRepository';
import type { BusinessSettings } from '../models/settings';

export interface BusinessEmailProfile {
  businessName?: string;
  contactEmail?: string;
  contactPhone?: string;
  websiteUrl?: string;
  facebookUrl?: string;
  instagramUrl?: string;
  twitterUrl?: string;
}

export interface BaseEmailBusinessFields {
  businessSettings?: BusinessEmailProfile;
  businessName?: string;
  businessEmail?: string;
  businessPhone?: string;
  contactEmail?: string;
  contactPhone?: string;
  contactNumber?: string;
  supportEmail?: string;
  websiteUrl?: string;
  facebookUrl?: string;
  instagramUrl?: string;
  twitterUrl?: string;
}

export interface ResendEmailConfig {
  apiKey?: string;
  fromEmail?: string;
  webhookUrl?: string;
  fetcher?: typeof fetch;
  businessSettings?: BusinessEmailProfile;
  settingsRepository?: SettingsRepository;
  settingsProvider?: () => Promise<BusinessSettings | BusinessEmailProfile | null | undefined>;
}

export interface EmailSendResult {
  success: boolean;
  id?: string;
  error?: string;
}

export function escapeHtml(str: string): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function resolveBusinessProfile(
  input?: BaseEmailBusinessFields,
  defaultSettings?: BusinessEmailProfile
): BusinessEmailProfile {
  const merged: BusinessEmailProfile = {
    businessName:
      input?.businessName ||
      input?.businessSettings?.businessName ||
      defaultSettings?.businessName ||
      'DeskAtlas',
    contactEmail:
      input?.contactEmail ||
      input?.businessEmail ||
      input?.supportEmail ||
      input?.businessSettings?.contactEmail ||
      defaultSettings?.contactEmail,
    contactPhone:
      input?.contactPhone ||
      input?.businessPhone ||
      input?.contactNumber ||
      input?.businessSettings?.contactPhone ||
      defaultSettings?.contactPhone,
    websiteUrl:
      input?.websiteUrl ||
      input?.businessSettings?.websiteUrl ||
      defaultSettings?.websiteUrl,
    facebookUrl:
      input?.facebookUrl ||
      input?.businessSettings?.facebookUrl ||
      defaultSettings?.facebookUrl,
    instagramUrl:
      input?.instagramUrl ||
      input?.businessSettings?.instagramUrl ||
      defaultSettings?.instagramUrl,
    twitterUrl:
      input?.twitterUrl ||
      input?.businessSettings?.twitterUrl ||
      defaultSettings?.twitterUrl,
  };
  return merged;
}

export async function getOrResolveBusinessProfile(
  input?: BaseEmailBusinessFields,
  defaultProfile?: BusinessEmailProfile
): Promise<BusinessEmailProfile> {
  const initial = resolveBusinessProfile(input, defaultProfile);
  if (
    initial.facebookUrl ||
    initial.instagramUrl ||
    initial.twitterUrl ||
    initial.websiteUrl ||
    (initial.contactEmail && initial.contactEmail !== 'support@deskatlas.com') ||
    initial.contactPhone
  ) {
    return initial;
  }

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (supabaseUrl && serviceRoleKey) {
    try {
      const endpoint = `${supabaseUrl.replace(/\/$/, '')}/rest/v1/business_settings?select=business_name,contact_email,contact_phone,facebook_url,instagram_url,twitter_url,website_url&id=eq.1&limit=1`;
      const res = await fetch(endpoint, {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
      });
      if (res.ok) {
        const rows: any = await res.json();
        if (Array.isArray(rows) && rows.length > 0) {
          const r = rows[0];
          return resolveBusinessProfile(input, {
            businessName: r.business_name || initial.businessName,
            contactEmail: r.contact_email || initial.contactEmail,
            contactPhone: r.contact_phone || initial.contactPhone,
            websiteUrl: r.website_url || initial.websiteUrl,
            facebookUrl: r.facebook_url || initial.facebookUrl,
            instagramUrl: r.instagram_url || initial.instagramUrl,
            twitterUrl: r.twitter_url || initial.twitterUrl,
          });
        }
      }
    } catch {
      // ignore
    }
  }

  return initial;
}

export function renderBusinessFooter(
  profile?: BusinessEmailProfile,
  customSuffix?: string
): string {
  const name = profile?.businessName?.trim() || 'DeskAtlas';
  const email = profile?.contactEmail?.trim();
  const phone = profile?.contactPhone?.trim();
  const website = profile?.websiteUrl?.trim();
  const facebook = profile?.facebookUrl?.trim();
  const instagram = profile?.instagramUrl?.trim();
  const twitter = profile?.twitterUrl?.trim();

  const contactItems: string[] = [];
  if (email) {
    contactItems.push(
      `<a href="mailto:${escapeHtml(email)}" style="color: #64748b; text-decoration: underline;">${escapeHtml(email)}</a>`
    );
  }
  if (phone) {
    contactItems.push(`<span>${escapeHtml(phone)}</span>`);
  }
  if (website) {
    contactItems.push(
      `<a href="${escapeHtml(website)}" style="color: #64748b; text-decoration: underline;" target="_blank" rel="noopener noreferrer">${escapeHtml(website.replace(/^https?:\/\//i, ''))}</a>`
    );
  }

  const socialLinks: string[] = [];
  if (facebook) {
    socialLinks.push(
      `<a href="${escapeHtml(facebook)}" style="color: #0284c7; text-decoration: none; font-weight: 600; margin-right: 12px;" target="_blank" rel="noopener noreferrer">Facebook</a>`
    );
  }
  if (instagram) {
    socialLinks.push(
      `<a href="${escapeHtml(instagram)}" style="color: #0284c7; text-decoration: none; font-weight: 600; margin-right: 12px;" target="_blank" rel="noopener noreferrer">Instagram</a>`
    );
  }
  if (twitter) {
    socialLinks.push(
      `<a href="${escapeHtml(twitter)}" style="color: #0284c7; text-decoration: none; font-weight: 600; margin-right: 12px;" target="_blank" rel="noopener noreferrer">Twitter / X</a>`
    );
  }

  const suffixText = customSuffix
    ? escapeHtml(customSuffix)
    : `${escapeHtml(name)} Workspace Reservation System &bull; This is an automated transactional message.`;

  return `
    <div class="footer" style="margin-top: 32px; padding-top: 20px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b; text-align: center; line-height: 1.6;">
      <div style="font-weight: 700; color: #0f172a; margin-bottom: 4px; font-size: 13px;">${escapeHtml(name)}</div>
      ${contactItems.length > 0 ? `<div style="margin-bottom: 6px; color: #64748b;">${contactItems.join(' &bull; ')}</div>` : ''}
      ${socialLinks.length > 0 ? `<div style="margin-bottom: 8px;">${socialLinks.join('')}</div>` : ''}
      <div style="color: #94a3b8; font-size: 11px;">${suffixText}</div>
    </div>
  `.trim();
}

export function renderBusinessFooterText(
  profile?: BusinessEmailProfile,
  customSuffix?: string
): string {
  const name = profile?.businessName?.trim() || 'DeskAtlas';
  const email = profile?.contactEmail?.trim();
  const phone = profile?.contactPhone?.trim();
  const website = profile?.websiteUrl?.trim();
  const facebook = profile?.facebookUrl?.trim();
  const instagram = profile?.instagramUrl?.trim();
  const twitter = profile?.twitterUrl?.trim();

  const lines: string[] = ['---', name];

  const contactParts: string[] = [];
  if (email) contactParts.push(`Email: ${email}`);
  if (phone) contactParts.push(`Phone: ${phone}`);
  if (website) contactParts.push(`Website: ${website}`);
  if (contactParts.length > 0) {
    lines.push(contactParts.join(' | '));
  }

  const socialParts: string[] = [];
  if (facebook) socialParts.push(`Facebook: ${facebook}`);
  if (instagram) socialParts.push(`Instagram: ${instagram}`);
  if (twitter) socialParts.push(`Twitter/X: ${twitter}`);
  if (socialParts.length > 0) {
    lines.push(socialParts.join(' | '));
  }

  const suffix = customSuffix || `${name} Workspace Reservation System`;
  lines.push(suffix);

  return lines.join('\n');
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

/**
 * MF-141: Formats session expiry duration in minutes into a human-readable label and session title.
 */
export function formatSessionExpiryDuration(minutes?: number | null): { label: string; sessionTitle: string } {
  const safeMinutes = typeof minutes === 'number' && !isNaN(minutes) && minutes > 0 ? Math.round(minutes) : 60;

  let label: string;
  if (safeMinutes < 60) {
    label = `${safeMinutes} minute${safeMinutes === 1 ? '' : 's'}`;
  } else if (safeMinutes % 60 === 0) {
    const hours = Math.floor(safeMinutes / 60);
    label = `${hours} hour${hours === 1 ? '' : 's'}`;
  } else {
    const hours = Math.floor(safeMinutes / 60);
    const remMinutes = safeMinutes % 60;
    label = `${hours} hour${hours === 1 ? '' : 's'} ${remMinutes} minute${remMinutes === 1 ? '' : 's'}`;
  }

  let sessionTitle: string;
  if (safeMinutes % 60 === 0) {
    const hours = Math.floor(safeMinutes / 60);
    sessionTitle = `${hours}-Hour Session`;
  } else {
    sessionTitle = `${safeMinutes}-Minute Session`;
  }

  return { label, sessionTitle };
}

export interface PaymentLinkEmailInput extends BaseEmailBusinessFields {
  to: string;
  customerFirstName?: string;
  customerLastName?: string;
  referenceCode: string;
  amountDue: number;
  currency: string;
  paymentUrl: string;
  expiresAt: string;
  expiryMinutes?: number;
  trackingUrl?: string;
  workspaceTemplateName?: string;
  bookingDate?: string;
}

// MF-141 alias for PaymentLinkEmailInput
export type PaymentProofRequestEmailInput = PaymentLinkEmailInput;

export interface BookingConfirmationEmailInput extends BaseEmailBusinessFields {
  to?: string;
  customerFirstName?: string;
  customerLastName?: string;
  referenceCode: string;
  workspaceDisplayName: string;
  workspaceTemplateName: string;
  floorName: string;
  bookingStartAt: string;
  bookingEndAt: string;
  bookingAccessUrl?: string;
  bookingToken?: string;
  qrIssuedAt?: string;
  trackingUrl?: string;
  digitalPassUrl?: string;
  termsUrl?: string;
  qrImageUrl?: string;
}

export interface ManualResolutionEmailInput extends BaseEmailBusinessFields {
  to: string;
  customerFirstName?: string;
  customerLastName?: string;
  referenceCode: string;
  trackingUrl?: string;
}

export interface PaymentProofReceivedEmailInput extends BaseEmailBusinessFields {
  to: string;
  customerFirstName?: string;
  customerLastName?: string;
  referenceCode: string;
  trackingUrl?: string;
}

export interface PaymentProofRejectedEmailInput extends BaseEmailBusinessFields {
  to: string;
  customerFirstName?: string;
  customerLastName?: string;
  referenceCode: string;
  rejectionReason?: string;
  paymentUrl?: string;
  trackingUrl?: string;
}

export interface ReservationTrackingCandidate {
  rank: number;
  workspaceDisplayName?: string;
  workspaceTemplateName?: string;
  floorName?: string;
  startAt?: string;
  endAt?: string;
}

export interface ReservationTrackingEmailInput extends BaseEmailBusinessFields {
  to?: string;
  customerFirstName?: string;
  customerLastName?: string;
  referenceCode: string;
  trackingUrl: string;
  status?: string;
  candidates?: ReservationTrackingCandidate[];
}

export interface BookingEndedSurveyEmailInput extends BaseEmailBusinessFields {
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

export interface StaffInvitationEmailInput extends BaseEmailBusinessFields {
  to: string;
  displayName: string;
  role: string;
  invitationUrl: string;
  verificationCode?: string;
  expiresAt: string;
}

export interface SuperAdminInvitationAcceptedEmailInput extends BaseEmailBusinessFields {
  to: string;
  adminName: string;
  adminEmail: string;
  role: string;
  activatedAt?: string;
  dashboardUrl?: string;
}

export interface AdminPasswordResetEmailInput extends BaseEmailBusinessFields {
  to: string;
  displayName?: string;
  resetUrl: string;
  expiresAt: string;
}

export interface ReservationCancelledEmailInput extends BaseEmailBusinessFields {
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

export interface ReservationRescheduledEmailInput extends BaseEmailBusinessFields {
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
  actorRole?: string;
}

export interface ReservationRelocatedEmailInput extends BaseEmailBusinessFields {
  to: string;
  customerFirstName?: string;
  customerLastName?: string;
  referenceCode: string;
  schedule: string;
  duration?: string;
  oldWorkspaceDisplayName: string;
  newWorkspaceDisplayName: string;
  workspaceTemplateName?: string;
  floorName?: string;
  relocationReason: string;
  relocationNotes?: string;
  bookingAccessUrl?: string;
  bookingToken?: string;
  trackingUrl?: string;
  qrImageUrl?: string;
}

export interface ReservationExtendedEmailInput extends BaseEmailBusinessFields {
  to: string;
  customerFirstName?: string;
  customerLastName?: string;
  referenceCode: string;
  previousEndAt: string;
  newEndAt: string;
  addedDurationMinutes: number;
  additionalFee: number;
  paymentMethod: string;
  currency?: string;
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

export interface TeamMemberJoinedEmailInput extends BaseEmailBusinessFields {
  to: string;
  memberName: string;
  memberEmail: string;
  role: 'ADMIN' | 'STAFF' | string;
  joinedAt?: string;
  invitedBy?: string;
  rosterUrl?: string;
}

export interface AccountStatusChangedEmailInput extends BaseEmailBusinessFields {
  to: string;
  memberName: string;
  role: 'ADMIN' | 'STAFF' | string;
  effectiveAt?: string;
  changedBy?: string;
  contactNumber?: string;
  supportEmail?: string;
  loginUrl?: string;
}

export interface RoleChangeNotificationEmailInput extends BaseEmailBusinessFields {
  to: string;
  displayName: string;
  previousRole: 'ADMIN' | 'STAFF' | string;
  newRole: 'ADMIN' | 'STAFF' | string;
  updatedByAdminName?: string;
  updatedAt?: string;
  loginUrl?: string;
  portalName?: string;
  contactNumber?: string;
  supportEmail?: string;
}

export function renderPaymentLinkEmail(input: PaymentLinkEmailInput): { subject: string; html: string; text: string } {
  const profile = resolveBusinessProfile(input);
  const customerName = [input.customerFirstName, input.customerLastName].filter(Boolean).join(' ') || 'Customer';
  const subject = `${profile.businessName || 'DeskAtlas'} Reservation Payment - Ref #${input.referenceCode}`;
  const formattedAmount = `${input.currency.toUpperCase()} ${Number(input.amountDue).toFixed(2)}`;
  const expiresFormatted = new Date(input.expiresAt).toLocaleString('en-US', {
    timeZone: 'UTC',
    dateStyle: 'medium',
    timeStyle: 'short',
    hour12: true,
  }) + ' UTC';

  let expiryMinutes = input.expiryMinutes;
  if (expiryMinutes === undefined && input.expiresAt) {
    const expiresMs = new Date(input.expiresAt).getTime();
    if (!isNaN(expiresMs)) {
      const diffMs = expiresMs - Date.now();
      const diffMinutes = Math.round(diffMs / 60000);
      if (diffMinutes > 0 && diffMinutes <= 10080) {
        expiryMinutes = diffMinutes;
      }
    }
  }
  const expiryInfo = formatSessionExpiryDuration(expiryMinutes);

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
      <div class="title">${escapeHtml(profile.businessName || 'DeskAtlas')} Reservation Payment</div>
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
        <p style="margin: 0 0 6px 0;">1. Click the button above to view official payment QR code and account details.</p>
        <p style="margin: 0 0 6px 0;">2. Open your GCash app or mobile banking to transfer the exact amount of <strong>${escapeHtml(formattedAmount)}</strong>.</p>
        <p style="margin: 0;">3. Upload a screenshot or photo of your payment receipt before the session expires.</p>
      </div>

      <p class="warning">⚠️ <strong>${escapeHtml(expiryInfo.sessionTitle)}:</strong> Payment link expires at <strong>${escapeHtml(expiresFormatted)}</strong> (${escapeHtml(expiryInfo.label)}). ${escapeHtml(profile.businessName || 'DeskAtlas')} No-Hold Policy: Submitting a reservation does not reserve physical inventory until payment proof is verified and approved by admin.</p>

      <p style="font-size: 13px; color: #64748b; margin-top: 20px;">
        If the button above does not work, copy and paste this link into your browser:<br>
        <a href="${escapeHtml(input.paymentUrl)}" style="color: #0284c7; word-break: break-all;">${escapeHtml(input.paymentUrl)}</a>
      </p>
    </div>
    ${renderBusinessFooter(profile)}
  </div>
</body>
</html>
  `.trim();

  const text = `
${profile.businessName || 'DeskAtlas'} Reservation Payment - Ref #${input.referenceCode}

Hello ${customerName},

Your workspace reservation request has been created. Please complete your payment and submit proof to secure your spot.

Amount Due: ${formattedAmount}
Payment URL: ${input.paymentUrl}

Session Expiry: ${expiresFormatted} (${expiryInfo.label})

Payment Instructions:
1. Open your GCash app or mobile banking to transfer the exact amount (${formattedAmount}).
2. Upload your payment receipt screenshot before the timer ends.

Note: Selecting a spot or submitting a request does not hold inventory. Spot allocation is finalized only after payment proof approval.

${renderBusinessFooterText(profile)}
  `.trim();

  return { subject, html, text };
}

// MF-141 alias for renderPaymentLinkEmail
export const renderPaymentProofRequestEmail = renderPaymentLinkEmail;

export function renderBookingConfirmationEmail(input: BookingConfirmationEmailInput): { subject: string; html: string; text: string } {
  const profile = resolveBusinessProfile(input);
  const customerName = [input.customerFirstName, input.customerLastName].filter(Boolean).join(' ') || 'Customer';
  const subject = `Booking Confirmed! - ${profile.businessName || 'DeskAtlas'} Ref #${input.referenceCode}`;
  const trackingUrl = normalizeCustomerTrackingUrl(input.trackingUrl);

  let customerOrigin = 'http://localhost:3001';
  if (trackingUrl) {
    try {
      customerOrigin = new URL(trackingUrl).origin;
    } catch {
      // fallback
    }
  } else if (input.bookingAccessUrl) {
    try {
      const url = new URL(input.bookingAccessUrl);
      if (url.port === '3000' || url.port === '3002' || url.port === '3003') {
        url.port = '3001';
      }
      customerOrigin = url.origin;
    } catch {
      // fallback
    }
  }

  const termsUrl = input.termsUrl || `${customerOrigin}/terms`;

  const qrImageUrl =
    input.qrImageUrl ||
    `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(
      input.bookingAccessUrl || input.bookingToken || input.referenceCode
    )}`;

  const assignedSpotText = input.workspaceTemplateName
    ? `${input.workspaceDisplayName} (${input.workspaceTemplateName})`
    : input.workspaceDisplayName;

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
    .section-title { font-size: 13px; font-weight: 700; color: #0f172a; text-transform: uppercase; letter-spacing: 0.5px; margin: 20px 0 8px 0; }
    .details-table { width: 100%; border-collapse: collapse; margin: 16px 0 24px 0; font-size: 14px; }
    .details-table td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; }
    .details-table td:first-child { color: #64748b; font-weight: 500; width: 35%; }
    .details-table td:last-child { color: #0f172a; font-weight: 600; }
    .qr-card { text-align: center; margin: 24px 0; background-color: #f8fafc; padding: 24px 20px; border-radius: 12px; border: 1px dashed #cbd5e1; }
    .qr-label { font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px; }
    .qr-code-text { font-family: monospace; font-size: 15px; font-weight: 700; color: #0f172a; margin-top: 12px; margin-bottom: 6px; }
    .qr-guide { font-size: 13px; color: #475569; margin: 8px 0 16px 0; line-height: 1.4; }
    .btn { display: inline-block; text-decoration: none; padding: 10px 22px; border-radius: 8px; font-weight: 600; font-size: 14px; margin: 4px; text-align: center; }
    .btn-primary { background-color: #15803d; color: #ffffff !important; }
    .btn-secondary { background-color: #f1f5f9; color: #0f172a !important; border: 1px solid #cbd5e1; }
    .guidelines-box { background-color: #f8fafc; border-radius: 10px; padding: 18px 20px; margin: 24px 0 16px 0; border: 1px solid #e2e8f0; }
    .guidelines-title { font-weight: 700; color: #0f172a; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 10px; }
    .guideline-p { font-size: 13px; color: #334155; margin: 8px 0; line-height: 1.5; }
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
      <p>Your workspace reservation is confirmed. Here are your booking details:</p>
      
      <div class="section-title">Booking Details</div>
      <table class="details-table">
        <tr>
          <td>Reference Code</td>
          <td><code>${escapeHtml(input.referenceCode)}</code></td>
        </tr>
        <tr>
          <td>Assigned Spot</td>
          <td>${escapeHtml(assignedSpotText)}</td>
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
        <p class="qr-guide">Please present this QR code upon arrival at the workspace reception desk or kiosk.</p>
        ${trackingUrl ? `
        <div style="margin-top: 16px;">
          <a href="${escapeHtml(trackingUrl)}" class="btn btn-primary">Track Reservation</a>
        </div>
        ` : ''}
      </div>

      <div class="guidelines-box">
        <div class="guidelines-title">Before Your Booking</div>
        <p class="guideline-p">Please use only your assigned workspace and observe the applicable booking rules during your stay.</p>
        <p class="guideline-p">If you need to relocate to another workspace, extend your booking time, or require assistance, please approach a Staff member. Relocation and extension requests are subject to workspace availability and existing reservations.</p>
        <div style="margin-top: 14px; padding-top: 10px; border-top: 1px dashed #cbd5e1;">
          <a href="${escapeHtml(termsUrl)}" style="font-size: 13px; font-weight: 600; color: #15803d; text-decoration: underline;">View Terms &amp; Conditions</a>
        </div>

        <div style="margin: 16px 0 10px 0; border-top: 1px solid #e2e8f0;"></div>
        <div style="font-weight: 700; color: #0f172a; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;">Facility Guidelines &amp; Amenities</div>
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
    ${renderBusinessFooter(profile)}
  </div>
</body>
</html>
  `.trim();

  const text = `
Booking Confirmed! - ${profile.businessName || 'DeskAtlas'} Ref #${input.referenceCode}

Hello ${customerName},

Your workspace reservation is confirmed. Here are your booking details:

Booking Details
Reference Code: ${input.referenceCode}
Assigned Spot: ${assignedSpotText}
Floor: ${input.floorName}
Start Time: ${formatEmailTime(input.bookingStartAt)}
End Time: ${formatEmailTime(input.bookingEndAt)}

Digital Access Pass
QR Code Image: ${qrImageUrl}
Please present this QR code upon arrival at the workspace reception desk or kiosk.
${trackingUrl ? `\nTrack Reservation: ${trackingUrl}\n` : ''}
Before Your Booking
Please use only your assigned workspace and observe the applicable booking rules during your stay.

If you need to relocate to another workspace, extend your booking time, or require assistance, please approach a Staff member. Relocation and extension requests are subject to workspace availability and existing reservations.

View Terms & Conditions: ${termsUrl}

Facility Guidelines:
- High-Speed WiFi credentials available at reception.
- Present your QR pass at reception or kiosk for check-in and re-entry.
- Please use designated call booths for phone calls.

${renderBusinessFooterText(profile)}
  `.trim();

  return { subject, html, text };
}

export function renderManualResolutionEmail(input: ManualResolutionEmailInput): { subject: string; html: string; text: string } {
  const profile = resolveBusinessProfile(input);
  const customerName = [input.customerFirstName, input.customerLastName].filter(Boolean).join(' ') || 'Customer';
  const businessName = profile.businessName || 'DeskAtlas';
  const businessEmail = profile.contactEmail || 'support@deskatlas.com';
  const businessPhone = profile.contactPhone;
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
        ${businessPhone ? `
        <div class="contact-item">
          <span class="contact-label">Business Phone:</span>
          <span class="contact-value">${escapeHtml(businessPhone)}</span>
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
    ${renderBusinessFooter(profile)}
  </div>
</body>
</html>
  `.trim();

  const text = `
${businessName} Reservation Update: Manual Resolution Needed
Reference: ${input.referenceCode}

Hello ${customerName},

Thank you for your payment for reservation ${input.referenceCode}.
Your payment has been received, but your requested workspace spot could not be automatically assigned and requires manual resolution.

Please contact ${businessName} directly using the registered business details:
Business Email: ${businessEmail}
${businessPhone ? `Business Phone: ${businessPhone}\n` : ''}Reference Code: ${input.referenceCode}

${input.trackingUrl ? `Track Reservation: ${input.trackingUrl}\n` : ''}
${renderBusinessFooterText(profile)}
  `.trim();

  return { subject, html, text };
}

export function renderPaymentProofReceivedEmail(input: PaymentProofReceivedEmailInput): { subject: string; html: string; text: string } {
  const profile = resolveBusinessProfile(input);
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
    ${renderBusinessFooter(profile)}
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
${renderBusinessFooterText(profile)}
  `.trim();

  return { subject, html, text };
}

export function renderPaymentProofRejectedEmail(input: PaymentProofRejectedEmailInput): { subject: string; html: string; text: string } {
  const profile = resolveBusinessProfile(input);
  const customerName = [input.customerFirstName, input.customerLastName].filter(Boolean).join(' ') || 'Customer';
  const subject = `Payment Proof Rejected - Reservation ${input.referenceCode}`;
  const reason = input.rejectionReason || 'The payment proof could not be verified by the admin team.';
  const contactEmail = profile.contactEmail;
  const contactPhone = profile.contactPhone;

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

      ${(contactEmail || contactPhone || profile.facebookUrl || profile.instagramUrl || profile.twitterUrl || profile.websiteUrl) ? `
      <div class="contact-box" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 16px 0;">
        <div style="font-weight: 700; color: #0f172a; margin-bottom: 8px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">Need Help or Have Inquiries?</div>
        <p style="margin: 0 0 10px 0; font-size: 14px; color: #334155;">If you have inquiries regarding your reservation or need assistance resubmitting payment proof, feel free to contact us:</p>
        ${contactEmail ? `
        <div style="margin: 6px 0; font-size: 14px;">
          <span style="color: #64748b; font-weight: 500;">Email:</span>
          <a href="mailto:${escapeHtml(contactEmail)}" style="color: #0284c7; text-decoration: underline; font-weight: 600; margin-left: 6px;">${escapeHtml(contactEmail)}</a>
        </div>
        ` : ''}
        ${contactPhone ? `
        <div style="margin: 6px 0; font-size: 14px;">
          <span style="color: #64748b; font-weight: 500;">Call / Text:</span>
          <a href="tel:${escapeHtml(contactPhone)}" style="color: #0f172a; font-weight: 600; text-decoration: none; margin-left: 6px;">${escapeHtml(contactPhone)}</a>
        </div>
        ` : ''}
        ${profile.facebookUrl ? `
        <div style="margin: 6px 0; font-size: 14px;">
          <span style="color: #64748b; font-weight: 500;">Facebook:</span>
          <a href="${escapeHtml(profile.facebookUrl)}" style="color: #0284c7; text-decoration: underline; font-weight: 600; margin-left: 6px;" target="_blank" rel="noopener noreferrer">Message us on Facebook</a>
        </div>
        ` : ''}
        ${profile.instagramUrl ? `
        <div style="margin: 6px 0; font-size: 14px;">
          <span style="color: #64748b; font-weight: 500;">Instagram:</span>
          <a href="${escapeHtml(profile.instagramUrl)}" style="color: #0284c7; text-decoration: underline; font-weight: 600; margin-left: 6px;" target="_blank" rel="noopener noreferrer">${escapeHtml(profile.instagramUrl)}</a>
        </div>
        ` : ''}
        ${profile.twitterUrl ? `
        <div style="margin: 6px 0; font-size: 14px;">
          <span style="color: #64748b; font-weight: 500;">Twitter / X:</span>
          <a href="${escapeHtml(profile.twitterUrl)}" style="color: #0284c7; text-decoration: underline; font-weight: 600; margin-left: 6px;" target="_blank" rel="noopener noreferrer">${escapeHtml(profile.twitterUrl)}</a>
        </div>
        ` : ''}
        ${profile.websiteUrl ? `
        <div style="margin: 6px 0; font-size: 14px;">
          <span style="color: #64748b; font-weight: 500;">Website:</span>
          <a href="${escapeHtml(profile.websiteUrl)}" style="color: #0284c7; text-decoration: underline; font-weight: 600; margin-left: 6px;" target="_blank" rel="noopener noreferrer">${escapeHtml(profile.websiteUrl.replace(/^https?:\/\//i, ''))}</a>
        </div>
        ` : ''}
      </div>
      ` : ''}

      ${input.paymentUrl ? `
      <p>If your session is still active, you may re-submit a valid payment proof using the link below:</p>
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
    ${renderBusinessFooter(profile)}
  </div>
</body>
</html>
  `.trim();

  const text = `
Payment Proof Rejected - ${profile.businessName || 'DeskAtlas'}
Reference: ${input.referenceCode}

Hello ${customerName},

Your payment proof for reservation ${input.referenceCode} could not be verified and has been rejected.

Reason: ${reason}
${input.paymentUrl ? `\nRe-submit proof (if session is active): ${input.paymentUrl}\n` : ''}${(contactEmail || contactPhone || profile.facebookUrl || profile.instagramUrl || profile.twitterUrl || profile.websiteUrl) ? `\nIf you have inquiries or need assistance resubmitting payment proof, please contact us:\n${contactEmail ? `Email: ${contactEmail}\n` : ''}${contactPhone ? `Call / Text: ${contactPhone}\n` : ''}${profile.facebookUrl ? `Facebook: ${profile.facebookUrl}\n` : ''}${profile.instagramUrl ? `Instagram: ${profile.instagramUrl}\n` : ''}${profile.twitterUrl ? `Twitter/X: ${profile.twitterUrl}\n` : ''}${profile.websiteUrl ? `Website: ${profile.websiteUrl}\n` : ''}` : ''}${input.trackingUrl ? `\nTrack Reservation: ${input.trackingUrl}\n` : ''}
${renderBusinessFooterText(profile)}
  `.trim();

  return { subject, html, text };
}

export function renderReservationTrackingEmail(input: ReservationTrackingEmailInput): { subject: string; html: string; text: string } {
  const profile = resolveBusinessProfile(input);
  const customerName = [input.customerFirstName, input.customerLastName].filter(Boolean).join(' ') || 'Customer';
  const subject = `${profile.businessName || 'DeskAtlas'} Reservation Status - Ref #${input.referenceCode}`;
  const statusLabel = input.status || 'PENDING_PAYMENT';
  const supportEmail = profile.contactEmail || 'support@deskatlas.com';

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
      <div class="title">${escapeHtml(profile.businessName || 'DeskAtlas')} Reservation Status</div>
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
    ${renderBusinessFooter(profile)}
  </div>
</body>
</html>
  `.trim();

  const text = `
${profile.businessName || 'DeskAtlas'} Reservation Status - Ref #${input.referenceCode}

Hello ${customerName},

Track the live status of your reservation here:
${input.trackingUrl}

Status: ${statusLabel}
${candidatesText ? `\n${candidatesText}\n` : ''}
Need help? Contact support at: ${supportEmail}

${renderBusinessFooterText(profile)}
  `.trim();

  return { subject, html, text };
}

export function renderBookingEndedSurveyEmail(input: BookingEndedSurveyEmailInput): { subject: string; html: string; text: string } {
  const profile = resolveBusinessProfile(input);
  const customerName = [input.customerFirstName, input.customerLastName].filter(Boolean).join(' ') || 'Customer';
  const subject = `Your ${profile.businessName || 'DeskAtlas'} Booking Has Ended — We Value Your Feedback!`;
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
      <div class="title">Thank you for visiting ${escapeHtml(profile.businessName || 'DeskAtlas')}! 🙌</div>
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

      <p>To help us continuously improve the ${escapeHtml(profile.businessName || 'DeskAtlas')} workspace experience, could you please take 1 minute to share your thoughts?</p>

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
    ${renderBusinessFooter(profile, `${escapeHtml(profile.businessName || 'DeskAtlas')} Workspace Reservation System • Customer Experience & Feedback`)}
  </div>
</body>
</html>
  `.trim();

  const text = `
Your ${profile.businessName || 'DeskAtlas'} Booking Has Ended — We Value Your Feedback!
Reference: ${input.referenceCode}

Hello ${customerName},

Thank you for working at ${profile.businessName || 'DeskAtlas'}! We hope you had a productive session.

Session Summary:
- Reference: ${input.referenceCode}
${input.workspaceDisplayName ? `- Workspace: ${input.workspaceDisplayName}\n` : ''}${input.bookingStartAt ? `- Start Time: ${formatEmailTime(input.bookingStartAt)}\n` : ''}${input.bookingEndAt ? `- End Time: ${formatEmailTime(input.bookingEndAt)}\n` : ''}
Please take a minute to share your feedback with us:
Survey Link: ${surveyUrl}

Ready to book another workspace? Visit:
${bookAgainUrl}

${renderBusinessFooterText(profile)}
  `.trim();

  return { subject, html, text };
}

export function renderStaffInvitationEmail(input: StaffInvitationEmailInput): { subject: string; html: string; text: string } {
  const profile = resolveBusinessProfile(input);
  const businessName = profile.businessName || 'DeskAtlas';
  const subject = `You've been invited to join ${businessName} as ${input.role === 'ADMIN' ? 'an Administrator' : 'Staff'}`;
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
      <div class="brand">${escapeHtml(businessName)}</div>
      <span class="badge">Team Invitation</span>
    </div>
    <div class="content">
      <div class="title">Welcome to ${escapeHtml(businessName)}!</div>
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
    ${renderBusinessFooter(profile, `${escapeHtml(businessName)} Workspace Reservation System • Automated Staff Onboarding`)}
  </div>
</body>
</html>
  `.trim();

  const text = `
${businessName} Team Invitation

Hello ${input.displayName},

You have been invited to join the ${businessName} team as a ${roleLabel}.

To finalize and activate your account, visit the link below:
${input.invitationUrl}

Two-Factor Authentication (2FA) Notice:
For security reasons, your 2FA verification code is not included in this email.
Please ask your workspace owner or administrator for your 6-digit 2FA confirmation code.

This invitation expires on ${expiresFormatted}.

${renderBusinessFooterText(profile, `${businessName} Workspace Reservation System • Automated Staff Onboarding`)}
  `.trim();

  return { subject, html, text };
}

export function renderSuperAdminInvitationAcceptedEmail(input: SuperAdminInvitationAcceptedEmailInput): { subject: string; html: string; text: string } {
  const profile = resolveBusinessProfile(input);
  const businessName = profile.businessName || 'DeskAtlas';
  const isAdmin = input.role.toUpperCase() === 'ADMIN';
  const subject = `New Administrator Joined: ${input.adminName}`;
  const dashboardUrl = input.dashboardUrl || 'http://localhost:3000/manage/staff';
  const activatedFormatted = input.activatedAt
    ? new Date(input.activatedAt).toLocaleString('en-US', {
        timeZone: 'Asia/Manila',
        dateStyle: 'medium',
        timeStyle: 'short',
        hour12: true,
      })
    : new Date().toLocaleString('en-US', {
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
    .info-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0; font-size: 14px; }
    .info-row { margin: 6px 0; }
    .info-label { color: #64748b; font-weight: 600; display: inline-block; width: 120px; }
    .btn { display: inline-block; background: linear-gradient(180deg, #064E3B 0%, #043629 100%); color: #ffffff !important; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 700; font-size: 15px; margin: 18px 0; text-align: center; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #f1f5f9; font-size: 12px; color: #94a3b8; text-align: center; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="brand">${escapeHtml(businessName)}</div>
      <span class="badge">Team Notification</span>
    </div>
    <div class="content">
      <div class="title">New ${isAdmin ? 'Administrator' : 'Staff Member'} Joined</div>
      <p>Hello Super Administrator,</p>
      <p><strong>${escapeHtml(input.adminName)}</strong> (<code>${escapeHtml(input.adminEmail)}</code>) has accepted your invitation and successfully activated their ${isAdmin ? 'administrator' : 'staff'} account.</p>
      
      <div class="info-box">
        <div class="info-row"><span class="info-label">Name:</span> <strong>${escapeHtml(input.adminName)}</strong></div>
        <div class="info-row"><span class="info-label">Email:</span> <strong>${escapeHtml(input.adminEmail)}</strong></div>
        <div class="info-row"><span class="info-label">Role:</span> <strong>${escapeHtml(input.role)}</strong></div>
        <div class="info-row"><span class="info-label">Activated:</span> ${escapeHtml(activatedFormatted)}</div>
      </div>

      <div style="text-align: center;">
        <a href="${escapeHtml(dashboardUrl)}" class="btn">View Staff &amp; Admins</a>
      </div>
    </div>
    ${renderBusinessFooter(profile, `${escapeHtml(businessName)} Workspace Reservation System • Team Management Alert`)}
  </div>
</body>
</html>
  `.trim();

  const text = `
${businessName} Notification: New ${isAdmin ? 'Administrator' : 'Staff Member'} Joined

Hello Super Administrator,

${input.adminName} (${input.adminEmail}) has accepted your invitation and activated their ${isAdmin ? 'administrator' : 'staff'} account.

Name: ${input.adminName}
Email: ${input.adminEmail}
Role: ${input.role}
Activated: ${activatedFormatted}

View in dashboard: ${dashboardUrl}

${renderBusinessFooterText(profile, `${businessName} Workspace Reservation System • Team Management Alert`)}
  `.trim();

  return { subject, html, text };
}

export function renderAdminPasswordResetEmail(input: AdminPasswordResetEmailInput): { subject: string; html: string; text: string } {
  const profile = resolveBusinessProfile(input);
  const businessName = profile.businessName || 'DeskAtlas';
  const subject = `Reset Your ${businessName} Admin Password`;
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
      <div class="brand">${escapeHtml(businessName)}</div>
      <span class="badge">Security Recovery</span>
    </div>
    <div class="content">
      <div class="title">Reset Your Password</div>
      <p>Hello <strong>${escapeHtml(name)}</strong>,</p>
      <p>We received a request to reset the password for your ${escapeHtml(businessName)} administrative account.</p>
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
    ${renderBusinessFooter(profile, `${escapeHtml(businessName)} Workspace Reservation System • Administrative Security Alert`)}
  </div>
</body>
</html>
  `.trim();

  const text = `
${businessName} Admin Password Reset

Hello ${name},

We received a request to reset the password for your ${businessName} administrative account.

To reset your password, visit the link below:
${input.resetUrl}

This link expires on ${expiresFormatted} (1 hour).

If you did not request this, please ignore this email.

${renderBusinessFooterText(profile, `${businessName} Workspace Reservation System • Administrative Security Alert`)}
  `.trim();

  return { subject, html, text };
}

export function renderReservationCancelledEmail(input: ReservationCancelledEmailInput): { subject: string; html: string; text: string } {
  const profile = resolveBusinessProfile(input);
  const customerName = [input.customerFirstName, input.customerLastName].filter(Boolean).join(' ') || 'Customer';
  const subject = `Your ${profile.businessName || 'DeskAtlas'} Reservation Has Been Cancelled [${input.referenceCode}]`;
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
    ${renderBusinessFooter(profile)}
  </div>
</body>
</html>
  `.trim();

  const text = `
Reservation Cancellation Notice - ${profile.businessName || 'DeskAtlas'}
Reference: ${input.referenceCode}

Hello ${customerName},

Your workspace reservation ${input.referenceCode} has been cancelled.

Reason: ${reasonText}
${input.workspaceDisplayName ? `Workspace: ${input.workspaceDisplayName}\n` : ''}${formattedSchedule ? `Original Schedule: ${formattedSchedule}\n` : ''}${input.trackingUrl ? `Status Link: ${input.trackingUrl}\n` : ''}
${renderBusinessFooterText(profile)}
  `.trim();

  return { subject, html, text };
}

export function renderReservationRescheduledEmail(input: ReservationRescheduledEmailInput): { subject: string; html: string; text: string } {
  const profile = resolveBusinessProfile(input);
  const customerName = [input.customerFirstName, input.customerLastName].filter(Boolean).join(' ') || 'Customer';
  const subject = `Your ${profile.businessName || 'DeskAtlas'} Reservation Has Been Rescheduled [${input.referenceCode}]`;
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
      <p>Your workspace reservation <strong>${escapeHtml(input.referenceCode)}</strong> has been ${input.actorRole === 'CUSTOMER' ? 'successfully rescheduled upon your request' : 'rescheduled by the administration'}.</p>
      
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
    ${renderBusinessFooter(profile)}
  </div>
</body>
</html>
  `.trim();

  const text = `
Reservation Schedule Updated - ${profile.businessName || 'DeskAtlas'}
Reference: ${input.referenceCode}

Hello ${customerName},

Your reservation has been rescheduled:
New Schedule: ${formattedNewSchedule}
Previous Schedule: ${formattedOldSchedule}
Allocated Spot: ${input.workspaceDisplayName}
Digital Access QR Pass: ${qrImageUrl}
${input.trackingUrl ? `Tracking Link: ${input.trackingUrl}\n` : ''}
${renderBusinessFooterText(profile)}
  `.trim();

  return { subject, html, text };
}

export function renderReservationRelocatedEmail(input: ReservationRelocatedEmailInput): { subject: string; html: string; text: string } {
  const profile = resolveBusinessProfile(input);
  const customerName = [input.customerFirstName, input.customerLastName].filter(Boolean).join(' ') || 'Customer';
  const subject = `Your ${profile.businessName || 'DeskAtlas'} Reservation Spot Has Been Relocated [${input.referenceCode}]`;
  const formattedSchedule = formatEmailSchedule(input.schedule);
  const reasonText = input.relocationNotes ? `${input.relocationReason} - ${input.relocationNotes}` : input.relocationReason;
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
    .card { background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; max-width: 560px; margin: 0 auto; padding: 32px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); }
    .header { margin-bottom: 20px; border-bottom: 1px solid #f1f5f9; padding-bottom: 16px; }
    .title { font-size: 18px; font-weight: 700; color: #0284c7; margin: 0 0 6px 0; }
    .content { font-size: 15px; line-height: 1.6; color: #334155; }
    .relocate-box { background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; margin: 18px 0; }
    .transaction-box { background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 18px 0; font-size: 13px; }
    .reason-box { background-color: #fffbeb; border-left: 4px solid #f59e0b; padding: 12px 16px; margin: 16px 0; border-radius: 4px; font-size: 14px; color: #92400e; }
    .qr-box { text-align: center; margin: 24px 0; background-color: #f8fafc; padding: 20px; border-radius: 12px; border: 1px dashed #cbd5e1; }
    .btn { display: inline-block; background-color: #0284c7; color: #ffffff !important; text-decoration: none; padding: 10px 22px; border-radius: 8px; font-weight: 600; font-size: 14px; margin: 16px 0; text-align: center; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #f1f5f9; font-size: 12px; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="title">Workspace Spot Relocation Notice</div>
      <div style="font-size: 13px; color: #64748b;">Reference: <strong>${escapeHtml(input.referenceCode)}</strong></div>
    </div>
    <div class="content">
      <p>Hello ${escapeHtml(customerName)},</p>
      <p>Your workspace reservation <strong>${escapeHtml(input.referenceCode)}</strong> has been relocated to a new conflict-free spot for your exact scheduled time slot.</p>
      
      <div class="reason-box">
        <strong>Reason for Relocation:</strong><br>
        ${escapeHtml(reasonText)}
      </div>

      <div class="relocate-box">
        <div style="font-size: 12px; font-weight: 700; color: #166534; text-transform: uppercase; margin-bottom: 8px;">Updated Spot Assignment</div>
        <div style="font-size: 15px; font-weight: 700; color: #0f172a; margin-bottom: 6px;">
          <strong>New Spot:</strong> ${escapeHtml(input.newWorkspaceDisplayName)}${input.workspaceTemplateName ? ` (${escapeHtml(input.workspaceTemplateName)})` : ''}${input.floorName ? ` &bull; ${escapeHtml(input.floorName)}` : ''}
        </div>
        <div style="font-size: 13px; color: #64748b;">
          <strong>Previous Spot:</strong> ${escapeHtml(input.oldWorkspaceDisplayName)}
        </div>
        <div style="font-size: 13px; color: #334155; margin-top: 8px; padding-top: 8px; border-top: 1px dashed #bbf7d0;">
          <strong>Preserved Schedule:</strong> ${escapeHtml(formattedSchedule)}${input.duration ? ` (${escapeHtml(input.duration)})` : ''}
        </div>
      </div>

      <div class="transaction-box">
        <div style="font-size: 12px; font-weight: 700; color: #475569; text-transform: uppercase; margin-bottom: 8px;">Relocation Transaction Summary</div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
          <span style="color: #64748b;">Transaction Type:</span>
          <strong style="color: #0f172a;">Spot Relocation</strong>
        </div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
          <span style="color: #64748b;">Booking Reference:</span>
          <strong style="color: #0f172a;">${escapeHtml(input.referenceCode)}</strong>
        </div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
          <span style="color: #64748b;">New Assigned Spot:</span>
          <strong style="color: #0f172a;">${escapeHtml(input.newWorkspaceDisplayName)}</strong>
        </div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
          <span style="color: #64748b;">Previous Spot:</span>
          <span style="color: #64748b;">${escapeHtml(input.oldWorkspaceDisplayName)}</span>
        </div>
        ${input.workspaceTemplateName ? `
        <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
          <span style="color: #64748b;">Workspace Tier:</span>
          <strong style="color: #0f172a;">${escapeHtml(input.workspaceTemplateName)}</strong>
        </div>
        ` : ''}
        ${input.floorName ? `
        <div style="display: flex; justify-content: space-between;">
          <span style="color: #64748b;">Floor / Zone:</span>
          <strong style="color: #0f172a;">${escapeHtml(input.floorName)}</strong>
        </div>
        ` : ''}
      </div>

      <div class="qr-box">
        <div style="font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px;">Digital Access QR Pass</div>
        <img src="${escapeHtml(qrImageUrl)}" alt="Digital Pass QR Code" width="200" height="200" style="display: block; margin: 0 auto; border-radius: 8px; border: 1px solid #e2e8f0; background: #ffffff; padding: 6px;" />
        <div style="font-family: monospace; font-size: 15px; font-weight: 700; color: #0f172a; margin-top: 10px; margin-bottom: 4px;">${escapeHtml(input.referenceCode)}</div>
        <p style="font-size: 12px; color: #166534; font-weight: 600; margin: 6px 0 0 0;">
          Your existing digital QR pass remains active and valid for your newly relocated spot.
        </p>
        <p style="font-size: 12px; color: #64748b; margin: 4px 0 0 0;">
          Present this QR code upon arrival at the workspace reception desk or kiosk for entry and re-entry.
        </p>
      </div>

      ${input.trackingUrl ? `
      <div style="text-align: center; margin: 20px 0;">
        <a href="${escapeHtml(input.trackingUrl)}" class="btn">View Reservation & Digital Pass</a>
      </div>
      <p style="font-size: 13px; color: #64748b; margin-top: 8px; text-align: center;">
        Direct link: <a href="${escapeHtml(input.trackingUrl)}" style="color: #0284c7;">${escapeHtml(input.trackingUrl)}</a>
      </p>
      ` : ''}
    </div>
    ${renderBusinessFooter(profile)}
  </div>
</body>
</html>
  `.trim();

  const text = `
Workspace Spot Relocation Notice - ${profile.businessName || 'DeskAtlas'}
Reference: ${input.referenceCode}

Hello ${customerName},

Your workspace reservation has been relocated:
Transaction: Spot Relocation
New Spot: ${input.newWorkspaceDisplayName}${input.workspaceTemplateName ? ` (${input.workspaceTemplateName})` : ''}${input.floorName ? ` - ${input.floorName}` : ''}
Previous Spot: ${input.oldWorkspaceDisplayName}
Schedule: ${formattedSchedule}${input.duration ? ` (${input.duration})` : ''}
Reason: ${reasonText}

Digital Access QR Pass: ${qrImageUrl}
Your existing digital QR pass remains active and valid for your newly relocated spot.

${input.trackingUrl ? `Track Reservation: ${input.trackingUrl}\n` : ''}
${renderBusinessFooterText(profile)}
  `.trim();

  return { subject, html, text };
}

export function formatDurationMinutes(minutes: number): string {
  if (minutes <= 0) return '0 mins';
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours > 0 && remainingMinutes > 0) {
    return `${hours} hr${hours > 1 ? 's' : ''} ${remainingMinutes} min${remainingMinutes > 1 ? 's' : ''}`;
  }
  if (hours > 0) {
    return `${hours} hour${hours > 1 ? 's' : ''}`;
  }
  return `${remainingMinutes} minute${remainingMinutes > 1 ? 's' : ''}`;
}

export function formatDurationFromDates(startAt: string, endAt: string): string {
  const startMs = new Date(startAt).getTime();
  const endMs = new Date(endAt).getTime();
  if (isNaN(startMs) || isNaN(endMs) || endMs <= startMs) return '';
  const diffMinutes = Math.round((endMs - startMs) / (1000 * 60));
  return formatDurationMinutes(diffMinutes);
}

export function renderReservationExtendedEmail(input: ReservationExtendedEmailInput): { subject: string; html: string; text: string } {
  const profile = resolveBusinessProfile(input);
  const customerName = [input.customerFirstName, input.customerLastName].filter(Boolean).join(' ') || 'Customer';
  const subject = `Your ${profile.businessName || 'DeskAtlas'} Reservation Has Been Extended [${input.referenceCode}]`;
  const formattedNewEnd = formatEmailTime(input.newEndAt);
  const formattedPrevEnd = formatEmailTime(input.previousEndAt);
  const durationLabel = formatDurationMinutes(input.addedDurationMinutes);
  const currencySymbol = input.currency || 'PHP';
  const formattedFee = `${currencySymbol === 'PHP' ? '₱' : `${currencySymbol} `}${Number(input.additionalFee || 0).toFixed(2)}`;
  const paymentMethodLabel = input.paymentMethod || 'Cash';
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
    .card { background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; max-width: 560px; margin: 0 auto; padding: 32px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); }
    .header { margin-bottom: 20px; border-bottom: 1px solid #f1f5f9; padding-bottom: 16px; }
    .title { font-size: 18px; font-weight: 700; color: #0284c7; margin: 0 0 6px 0; }
    .content { font-size: 15px; line-height: 1.6; color: #334155; }
    .summary-box { background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; margin: 18px 0; }
    .payment-box { background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 18px 0; }
    .qr-box { text-align: center; margin: 24px 0; background-color: #f8fafc; padding: 20px; border-radius: 12px; border: 1px dashed #cbd5e1; }
    .btn { display: inline-block; background-color: #0284c7; color: #ffffff !important; text-decoration: none; padding: 10px 22px; border-radius: 8px; font-weight: 600; font-size: 14px; margin: 16px 0; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #f1f5f9; font-size: 12px; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="title">Reservation Time Extended</div>
      <div style="font-size: 13px; color: #64748b;">Reference: <strong>${escapeHtml(input.referenceCode)}</strong></div>
    </div>
    <div class="content">
      <p>Hello ${escapeHtml(customerName)},</p>
      <p>Your request to extend your workspace reservation has been approved!</p>
      
      <div class="summary-box">
        <div style="font-size: 12px; font-weight: 700; color: #166534; text-transform: uppercase; margin-bottom: 8px;">Updated Schedule Details</div>
        <div style="font-size: 15px; font-weight: 700; color: #0f172a; margin-bottom: 6px;">
          <strong>New Extended End Time:</strong> ${escapeHtml(formattedNewEnd)}
        </div>
        <div style="font-size: 13px; color: #64748b;">
          <strong>Previous End Time:</strong> ${escapeHtml(formattedPrevEnd)}
        </div>
        <div style="font-size: 13px; color: #166534; margin-top: 4px;">
          <strong>Added Duration:</strong> +${escapeHtml(durationLabel)}
        </div>
        <div style="font-size: 13px; color: #334155; margin-top: 8px; padding-top: 8px; border-top: 1px dashed #bbf7d0;">
          <strong>Allocated Spot:</strong> ${escapeHtml(input.workspaceDisplayName)}${input.workspaceTemplateName ? ` (${escapeHtml(input.workspaceTemplateName)})` : ''}${input.floorName ? ` &bull; ${escapeHtml(input.floorName)}` : ''}
        </div>
      </div>

      <div class="payment-box">
        <div style="font-size: 12px; font-weight: 700; color: #475569; text-transform: uppercase; margin-bottom: 8px;">Extension Transaction Details</div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
          <span style="color: #64748b;">Additional Charge:</span>
          <strong style="color: #0f172a;">${escapeHtml(formattedFee)}</strong>
        </div>
        <div style="display: flex; justify-content: space-between;">
          <span style="color: #64748b;">Payment Method:</span>
          <strong style="color: #0f172a;">${escapeHtml(paymentMethodLabel)}</strong>
        </div>
      </div>

      <div class="qr-box">
        <div style="font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px;">Digital Access QR Pass</div>
        <img src="${escapeHtml(qrImageUrl)}" alt="Digital Pass QR Code" width="200" height="200" style="display: block; margin: 0 auto; border-radius: 8px; border: 1px solid #e2e8f0; background: #ffffff; padding: 6px;" />
        <div style="font-family: monospace; font-size: 15px; font-weight: 700; color: #0f172a; margin-top: 10px; margin-bottom: 4px;">${escapeHtml(input.referenceCode)}</div>
        <p style="font-size: 12px; color: #166534; font-weight: 600; margin: 6px 0 0 0;">
          ✓ Your existing QR pass remains valid and active through your new extended time (${escapeHtml(formattedNewEnd)}).
        </p>
        <p style="font-size: 12px; color: #64748b; margin: 4px 0 0 0;">
          You can continue using this same QR code for entry and re-entry.
        </p>
      </div>

      ${input.trackingUrl ? `
      <div style="text-align: center;">
        <a href="${escapeHtml(input.trackingUrl)}" class="btn">View Reservation Status</a>
      </div>
      <p style="font-size: 13px; color: #64748b; margin-top: 16px; text-align: center;">
        Track Reservation: <a href="${escapeHtml(input.trackingUrl)}" style="color: #0284c7;">${escapeHtml(input.trackingUrl)}</a>
      </p>
      ` : ''}
    </div>
    ${renderBusinessFooter(profile)}
  </div>
</body>
</html>
  `.trim();

  const text = `
Reservation Time Extended - ${profile.businessName || 'DeskAtlas'}
Reference: ${input.referenceCode}

Hello ${customerName},

Your request to extend your workspace reservation has been approved!

Updated Schedule Details:
- New End Time: ${formattedNewEnd}
- Previous End Time: ${formattedPrevEnd}
- Added Duration: +${durationLabel}
- Allocated Spot: ${input.workspaceDisplayName}${input.workspaceTemplateName ? ` (${input.workspaceTemplateName})` : ''}

Transaction Details:
- Additional Charge: ${formattedFee}
- Payment Method: ${paymentMethodLabel}

Digital Access QR Pass:
Your existing QR pass remains active and valid through your new extended time (${formattedNewEnd}). No new pass is needed.
QR Pass: ${qrImageUrl}

${input.trackingUrl ? `Tracking Link: ${input.trackingUrl}\n` : ''}
${renderBusinessFooterText(profile)}
  `.trim();

  return { subject, html, text };
}

export function renderTeamMemberJoinedEmail(input: TeamMemberJoinedEmailInput): { subject: string; html: string; text: string } {
  const profile = resolveBusinessProfile(input);
  const businessName = profile.businessName || 'DeskAtlas';
  const isRoleAdmin = input.role.toUpperCase() === 'ADMIN';
  const roleLabel = isRoleAdmin ? 'Admin' : 'Staff';
  const subject = `[${businessName}] New Team Member Joined: ${input.memberName} (${roleLabel})`;
  const rosterUrl = input.rosterUrl || 'http://localhost:3000/manage/staff';
  const joinedFormatted = input.joinedAt
    ? formatEmailTime(input.joinedAt)
    : new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Manila',
        dateStyle: 'medium',
        timeStyle: 'short',
        hour12: true,
      }).format(new Date());

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
    .info-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0; font-size: 14px; }
    .info-row { margin: 6px 0; }
    .info-label { color: #64748b; font-weight: 600; display: inline-block; width: 130px; }
    .btn { display: inline-block; background: linear-gradient(180deg, #064E3B 0%, #043629 100%); color: #ffffff !important; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 700; font-size: 15px; margin: 18px 0; text-align: center; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #f1f5f9; font-size: 12px; color: #94a3b8; text-align: center; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="brand">${escapeHtml(businessName)}</div>
      <span class="badge">Team Notification</span>
    </div>
    <div class="content">
      <div class="title">New Team Member Joined</div>
      <p>Hello Administrator,</p>
      <p>A new team member has joined ${escapeHtml(businessName)}:</p>
      
      <div class="info-box">
        <div class="info-row"><span class="info-label">Full Name:</span> <strong>${escapeHtml(input.memberName)}</strong></div>
        <div class="info-row"><span class="info-label">Email Address:</span> <strong>${escapeHtml(input.memberEmail)}</strong></div>
        <div class="info-row"><span class="info-label">Assigned Role:</span> <strong>${escapeHtml(roleLabel)}</strong></div>
        <div class="info-row"><span class="info-label">Joined:</span> ${escapeHtml(joinedFormatted)}</div>
        ${input.invitedBy ? `<div class="info-row"><span class="info-label">Invited By:</span> ${escapeHtml(input.invitedBy)}</div>` : ''}
      </div>

      <div style="text-align: center;">
        <a href="${escapeHtml(rosterUrl)}" class="btn">View Team Roster</a>
      </div>
    </div>
    ${renderBusinessFooter(profile, `${escapeHtml(businessName)} Workspace Reservation System • Team Management Alert`)}
  </div>
</body>
</html>
  `.trim();

  const text = `
${businessName} Notification: New Team Member Joined

A new team member has joined ${businessName}:

Full Name: ${input.memberName}
Email Address: ${input.memberEmail}
Assigned Role: ${roleLabel}
Joined: ${joinedFormatted}
${input.invitedBy ? `Invited By: ${input.invitedBy}\n` : ''}
View Team Roster: ${rosterUrl}

${renderBusinessFooterText(profile, `${businessName} Workspace Reservation System • Team Management Alert`)}
  `.trim();

  return { subject, html, text };
}

export function renderAccountDeactivatedEmail(input: AccountStatusChangedEmailInput): { subject: string; html: string; text: string } {
  const profile = resolveBusinessProfile(input);
  const businessName = profile.businessName || 'DeskAtlas';
  const isRoleAdmin = input.role.toUpperCase() === 'ADMIN';
  const roleLabel = isRoleAdmin ? 'Admin' : 'Staff';
  const subject = `[${businessName}] Notice: Your Account Has Been Deactivated`;
  const firstName = input.memberName.trim().split(' ')[0] || input.memberName;
  const effectiveFormatted = input.effectiveAt
    ? formatEmailTime(input.effectiveAt)
    : new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Manila',
        dateStyle: 'medium',
        timeStyle: 'short',
        hour12: true,
      }).format(new Date());

  const supportEmail = profile.contactEmail || input.supportEmail || 'support@deskatlas.com';
  const contactNumber = profile.contactPhone || input.contactNumber || '+63 2 8123 4567';

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
    .title { font-size: 22px; font-weight: 800; color: #dc2626; margin: 16px 0 8px 0; }
    .badge { display: inline-block; background-color: #fee2e2; color: #991b1b; padding: 4px 10px; border-radius: 6px; font-size: 12px; font-weight: 700; text-transform: uppercase; }
    .content { font-size: 15px; line-height: 1.6; color: #334155; }
    .info-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0; font-size: 14px; }
    .info-row { margin: 6px 0; }
    .info-label { color: #64748b; font-weight: 600; display: inline-block; width: 130px; }
    .alert-box { background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin: 20px 0; font-size: 14px; color: #991b1b; line-height: 1.5; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #f1f5f9; font-size: 12px; color: #94a3b8; text-align: center; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="brand">${escapeHtml(businessName)}</div>
      <span class="badge">Notice</span>
    </div>
    <div class="content">
      <div class="title">Account Deactivated</div>
      <p>Hello ${escapeHtml(firstName)},</p>
      <p>Your ${escapeHtml(businessName)} ${escapeHtml(roleLabel)} account has been deactivated by an administrator effective immediately.</p>
      
      <div class="info-box">
        <div class="info-row"><span class="info-label">Account Name:</span> <strong>${escapeHtml(input.memberName)}</strong></div>
        <div class="info-row"><span class="info-label">Account Role:</span> <strong>${escapeHtml(roleLabel)}</strong></div>
        <div class="info-row"><span class="info-label">Effective Date:</span> ${escapeHtml(effectiveFormatted)}</div>
      </div>

      <div class="alert-box">
        <strong>Security Notice:</strong> Your active sessions have been terminated and you will no longer be able to access the management portal.
      </div>

      <p>If you believe this was done in error or need assistance, please contact management support:</p>
      <div class="info-box">
        <div class="info-row"><span class="info-label">Admin Email:</span> <a href="mailto:${escapeHtml(supportEmail)}" style="color: #0284c7;">${escapeHtml(supportEmail)}</a></div>
        <div class="info-row"><span class="info-label">Contact Number:</span> <strong>${escapeHtml(contactNumber)}</strong></div>
      </div>
    </div>
    ${renderBusinessFooter(profile, `${escapeHtml(businessName)} Workspace Reservation System • Administrative Notification`)}
  </div>
</body>
</html>
  `.trim();

  const text = `
Notice: Your ${businessName} Account Has Been Deactivated

Hello ${firstName},

Your ${businessName} ${roleLabel} account has been deactivated by an administrator effective immediately.

Account Details:
- Name: ${input.memberName}
- Role: ${roleLabel}
- Effective Date: ${effectiveFormatted}

Security Notice:
Your active sessions have been terminated and you will no longer be able to access the management portal.

Support Contact Details:
- Admin Email: ${supportEmail}
- Contact Number: ${contactNumber}

${renderBusinessFooterText(profile, `${businessName} Workspace Reservation System • Administrative Notification`)}
  `.trim();

  return { subject, html, text };
}

export function renderAccountReactivatedEmail(input: AccountStatusChangedEmailInput): { subject: string; html: string; text: string } {
  const profile = resolveBusinessProfile(input);
  const businessName = profile.businessName || 'DeskAtlas';
  const isRoleAdmin = input.role.toUpperCase() === 'ADMIN';
  const roleLabel = isRoleAdmin ? 'Admin' : 'Staff';
  const subject = `[${businessName}] Your Account Has Been Reactivated`;
  const firstName = input.memberName.trim().split(' ')[0] || input.memberName;
  const effectiveFormatted = input.effectiveAt
    ? formatEmailTime(input.effectiveAt)
    : new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Manila',
        dateStyle: 'medium',
        timeStyle: 'short',
        hour12: true,
      }).format(new Date());

  const loginUrl = input.loginUrl || 'http://localhost:3000/manage/login';

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
    .title { font-size: 22px; font-weight: 800; color: #064e3b; margin: 16px 0 8px 0; }
    .badge { display: inline-block; background-color: #d1fae5; color: #065f46; padding: 4px 10px; border-radius: 6px; font-size: 12px; font-weight: 700; text-transform: uppercase; }
    .content { font-size: 15px; line-height: 1.6; color: #334155; }
    .info-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0; font-size: 14px; }
    .info-row { margin: 6px 0; }
    .info-label { color: #64748b; font-weight: 600; display: inline-block; width: 130px; }
    .btn { display: inline-block; background: linear-gradient(180deg, #064E3B 0%, #043629 100%); color: #ffffff !important; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 700; font-size: 15px; margin: 18px 0; text-align: center; }
    .guidance-box { background-color: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 14px; margin: 20px 0; font-size: 14px; color: #0369a1; line-height: 1.5; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #f1f5f9; font-size: 12px; color: #94a3b8; text-align: center; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="brand">${escapeHtml(businessName)}</div>
      <span class="badge">Reactivated</span>
    </div>
    <div class="content">
      <div class="title">Account Reactivated</div>
      <p>Hello ${escapeHtml(firstName)},</p>
      <p>Your ${escapeHtml(businessName)} ${escapeHtml(roleLabel)} account access has been restored.</p>
      
      <div class="info-box">
        <div class="info-row"><span class="info-label">Account Name:</span> <strong>${escapeHtml(input.memberName)}</strong></div>
        <div class="info-row"><span class="info-label">Account Role:</span> <strong>${escapeHtml(roleLabel)}</strong></div>
        <div class="info-row"><span class="info-label">Effective Date:</span> ${escapeHtml(effectiveFormatted)}</div>
      </div>

      <div style="text-align: center;">
        <a href="${escapeHtml(loginUrl)}" class="btn">Sign In to ${escapeHtml(businessName)}</a>
      </div>

      <div class="guidance-box">
        <strong>Forgot your password?</strong> You can use the "Forgot Password" link on the sign-in page to reset your credentials.
      </div>
    </div>
    ${renderBusinessFooter(profile, `${escapeHtml(businessName)} Workspace Reservation System • Administrative Notification`)}
  </div>
</body>
</html>
  `.trim();

  const text = `
Your ${businessName} Account Has Been Reactivated

Hello ${firstName},

Your ${businessName} ${roleLabel} account access has been restored.

Account Details:
- Name: ${input.memberName}
- Role: ${roleLabel}
- Effective Date: ${effectiveFormatted}

Sign In: ${loginUrl}

Forgot your password? You can use the "Forgot Password" link on the sign-in page to reset your credentials.

${renderBusinessFooterText(profile, `${businessName} Workspace Reservation System • Administrative Notification`)}
  `.trim();

  return { subject, html, text };
}

export function renderRoleChangeNotificationEmail(input: RoleChangeNotificationEmailInput): { subject: string; html: string; text: string } {
  const profile = resolveBusinessProfile(input);
  const businessName = profile.businessName || 'DeskAtlas';
  const isNewRoleAdmin = String(input.newRole).toUpperCase() === 'ADMIN';
  const isPrevRoleAdmin = String(input.previousRole).toUpperCase() === 'ADMIN';
  const newRoleLabel = isNewRoleAdmin ? 'Admin' : 'Staff';
  const prevRoleLabel = isPrevRoleAdmin ? 'Admin' : 'Staff';
  const subject = `[${businessName}] Account Update: Your Role is Now ${newRoleLabel}`;
  const firstName = input.displayName ? (input.displayName.trim().split(' ')[0] || input.displayName) : 'Team Member';
  const updatedFormatted = input.updatedAt
    ? formatEmailTime(input.updatedAt)
    : new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Manila',
        dateStyle: 'medium',
        timeStyle: 'short',
        hour12: true,
      }).format(new Date());

  const supportEmail = profile.contactEmail || input.supportEmail || 'support@deskatlas.com';
  const contactNumber = profile.contactPhone || input.contactNumber || '+63 2 8123 4567';

  const defaultPortalName = isNewRoleAdmin ? 'Admin Portal' : 'Staff Dashboard';
  const defaultLoginUrl = isNewRoleAdmin ? 'http://localhost:3000/manage/login' : 'http://localhost:3002/manage';
  const portalName = input.portalName || defaultPortalName;
  const loginUrl = input.loginUrl || defaultLoginUrl;

  const roleDescription = isNewRoleAdmin
    ? 'As an Administrator, you now have access to administrative management, workspace map design, financial reports, reservation overrides, and staff roster oversight.'
    : 'As a Staff Member, you now have access to front-desk operations, check-in and check-out management, scanner tools, floor map overview, and kiosk payment confirmations.';

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
    .badge { display: inline-block; background-color: #e0f2fe; color: #0369a1; padding: 4px 10px; border-radius: 6px; font-size: 12px; font-weight: 700; text-transform: uppercase; }
    .content { font-size: 15px; line-height: 1.6; color: #334155; }
    .info-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0; font-size: 14px; }
    .info-row { margin: 6px 0; }
    .info-label { color: #64748b; font-weight: 600; display: inline-block; width: 140px; }
    .btn { display: inline-block; background: linear-gradient(180deg, #064E3B 0%, #043629 100%); color: #ffffff !important; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 700; font-size: 15px; margin: 18px 0; text-align: center; }
    .guidance-box { background-color: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 14px; margin: 20px 0; font-size: 14px; color: #0369a1; line-height: 1.5; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #f1f5f9; font-size: 12px; color: #94a3b8; text-align: center; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="brand">${escapeHtml(businessName)}</div>
      <span class="badge">Role Updated</span>
    </div>
    <div class="content">
      <div class="title">Account Role Updated</div>
      <p>Hello ${escapeHtml(input.displayName || firstName)},</p>
      <p>Your ${escapeHtml(businessName)} account role has been updated from <strong>${escapeHtml(prevRoleLabel)}</strong> to <strong>${escapeHtml(newRoleLabel)}</strong>.</p>
      
      <div class="info-box">
        <div class="info-row"><span class="info-label">Account Name:</span> <strong>${escapeHtml(input.displayName)}</strong></div>
        <div class="info-row"><span class="info-label">Previous Role:</span> <strong>${escapeHtml(prevRoleLabel)}</strong></div>
        <div class="info-row"><span class="info-label">New Role:</span> <strong>${escapeHtml(newRoleLabel)}</strong></div>
        ${input.updatedByAdminName ? `<div class="info-row"><span class="info-label">Updated By:</span> <strong>${escapeHtml(input.updatedByAdminName)}</strong></div>` : ''}
        <div class="info-row"><span class="info-label">Effective Date:</span> ${escapeHtml(updatedFormatted)}</div>
      </div>

      <div class="guidance-box">
        <strong>${escapeHtml(portalName)} Access:</strong><br />
        ${escapeHtml(roleDescription)}
      </div>

      <div style="text-align: center;">
        <a href="${escapeHtml(loginUrl)}" class="btn">Sign In to ${escapeHtml(portalName)}</a>
      </div>

      <p style="font-size: 13px; color: #64748b; margin-top: 16px; text-align: center;">
        Direct Login Link: <a href="${escapeHtml(loginUrl)}" style="color: #0284c7;">${escapeHtml(loginUrl)}</a>
      </p>

      <p style="font-size: 13px; color: #64748b; margin-top: 20px;">
        If you have questions about your permissions or believe this was done in error, please contact management:
      </p>
      <div class="info-box">
        <div class="info-row"><span class="info-label">Admin Email:</span> <a href="mailto:${escapeHtml(supportEmail)}" style="color: #0284c7;">${escapeHtml(supportEmail)}</a></div>
        <div class="info-row"><span class="info-label">Contact Number:</span> <strong>${escapeHtml(contactNumber)}</strong></div>
      </div>
    </div>
    ${renderBusinessFooter(profile, `${escapeHtml(businessName)} Workspace Reservation System • Administrative Notification`)}
  </div>
</body>
</html>
  `.trim();

  const text = `
Account Role Updated - ${businessName}

Hello ${input.displayName || firstName},

Your ${businessName} account role has been updated from ${prevRoleLabel} to ${newRoleLabel}.

Account Details:
- Name: ${input.displayName}
- Previous Role: ${prevRoleLabel}
- New Role: ${newRoleLabel}
${input.updatedByAdminName ? `- Updated By: ${input.updatedByAdminName}\n` : ''}- Effective Date: ${updatedFormatted}

${portalName} Access:
${roleDescription}

Sign In to ${portalName}:
${loginUrl}

Support Contact Details:
- Admin Email: ${supportEmail}
- Contact Number: ${contactNumber}

${renderBusinessFooterText(profile, `${businessName} Workspace Reservation System • Administrative Notification`)}
  `.trim();

  return { subject, html, text };
}

export class TransactionalEmailService {
  private readonly apiKey?: string;
  private readonly fromEmail: string;
  private readonly webhookUrl?: string;
  private readonly fetcher: typeof fetch;
  private readonly defaultBusinessSettings?: BusinessEmailProfile;
  private readonly settingsRepository?: SettingsRepository;
  private readonly settingsProvider?: () => Promise<BusinessSettings | BusinessEmailProfile | null | undefined>;
  private cachedSettings?: BusinessEmailProfile;

  constructor(config?: ResendEmailConfig) {
    this.apiKey = config?.apiKey ?? process.env.RESEND_API_KEY;
    this.fromEmail = config?.fromEmail ?? process.env.RESEND_FROM_EMAIL ?? 'DeskAtlas <noreply@deskatlas.com>';
    this.webhookUrl = config?.webhookUrl ?? process.env.TRANSACTIONAL_EMAIL_WEBHOOK_URL;
    this.fetcher = config?.fetcher ?? fetch;
    this.defaultBusinessSettings = config?.businessSettings;
    this.settingsRepository = config?.settingsRepository;
    this.settingsProvider = config?.settingsProvider;
  }

  private async fetchBusinessSettings(): Promise<BusinessEmailProfile | null> {
    if (this.cachedSettings) {
      return this.cachedSettings;
    }
    if (this.settingsProvider) {
      try {
        const res = await this.settingsProvider();
        if (res) {
          this.cachedSettings = {
            businessName: res.businessName || (res as any).business_name || undefined,
            contactEmail: res.contactEmail || (res as any).contact_email || undefined,
            contactPhone: res.contactPhone || (res as any).contact_phone || undefined,
            websiteUrl: res.websiteUrl || (res as any).website_url || undefined,
            facebookUrl: res.facebookUrl || (res as any).facebook_url || undefined,
            instagramUrl: res.instagramUrl || (res as any).instagram_url || undefined,
            twitterUrl: res.twitterUrl || (res as any).twitter_url || undefined,
          };
          return this.cachedSettings;
        }
      } catch {
        // ignore
      }
    }
    if (this.settingsRepository) {
      try {
        const res = await this.settingsRepository.getBusinessSettings();
        if (res) {
          this.cachedSettings = {
            businessName: res.businessName,
            contactEmail: res.contactEmail || undefined,
            contactPhone: res.contactPhone || undefined,
            websiteUrl: res.websiteUrl || undefined,
            facebookUrl: res.facebookUrl || undefined,
            instagramUrl: res.instagramUrl || undefined,
            twitterUrl: res.twitterUrl || undefined,
          };
          return this.cachedSettings;
        }
      } catch {
        // ignore
      }
    }

    const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (supabaseUrl && serviceRoleKey) {
      try {
        const endpoint = `${supabaseUrl.replace(/\/$/, '')}/rest/v1/business_settings?select=business_name,contact_email,contact_phone,facebook_url,instagram_url,twitter_url,website_url&id=eq.1&limit=1`;
        const res = await this.fetcher(endpoint, {
          headers: {
            apikey: serviceRoleKey,
            Authorization: `Bearer ${serviceRoleKey}`,
          },
        });
        if (res.ok) {
          const rows: any = await res.json();
          if (Array.isArray(rows) && rows.length > 0) {
            const r = rows[0];
            this.cachedSettings = {
              businessName: r.business_name || undefined,
              contactEmail: r.contact_email || undefined,
              contactPhone: r.contact_phone || undefined,
              websiteUrl: r.website_url || undefined,
              facebookUrl: r.facebook_url || undefined,
              instagramUrl: r.instagram_url || undefined,
              twitterUrl: r.twitter_url || undefined,
            };
            return this.cachedSettings;
          }
        }
      } catch {
        // ignore
      }
    }

    return null;
  }

  private async resolveProfile(input?: BaseEmailBusinessFields): Promise<BusinessEmailProfile> {
    let profile = resolveBusinessProfile(input, this.defaultBusinessSettings);
    if (
      !profile.facebookUrl &&
      !profile.instagramUrl &&
      !profile.twitterUrl &&
      !profile.websiteUrl &&
      (!profile.contactEmail || profile.contactEmail === 'support@deskatlas.com') &&
      !profile.contactPhone
    ) {
      const fetched = await this.fetchBusinessSettings();
      if (fetched) {
        profile = resolveBusinessProfile(input, {
          businessName: fetched.businessName || profile.businessName,
          contactEmail: fetched.contactEmail || profile.contactEmail,
          contactPhone: fetched.contactPhone || profile.contactPhone,
          websiteUrl: fetched.websiteUrl || profile.websiteUrl,
          facebookUrl: fetched.facebookUrl || profile.facebookUrl,
          instagramUrl: fetched.instagramUrl || profile.instagramUrl,
          twitterUrl: fetched.twitterUrl || profile.twitterUrl,
        });
      }
    }
    return profile;
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
    const resolvedProfile = await this.resolveProfile(input);
    const mergedInput: PaymentLinkEmailInput = {
      ...input,
      businessSettings: resolvedProfile,
    };
    const rendered = renderPaymentLinkEmail(mergedInput);

    if (!this.apiKey && this.webhookUrl) {
      try {
        await this.fetcher(this.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            template: 'payment-session',
            ...mergedInput,
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

  async sendPaymentProofRequestEmail(input: PaymentProofRequestEmailInput): Promise<EmailSendResult> {
    return this.sendPaymentLinkEmail(input);
  }

  async sendBookingConfirmationEmail(input: BookingConfirmationEmailInput): Promise<EmailSendResult> {
    const resolvedProfile = await this.resolveProfile(input);
    const mergedInput: BookingConfirmationEmailInput = {
      ...input,
      businessSettings: resolvedProfile,
    };
    const rendered = renderBookingConfirmationEmail(mergedInput);

    if (!this.apiKey && this.webhookUrl) {
      try {
        await this.fetcher(this.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            template: 'booking-confirmed',
            ...mergedInput,
          }),
        });
        return { success: true, id: 'webhook-booking-confirmed' };
      } catch (err: any) {
        console.warn('[TransactionalEmail] Booking confirmed webhook dispatch error:', err.message);
      }
    }

    return this.sendEmail({
      to: input.to || '',
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  }

  async sendManualResolutionEmail(input: ManualResolutionEmailInput): Promise<EmailSendResult> {
    const resolvedProfile = await this.resolveProfile(input);
    const mergedInput: ManualResolutionEmailInput = {
      ...input,
      businessSettings: resolvedProfile,
    };
    const rendered = renderManualResolutionEmail(mergedInput);

    if (!this.apiKey && this.webhookUrl) {
      try {
        await this.fetcher(this.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            template: 'manual-resolution',
            ...mergedInput,
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
    const resolvedProfile = await this.resolveProfile(input);
    const mergedInput: PaymentProofReceivedEmailInput = {
      ...input,
      businessSettings: resolvedProfile,
    };
    const rendered = renderPaymentProofReceivedEmail(mergedInput);
    return this.sendEmail({
      to: input.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  }

  async sendPaymentProofSubmittedEmail(input: PaymentProofReceivedEmailInput): Promise<EmailSendResult> {
    return this.sendPaymentProofReceivedEmail(input);
  }

  async sendPaymentProofRejectedEmail(input: PaymentProofRejectedEmailInput): Promise<EmailSendResult> {
    const resolvedProfile = await this.resolveProfile(input);
    const mergedInput: PaymentProofRejectedEmailInput = {
      ...input,
      businessSettings: resolvedProfile,
    };
    const rendered = renderPaymentProofRejectedEmail(mergedInput);
    return this.sendEmail({
      to: input.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  }

  async sendPaymentRejectionEmail(input: PaymentProofRejectedEmailInput): Promise<EmailSendResult> {
    return this.sendPaymentProofRejectedEmail(input);
  }

  async sendReservationTrackingEmail(input: ReservationTrackingEmailInput): Promise<EmailSendResult> {
    const resolvedProfile = await this.resolveProfile(input);
    const mergedInput: ReservationTrackingEmailInput = {
      ...input,
      businessSettings: resolvedProfile,
    };
    const rendered = renderReservationTrackingEmail(mergedInput);
    return this.sendEmail({
      to: input.to || '',
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  }

  async sendStaffInvitationEmail(input: StaffInvitationEmailInput): Promise<EmailSendResult> {
    const resolvedProfile = await this.resolveProfile(input);
    const mergedInput: StaffInvitationEmailInput = {
      ...input,
      businessSettings: resolvedProfile,
    };
    const rendered = renderStaffInvitationEmail(mergedInput);
    return this.sendEmail({
      to: input.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  }

  async sendSuperAdminInvitationAcceptedEmail(input: SuperAdminInvitationAcceptedEmailInput): Promise<EmailSendResult> {
    const resolvedProfile = await this.resolveProfile(input);
    const mergedInput: SuperAdminInvitationAcceptedEmailInput = {
      ...input,
      businessSettings: resolvedProfile,
    };
    const rendered = renderSuperAdminInvitationAcceptedEmail(mergedInput);
    return this.sendEmail({
      to: input.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  }

  async sendAdminPasswordResetEmail(input: AdminPasswordResetEmailInput): Promise<EmailSendResult> {
    const resolvedProfile = await this.resolveProfile(input);
    const mergedInput: AdminPasswordResetEmailInput = {
      ...input,
      businessSettings: resolvedProfile,
    };
    const rendered = renderAdminPasswordResetEmail(mergedInput);
    return this.sendEmail({
      to: input.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  }

  async sendReservationCancelledEmail(input: ReservationCancelledEmailInput): Promise<EmailSendResult> {
    const resolvedProfile = await this.resolveProfile(input);
    const mergedInput: ReservationCancelledEmailInput = {
      ...input,
      businessSettings: resolvedProfile,
    };
    const rendered = renderReservationCancelledEmail(mergedInput);
    return this.sendEmail({
      to: input.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  }

  async sendReservationCancellationEmail(input: ReservationCancelledEmailInput): Promise<EmailSendResult> {
    return this.sendReservationCancelledEmail(input);
  }

  async sendReservationRescheduledEmail(input: ReservationRescheduledEmailInput): Promise<EmailSendResult> {
    const resolvedProfile = await this.resolveProfile(input);
    const mergedInput: ReservationRescheduledEmailInput = {
      ...input,
      businessSettings: resolvedProfile,
    };
    const rendered = renderReservationRescheduledEmail(mergedInput);
    return this.sendEmail({
      to: input.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  }

  async sendReservationRelocatedEmail(input: ReservationRelocatedEmailInput): Promise<EmailSendResult> {
    const resolvedProfile = await this.resolveProfile(input);
    const mergedInput: ReservationRelocatedEmailInput = {
      ...input,
      businessSettings: resolvedProfile,
    };
    const rendered = renderReservationRelocatedEmail(mergedInput);
    return this.sendEmail({
      to: input.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  }

  async sendReservationRelocationEmail(input: ReservationRelocatedEmailInput): Promise<EmailSendResult> {
    return this.sendReservationRelocatedEmail(input);
  }

  async sendReservationExtendedEmail(input: ReservationExtendedEmailInput): Promise<EmailSendResult> {
    const resolvedProfile = await this.resolveProfile(input);
    const mergedInput: ReservationExtendedEmailInput = {
      ...input,
      businessSettings: resolvedProfile,
    };
    const rendered = renderReservationExtendedEmail(mergedInput);
    return this.sendEmail({
      to: input.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  }

  async sendReservationTimeExtensionEmail(input: ReservationExtendedEmailInput): Promise<EmailSendResult> {
    return this.sendReservationExtendedEmail(input);
  }

  async sendBookingEndedSurveyEmail(input: BookingEndedSurveyEmailInput): Promise<EmailSendResult> {
    const resolvedProfile = await this.resolveProfile(input);
    const mergedInput: BookingEndedSurveyEmailInput = {
      ...input,
      businessSettings: resolvedProfile,
    };
    const rendered = renderBookingEndedSurveyEmail(mergedInput);
    return this.sendEmail({
      to: input.to || '',
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  }

  async sendSurveyEmail(input: BookingEndedSurveyEmailInput): Promise<EmailSendResult> {
    return this.sendBookingEndedSurveyEmail(input);
  }

  async sendTeamMemberJoinedEmail(input: TeamMemberJoinedEmailInput): Promise<EmailSendResult> {
    const resolvedProfile = await this.resolveProfile(input);
    const mergedInput: TeamMemberJoinedEmailInput = {
      ...input,
      businessSettings: resolvedProfile,
    };
    const rendered = renderTeamMemberJoinedEmail(mergedInput);
    return this.sendEmail({
      to: input.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  }

  async sendAccountDeactivatedEmail(input: AccountStatusChangedEmailInput): Promise<EmailSendResult> {
    const resolvedProfile = await this.resolveProfile(input);
    const mergedInput: AccountStatusChangedEmailInput = {
      ...input,
      businessSettings: resolvedProfile,
    };
    const rendered = renderAccountDeactivatedEmail(mergedInput);
    return this.sendEmail({
      to: input.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  }

  async sendAccountReactivatedEmail(input: AccountStatusChangedEmailInput): Promise<EmailSendResult> {
    const resolvedProfile = await this.resolveProfile(input);
    const mergedInput: AccountStatusChangedEmailInput = {
      ...input,
      businessSettings: resolvedProfile,
    };
    const rendered = renderAccountReactivatedEmail(mergedInput);
    return this.sendEmail({
      to: input.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  }

  async sendRoleChangeNotificationEmail(input: RoleChangeNotificationEmailInput): Promise<EmailSendResult> {
    const resolvedProfile = await this.resolveProfile(input);
    const mergedInput: RoleChangeNotificationEmailInput = {
      ...input,
      businessSettings: resolvedProfile,
    };
    const rendered = renderRoleChangeNotificationEmail(mergedInput);
    return this.sendEmail({
      to: input.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  }

  async sendClosureImpactNotice(input: ClosureImpactNoticeEmailInput): Promise<EmailSendResult> {
    const resolvedProfile = await this.resolveProfile(input);
    const mergedInput: ClosureImpactNoticeEmailInput = {
      ...input,
      businessSettings: resolvedProfile,
    };
    const rendered = renderClosureImpactNoticeEmail(mergedInput);
    return this.sendEmail({
      to: input.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  }
}

export interface ClosureImpactNoticeEmailInput extends BaseEmailBusinessFields {
  to: string;
  customerName: string;
  customerFirstName?: string;
  customerLastName?: string;
  referenceCode: string;
  closureDate: string;
  closureEndDate?: string | null;
  closureReason?: string | null;
  workspaceDisplayName?: string;
  workspaceName?: string;
  workspaceTemplateName?: string;
  floorName?: string;
  startAt?: string;
  endAt?: string;
  schedule?: string;
  trackingUrl?: string;
  selfServiceUrl?: string;
  supportPhone?: string;
}

export function renderClosureImpactNoticeEmail(input: ClosureImpactNoticeEmailInput): { subject: string; html: string; text: string } {
  const profile = resolveBusinessProfile(input);
  const businessName = profile.businessName || 'DeskAtlas';
  const customerName = input.customerName || [input.customerFirstName, input.customerLastName].filter(Boolean).join(' ') || 'Valued Guest';
  const subject = `Important Notice: Your ${businessName} Reservation [${input.referenceCode}] is Affected by a Facility Closure`;
  const reasonText = input.closureReason ? input.closureReason.trim() : 'Scheduled Facility Closure / Maintenance';

  const closurePeriod = input.closureEndDate && input.closureEndDate !== input.closureDate
    ? `${input.closureDate} to ${input.closureEndDate}`
    : input.closureDate;

  const trackingLink = input.trackingUrl || `http://localhost:3001/track?code=${encodeURIComponent(input.referenceCode)}&remedy=closure`;
  const scheduleFormatted = input.schedule || (input.startAt && input.endAt ? `${formatEmailTime(input.startAt)} to ${formatEmailTime(input.endAt)}` : 'Booked Time Slot');

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b; margin: 0; padding: 24px; }
    .card { background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; max-width: 560px; margin: 0 auto; padding: 32px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); }
    .header { margin-bottom: 20px; border-bottom: 1px solid #f1f5f9; padding-bottom: 16px; }
    .title { font-size: 18px; font-weight: 700; color: #d97706; margin: 0 0 6px 0; }
    .content { font-size: 15px; line-height: 1.6; color: #334155; }
    .alert-box { background-color: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 16px; margin: 18px 0; color: #92400e; }
    .details-box { background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 18px 0; }
    .btn { display: inline-block; background-color: #d97706; color: #ffffff !important; text-decoration: none; padding: 12px 26px; border-radius: 8px; font-weight: 700; font-size: 14px; margin: 16px 0; text-align: center; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #f1f5f9; font-size: 12px; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="title">Facility Closure Notice: Action Required</div>
      <div style="font-size: 13px; color: #64748b;">Reference: <strong>${escapeHtml(input.referenceCode)}</strong></div>
    </div>
    <div class="content">
      <p>Hello ${escapeHtml(customerName)},</p>
      <p>We are reaching out to inform you that <strong>${escapeHtml(businessName)}</strong> will be closed or operating under special hours during your upcoming reservation window.</p>
      
      <div class="alert-box">
        <div style="font-weight: 700; font-size: 14px; margin-bottom: 4px;">Closure Information</div>
        <div><strong>Date(s):</strong> ${escapeHtml(closurePeriod)}</div>
        <div><strong>Reason:</strong> ${escapeHtml(reasonText)}</div>
      </div>

      <div class="details-box">
        <div style="font-weight: 700; font-size: 12px; color: #64748b; text-transform: uppercase; margin-bottom: 8px;">Your Affected Reservation</div>
        <div><strong>Reserved Workspace:</strong> ${escapeHtml(input.workspaceDisplayName || 'Workspace Desk')}${input.workspaceTemplateName ? ` (${escapeHtml(input.workspaceTemplateName)})` : ''}</div>
        <div><strong>Scheduled Time:</strong> ${escapeHtml(scheduleFormatted)}</div>
      </div>

      <p><strong>Next Steps & Self-Service Remedy:</strong></p>
      <p>You can relocate to an available workspace on another open floor or reschedule your reservation to any alternative open date without any cutoff restrictions or additional penalty fees.</p>

      <div style="text-align: center;">
        <a href="${escapeHtml(trackingLink)}" class="btn">Relocate or Reschedule Reservation</a>
      </div>

      <p style="font-size: 13px; color: #64748b; text-align: center;">
        Or access directly at: <a href="${escapeHtml(trackingLink)}" style="color: #d97706;">${escapeHtml(trackingLink)}</a>
      </p>

      <p style="font-size: 13px; color: #64748b;">
        If you need assistance, our front-desk team will also reach out to help coordinate your booking or arrange a full refund or credit.
      </p>
    </div>
    ${renderBusinessFooter(profile)}
  </div>
</body>
</html>
  `.trim();

  const text = `
Facility Closure Notice: Action Required - ${businessName}
Reference: ${input.referenceCode}

Hello ${customerName},

We are reaching out to inform you that ${businessName} will be closed or operating under special hours during your upcoming reservation window.

Closure Information:
- Date(s): ${closurePeriod}
- Reason: ${reasonText}

Your Affected Reservation:
- Reserved Workspace: ${input.workspaceDisplayName || 'Workspace Desk'}${input.workspaceTemplateName ? ` (${input.workspaceTemplateName})` : ''}
- Scheduled Time: ${scheduleFormatted}

Next Steps & Self-Service Remedy:
You can relocate to an available workspace on another open floor or reschedule your reservation to any alternative open date without any cutoff restrictions or additional penalty fees.

Relocate or Reschedule:
${trackingLink}

If you need assistance, our front-desk team will also reach out to help coordinate your booking or arrange a full refund or credit.

${renderBusinessFooterText(profile)}
  `.trim();

  return { subject, html, text };
}

export function createTransactionalEmailService(config?: ResendEmailConfig): TransactionalEmailService {
  return new TransactionalEmailService(config);
}

