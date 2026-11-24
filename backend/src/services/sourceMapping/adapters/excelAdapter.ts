import * as XLSX from "xlsx";
import type { SourceAdapter, TextSpan } from "../types.js";

type SheetJsCell = {
  w?: string;
  v?: string | number | boolean | Date | null;
  t?: string;
};

const EXCEL_EXT = /\.(xlsx|xlsm|xls)$/i;

const cellText = (cell: SheetJsCell | undefined) => {
  if (!cell) return "";
  if (typeof cell.w === "string" && cell.w.trim()) return cell.w.trim();
  if (cell.v == null) return "";
  return String(cell.v).trim();
};

const isExcelBuffer = (buffer: Buffer) => {
  if (buffer.length < 8) return false;
  // ZIP-based OOXML (xlsx/xlsm)
  if (buffer[0] === 0x50 && buffer[1] === 0x4b) return true;
  // OLE Compound File (legacy xls)
  return (
    buffer[0] === 0xd0 &&
    buffer[1] === 0xcf &&
    buffer[2] === 0x11 &&
    buffer[3] === 0xe0
  );
};

export const excelAdapter: SourceAdapter = {
  id: "excel",
  canHandle: ({ fileName, mimeType, buffer }) => {
    const mime = (mimeType ?? "").toLowerCase();
    return (
      EXCEL_EXT.test(fileName) ||
      mime.includes("spreadsheet") ||
      mime.includes("excel") ||
      isExcelBuffer(buffer)
    );
  },
  extractSpans: async ({ buffer }) => {
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
    const spans: TextSpan[] = [];

    workbook.SheetNames.forEach((sheetName, sheetIndex) => {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet?.["!ref"]) return;
      const range = XLSX.utils.decode_range(sheet["!ref"]);
      for (let row = range.s.r; row <= range.e.r; row += 1) {
        for (let col = range.s.c; col <= range.e.c; col += 1) {
          const address = XLSX.utils.encode_cell({ r: row, c: col });
          const raw = sheet[address] as SheetJsCell | undefined;
          const text = cellText(raw);
          if (!text) continue;
          // page is 1-based sheet index for adapters that still key off page.
          spans.push({
            page: sheetIndex + 1,
            text,
            start: 0,
            end: text.length,
            // Approximate sheet placement for generic overlays (unused by Excel viewer).
            x: Math.min(99, (col / Math.max(1, range.e.c + 1)) * 100),
            y: Math.min(99, (row / Math.max(1, range.e.r + 1)) * 100),
            w: Math.max(0.8, 100 / Math.max(1, range.e.c + 1)),
            h: Math.max(0.8, 100 / Math.max(1, range.e.r + 1)),
            sheet: sheetName,
            cell: address,
            row: row + 1,
            col: col + 1,
          });
        }
      }
    });

    return spans;
  },
};
