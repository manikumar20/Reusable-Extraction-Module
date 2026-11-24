import {
  docPlainText,
  docxPlainText,
  excelPlainText,
  htmlPlainText,
  looksLikeHtml,
  officePlainText,
} from "../../extract/engine/read/documentText.js";
import type { SourceAdapter, TextSpan } from "../types.js";

const OFFICE_EXT = /\.(docx?|pptx?|odt|rtf)$/i;
const EXCEL_EXT = /\.(xlsx|xlsm|xls)$/i;

const toLineSpans = (text: string): TextSpan[] => {
  const lines = text.split(/\r?\n/);
  const spans: TextSpan[] = [];
  let offset = 0;
  lines.forEach((line, index) => {
    if (!line.trim()) {
      offset += line.length + 1;
      return;
    }
    spans.push({
      page: 1,
      text: line,
      start: offset,
      end: offset + line.length,
      x: 0,
      y: Math.min(99, (index / Math.max(lines.length, 1)) * 100),
      w: 100,
      h: Math.max(0.5, 100 / Math.max(lines.length, 1)),
    });
    offset += line.length + 1;
  });
  return spans;
};

export const officeAdapter: SourceAdapter = {
  id: "office",
  canHandle: ({ fileName, mimeType, buffer }) => {
    const mime = (mimeType ?? "").toLowerCase();
    // Spreadsheets are handled by excelAdapter (sheet + cell coords).
    if (EXCEL_EXT.test(fileName) || mime.includes("spreadsheet") || mime.includes("excel")) {
      return false;
    }
    return (
      OFFICE_EXT.test(fileName) ||
      mime.includes("word") ||
      mime.includes("presentation") ||
      mime.includes("msword") ||
      looksLikeHtml(buffer)
    );
  },
  extractSpans: async ({ fileName, buffer }) => {
    const lower = fileName.toLowerCase();
    const ext = lower.includes(".") ? lower.slice(lower.lastIndexOf(".")) : "";
    let text = "";
    try {
      if (ext === ".xlsx" || ext === ".xls" || ext === ".xlsm") text = excelPlainText(buffer);
      else if (ext === ".docx") text = await docxPlainText(buffer);
      else if (ext === ".doc") text = await docPlainText(buffer);
      else if (looksLikeHtml(buffer)) text = htmlPlainText(buffer);
      else text = await officePlainText(buffer, ext);
    } catch {
      text = "";
    }
    return toLineSpans(text);
  },
};
