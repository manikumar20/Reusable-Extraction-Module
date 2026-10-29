import { createRequire } from "node:module";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { getDocumentProxy } from "unpdf";
import { MIN_USABLE_TEXT_CHARS, PDF_PART_PAGES } from "../shared/constants.js";

export { PDF_PART_PAGES };

const require = createRequire(import.meta.url);
const WordExtractor = require("word-extractor") as new () => {
  extract: (source: Buffer) => Promise<{ getBody: () => string }>;
};
const XLSX = require("xlsx") as {
  read: (
    data: Buffer,
    opts?: { type: string; cellDates?: boolean },
  ) => {
    SheetNames: string[];
    Sheets: Record<string, unknown>;
  };
  utils: {
    sheet_to_json: (
      sheet: unknown,
      opts: { header: number; defval: string; raw: boolean },
    ) => unknown[][];
  };
};

type PdfTextItem = {
  str: string;
  x: number;
  y: number;
  height: number;
};

const asText = (value: unknown) => {
  if (value === null || value === undefined) return "";
  return String(value).trim();
};

const decodeXml = (value: string) =>
  value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (match, hex: string) => {
      const code = Number.parseInt(hex, 16);
      if (!Number.isFinite(code)) return match;
      return String.fromCodePoint(code);
    })
    .replace(/&#(\d+);/g, (match, digits: string) => {
      const code = Number(digits);
      if (!Number.isFinite(code)) return match;
      return String.fromCodePoint(code);
    });

const isOleCompound = (buffer: Buffer) =>
  buffer.length >= 4 &&
  buffer[0] === 0xd0 &&
  buffer[1] === 0xcf &&
  buffer[2] === 0x11 &&
  buffer[3] === 0xe0;

const isZip = (buffer: Buffer) =>
  buffer.length >= 4 &&
  buffer[0] === 0x50 &&
  buffer[1] === 0x4b &&
  (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07) &&
  (buffer[3] === 0x04 || buffer[3] === 0x06 || buffer[3] === 0x08);

const decodeHtmlBuffer = (buffer: Buffer) => {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.subarray(2).toString("utf16le");
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.alloc(buffer.length - 2 - ((buffer.length - 2) % 2));
    for (let index = 2; index + 1 < buffer.length; index += 2) {
      swapped[index - 2] = buffer[index + 1] ?? 0;
      swapped[index - 1] = buffer[index] ?? 0;
    }
    return swapped.toString("utf16le");
  }
  const text = buffer.toString("utf8");
  if (text.charCodeAt(0) === 0xfeff) return text.slice(1);
  return text;
};

export const looksLikeHtml = (buffer: Buffer) => {
  if (isOleCompound(buffer) || isZip(buffer)) return false;
  if (buffer.subarray(0, 5).toString("latin1") === "%PDF-") return false;
  const head = decodeHtmlBuffer(buffer.subarray(0, Math.min(buffer.length, 1200)))
    .trim()
    .slice(0, 500)
    .toLowerCase();
  return (
    head.startsWith("<html") ||
    head.startsWith("<!doctype") ||
    head.startsWith("<!--") ||
    head.startsWith("<table") ||
    head.includes("<html")
  );
};

const cleanHtmlLine = (line: string) =>
  line
    .replace(/\u00a0/g, " ")
    .split("\t")
    .map((cell) => cell.replace(/[ \t]+/g, " ").trim())
    .filter((cell) => cell.length > 0)
    .join("\t");

const htmlCellText = (cell: string) =>
  decodeXml(cell.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const htmlRowLine = (rowHtml: string) =>
  rowHtml
    .split(/<t[dh]\b[^>]*>/i)
    .slice(1)
    .map((cell) => htmlCellText(cell.split(/<\/t[dh]>/i)[0] ?? ""))
    .filter((cell) => cell.length > 0)
    .join("\t");

export const htmlPlainText = (buffer: Buffer) => {
  let html = decodeHtmlBuffer(buffer)
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  let previous = "";
  while (html !== previous) {
    previous = html;
    html = html.replace(
      /<tr\b[^>]*>(?:(?!<tr\b)[\s\S])*?<\/tr>/gi,
      (row) => `\n${htmlRowLine(row)}\n`,
    );
  }
  const text = decodeXml(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|h[1-6]|li|table|section)>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  );
  return text
    .split("\n")
    .map(cleanHtmlLine)
    .filter((line) => line.length > 0)
    .join("\n");
};

const linesFromItems = (items: PdfTextItem[]) => {
  const ordered = items
    .filter((item) => item.str.trim())
    .sort((left, right) => {
      const tolerance = Math.max(left.height, right.height, 2) * 0.5;
      if (Math.abs(left.y - right.y) > tolerance) return right.y - left.y;
      return left.x - right.x;
    });
  const rows: string[] = [];
  let cells: string[] = [];
  let currentY = Number.NaN;
  let lastX = 0;
  const flush = () => {
    const line = cells.join("\t").trim();
    if (line) rows.push(line);
    cells = [];
  };
  ordered.forEach((item) => {
    const text = item.str.trim();
    if (!text) return;
    const tolerance = Math.max(item.height, 2) * 0.5;
    if (Number.isNaN(currentY) || Math.abs(item.y - currentY) > tolerance) {
      flush();
      cells = [text];
      currentY = item.y;
      lastX = item.x;
      return;
    }
    if (item.x - lastX > 8) cells.push(text);
    else cells[cells.length - 1] = `${cells[cells.length - 1]} ${text}`.trim();
    lastX = item.x;
  });
  flush();
  return rows.join("\n");
};

export const textIsUsable = (text: string) =>
  text.replace(/\s/g, "").length >= MIN_USABLE_TEXT_CHARS;

export const excelPlainText = (buffer: Buffer) => {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const lines: string[] = [];
  workbook.SheetNames.forEach((name) => {
    lines.push(`# ${name}`);
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[name], {
      header: 1,
      defval: "",
      raw: false,
    });
    rows.forEach((row) => {
      lines.push(row.map((cell) => asText(cell)).join("\t"));
    });
  });
  return lines.join("\n");
};

export const docxPlainText = async (buffer: Buffer) => {
  const zip = await JSZip.loadAsync(buffer);
  const file = zip.file("word/document.xml");
  if (!file) return "";
  const xml = await file.async("string");
  return decodeXml(
    xml
      .replace(/<w:tab\/>/g, "\t")
      .replace(/<\/w:tr>/g, "\n")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<\/w:tc>/g, "\t")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

export const docPlainText = async (buffer: Buffer) => {
  const extractor = new WordExtractor();
  const document = await extractor.extract(buffer);
  return document.getBody().trim();
};

export const officePlainText = async (buffer: Buffer, ext: string) => {
  if (looksLikeHtml(buffer)) return htmlPlainText(buffer);
  if (isZip(buffer)) {
    if (ext === ".xls" || ext === ".xlsx") return excelPlainText(buffer);
    if (ext === ".doc" || ext === ".docx") return docxPlainText(buffer);
    const zip = await JSZip.loadAsync(buffer);
    if (zip.file("word/document.xml")) return docxPlainText(buffer);
    if (zip.file("xl/workbook.xml")) return excelPlainText(buffer);
    return "";
  }
  if (ext === ".xls" || ext === ".xlsx") return excelPlainText(buffer);
  if (ext === ".docx") return docxPlainText(buffer);
  if (ext === ".doc" && isOleCompound(buffer)) return docPlainText(buffer);
  if (ext === ".doc") return htmlPlainText(buffer);
  return "";
};

type PdfJsTextItem = {
  str?: string;
  transform?: number[];
  height?: number;
};

export const pdfRowText = async (
  buffer: Buffer,
  onPage?: (done: number, total: number) => Promise<void>,
) => {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const total = pdf.numPages;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= total; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const items = content.items.flatMap((item) => {
      const row = item as PdfJsTextItem;
      const text = row.str ?? "";
      if (!text.trim()) return [];
      const transform = row.transform ?? [];
      return [
        {
          str: text,
          x: transform[4] ?? 0,
          y: transform[5] ?? 0,
          height: row.height ?? 0,
        },
      ];
    });
    const lines = linesFromItems(items);
    if (lines) pages.push(lines);
    if (onPage) await onPage(pageNumber, total);
  }
  return { pageCount: total, text: pages.join("\n") };
};

export const splitPdfParts = async (
  buffer: Buffer,
  pageSize = PDF_PART_PAGES,
) => {
  const source = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const pageCount = source.getPageCount();
  if (pageCount <= pageSize) return [buffer];
  const partCount = Math.ceil(pageCount / pageSize);
  const parts: Buffer[] = [];
  for (let index = 0; index < partCount; index += 1) {
    const start = Math.floor((pageCount * index) / partCount);
    const end = Math.floor((pageCount * (index + 1)) / partCount);
    const part = await PDFDocument.create();
    const pages = await part.copyPages(
      source,
      Array.from({ length: end - start }, (_, offset) => start + offset),
    );
    pages.forEach((page) => part.addPage(page));
    parts.push(Buffer.from(await part.save()));
  }
  return parts;
};
