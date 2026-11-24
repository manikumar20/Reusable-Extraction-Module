import { getDocumentProxy } from "unpdf";
import type { SourceAdapter, TextSpan } from "../types.js";

type PdfJsTextItem = {
  str?: string;
  transform?: number[];
  width?: number;
  height?: number;
};

type PdfViewport = {
  width: number;
  height: number;
  convertToViewportRectangle?: (rect: number[]) => number[];
};

const isPdfPasswordError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const name = error instanceof Error ? error.name : "";
  return name === "PasswordException" || /password/i.test(message);
};

const openPdf = async (buffer: Buffer) => {
  const data = new Uint8Array(buffer);
  try {
    return await getDocumentProxy(data, { password: "" });
  } catch (error) {
    if (!isPdfPasswordError(error)) throw error;
    return getDocumentProxy(data);
  }
};

const isPdfBuffer = (buffer: Buffer) =>
  buffer.length >= 5 && buffer.subarray(0, 5).toString("latin1") === "%PDF-";

/** Convert a PDF-space glyph box to top-left percent coordinates. */
const glyphBoxPercent = (
  viewport: PdfViewport,
  item: PdfJsTextItem,
  text: string,
): { x: number; y: number; w: number; h: number } => {
  const transform = item.transform ?? [];
  const xPdf = transform[4] ?? 0;
  const yPdf = transform[5] ?? 0;
  // Font size from the text matrix vertical scale; fall back to item.height.
  const fontSize = Math.max(
    Math.abs(transform[3] ?? 0),
    Math.abs(item.height ?? 0),
    6,
  );
  const width = Math.max(item.width ?? text.length * fontSize * 0.5, fontSize * 0.5);
  // PDF text origin is the baseline; glyphs mostly sit above it.
  // Use a slightly smaller ascent so boxes don't float above the ink.
  const ascent = fontSize * 0.82;
  const descent = fontSize * 0.18;
  const pageWidth = Math.max(1, viewport.width || 1);
  const pageHeight = Math.max(1, viewport.height || 1);

  if (typeof viewport.convertToViewportRectangle === "function") {
    const rect = viewport.convertToViewportRectangle([
      xPdf,
      yPdf - descent,
      xPdf + width,
      yPdf + ascent,
    ]);
    const left = Math.min(rect[0] ?? 0, rect[2] ?? 0);
    const top = Math.min(rect[1] ?? 0, rect[3] ?? 0);
    const right = Math.max(rect[0] ?? 0, rect[2] ?? 0);
    const bottom = Math.max(rect[1] ?? 0, rect[3] ?? 0);
    const x = Math.max(0, Math.min(100, (left / pageWidth) * 100));
    const y = Math.max(0, Math.min(100, (top / pageHeight) * 100));
    const w = Math.max(0.5, Math.min(100 - x, ((right - left) / pageWidth) * 100));
    const h = Math.max(0.7, Math.min(100 - y, ((bottom - top) / pageHeight) * 100));
    return { x, y, w, h };
  }

  const x = Math.max(0, Math.min(100, (xPdf / pageWidth) * 100));
  const y = Math.max(0, Math.min(100, ((pageHeight - yPdf - ascent) / pageHeight) * 100));
  const w = Math.max(0.5, Math.min(100 - x, (width / pageWidth) * 100));
  const h = Math.max(0.7, Math.min(100 - y, ((ascent + descent) / pageHeight) * 100));
  return { x, y, w, h };
};

export const pdfAdapter: SourceAdapter = {
  id: "pdf",
  canHandle: ({ fileName, mimeType, buffer }) => {
    const lower = fileName.toLowerCase();
    return (
      lower.endsWith(".pdf") ||
      (mimeType ?? "").toLowerCase().includes("pdf") ||
      isPdfBuffer(buffer)
    );
  },
  extractSpans: async ({ buffer }) => {
    const pdf = await openPdf(buffer);
    const spans: TextSpan[] = [];
    try {
      const total = pdf.numPages;
      for (let pageNumber = 1; pageNumber <= total; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        try {
          const viewport = page.getViewport({ scale: 1 }) as PdfViewport;
          const content = await page.getTextContent();
          for (const raw of content.items) {
            const item = raw as PdfJsTextItem;
            const text = (item.str ?? "").trim();
            if (!text) continue;
            const box = glyphBoxPercent(viewport, item, text);
            spans.push({
              page: pageNumber,
              text,
              start: 0,
              end: text.length,
              ...box,
            });
          }
        } finally {
          page.cleanup?.();
        }
      }
    } finally {
      try {
        await pdf.cleanup();
        await pdf.loadingTask.destroy();
      } catch {
        /* ignore */
      }
    }
    return spans;
  },
};
