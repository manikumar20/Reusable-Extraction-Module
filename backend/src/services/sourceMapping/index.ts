import { excelAdapter } from "./adapters/excelAdapter.js";
import { imageAdapter } from "./adapters/imageAdapter.js";
import { officeAdapter } from "./adapters/officeAdapter.js";
import { pdfAdapter } from "./adapters/pdfAdapter.js";
import { textAdapter } from "./adapters/textAdapter.js";
import { locateValueInSpans } from "./match.js";
import type { SourceAdapter, SourceLocation, TextSpan } from "./types.js";

export type { SourceLocation } from "./types.js";

/** Order matters: Excel before generic Office, specific binaries before plain text. */
const adapters: SourceAdapter[] = [
  pdfAdapter,
  excelAdapter,
  officeAdapter,
  imageAdapter,
  textAdapter,
];

const valueText = (value: unknown) => {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const pickAdapter = (input: { fileName: string; mimeType?: string; buffer: Buffer }) =>
  adapters.find((adapter) => {
    try {
      return adapter.canHandle(input);
    } catch {
      return false;
    }
  }) ?? null;

/**
 * Locate extracted field values in the original file bytes.
 * Does not call Claude. Returns locations keyed by `fieldKey#lineNumber`.
 */
export const mapExtractedSources = async (input: {
  fileName: string;
  mimeType?: string;
  buffer: Buffer;
  lines: { fields: Record<string, unknown> }[];
}): Promise<Record<string, SourceLocation[]>> => {
  const result: Record<string, SourceLocation[]> = {};
  if (!input.buffer?.length || !input.lines.length) return result;

  const adapter = pickAdapter(input);
  if (!adapter) return result;

  let spans;
  try {
    spans = await adapter.extractSpans(input);
  } catch {
    return result;
  }
  if (!spans.length) return result;

  // Excel cells are atomic — line/window enriching would drop sheet/cell coords.
  const enriched = adapter.id === "excel" ? spans : enrichSpans(spans);

  for (const [lineIndex, line] of input.lines.entries()) {
    for (const [fieldKey, raw] of Object.entries(line.fields ?? {})) {
      const value = valueText(raw);
      if (!value || value === "[]") continue;
      const key = `${fieldKey}#${lineIndex + 1}`;
      const locations = locateValueInSpans(enriched, value, adapter.id);
      if (locations.length) result[key] = locations;
    }
  }
  return result;
};

/** Attach locations onto each line's fields without changing Claude values. */
export const attachSourceLocations = async <
  T extends { fields: Record<string, unknown>; locations?: Record<string, SourceLocation[]> },
>(input: {
  fileName: string;
  mimeType?: string;
  buffer: Buffer;
  lines: T[];
}): Promise<T[]> => {
  const mapped = await mapExtractedSources(input);
  return input.lines.map((line, lineIndex) => {
    const locations: Record<string, SourceLocation[]> = { ...(line.locations ?? {}) };
    for (const fieldKey of Object.keys(line.fields ?? {})) {
      const key = `${fieldKey}#${lineIndex + 1}`;
      const found = mapped[key];
      if (found?.length) locations[fieldKey] = found;
    }
    return {
      ...line,
      locations: Object.keys(locations).length ? locations : undefined,
    };
  });
};

const LINE_Y_TOLERANCE = 1.35;
/** Max vertical gap (% of page) between consecutive lines that may form one value. */
const MULTI_LINE_GAP = 4.5;
const MAX_LINE_WINDOW = 5;

const unionBox = (list: TextSpan[]) => {
  const xs = list.map((span) => span.x ?? 0);
  const ys = list.map((span) => span.y ?? 0);
  const rights = list.map((span) => (span.x ?? 0) + (span.w ?? 0));
  const bottoms = list.map((span) => (span.y ?? 0) + (span.h ?? 0));
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    x,
    y,
    w: Math.max(0.4, Math.min(100 - x, Math.max(...rights) - x)),
    h: Math.max(0.4, Math.min(100 - y, Math.max(...bottoms) - y)),
  };
};

type LineUnit = {
  page: number;
  glyphs: TextSpan[];
  text: string;
  parts: TextSpan[];
  y: number;
  bottom: number;
};

const buildLineSpan = (page: number, glyphs: TextSpan[]): TextSpan => {
  const parts: TextSpan[] = [];
  let cursor = 0;
  const chunks: string[] = [];
  for (const glyph of glyphs) {
    if (chunks.length) {
      chunks.push(" ");
      cursor += 1;
    }
    const start = cursor;
    chunks.push(glyph.text);
    cursor += glyph.text.length;
    parts.push({
      ...glyph,
      start,
      end: cursor,
    });
  }
  return {
    page,
    text: chunks.join(""),
    start: 0,
    end: cursor,
    ...unionBox(glyphs),
    parts,
  };
};

const joinLineUnits = (page: number, lines: LineUnit[]): TextSpan => {
  const parts: TextSpan[] = [];
  let cursor = 0;
  const textParts: string[] = [];
  for (const [lineIndex, line] of lines.entries()) {
    if (lineIndex > 0) {
      textParts.push(" ");
      cursor += 1;
    }
    for (const [glyphIndex, glyph] of line.glyphs.entries()) {
      if (glyphIndex > 0) {
        textParts.push(" ");
        cursor += 1;
      }
      const start = cursor;
      textParts.push(glyph.text);
      cursor += glyph.text.length;
      parts.push({
        ...glyph,
        start,
        end: cursor,
      });
    }
  }
  const glyphs = lines.flatMap((line) => line.glyphs);
  return {
    page,
    text: textParts.join(""),
    start: 0,
    end: cursor,
    ...unionBox(glyphs),
    parts,
  };
};

/** Build per-line and multi-line joined spans so titles/descriptions split across lines still match. */
const enrichSpans = (spans: TextSpan[]) => {
  if (spans.length < 2) return spans;
  const merged: TextSpan[] = [...spans];

  const byPage = new Map<number, TextSpan[]>();
  for (const span of spans) {
    const list = byPage.get(span.page) ?? [];
    list.push(span);
    byPage.set(span.page, list);
  }

  for (const [page, list] of byPage) {
    const ordered = [...list].sort((left, right) => {
      const yDelta = (left.y ?? 0) - (right.y ?? 0);
      if (Math.abs(yDelta) > 0.01) return yDelta;
      return (left.x ?? 0) - (right.x ?? 0);
    });

    const lines: LineUnit[] = [];
    let glyphs: TextSpan[] = [];

    const flushLine = () => {
      if (!glyphs.length) return;
      const span = buildLineSpan(page, glyphs);
      const y = Math.min(...glyphs.map((g) => g.y ?? 0));
      const bottom = Math.max(...glyphs.map((g) => (g.y ?? 0) + (g.h ?? 0)));
      lines.push({ page, glyphs: [...glyphs], text: span.text, parts: span.parts ?? [], y, bottom });
      if (glyphs.length >= 1) merged.push(span);
      glyphs = [];
    };

    for (const span of ordered) {
      if (!glyphs.length) {
        glyphs = [span];
        continue;
      }
      const prev = glyphs[glyphs.length - 1]!;
      const sameLine = Math.abs((span.y ?? 0) - (prev.y ?? 0)) <= LINE_Y_TOLERANCE;
      if (sameLine) glyphs.push(span);
      else {
        flushLine();
        glyphs = [span];
      }
    }
    flushLine();

    // Windows of consecutive nearby lines (titles, wrapped descriptions).
    for (let size = 2; size <= Math.min(MAX_LINE_WINDOW, lines.length); size += 1) {
      for (let start = 0; start + size <= lines.length; start += 1) {
        const window = lines.slice(start, start + size);
        let ok = true;
        for (let i = 1; i < window.length; i += 1) {
          const gap = window[i]!.y - window[i - 1]!.bottom;
          if (gap > MULTI_LINE_GAP) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
        merged.push(joinLineUnits(page, window));
      }
    }
  }

  return merged;
};
