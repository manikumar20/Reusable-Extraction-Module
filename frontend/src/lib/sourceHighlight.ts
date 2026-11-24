import type { SourceLocation } from "@/types";

/** Boxes with usable percent coordinates (PDF / overlay adapters). */
export const boxesForPage = (locations: SourceLocation[] | null | undefined, page: number) =>
  (locations ?? []).filter(
    (loc) =>
      loc.page === page &&
      typeof loc.x === "number" &&
      typeof loc.y === "number" &&
      typeof loc.w === "number" &&
      typeof loc.h === "number",
  );

export const primaryLocation = (locations: SourceLocation[] | null | undefined) =>
  locations?.find((loc) => typeof loc.page === "number") ?? null;

export const hasMappableLocation = (locations: SourceLocation[] | null | undefined) => {
  if (!locations?.length) return false;
  return locations.some(
    (loc) =>
      (typeof loc.x === "number" && typeof loc.y === "number") ||
      (typeof loc.start === "number" && typeof loc.end === "number") ||
      Boolean(loc.quote?.trim()) ||
      Boolean(loc.sheet && (loc.cell || (typeof loc.row === "number" && typeof loc.col === "number"))) ||
      Boolean(loc.cell) ||
      (typeof loc.row === "number" && typeof loc.col === "number"),
  );
};

/** Build mark ranges for a plain-text body from offset-based locations. */
export const textMarkRanges = (
  body: string,
  locations: SourceLocation[] | null | undefined,
): { start: number; end: number; active: boolean }[] => {
  if (!body || !locations?.length) return [];
  const ranges: { start: number; end: number; active: boolean }[] = [];
  for (const loc of locations) {
    if (typeof loc.start === "number" && typeof loc.end === "number" && loc.end > loc.start) {
      ranges.push({
        start: Math.max(0, Math.min(body.length, loc.start)),
        end: Math.max(0, Math.min(body.length, loc.end)),
        active: true,
      });
      continue;
    }
    const quote = loc.quote?.trim();
    if (!quote) continue;
    const index = body.indexOf(quote);
    if (index < 0) continue;
    ranges.push({ start: index, end: index + quote.length, active: true });
  }
  return ranges
    .filter((range) => range.end > range.start)
    .sort((a, b) => a.start - b.start);
};

/** Render plain text with <mark> spans for highlight ranges (non-overlapping). */
export const renderMarkedText = (
  body: string,
  ranges: { start: number; end: number; active: boolean }[],
): { kind: "text" | "mark"; text: string; active?: boolean }[] => {
  if (!ranges.length) return [{ kind: "text", text: body }];
  const parts: { kind: "text" | "mark"; text: string; active?: boolean }[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start < cursor) continue;
    if (range.start > cursor) {
      parts.push({ kind: "text", text: body.slice(cursor, range.start) });
    }
    parts.push({
      kind: "mark",
      text: body.slice(range.start, range.end),
      active: range.active,
    });
    cursor = range.end;
  }
  if (cursor < body.length) parts.push({ kind: "text", text: body.slice(cursor) });
  return parts;
};

/** Candidate search strings for DOCX DOM highlighting (quote + value + short phrases). */
export const highlightNeedlesFor = (
  locations: SourceLocation[] | null | undefined,
  value?: string | null,
): string[] => {
  const out: string[] = [];
  const push = (raw?: string | null) => {
    const text = raw?.trim();
    if (!text || text.length < 2 || text.length > 220) return;
    if (!out.includes(text)) out.push(text);
  };
  for (const loc of locations ?? []) push(loc.quote);
  push(value);
  const words = (value || "").trim().split(/\s+/).filter(Boolean);
  if (words.length >= 3) {
    push(words.slice(0, 3).join(" "));
    push(words.slice(0, Math.min(6, words.length)).join(" "));
  }
  // Longer needles first so we prefer full values over short fragments.
  return out.sort((left, right) => right.length - left.length);
};

type TextPiece = { node: Text; start: number; end: number };

const collectTextPieces = (root: HTMLElement): { haystack: string; pieces: TextPiece[] } => {
  const pieces: TextPiece[] = [];
  let haystack = "";
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = (node as Text).parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest("[data-docx-style-root], script, style, noscript")) {
        return NodeFilter.FILTER_REJECT;
      }
      if (!(node.textContent || "").length) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let current: Node | null = walker.nextNode();
  while (current) {
    const text = current.textContent ?? "";
    const start = haystack.length;
    haystack += text;
    pieces.push({ node: current as Text, start, end: haystack.length });
    current = walker.nextNode();
  }
  return { haystack, pieces };
};

const softenText = (value: string) =>
  value
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u00a0/g, " ");

const indexInHaystack = (haystack: string, needle: string): { index: number; length: number } | null => {
  if (!needle) return null;
  const exact = haystack.indexOf(needle);
  if (exact >= 0) return { index: exact, length: needle.length };

  const softHay = softenText(haystack);
  const softNeedle = softenText(needle);
  const softExact = softHay.indexOf(softNeedle);
  if (softExact >= 0) return { index: softExact, length: softNeedle.length };

  const lower = softHay.toLowerCase();
  const lowerNeedle = softNeedle.toLowerCase();
  const soft = lower.indexOf(lowerNeedle);
  if (soft >= 0) return { index: soft, length: lowerNeedle.length };

  // Ignore extra whitespace differences between Word runs and extracted values.
  const compactHay = lower.replace(/\s+/g, " ").trim();
  const compactNeedle = lowerNeedle.replace(/\s+/g, " ").trim();
  if (compactNeedle.length >= 3) {
    const compactIndex = compactHay.indexOf(compactNeedle);
    if (compactIndex >= 0) {
      let seen = 0;
      for (let i = 0; i < lower.length; i += 1) {
        const ch = lower[i] ?? "";
        if (/\s/.test(ch)) {
          if (i > 0 && !/\s/.test(lower[i - 1] ?? "")) seen += 1;
          continue;
        }
        if (seen === compactIndex) {
          return { index: i, length: Math.min(softNeedle.length, lower.length - i) };
        }
        seen += 1;
      }
    }
  }
  return null;
};

const rangeFromOffsets = (
  pieces: TextPiece[],
  start: number,
  end: number,
): Range | null => {
  if (end <= start || !pieces.length) return null;
  let startPiece: TextPiece | null = null;
  let endPiece: TextPiece | null = null;
  for (const piece of pieces) {
    if (!startPiece && start >= piece.start && start < piece.end) startPiece = piece;
    if (end > piece.start && end <= piece.end) endPiece = piece;
  }
  if (!startPiece) startPiece = pieces.find((piece) => piece.end > start) ?? null;
  if (!endPiece) endPiece = [...pieces].reverse().find((piece) => piece.start < end) ?? null;
  if (!startPiece || !endPiece) return null;
  const range = document.createRange();
  range.setStart(startPiece.node, Math.max(0, start - startPiece.start));
  range.setEnd(endPiece.node, Math.max(0, Math.min(endPiece.node.length, end - endPiece.start)));
  return range;
};

const wrapRangeWithMark = (range: Range, className: string): HTMLElement | null => {
  const mark = document.createElement("mark");
  mark.className = className;
  try {
    range.surroundContents(mark);
    return mark;
  } catch {
    try {
      const contents = range.extractContents();
      mark.appendChild(contents);
      range.insertNode(mark);
      return mark;
    } catch {
      return null;
    }
  }
};

/**
 * Highlight the first matching needle inside a rendered DOCX DOM.
 * Handles text split across many Word runs/spans.
 */
export const highlightDocxNeedles = (
  root: HTMLElement,
  needles: string[],
  className = "src-hl-docx src-hl-active",
): HTMLElement | null => {
  const searchRoot =
    root.querySelector<HTMLElement>("[data-docx-body-root]") ?? root;
  const { haystack, pieces } = collectTextPieces(searchRoot);
  if (!haystack || !pieces.length || !needles.length) return null;

  for (const needle of needles) {
    const found = indexInHaystack(haystack, needle);
    if (!found) continue;
    const range = rangeFromOffsets(pieces, found.index, found.index + Math.max(1, found.length));
    if (!range || range.collapsed) continue;
    const mark = wrapRangeWithMark(range, className);
    if (mark) return mark;
  }
  return null;
};

/** Remove previous DOCX highlight marks and restore plain text nodes. */
export const clearDocxHighlights = (root: HTMLElement) => {
  root.querySelectorAll("mark.src-hl-docx").forEach((node) => {
    const parent = node.parentNode;
    if (!parent) return;
    parent.replaceChild(document.createTextNode(node.textContent ?? ""), node);
    parent.normalize();
  });
};
