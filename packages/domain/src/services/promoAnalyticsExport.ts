import ExcelJS from 'exceljs';
import type { PromoAnalyticsSnapshot } from '../models/promoAnalytics';
import {
  COLORS,
  styleTableHeaderCell,
  styleDataCell,
  applyStatusBadgeStyle,
} from './excelReportStyles';

// MS-74: PRD-F15/F25, SDD-C11/C19, QAD-TC43. Multi-format export for Promotional Rates Telemetry.
export interface PromoExportResult {
  filename: string;
  contentType: string;
  body: string | Uint8Array;
}

export async function exportPromoAnalytics(
  snapshot: PromoAnalyticsSnapshot,
  type: 'summary' | 'bookings',
  format: 'csv' | 'xlsx'
): Promise<PromoExportResult> {
  const headers =
    type === 'summary'
      ? [
          'Promotion Name',
          'Status',
          'Rate Type',
          'Target Workspaces',
          'Regular Price (PHP)',
          'Promo Price (PHP)',
          'Bookings',
          'Discounts Granted (PHP)',
          'Gross Revenue (PHP)',
          'ROI Multiple',
          'Schedule Window',
        ]
      : [
          'Reservation ID',
          'Reference Code',
          'Customer Name',
          'Customer Email (Masked)',
          'Workspace',
          'Rate Type',
          'Promotion Applied',
          'Regular Price (PHP)',
          'Promo Price (PHP)',
          'Discount Granted (PHP)',
          'Net Paid (PHP)',
          'Channel',
          'Booked At',
        ];

  const rows: Array<Array<string | number>> =
    type === 'summary'
      ? snapshot.promotionsPerformance.map((r) => [
          r.name,
          r.status,
          r.rateType,
          r.workspaceTemplateNames.join(', '),
          r.regularPrice,
          r.promotionalPrice,
          r.bookingsCount,
          r.discountsGranted,
          r.attributedRevenue,
          r.roiMultiple,
          `${r.startAt} to ${r.endAt}`,
        ])
      : snapshot.recentBookings.map((r) => [
          r.reservationId,
          r.referenceCode,
          r.customerName,
          r.customerEmail,
          r.workspaceName,
          r.rateType,
          r.promotionName,
          r.regularPrice,
          r.promotionalPrice,
          r.discountGranted,
          r.amountDue,
          r.channel,
          r.bookedAt,
        ]);

  const filename = `promo-${type}-${snapshot.range}-${snapshot.generatedAt.slice(0, 10)}.${format}`;

  if (format === 'csv') {
    const escape = (value: string | number) => {
      const text =
        typeof value === 'string' && /^[\s]*[=+@-]/.test(value) ? `'${value}` : String(value);
      return `"${text.replaceAll('"', '""')}"`;
    };

    return {
      filename,
      contentType: 'text/csv; charset=utf-8',
      body: '\uFEFF' + [headers, ...rows].map((row) => row.map(escape).join(',')).join('\r\n'),
    };
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'DeskAtlas Management System';
  workbook.lastModifiedBy = 'DeskAtlas Automated Engine';
  workbook.created = new Date(snapshot.generatedAt);
  workbook.modified = new Date(snapshot.generatedAt);
  workbook.title =
    type === 'summary' ? 'Promotional Rates Performance' : 'Promotional Bookings Audit Log';
  workbook.subject = `${snapshot.rangeLabel} (${snapshot.timeZone})`;
  workbook.calcProperties.fullCalcOnLoad = true;

  const sheet = workbook.addWorksheet(
    type === 'summary' ? 'Promo Performance' : 'Promo Bookings',
    {
      properties: { tabColor: { argb: COLORS.BRAND_DARK } },
      views: [{ state: 'frozen', ySplit: 1, showGridLines: true }],
      pageSetup: {
        orientation: 'landscape',
        paperSize: 9,
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        printTitlesRow: '1:1',
      },
    }
  );

  const widths =
    type === 'summary'
      ? [28, 14, 16, 32, 20, 20, 14, 24, 22, 16, 36]
      : [38, 20, 24, 26, 26, 16, 28, 20, 20, 24, 20, 14, 28];

  sheet.columns = widths.map((width) => ({ width }));
  sheet.addRow(headers);
  sheet.addRows(rows);

  const header = sheet.getRow(1);
  header.height = 32;
  header.eachCell((cell) => {
    styleTableHeaderCell(cell);
    cell.alignment = { ...cell.alignment, wrapText: true };
  });

  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, rows.length + 1), column: headers.length },
  };

  sheet.headerFooter.oddHeader = `&LDeskAtlas&C${workbook.title}&R${snapshot.rangeLabel}`;
  sheet.headerFooter.oddFooter = `&L${snapshot.timeZone} · Generated ${snapshot.generatedAt}&RPage &P of &N`;

  rows.forEach((_, index) => {
    const row = sheet.getRow(index + 2);
    row.height = 22;
    row.eachCell((cell, column) => {
      styleDataCell(cell, index % 2 === 1);
      if (typeof cell.value === 'number') {
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
        cell.numFmt = '#,##0.00';
      }
      if (type === 'summary' && column === 2) {
        applyStatusBadgeStyle(cell, String(cell.value));
      }
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return {
    filename,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    body: new Uint8Array(buffer),
  };
}
