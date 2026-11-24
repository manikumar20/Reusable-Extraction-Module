import ExcelJS from "exceljs";
import * as XLSX from "xlsx";

export type ExcelCellStyle = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  fontSize?: number;
  fontColor?: string;
  fill?: string;
  align?: "left" | "center" | "right";
  vertical?: "top" | "middle" | "bottom";
};

export type ExcelCellModel = {
  address: string;
  row: number;
  col: number;
  text: string;
  style: ExcelCellStyle;
};

export type ExcelMergeModel = {
  top: number;
  left: number;
  bottom: number;
  right: number;
};

export type ExcelSheetModel = {
  name: string;
  rowCount: number;
  colCount: number;
  /** Sparse map keyed by `${row}:${col}` (1-based). */
  cells: Map<string, ExcelCellModel>;
  merges: ExcelMergeModel[];
  /** Column widths in px (index 0 unused; 1-based cols). */
  colWidths: number[];
  /** Row heights in px (index 0 unused; 1-based rows). */
  rowHeights: number[];
};

export type ExcelWorkbookModel = {
  sheets: ExcelSheetModel[];
};

const DEFAULT_COL_WIDTH = 96;
const DEFAULT_ROW_HEIGHT = 24;
const MAX_ROWS = 5_000;
const MAX_COLS = 100;

const argbToCss = (value?: string) => {
  if (!value) return undefined;
  const hex = value.replace(/^#/, "");
  if (hex.length === 8) return `#${hex.slice(2)}`;
  if (hex.length === 6) return `#${hex}`;
  return undefined;
};

const cellKey = (row: number, col: number) => `${row}:${col}`;

const excelColLetter = (col: number) => {
  let n = col;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out || "A";
};

export const columnLabel = excelColLetter;

const decodeA1 = (address: string) => {
  const match = /^([A-Z]+)(\d+)$/i.exec(address.trim());
  if (!match) return { row: 1, col: 1 };
  const letters = match[1]!.toUpperCase();
  let col = 0;
  for (let i = 0; i < letters.length; i += 1) col = col * 26 + (letters.charCodeAt(i) - 64);
  return { row: Number(match[2]), col };
};

const emptySheet = (name = "Sheet1"): ExcelSheetModel => ({
  name,
  rowCount: 20,
  colCount: 10,
  cells: new Map(),
  merges: [],
  colWidths: Array.from({ length: 11 }, () => DEFAULT_COL_WIDTH),
  rowHeights: Array.from({ length: 21 }, () => DEFAULT_ROW_HEIGHT),
});

const displayText = (cell: ExcelJS.Cell) => {
  const value = cell.value;
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value instanceof Date) return value.toLocaleString();
  if (typeof value === "object") {
    const rich = value as { richText?: { text: string }[]; text?: string; result?: unknown; formula?: string };
    if (Array.isArray(rich.richText)) return rich.richText.map((part) => part.text).join("");
    if (rich.text != null) return String(rich.text);
    if (rich.result != null) return String(rich.result);
    if (rich.formula) return String(cell.text || "");
    if ("sharedFormula" in (value as object)) return String(cell.text || "");
  }
  return String(cell.text || "").trim();
};

const readStyle = (cell: ExcelJS.Cell): ExcelCellStyle => {
  const font = cell.font ?? {};
  const fill = cell.fill;
  const alignment = cell.alignment ?? {};
  let fillColor: string | undefined;
  if (fill && fill.type === "pattern" && fill.fgColor) {
    fillColor = argbToCss(fill.fgColor.argb);
  }
  const horizontal = alignment.horizontal;
  const align =
    horizontal === "center" || horizontal === "centerContinuous"
      ? "center"
      : horizontal === "right"
        ? "right"
        : "left";
  const vertical =
    alignment.vertical === "middle"
      ? "middle"
      : alignment.vertical === "bottom"
        ? "bottom"
        : "top";
  return {
    bold: Boolean(font.bold),
    italic: Boolean(font.italic),
    underline: Boolean(font.underline),
    fontSize: typeof font.size === "number" ? font.size : undefined,
    fontColor: argbToCss(font.color?.argb),
    fill: fillColor,
    align,
    vertical,
  };
};

const parseMerges = (refs: unknown): ExcelMergeModel[] => {
  if (!Array.isArray(refs)) return [];
  return refs
    .map((ref) => {
      const [start, end] = String(ref).split(":");
      const a = decodeA1(start || "A1");
      const b = decodeA1(end || start || "A1");
      return {
        top: Math.min(a.row, b.row),
        left: Math.min(a.col, b.col),
        bottom: Math.max(a.row, b.row),
        right: Math.max(a.col, b.col),
      };
    })
    .filter((merge) => merge.bottom >= merge.top && merge.right >= merge.left);
};

/** OOXML path (xlsx / xlsm) via ExcelJS — preserves fonts, fills, merges, widths. */
const parseWithExcelJs = async (data: ArrayBuffer): Promise<ExcelWorkbookModel> => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(data);

  const sheets: ExcelSheetModel[] = [];
  workbook.eachSheet((worksheet) => {
    const model = worksheet.model as { merges?: unknown } | undefined;
    const merges = parseMerges(model?.merges);

    let maxRow = 0;
    let maxCol = 0;
    const cells = new Map<string, ExcelCellModel>();
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber > MAX_ROWS) return;
      maxRow = Math.max(maxRow, rowNumber);
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        if (colNumber > MAX_COLS) return;
        maxCol = Math.max(maxCol, colNumber);
        const text = displayText(cell);
        if (!text && !cell.fill && !cell.font) return;
        cells.set(cellKey(rowNumber, colNumber), {
          address: `${excelColLetter(colNumber)}${rowNumber}`,
          row: rowNumber,
          col: colNumber,
          text,
          style: readStyle(cell),
        });
      });
    });

    for (const merge of merges) {
      maxRow = Math.max(maxRow, merge.bottom);
      maxCol = Math.max(maxCol, merge.right);
    }

    const rowCount = Math.min(MAX_ROWS, Math.max(maxRow, 1));
    const colCount = Math.min(MAX_COLS, Math.max(maxCol, 1));
    const colWidths = Array.from({ length: colCount + 1 }, () => DEFAULT_COL_WIDTH);
    const rowHeights = Array.from({ length: rowCount + 1 }, () => DEFAULT_ROW_HEIGHT);

    worksheet.columns?.forEach((column, index) => {
      const col = index + 1;
      if (col > colCount) return;
      const width = column.width;
      if (typeof width === "number" && width > 0) {
        colWidths[col] = Math.max(40, Math.round(width * 9));
      }
    });

    for (let row = 1; row <= rowCount; row += 1) {
      const height = worksheet.getRow(row).height;
      if (typeof height === "number" && height > 0) {
        rowHeights[row] = Math.max(18, Math.round(height * 1.3));
      }
    }

    sheets.push({
      name: worksheet.name || `Sheet${sheets.length + 1}`,
      rowCount,
      colCount,
      cells,
      merges,
      colWidths,
      rowHeights,
    });
  });

  return { sheets: sheets.length ? sheets : [emptySheet()] };
};

/** Legacy .xls (and ExcelJS failures) via SheetJS — values + merges, basic layout. */
const parseWithSheetJs = (data: ArrayBuffer): ExcelWorkbookModel => {
  const workbook = XLSX.read(data, { type: "array", cellDates: true });
  const sheets: ExcelSheetModel[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const ref = sheet["!ref"];
    if (!ref) {
      sheets.push(emptySheet(sheetName));
      continue;
    }
    const range = XLSX.utils.decode_range(ref);
    const rowCount = Math.min(MAX_ROWS, Math.max(1, range.e.r - range.s.r + 1, range.e.r + 1));
    const colCount = Math.min(MAX_COLS, Math.max(1, range.e.c - range.s.c + 1, range.e.c + 1));
    const cells = new Map<string, ExcelCellModel>();
    const colWidths = Array.from({ length: colCount + 1 }, () => DEFAULT_COL_WIDTH);
    const rowHeights = Array.from({ length: rowCount + 1 }, () => DEFAULT_ROW_HEIGHT);

    for (let row = range.s.r; row <= range.e.r && row < MAX_ROWS; row += 1) {
      for (let col = range.s.c; col <= range.e.c && col < MAX_COLS; col += 1) {
        const address = XLSX.utils.encode_cell({ r: row, c: col });
        const raw = sheet[address] as XLSX.CellObject | undefined;
        if (!raw) continue;
        const text =
          typeof raw.w === "string" && raw.w.trim()
            ? raw.w.trim()
            : raw.v == null
              ? ""
              : String(raw.v).trim();
        if (!text) continue;
        const r = row + 1;
        const c = col + 1;
        cells.set(cellKey(r, c), {
          address: `${excelColLetter(c)}${r}`,
          row: r,
          col: c,
          text,
          style: {},
        });
      }
    }

    const merges: ExcelMergeModel[] = (sheet["!merges"] ?? []).map((merge) => ({
      top: merge.s.r + 1,
      left: merge.s.c + 1,
      bottom: merge.e.r + 1,
      right: merge.e.c + 1,
    }));

    const cols = sheet["!cols"] ?? [];
    cols.forEach((column, index) => {
      const col = index + 1;
      if (col > colCount) return;
      const width = column?.wpx ?? (typeof column?.wch === "number" ? column.wch * 9 : undefined);
      if (typeof width === "number" && width > 0) colWidths[col] = Math.max(40, Math.round(width));
    });

    sheets.push({
      name: sheetName || `Sheet${sheets.length + 1}`,
      rowCount,
      colCount,
      cells,
      merges,
      colWidths,
      rowHeights,
    });
  }

  return { sheets: sheets.length ? sheets : [emptySheet()] };
};

const looksLikeZip = (data: ArrayBuffer) => {
  const bytes = new Uint8Array(data);
  return bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b;
};

/** Parse an Excel workbook for the read-only ExtractIQ preview (does not mutate the file). */
export const parseExcelWorkbook = async (data: ArrayBuffer): Promise<ExcelWorkbookModel> => {
  // Prefer ExcelJS for OOXML (formatting). Fall back to SheetJS for .xls / parse failures.
  if (looksLikeZip(data)) {
    try {
      return await parseWithExcelJs(data);
    } catch {
      return parseWithSheetJs(data);
    }
  }
  return parseWithSheetJs(data);
};

export const excelCellKey = cellKey;
