import type { SourceAdapter, TextSpan } from "../types.js";

const TEXT_EXT = /\.(txt|csv|tsv|json|xml|md|log|html?|ya?ml|ini|conf|properties)$/i;

/** Heuristic: buffer is mostly printable UTF-8 / ASCII. */
export const looksLikePlainText = (buffer: Buffer) => {
  if (!buffer.length) return false;
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  let printable = 0;
  for (const byte of sample) {
    if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte < 127) || byte >= 160) {
      printable += 1;
    }
  }
  return printable / sample.length >= 0.85;
};

export const textAdapter: SourceAdapter = {
  id: "text",
  canHandle: ({ fileName, mimeType, buffer }) => {
    const mime = (mimeType ?? "").toLowerCase();
    return (
      TEXT_EXT.test(fileName) ||
      mime.startsWith("text/") ||
      mime.includes("json") ||
      mime.includes("xml") ||
      mime.includes("csv") ||
      // Universal fallback for unknown extensions that are still readable text.
      looksLikePlainText(buffer)
    );
  },
  extractSpans: async ({ buffer }) => {
    const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
    const lines = text.split(/\r?\n/);
    const spans: TextSpan[] = [];
    let offset = 0;
    lines.forEach((line, index) => {
      const content = line;
      spans.push({
        page: 1,
        text: content,
        start: offset,
        end: offset + content.length,
        x: 0,
        y: Math.min(99, (index / Math.max(lines.length, 1)) * 100),
        w: 100,
        h: Math.max(0.5, 100 / Math.max(lines.length, 1)),
      });
      offset += content.length + 1;
    });
    if (!spans.length && text) {
      spans.push({ page: 1, text, start: 0, end: text.length, x: 0, y: 0, w: 100, h: 2 });
    }
    return spans;
  },
};
