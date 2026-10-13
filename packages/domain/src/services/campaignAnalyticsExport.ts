import ExcelJS from 'exceljs';
import type { CampaignAnalyticsSnapshot } from '../models/campaignAnalytics';
import { COLORS, styleTableHeaderCell, styleDataCell, applyStatusBadgeStyle, styleTotalRowCell } from './excelReportStyles';

// MS-43: PRD-F25, QAD-TC43.10. Export every matching redemption, not just the feed.
export async function exportCampaignAnalytics(snapshot: CampaignAnalyticsSnapshot, type: 'summary' | 'redemptions', format: 'csv' | 'xlsx') {
  const headers = type === 'summary'
    ? ['Campaign', 'Status', 'Rule', 'Version', 'Conditions', 'Reward Type', 'Reward Value', 'Issued', 'Redeemed', 'Redemption %', 'Discounts PHP', 'Gross Revenue PHP', 'ROI Multiple']
    : ['Voucher ID', 'Customer ID (masked)', 'Promo Code', 'Reservation ID', 'Reference', 'Redeemed At', 'Discount PHP', 'Net Paid PHP', 'Channel'];
  const rows: Array<Array<string | number>> = type === 'summary'
    ? snapshot.campaignPerformance.map(r => [r.campaignName, r.status, r.ruleLabel, r.ruleVersion, r.conditionSummary, r.rewardType, r.rewardValue, r.vouchersIssued, r.vouchersRedeemed, r.redemptionRatePercentage, r.discountsGranted, r.attributedRevenue, r.roiMultiple])
    : snapshot.recentRedemptions.map(r => [r.voucherId, r.customerCode, r.promoCode, r.reservationId, r.reservationReference, r.redeemedAt, r.discountAmount, r.netPaidAmount, r.channel]);
  const filename = `campaign-${type}-${snapshot.range}-${snapshot.generatedAt.slice(0, 10)}.${format}`;
  if (format === 'csv') {
    const escape = (value: string | number) => {
      const text = typeof value === 'string' && /^[\s]*[=+@-]/.test(value) ? `'${value}` : String(value);
      return `"${text.replaceAll('"', '""')}"`;
    };
    return { filename, contentType: 'text/csv; charset=utf-8', body: '\uFEFF' + [headers, ...rows].map(row => row.map(escape).join(',')).join('\r\n') };
  }
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'DeskAtlas Management System';
  workbook.lastModifiedBy = 'DeskAtlas Automated Engine';
  workbook.created = new Date(snapshot.generatedAt);
  workbook.modified = new Date(snapshot.generatedAt);
  workbook.title = type === 'summary' ? 'Campaign Performance' : 'Voucher Redemptions';
  workbook.subject = `${snapshot.rangeLabel} (${snapshot.timeZone})`;
  workbook.calcProperties.fullCalcOnLoad = true;
  const sheet = workbook.addWorksheet(type === 'summary' ? 'Campaign Performance' : 'Redemptions', {
    properties: { tabColor: { argb: COLORS.BRAND_DARK } },
    views: [{ state: 'frozen', ySplit: 1, showGridLines: true }],
    pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '1:1' },
  });
  const widths = type === 'summary'
    ? [28, 14, 28, 10, 42, 28, 18, 12, 12, 18, 20, 22, 16]
    : [38, 24, 18, 38, 22, 34, 20, 20, 14];
  sheet.columns = widths.map(width => ({ width }));
  sheet.addRow(headers);
  sheet.addRows(rows);
  const header = sheet.getRow(1);
  header.height = 32;
  header.eachCell(cell => {
    styleTableHeaderCell(cell);
    cell.alignment = { ...cell.alignment, wrapText: true };
  });
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, rows.length + 1), column: headers.length } };
  sheet.headerFooter.oddHeader = `&LDeskAtlas&C${workbook.title}&R${snapshot.rangeLabel}`;
  sheet.headerFooter.oddFooter = `&L${snapshot.timeZone} · Generated ${snapshot.generatedAt}&RPage &P of &N`;

  rows.forEach((values, index) => {
    const row = sheet.getRow(index + 2);
    row.height = 22;
    row.eachCell((cell, column) => {
      styleDataCell(cell, index % 2 === 1);
      if (typeof cell.value === 'number') {
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
        cell.numFmt = '#,##0';
      }
      if (type === 'summary') {
        if (column === 2) applyStatusBadgeStyle(cell, String(cell.value));
        if ([1, 3, 5].includes(column)) {
          cell.alignment = { ...cell.alignment, wrapText: true };
          row.height = Math.max(row.height, Math.ceil(String(values[column - 1]).length / widths[column - 1]) * 14 + 8);
        }
        if (column === 7) {
          const percentage = values[5] === 'PERCENTAGE_DISCOUNT';
          cell.value = percentage ? Number(values[6]) / 100 : Number(values[6]);
          cell.numFmt = percentage ? '0.0%' : '₱#,##0.00';
        }
        if (column === 10) { cell.value = Number(values[9]) / 100; cell.numFmt = '0.0%'; }
        if ([11, 12].includes(column)) cell.numFmt = '₱#,##0.00';
        if (column === 13) cell.numFmt = '0.00"x"';
      } else {
        if ([7, 8].includes(column)) cell.numFmt = '₱#,##0.00';
        if (column === 6) {
          cell.value = excelLocalDate(String(values[5]), snapshot.timeZone);
          cell.numFmt = 'mmm d, yyyy h:mm AM/PM';
        }
        if (column === 9) cell.alignment = { horizontal: 'center', vertical: 'middle' };
      }
    });
  });
  if (type === 'redemptions') sheet.getCell('F1').value = `Redeemed At (${snapshot.timeZone})`;
  if (rows.length) addTotals(sheet, rows, type, headers.length);
  else {
    const empty = sheet.getRow(2);
    empty.height = 26;
    sheet.mergeCells(2, 1, 2, headers.length);
    empty.getCell(1).value = 'No records for this period.';
    styleDataCell(empty.getCell(1), false);
  }
  return { filename, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body: new Uint8Array(await workbook.xlsx.writeBuffer()) };
}

function excelLocalDate(timestamp: string, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(timestamp));
  const date = Object.fromEntries(parts.map(part => [part.type, part.value]));
  // Excel dates have no timezone. Store the venue's displayed wall-clock time.
  return new Date(Date.UTC(Number(date.year), Number(date.month) - 1, Number(date.day), Number(date.hour), Number(date.minute), Number(date.second)));
}

function addTotals(sheet: ExcelJS.Worksheet, rows: Array<Array<string | number>>, type: 'summary' | 'redemptions', columnCount: number) {
  const lastDataRow = rows.length + 1;
  const total = sheet.getRow(lastDataRow + 1);
  total.height = 24;
  total.getCell(1).value = 'TOTAL / SUMMARY';
  const totalColumns = type === 'summary' ? [8, 9, 11, 12] : [7, 8];
  for (const column of totalColumns) {
    const letter = sheet.getColumn(column).letter;
    const result = Math.round(rows.reduce((sum, row) => sum + Number(row[column - 1]), 0) * 100) / 100;
    total.getCell(column).value = { formula: `SUM(${letter}2:${letter}${lastDataRow})`, result };
    total.getCell(column).numFmt = type === 'summary' && [8, 9].includes(column) ? '#,##0' : '₱#,##0.00';
  }
  if (type === 'summary') {
    const row = total.number;
    const issued = Number(total.getCell(8).result);
    const redeemed = Number(total.getCell(9).result);
    const discount = Number(total.getCell(11).result);
    const revenue = Number(total.getCell(12).result);
    total.getCell(10).value = { formula: `IF(H${row}=0,0,I${row}/H${row})`, result: issued ? redeemed / issued : 0 };
    total.getCell(10).numFmt = '0.0%';
    total.getCell(13).value = { formula: `IF(K${row}=0,0,L${row}/K${row})`, result: discount ? revenue / discount : 0 };
    total.getCell(13).numFmt = '0.00"x"';
  }
  for (let column = 1; column <= columnCount; column++) {
    const cell = total.getCell(column);
    styleTotalRowCell(cell);
    cell.alignment = { horizontal: column === 1 ? 'left' : 'right', vertical: 'middle' };
  }
}
