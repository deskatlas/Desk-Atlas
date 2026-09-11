import ExcelJS from "exceljs";
import {
  AdminFrequentBookerSummary,
  AdminReportExportType,
  AdminReportRange,
  AdminReportsSnapshot,
  AdminTopWorkspaceSummary,
  ReportPaymentAttemptRecord,
  ReportReservationRecord,
} from "../models/reports";
import {
  generateRevenueTrendChartPng,
  generateStatusBreakdownChartPng,
  generateWorkspaceUtilizationChartPng,
} from "./chartRenderer";

// DeskAtlas Palette Constants (Hex without # for ExcelJS ARGB)
const COLORS = {
  BRAND_DARK: "FF0C3B27", // #0C3B27
  BRAND_ACCENT: "FFC8F451", // #C8F451
  CANVAS: "FFF3F7F4", // #F3F7F4
  INFO_SOFT: "FFE0EFE4", // #E0EFE4
  WHITE: "FFFFFFFF",
  TEXT_PRIMARY: "FF12251A", // #12251A
  TEXT_SECONDARY: "FF65736A", // #65736A
  BORDER: "FFDCE6DF", // #DCE6DF
  ZEBRA_ROW: "FFF8FAF9",
  SUCCESS_BG: "FFDCFCE7",
  SUCCESS_FG: "FF166534",
  WARNING_BG: "FFFEF3C7",
  WARNING_FG: "FF92400E",
  DANGER_BG: "FFFEE2E2",
  DANGER_FG: "FF991B1B",
  CARD_BG: "FFF0F7F2",
};

const FONT_NAME = "Segoe UI";

export async function buildAdminExcelWorkbook(params: {
  exportType: AdminReportExportType;
  range?: AdminReportRange;
  snapshot: AdminReportsSnapshot;
  reservations: ReportReservationRecord[];
  payments: ReportPaymentAttemptRecord[];
  now: Date;
}): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "DeskAtlas Management System";
  workbook.lastModifiedBy = "DeskAtlas Automated Engine";
  workbook.created = params.now;
  workbook.modified = params.now;

  const { exportType, snapshot, reservations, payments, now, range } = params;

  if (exportType === "operations-summary") {
    // 1. Executive Dashboard Sheet
    await buildExecutiveDashboardSheet(workbook, snapshot, reservations, now, range);

    // 2. Dedicated Data Sheets
    buildReservationsSheet(workbook, reservations);
    buildPaymentsSheet(workbook, payments);
    buildWorkspaceSheet(workbook, reservations);
    buildCheckinSheet(workbook, reservations);
    buildCancellationSheet(workbook, reservations, payments);
  } else {
    // Focused Category Export
    switch (exportType) {
      case "reservations":
      case "booking-activity":
        await buildFocusedCategorySheet(workbook, "Reservations & Booking Activity", reservations, payments, snapshot, "reservations");
        break;
      case "payment":
        await buildFocusedCategorySheet(workbook, "Payment Records & Revenue", reservations, payments, snapshot, "payment");
        break;
      case "workspace":
        await buildFocusedCategorySheet(workbook, "Workspace Utilization", reservations, payments, snapshot, "workspace");
        break;
      case "checkin":
        await buildFocusedCategorySheet(workbook, "Check-in & Check-out Records", reservations, payments, snapshot, "checkin");
        break;
      case "cancellation":
        await buildFocusedCategorySheet(workbook, "Cancellations & Resolutions", reservations, payments, snapshot, "cancellation");
        break;
      default:
        buildReservationsSheet(workbook, reservations);
        break;
    }
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Builds the primary Executive Dashboard sheet with KPI scorecards, charts, and leaderboards.
 */
async function buildExecutiveDashboardSheet(
  workbook: ExcelJS.Workbook,
  snapshot: AdminReportsSnapshot,
  reservations: ReportReservationRecord[],
  now: Date,
  range?: AdminReportRange
) {
  const sheet = workbook.addWorksheet("Executive Dashboard", {
    views: [{ showGridLines: true }],
  });

  // Column Widths
  sheet.columns = [
    { width: 4 },  // A (padding)
    { width: 22 }, // B
    { width: 22 }, // C
    { width: 22 }, // D
    { width: 22 }, // E
    { width: 22 }, // F
    { width: 22 }, // G
    { width: 24 }, // H
    { width: 4 },  // I (padding)
  ];

  // 1. Executive Branded Banner (Rows 2 to 4)
  sheet.mergeCells("B2:H4");
  const headerCell = sheet.getCell("B2");
  headerCell.value = {
    richText: [
      { text: "DESKATLAS  ", font: { name: FONT_NAME, size: 16, bold: true, color: { argb: COLORS.BRAND_ACCENT } } },
      { text: "EXECUTIVE OPERATIONS & ANALYTICS REPORT\n", font: { name: FONT_NAME, size: 15, bold: true, color: { argb: COLORS.WHITE } } },
      { text: `Period: ${snapshot.rangeLabel}  •  Generated: ${now.toISOString().replace("T", " ").slice(0, 19)} UTC  •  System: LIVE DATABASE`, font: { name: FONT_NAME, size: 9, color: { argb: COLORS.INFO_SOFT } } },
    ],
  };
  headerCell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: COLORS.BRAND_DARK },
  };
  headerCell.alignment = { vertical: "middle", horizontal: "left", indent: 1, wrapText: true };
  applyCardBorder(sheet, "B2:H4", COLORS.BRAND_DARK);

  // 2. KPI Summary Metric Scorecard (Row 6 to 8)
  const metrics = snapshot.summaryMetrics;
  const cardRanges = [
    { titleCol: "B", endCol: "C", metric: metrics[0] },
    { titleCol: "D", endCol: "E", metric: metrics[1] },
    { titleCol: "F", endCol: "F", metric: metrics[2] },
    { titleCol: "G", endCol: "H", metric: metrics[3] },
  ];

  cardRanges.forEach(({ titleCol, endCol, metric }) => {
    if (!metric) return;
    const rangeStr = `${titleCol}6:${endCol}8`;
    sheet.mergeCells(rangeStr);
    const cardCell = sheet.getCell(`${titleCol}6`);

    const isPositive = metric.positive !== false;
    const trendColor = isPositive ? COLORS.SUCCESS_FG : COLORS.WARNING_FG;

    cardCell.value = {
      richText: [
        { text: `${metric.label.toUpperCase()}\n`, font: { name: FONT_NAME, size: 8.5, bold: true, color: { argb: COLORS.TEXT_SECONDARY } } },
        { text: `${metric.value}\n`, font: { name: FONT_NAME, size: 18, bold: true, color: { argb: COLORS.BRAND_DARK } } },
        { text: `● ${metric.trend}`, font: { name: FONT_NAME, size: 8, bold: true, color: { argb: trendColor } } },
      ],
    };
    cardCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: COLORS.CARD_BG },
    };
    cardCell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    applyCardBorder(sheet, rangeStr, COLORS.BORDER);
  });

  // 3. Render Visual Chart Images & Embed into Worksheet
  // A. Revenue Trend Chart Image
  const revenueChartPng = generateRevenueTrendChartPng({
    bars: snapshot.revenueOverview.bars,
    currency: snapshot.revenueOverview.currency,
    totalFormatted: snapshot.revenueOverview.formattedTotalAmount,
    width: 720,
    height: 310,
  });
  const revenueImageId = workbook.addImage({
    buffer: revenueChartPng as unknown as ExcelJS.Buffer,
    extension: "png",
  });
  sheet.addImage(revenueImageId, {
    tl: { col: 1, row: 9 }, // B10
    ext: { width: 440, height: 215 },
  });

  // B. Status Breakdown Chart Image
  const confirmedCount = reservations.filter((r) => ["CONFIRMED", "CHECKED_IN", "COMPLETED"].includes(r.reservationStatus)).length;
  const checkedInCount = reservations.filter((r) => r.reservationStatus === "CHECKED_IN").length;
  const completedCount = reservations.filter((r) => r.reservationStatus === "COMPLETED").length;
  const cancelledCount = reservations.filter((r) => r.reservationStatus === "CANCELLED").length;
  const manualCount = reservations.filter((r) => r.reservationStatus === "NEEDS_MANUAL_RESOLUTION").length;

  const statusChartPng = generateStatusBreakdownChartPng({
    confirmed: confirmedCount,
    checkedIn: checkedInCount,
    completed: completedCount,
    cancelled: cancelledCount,
    manualResolution: manualCount,
    width: 720,
    height: 310,
  });
  const statusImageId = workbook.addImage({
    buffer: statusChartPng as unknown as ExcelJS.Buffer,
    extension: "png",
  });
  sheet.addImage(statusImageId, {
    tl: { col: 4.8, row: 9 }, // F10
    ext: { width: 440, height: 215 },
  });

  // 4. Top Workspaces Table (Starting at Row 22)
  const startRow = 22;
  sheet.mergeCells(`B${startRow}:E${startRow}`);
  const topWsHeader = sheet.getCell(`B${startRow}`);
  topWsHeader.value = "TOP PERFORMING WORKSPACES";
  styleSectionHeader(topWsHeader);

  // Table Columns
  const wsTableCols = ["B", "C", "D", "E"];
  const wsHeaders = ["Workspace Name", "Tier / Template", "Floor", "Total Bookings"];
  wsHeaders.forEach((h, i) => {
    const cell = sheet.getCell(`${wsTableCols[i]}${startRow + 1}`);
    cell.value = h;
    styleTableHeaderCell(cell);
  });

  let curWsRow = startRow + 2;
  if (snapshot.topWorkspaces.length > 0) {
    snapshot.topWorkspaces.forEach((ws, idx) => {
      sheet.getCell(`B${curWsRow}`).value = ws.name;
      sheet.getCell(`C${curWsRow}`).value = ws.templateName;
      sheet.getCell(`D${curWsRow}`).value = ws.floorName;
      const countCell = sheet.getCell(`E${curWsRow}`);
      countCell.value = ws.reservationCount;
      countCell.numFmt = "#,##0";
      countCell.alignment = { horizontal: "center" };

      styleTableRow(sheet, `B${curWsRow}:E${curWsRow}`, idx % 2 === 1);
      curWsRow++;
    });
  } else {
    sheet.mergeCells(`B${curWsRow}:E${curWsRow}`);
    const emptyCell = sheet.getCell(`B${curWsRow}`);
    emptyCell.value = "No workspace reservations recorded in this period.";
    emptyCell.alignment = { horizontal: "center" };
    styleTableRow(sheet, `B${curWsRow}:E${curWsRow}`, false);
    curWsRow++;
  }

  // 5. Frequent Bookers Table (Starting at Row 22, Columns F to H)
  sheet.mergeCells(`F${startRow}:H${startRow}`);
  const topUsersHeader = sheet.getCell(`F${startRow}`);
  topUsersHeader.value = "FREQUENT BOOKERS LEADERBOARD";
  styleSectionHeader(topUsersHeader);

  const uTableCols = ["F", "G", "H"];
  const uHeaders = ["Customer Name", "Bookings", "Total Spent"];
  uHeaders.forEach((h, i) => {
    const cell = sheet.getCell(`${uTableCols[i]}${startRow + 1}`);
    cell.value = h;
    styleTableHeaderCell(cell);
  });

  let curURow = startRow + 2;
  if (snapshot.topUsers.length > 0) {
    snapshot.topUsers.forEach((u, idx) => {
      sheet.getCell(`F${curURow}`).value = u.name;
      const bCell = sheet.getCell(`G${curURow}`);
      bCell.value = u.bookings;
      bCell.numFmt = "#,##0";
      bCell.alignment = { horizontal: "center" };

      const sCell = sheet.getCell(`H${curURow}`);
      sCell.value = u.rawSpent ?? 0;
      sCell.numFmt = "₱#,##0.00";
      sCell.alignment = { horizontal: "right" };

      styleTableRow(sheet, `F${curURow}:H${curURow}`, idx % 2 === 1);
      curURow++;
    });
  } else {
    sheet.mergeCells(`F${curURow}:H${curURow}`);
    const emptyCell = sheet.getCell(`F${curURow}`);
    emptyCell.value = "No customer bookings in this period.";
    emptyCell.alignment = { horizontal: "center" };
    styleTableRow(sheet, `F${curURow}:H${curURow}`, false);
    curURow++;
  }
}

/**
 * Builds the Detailed Reservations Sheet with rich styling, status badges, and formulas.
 */
function buildReservationsSheet(workbook: ExcelJS.Workbook, reservations: ReportReservationRecord[]) {
  const sheet = workbook.addWorksheet("Reservations History", {
    views: [{ showGridLines: true }],
  });

  sheet.columns = [
    { header: "Reference Code", key: "referenceCode", width: 18 },
    { header: "Source", key: "source", width: 12 },
    { header: "Customer Name", key: "customerName", width: 24 },
    { header: "Customer Email", key: "customerEmail", width: 28 },
    { header: "Status", key: "status", width: 22 },
    { header: "Workspace Name", key: "workspaceName", width: 22 },
    { header: "Workspace Code", key: "workspaceCode", width: 16 },
    { header: "Floor", key: "floorName", width: 16 },
    { header: "Booking Start", key: "bookingStart", width: 20 },
    { header: "Booking End", key: "bookingEnd", width: 20 },
    { header: "Amount Due", key: "amountDue", width: 16 },
    { header: "Created At", key: "createdAt", width: 20 },
  ];

  // Style Header Row
  const headerRow = sheet.getRow(1);
  headerRow.height = 28;
  headerRow.eachCell((cell) => {
    styleTableHeaderCell(cell);
  });

  // Enable Auto-Filter
  sheet.autoFilter = "A1:L1";

  // Add Data Rows
  reservations.forEach((r, idx) => {
    const row = sheet.addRow({
      referenceCode: r.referenceCode,
      source: r.source,
      customerName: `${r.customerFirstName} ${r.customerLastName}`.trim(),
      customerEmail: r.customerEmail,
      status: r.reservationStatus,
      workspaceName: r.workspaceDisplayName ?? "",
      workspaceCode: r.workspaceInstanceCode ?? "",
      floorName: r.floorName ?? "",
      bookingStart: r.bookingStartAt ? formatDateTime(r.bookingStartAt) : "",
      bookingEnd: r.bookingEndAt ? formatDateTime(r.bookingEndAt) : "",
      amountDue: r.amountDue,
      createdAt: formatDateTime(r.createdAt),
    });

    row.height = 22;
    const isZebra = idx % 2 === 1;

    row.eachCell((cell, colNumber) => {
      styleDataCell(cell, isZebra);

      // Status Badge Styling (Col 5)
      if (colNumber === 5) {
        applyStatusBadgeStyle(cell, String(cell.value));
      }
      // Currency Formatting (Col 11)
      if (colNumber === 11) {
        cell.numFmt = "₱#,##0.00";
        cell.alignment = { horizontal: "right", vertical: "middle" };
      }
      // Center aligned columns
      if ([1, 2, 7, 8, 9, 10, 12].includes(colNumber)) {
        cell.alignment = { horizontal: "center", vertical: "middle" };
      }
    });
  });

  // Total Summary Row
  if (reservations.length > 0) {
    const totalRowNum = reservations.length + 2;
    const totalRow = sheet.getRow(totalRowNum);
    totalRow.height = 24;
    totalRow.getCell(1).value = "TOTAL / SUMMARY";
    totalRow.getCell(11).value = { formula: `SUM(K2:K${reservations.length + 1})` };
    totalRow.getCell(11).numFmt = "₱#,##0.00";

    totalRow.eachCell((cell) => {
      styleTotalRowCell(cell);
    });
  }
}

/**
 * Builds the Detailed Payments Sheet.
 */
function buildPaymentsSheet(workbook: ExcelJS.Workbook, payments: ReportPaymentAttemptRecord[]) {
  const sheet = workbook.addWorksheet("Payment Records", {
    views: [{ showGridLines: true }],
  });

  sheet.columns = [
    { header: "Reservation Ref", key: "ref", width: 18 },
    { header: "Channel", key: "channel", width: 14 },
    { header: "Payment Status", key: "paymentStatus", width: 18 },
    { header: "Refund Status", key: "refundStatus", width: 16 },
    { header: "Payment Method", key: "method", width: 22 },
    { header: "Method Type", key: "methodType", width: 16 },
    { header: "Amount", key: "amount", width: 16 },
    { header: "Currency", key: "currency", width: 10 },
    { header: "Proof Submitted At", key: "proofSubmittedAt", width: 20 },
    { header: "Processed At", key: "processedAt", width: 20 },
    { header: "Created At", key: "createdAt", width: 20 },
  ];

  const headerRow = sheet.getRow(1);
  headerRow.height = 28;
  headerRow.eachCell((cell) => styleTableHeaderCell(cell));
  sheet.autoFilter = "A1:K1";

  payments.forEach((p, idx) => {
    const row = sheet.addRow({
      ref: p.reservationReferenceCode,
      channel: p.channel,
      paymentStatus: p.paymentStatus,
      refundStatus: p.refundStatus,
      method: p.paymentMethodDisplayName ?? "",
      methodType: p.paymentMethodType ?? "",
      amount: p.amount,
      currency: p.currency,
      proofSubmittedAt: p.proofSubmittedAt ? formatDateTime(p.proofSubmittedAt) : "",
      processedAt: p.processedAt ? formatDateTime(p.processedAt) : "",
      createdAt: formatDateTime(p.createdAt),
    });

    row.height = 22;
    const isZebra = idx % 2 === 1;

    row.eachCell((cell, colNumber) => {
      styleDataCell(cell, isZebra);

      // Payment Status (Col 3)
      if (colNumber === 3) {
        applyStatusBadgeStyle(cell, String(cell.value));
      }
      // Amount (Col 7)
      if (colNumber === 7) {
        cell.numFmt = "₱#,##0.00";
        cell.alignment = { horizontal: "right", vertical: "middle" };
      }
      if ([1, 2, 4, 6, 8, 9, 10, 11].includes(colNumber)) {
        cell.alignment = { horizontal: "center", vertical: "middle" };
      }
    });
  });

  if (payments.length > 0) {
    const totalRowNum = payments.length + 2;
    const totalRow = sheet.getRow(totalRowNum);
    totalRow.height = 24;
    totalRow.getCell(1).value = "TOTAL REVENUE";
    totalRow.getCell(7).value = { formula: `SUM(G2:G${payments.length + 1})` };
    totalRow.getCell(7).numFmt = "₱#,##0.00";

    totalRow.eachCell((cell) => styleTotalRowCell(cell));
  }
}

/**
 * Builds Workspace Utilization Sheet.
 */
function buildWorkspaceSheet(workbook: ExcelJS.Workbook, reservations: ReportReservationRecord[]) {
  const sheet = workbook.addWorksheet("Workspace Utilization", {
    views: [{ showGridLines: true }],
  });

  sheet.columns = [
    { header: "Floor Name", key: "floor", width: 18 },
    { header: "Workspace Name", key: "name", width: 24 },
    { header: "Instance Code", key: "code", width: 16 },
    { header: "Template Tier", key: "template", width: 22 },
    { header: "Reservation Count", key: "count", width: 18 },
    { header: "Total Booked Hours", key: "hours", width: 20 },
  ];

  const headerRow = sheet.getRow(1);
  headerRow.height = 28;
  headerRow.eachCell((cell) => styleTableHeaderCell(cell));
  sheet.autoFilter = "A1:F1";

  const usageByWs = new Map<string, { floor: string; name: string; code: string; template: string; count: number; hours: number }>();
  for (const r of reservations) {
    if (!r.workspaceDisplayName) continue;
    const key = r.workspaceInstanceCode ?? r.workspaceDisplayName;
    const existing = usageByWs.get(key) ?? {
      floor: r.floorName ?? "",
      name: r.workspaceDisplayName,
      code: r.workspaceInstanceCode ?? "",
      template: r.workspaceTemplateName ?? "",
      count: 0,
      hours: 0,
    };
    existing.count += 1;
    if (r.bookingStartAt && r.bookingEndAt) {
      existing.hours += (new Date(r.bookingEndAt).getTime() - new Date(r.bookingStartAt).getTime()) / (1000 * 60 * 60);
    } else {
      existing.hours += 1;
    }
    usageByWs.set(key, existing);
  }

  const items = Array.from(usageByWs.values()).sort((a, b) => b.count - a.count);

  items.forEach((item, idx) => {
    const row = sheet.addRow({
      floor: item.floor,
      name: item.name,
      code: item.code,
      template: item.template,
      count: item.count,
      hours: Number(item.hours.toFixed(1)),
    });

    row.height = 22;
    const isZebra = idx % 2 === 1;
    row.eachCell((cell, colNumber) => {
      styleDataCell(cell, isZebra);
      if (colNumber === 5) {
        cell.numFmt = "#,##0";
        cell.alignment = { horizontal: "center", vertical: "middle" };
      }
      if (colNumber === 6) {
        cell.numFmt = "#,##0.0 \"hrs\"";
        cell.alignment = { horizontal: "right", vertical: "middle" };
      }
    });
  });
}

/**
 * Builds Checkin Records Sheet.
 */
function buildCheckinSheet(workbook: ExcelJS.Workbook, reservations: ReportReservationRecord[]) {
  const sheet = workbook.addWorksheet("Check-in Records", {
    views: [{ showGridLines: true }],
  });

  sheet.columns = [
    { header: "Reference Code", key: "ref", width: 18 },
    { header: "Customer Name", key: "customerName", width: 24 },
    { header: "Workspace", key: "workspaceName", width: 22 },
    { header: "Instance Code", key: "workspaceCode", width: 16 },
    { header: "Floor", key: "floorName", width: 16 },
    { header: "Checked In At", key: "checkedInAt", width: 20 },
    { header: "Checked Out At", key: "checkedOutAt", width: 20 },
    { header: "Status", key: "status", width: 18 },
    { header: "Source", key: "source", width: 12 },
  ];

  const headerRow = sheet.getRow(1);
  headerRow.height = 28;
  headerRow.eachCell((cell) => styleTableHeaderCell(cell));
  sheet.autoFilter = "A1:I1";

  const checkins = reservations
    .filter((r) => r.checkedInAt !== null || r.checkedOutAt !== null)
    .sort((a, b) => (b.checkedInAt ?? b.checkedOutAt ?? "").localeCompare(a.checkedInAt ?? a.checkedOutAt ?? ""));

  checkins.forEach((r, idx) => {
    const row = sheet.addRow({
      ref: r.referenceCode,
      customerName: `${r.customerFirstName} ${r.customerLastName}`.trim(),
      workspaceName: r.workspaceDisplayName ?? "",
      workspaceCode: r.workspaceInstanceCode ?? "",
      floorName: r.floorName ?? "",
      checkedInAt: r.checkedInAt ? formatDateTime(r.checkedInAt) : "",
      checkedOutAt: r.checkedOutAt ? formatDateTime(r.checkedOutAt) : "",
      status: r.reservationStatus,
      source: r.source,
    });

    row.height = 22;
    const isZebra = idx % 2 === 1;
    row.eachCell((cell, colNumber) => {
      styleDataCell(cell, isZebra);
      if (colNumber === 8) {
        applyStatusBadgeStyle(cell, String(cell.value));
      }
      if ([1, 4, 5, 6, 7, 9].includes(colNumber)) {
        cell.alignment = { horizontal: "center", vertical: "middle" };
      }
    });
  });
}

/**
 * Builds Cancellation Sheet.
 */
function buildCancellationSheet(
  workbook: ExcelJS.Workbook,
  reservations: ReportReservationRecord[],
  payments: ReportPaymentAttemptRecord[]
) {
  const sheet = workbook.addWorksheet("Cancellations & Resolutions", {
    views: [{ showGridLines: true }],
  });

  sheet.columns = [
    { header: "Reference Code", key: "ref", width: 18 },
    { header: "Customer Name", key: "customerName", width: 24 },
    { header: "Reservation Status", key: "status", width: 24 },
    { header: "Refund Status", key: "refundStatus", width: 18 },
    { header: "Amount Due", key: "amountDue", width: 16 },
    { header: "Currency", key: "currency", width: 12 },
    { header: "Created At", key: "createdAt", width: 20 },
  ];

  const headerRow = sheet.getRow(1);
  headerRow.height = 28;
  headerRow.eachCell((cell) => styleTableHeaderCell(cell));
  sheet.autoFilter = "A1:G1";

  const refundMap = new Map<string, string>();
  for (const p of payments) {
    if (p.refundStatus === "REFUNDED") refundMap.set(p.reservationId, "REFUNDED");
    else if (!refundMap.has(p.reservationId)) refundMap.set(p.reservationId, p.refundStatus);
  }

  const cancelled = reservations.filter(
    (r) => r.reservationStatus === "CANCELLED" || r.reservationStatus === "NEEDS_MANUAL_RESOLUTION"
  );

  cancelled.forEach((r, idx) => {
    const row = sheet.addRow({
      ref: r.referenceCode,
      customerName: `${r.customerFirstName} ${r.customerLastName}`.trim(),
      status: r.reservationStatus,
      refundStatus: refundMap.get(r.reservationId) ?? "NONE",
      amountDue: r.amountDue,
      currency: r.currency,
      createdAt: formatDateTime(r.createdAt),
    });

    row.height = 22;
    const isZebra = idx % 2 === 1;
    row.eachCell((cell, colNumber) => {
      styleDataCell(cell, isZebra);
      if (colNumber === 3) {
        applyStatusBadgeStyle(cell, String(cell.value));
      }
      if (colNumber === 5) {
        cell.numFmt = "₱#,##0.00";
        cell.alignment = { horizontal: "right", vertical: "middle" };
      }
      if ([1, 4, 6, 7].includes(colNumber)) {
        cell.alignment = { horizontal: "center", vertical: "middle" };
      }
    });
  });
}

/**
 * Builds a Focused Category Sheet for standalone category exports.
 */
async function buildFocusedCategorySheet(
  workbook: ExcelJS.Workbook,
  categoryTitle: string,
  reservations: ReportReservationRecord[],
  payments: ReportPaymentAttemptRecord[],
  snapshot: AdminReportsSnapshot,
  type: string
) {
  if (type === "reservations") {
    buildReservationsSheet(workbook, reservations);
  } else if (type === "payment") {
    buildPaymentsSheet(workbook, payments);
  } else if (type === "workspace") {
    buildWorkspaceSheet(workbook, reservations);
  } else if (type === "checkin") {
    buildCheckinSheet(workbook, reservations);
  } else if (type === "cancellation") {
    buildCancellationSheet(workbook, reservations, payments);
  }
}

// ----------------------------------------------------
// Styling Helper Functions
// ----------------------------------------------------

function styleSectionHeader(cell: ExcelJS.Cell) {
  cell.font = { name: FONT_NAME, size: 12, bold: true, color: { argb: COLORS.BRAND_DARK } };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.CANVAS } };
  cell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  cell.border = {
    top: { style: "medium", color: { argb: COLORS.BRAND_DARK } },
    bottom: { style: "thin", color: { argb: COLORS.BORDER } },
    left: { style: "thin", color: { argb: COLORS.BORDER } },
    right: { style: "thin", color: { argb: COLORS.BORDER } },
  };
}

function styleTableHeaderCell(cell: ExcelJS.Cell) {
  cell.font = { name: FONT_NAME, size: 10, bold: true, color: { argb: COLORS.WHITE } };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.BRAND_DARK } };
  cell.alignment = { vertical: "middle", horizontal: "center" };
  cell.border = {
    top: { style: "thin", color: { argb: COLORS.BRAND_DARK } },
    bottom: { style: "medium", color: { argb: COLORS.BRAND_ACCENT } },
    left: { style: "thin", color: { argb: COLORS.BORDER } },
    right: { style: "thin", color: { argb: COLORS.BORDER } },
  };
}

function styleTableRow(sheet: ExcelJS.Worksheet, rangeStr: string, isZebra: boolean) {
  const bgColor = isZebra ? COLORS.ZEBRA_ROW : COLORS.WHITE;
  // Apply to all cells in range
  const [start, end] = rangeStr.split(":");
  const startCol = start.charCodeAt(0);
  const endCol = end.charCodeAt(0);
  const rowNum = parseInt(start.slice(1), 10);

  for (let c = startCol; c <= endCol; c++) {
    const cellKey = `${String.fromCharCode(c)}${rowNum}`;
    const cell = sheet.getCell(cellKey);
    cell.font = { name: FONT_NAME, size: 9.5, color: { argb: COLORS.TEXT_PRIMARY } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgColor } };
    cell.border = {
      bottom: { style: "thin", color: { argb: COLORS.BORDER } },
      left: { style: "thin", color: { argb: COLORS.BORDER } },
      right: { style: "thin", color: { argb: COLORS.BORDER } },
    };
  }
}

function styleDataCell(cell: ExcelJS.Cell, isZebra: boolean) {
  cell.font = { name: FONT_NAME, size: 9.5, color: { argb: COLORS.TEXT_PRIMARY } };
  cell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: isZebra ? COLORS.ZEBRA_ROW : COLORS.WHITE },
  };
  cell.border = {
    top: { style: "thin", color: { argb: COLORS.BORDER } },
    bottom: { style: "thin", color: { argb: COLORS.BORDER } },
    left: { style: "thin", color: { argb: COLORS.BORDER } },
    right: { style: "thin", color: { argb: COLORS.BORDER } },
  };
  cell.alignment = { vertical: "middle", horizontal: "left" };
}

function applyStatusBadgeStyle(cell: ExcelJS.Cell, status: string) {
  const st = status.toUpperCase();
  let bg = COLORS.INFO_SOFT;
  let fg = COLORS.TEXT_PRIMARY;

  if (["CONFIRMED", "APPROVED", "COMPLETED", "CHECKED_IN"].includes(st)) {
    bg = COLORS.SUCCESS_BG;
    fg = COLORS.SUCCESS_FG;
  } else if (["NEEDS_MANUAL_RESOLUTION", "PENDING", "PROCESSING"].includes(st)) {
    bg = COLORS.WARNING_BG;
    fg = COLORS.WARNING_FG;
  } else if (["CANCELLED", "FAILED", "EXPIRED", "REJECTED"].includes(st)) {
    bg = COLORS.DANGER_BG;
    fg = COLORS.DANGER_FG;
  }

  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
  cell.font = { name: FONT_NAME, size: 9, bold: true, color: { argb: fg } };
  cell.alignment = { vertical: "middle", horizontal: "center" };
}

function styleTotalRowCell(cell: ExcelJS.Cell) {
  cell.font = { name: FONT_NAME, size: 10.5, bold: true, color: { argb: COLORS.BRAND_DARK } };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.CANVAS } };
  cell.border = {
    top: { style: "thin", color: { argb: COLORS.BRAND_DARK } },
    bottom: { style: "double", color: { argb: COLORS.BRAND_DARK } },
  };
  cell.alignment = { vertical: "middle" };
}

function applyCardBorder(sheet: ExcelJS.Worksheet, rangeStr: string, borderColor: string) {
  const [start, end] = rangeStr.split(":");
  const startCol = start.charCodeAt(0);
  const startRow = parseInt(start.slice(1), 10);
  const endCol = end.charCodeAt(0);
  const endRow = parseInt(end.slice(1), 10);

  for (let r = startRow; r <= endRow; r++) {
    for (let c = startCol; c <= endCol; c++) {
      const cell = sheet.getCell(`${String.fromCharCode(c)}${r}`);
      cell.border = {
        top: r === startRow ? { style: "medium", color: { argb: borderColor } } : undefined,
        bottom: r === endRow ? { style: "medium", color: { argb: borderColor } } : undefined,
        left: c === startCol ? { style: "medium", color: { argb: borderColor } } : undefined,
        right: c === endCol ? { style: "medium", color: { argb: borderColor } } : undefined,
      };
    }
  }
}

function formatDateTime(iso: string, timezone = "Asia/Manila"): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso.replace("T", " ").slice(0, 16);
    const dateStr = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(d);
    const timeStr = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(d);
    return `${dateStr}, ${timeStr}`;
  } catch {
    return iso.replace("T", " ").slice(0, 16);
  }
}
