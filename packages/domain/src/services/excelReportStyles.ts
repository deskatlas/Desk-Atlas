import type ExcelJS from "exceljs";

// Shared report presentation: PRD-F15/F25, MS-43, QAD-TC43.10.
// DeskAtlas Palette Constants (Hex without # for ExcelJS ARGB)
export const COLORS = {
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

export const FONT_NAME = "Segoe UI";

export function styleTableHeaderCell(cell: ExcelJS.Cell) {
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

export function styleDataCell(cell: ExcelJS.Cell, isZebra: boolean) {
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

export function applyStatusBadgeStyle(cell: ExcelJS.Cell, status: string) {
  const st = status.toUpperCase();
  let bg = COLORS.INFO_SOFT;
  let fg = COLORS.TEXT_PRIMARY;

  if (["CONFIRMED", "APPROVED", "COMPLETED", "CHECKED_IN", "ACTIVE"].includes(st)) {
    bg = COLORS.SUCCESS_BG;
    fg = COLORS.SUCCESS_FG;
  } else if (["NEEDS_MANUAL_RESOLUTION", "PENDING", "PROCESSING", "PAUSED"].includes(st)) {
    bg = COLORS.WARNING_BG;
    fg = COLORS.WARNING_FG;
  } else if (["CANCELLED", "FAILED", "EXPIRED", "REJECTED"].includes(st)) {
    bg = COLORS.DANGER_BG;
    fg = COLORS.DANGER_FG;
  }

  if (["DRAFT", "ARCHIVED"].includes(st)) {
    bg = COLORS.CANVAS;
    fg = COLORS.TEXT_SECONDARY;
  }

  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
  cell.font = { name: FONT_NAME, size: 9, bold: true, color: { argb: fg } };
  cell.alignment = { vertical: "middle", horizontal: "center" };
}

export function styleTotalRowCell(cell: ExcelJS.Cell) {
  cell.font = { name: FONT_NAME, size: 10.5, bold: true, color: { argb: COLORS.BRAND_DARK } };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.CANVAS } };
  cell.border = {
    top: { style: "thin", color: { argb: COLORS.BRAND_DARK } },
    bottom: { style: "double", color: { argb: COLORS.BRAND_DARK } },
  };
  cell.alignment = { vertical: "middle" };
}

