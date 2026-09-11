import { AdminReservationSummary } from "../models/reservation";

export function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  const str = String(value);
  if (
    str.includes(",") ||
    str.includes('"') ||
    str.includes("\n") ||
    str.includes("\r")
  ) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function formatIsoDateOnly(isoString?: string | null): string {
  if (!isoString) return "N/A";
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return "N/A";
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  } catch {
    return "N/A";
  }
}

function formatIsoTimeOnly(isoString?: string | null): string {
  if (!isoString) return "N/A";
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return "N/A";
    const h = String(d.getUTCHours()).padStart(2, "0");
    const m = String(d.getUTCMinutes()).padStart(2, "0");
    return `${h}:${m}`;
  } catch {
    return "N/A";
  }
}

function calculateDurationHours(
  startAt?: string | null,
  endAt?: string | null
): string {
  if (!startAt || !endAt) return "N/A";
  try {
    const start = new Date(startAt).getTime();
    const end = new Date(endAt).getTime();
    if (isNaN(start) || isNaN(end) || end <= start) return "N/A";
    const hours = (end - start) / (1000 * 60 * 60);
    return Number(hours.toFixed(2)).toString();
  } catch {
    return "N/A";
  }
}

function formatIsoDateTime(isoString?: string | null): string {
  if (!isoString) return "N/A";
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return "N/A";
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    const h = String(d.getUTCHours()).padStart(2, "0");
    const min = String(d.getUTCMinutes()).padStart(2, "0");
    const s = String(d.getUTCSeconds()).padStart(2, "0");
    return `${y}-${m}-${day} ${h}:${min}:${s}`;
  } catch {
    return "N/A";
  }
}

export function generateReservationsCsv(
  reservations: AdminReservationSummary[]
): string {
  const headers = [
    "Reference ID",
    "Customer Name",
    "Customer Email",
    "Customer Phone",
    "Workspace Spot / Template",
    "Booking Date",
    "Start Time",
    "End Time",
    "Duration (Hours)",
    "Reservation Status",
    "Payment Status",
    "Payment Method",
    "Amount Due (PHP)",
    "Amount Paid (PHP)",
    "Created At",
    "Source",
  ];

  const rows = reservations.map((r) => {
    // Reference ID
    const refId = r.referenceCode || r.id;

    // Customer Name
    const custName = r.customerName || `${r.customerFirstName} ${r.customerLastName}`.trim();

    // Customer Email
    const custEmail = r.customerEmail || "N/A";

    // Customer Phone
    const custPhone = r.customerPhone || "N/A";

    // Workspace Spot / Template
    let workspaceSpot = r.workspaceDisplayName || "Unassigned";
    if (
      r.workspaceTemplateName &&
      !workspaceSpot.toLowerCase().includes(r.workspaceTemplateName.toLowerCase())
    ) {
      workspaceSpot = `${workspaceSpot} (${r.workspaceTemplateName})`;
    }

    // Booking Date & Times
    const bookingDate = formatIsoDateOnly(r.startAt || r.createdAt);
    const startTime = formatIsoTimeOnly(r.startAt);
    const endTime = formatIsoTimeOnly(r.endAt);
    const durationHours = calculateDurationHours(r.startAt, r.endAt);

    // Reservation Status
    const reservationStatus = r.reservationStatus;

    // Payment Status
    const isApproved =
      r.paymentAttemptStatus === "APPROVED" ||
      ["CONFIRMED", "CHECKED_IN", "COMPLETED"].includes(r.reservationStatus);
    const paymentStatus =
      r.paymentAttemptStatus ||
      (isApproved
        ? "APPROVED"
        : r.reservationStatus === "EXPIRED"
        ? "EXPIRED"
        : r.paymentStatus);

    // Payment Method
    const paymentMethod =
      r.paymentMethodDisplayName ||
      (r.paymentMethodType
        ? r.paymentMethodType.replace(/_/g, " ")
        : r.source === "KIOSK"
        ? "Cash / Onsite"
        : "GCash / Online");

    // Amount Due & Paid
    const amountDue = Number(r.amountDue ?? 0).toFixed(2);
    const amountPaid = (
      r.amountPaid !== undefined
        ? r.amountPaid
        : isApproved
        ? r.amountDue ?? 0
        : 0
    ).toFixed(2);

    // Created At
    const createdAt = formatIsoDateTime(r.createdAt);

    // Source
    const source = r.source === "KIOSK" ? "KIOSK" : "ONLINE";

    return [
      escapeCsvField(refId),
      escapeCsvField(custName),
      escapeCsvField(custEmail),
      escapeCsvField(custPhone),
      escapeCsvField(workspaceSpot),
      escapeCsvField(bookingDate),
      escapeCsvField(startTime),
      escapeCsvField(endTime),
      escapeCsvField(durationHours),
      escapeCsvField(reservationStatus),
      escapeCsvField(paymentStatus),
      escapeCsvField(paymentMethod),
      escapeCsvField(amountDue),
      escapeCsvField(amountPaid),
      escapeCsvField(createdAt),
      escapeCsvField(source),
    ].join(",");
  });

  // UTF-8 BOM + Header + Rows
  const csvContent = ["\uFEFF" + headers.join(","), ...rows].join("\r\n");
  return csvContent;
}

export function generateReservationsCsvFilename(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const h = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");

  return `deskatlas_reservations_${y}-${m}-${d}_${h}${min}.csv`;
}
