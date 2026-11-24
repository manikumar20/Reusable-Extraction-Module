import { candidateValues, compactValue, normalizeValue } from "./normalize.js";
import type { SourceLocation, TextSpan } from "./types.js";

type Hit = {
  span: TextSpan;
  confidence: SourceLocation["confidence"];
  quote: string;
  matchStart: number;
  matchLength: number;
};

const findInHaystack = (
  haystack: string,
  needle: string,
): { index: number; length: number; confidence: SourceLocation["confidence"] } | null => {
  if (!needle) return null;
  const exact = haystack.indexOf(needle);
  if (exact >= 0) return { index: exact, length: needle.length, confidence: "exact" };

  const normHay = normalizeValue(haystack);
  const normNeedle = normalizeValue(needle);
  if (normNeedle.length < 2) return null;
  const normIndex = normHay.indexOf(normNeedle);
  if (normIndex >= 0) {
    // Map normalized index approximately back by scanning original.
    let seen = 0;
    for (let i = 0; i < haystack.length; i += 1) {
      const ch = haystack[i] ?? "";
      if (/\s/.test(ch) && (i === 0 || /\s/.test(haystack[i - 1] ?? ""))) continue;
      if (seen === normIndex) {
        return { index: i, length: Math.max(needle.length, normNeedle.length), confidence: "normalized" };
      }
      if (!/\s/.test(ch)) seen += 1;
      else if (i > 0 && !/\s/.test(haystack[i - 1] ?? "")) seen += 1;
    }
    return { index: 0, length: needle.length, confidence: "normalized" };
  }

  const compactHay = compactValue(haystack);
  const compactNeedle = compactValue(needle);
  if (compactNeedle.length >= 4 && compactHay.includes(compactNeedle)) {
    return { index: 0, length: needle.length, confidence: "normalized" };
  }
  return null;
};

const spanArea = (span: TextSpan) => Math.max(0.01, (span.w ?? 100) * (span.h ?? 100));

/** Prefer tight, exact, short-span hits over page-wide joins. */
const scoreHit = (hit: Hit) => {
  let score = hit.confidence === "exact" ? 120 : 60;
  score -= Math.min(50, spanArea(hit.span) / 40);
  score -= Math.min(35, (hit.span.text?.length ?? 0) / 18);
  // Prefer matches that consume most of a short span (token-level).
  const coverage =
    hit.span.text.length > 0 ? Math.min(1, hit.matchLength / hit.span.text.length) : 0;
  if (hit.span.text.length <= 80) score += coverage * 25;
  // Prefer earlier pages and higher-on-page occurrences for repeated headers/footers.
  score -= Math.min(20, (hit.span.page - 1) * 0.35);
  score -= Math.min(15, (hit.span.y ?? 50) * 0.08);
  return score;
};

const refineBox = (span: TextSpan, matchStart: number, matchLength: number) => {
  const parts = span.parts;
  if (parts?.length) {
    const matched = parts.filter(
      (part) => part.end > matchStart && part.start < matchStart + matchLength,
    );
    if (matched.length) {
      const xs = matched.map((part) => part.x ?? 0);
      const ys = matched.map((part) => part.y ?? 0);
      const rights = matched.map((part) => (part.x ?? 0) + (part.w ?? 0));
      const bottoms = matched.map((part) => (part.y ?? 0) + (part.h ?? 0));
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      return {
        x,
        y,
        w: Math.max(0.4, Math.min(100 - x, Math.max(...rights) - x)),
        h: Math.max(0.4, Math.min(100 - y, Math.max(...bottoms) - y)),
        start: matchStart,
        end: matchStart + matchLength,
      };
    }
  }

  const textLen = Math.max(1, span.text.length);
  const startRatio = Math.max(0, Math.min(1, matchStart / textLen));
  const endRatio = Math.max(startRatio, Math.min(1, (matchStart + matchLength) / textLen));
  const baseX = span.x ?? 0;
  const baseW = span.w ?? 10;
  const x = baseX + baseW * startRatio;
  const w = Math.max(0.4, baseW * (endRatio - startRatio));
  return {
    x,
    y: span.y,
    w: Math.min(100 - x, w),
    h: span.h,
    start: matchStart,
    end: matchStart + matchLength,
  };
};

const pickBestHits = (hits: Hit[]): Hit[] => {
  if (hits.length <= 1) return hits;

  const ranked = [...hits].sort((left, right) => scoreHit(right) - scoreHit(left));
  const best = ranked[0]!;
  const bestScore = scoreHit(best);

  // Prefer a single clear box — stacked near-ties (line + multi-line join)
  // produce overlapping misaligned highlights in the viewer.
  const samePage = ranked.filter(
    (hit) => hit.span.page === best.span.page && scoreHit(hit) >= bestScore - 8,
  );
  if (samePage.length) {
    // Prefer the hit whose match covers more of the value with a tighter box.
    const preferred = [...samePage].sort((left, right) => {
      const leftParts = left.span.parts?.length ?? 0;
      const rightParts = right.span.parts?.length ?? 0;
      // Multi-line joins (with parts) beat single glyph lines when scores are close.
      if (leftParts !== rightParts) return rightParts - leftParts;
      return scoreHit(right) - scoreHit(left);
    })[0]!;
    return [preferred];
  }

  // Clear winner on one page vs weak hits elsewhere.
  const pages = new Set(ranked.map((hit) => hit.span.page));
  if (pages.size > 1) {
    const second = ranked[1];
    if (second && scoreHit(second) >= bestScore - 5) return [];
  }
  return [best];
};

const collectHits = (spans: TextSpan[], candidates: string[]): Hit[] => {
  const hits: Hit[] = [];
  for (const span of spans) {
    for (const candidate of candidates) {
      const found = findInHaystack(span.text, candidate);
      if (!found) continue;
      hits.push({
        span,
        confidence: found.confidence,
        quote: span.text.slice(
          Math.max(0, found.index),
          Math.min(span.text.length, found.index + found.length),
        ),
        matchStart: found.index,
        matchLength: found.length,
      });
      break;
    }
  }
  return hits;
};

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "of",
  "to",
  "in",
  "on",
  "for",
  "with",
  "from",
  "by",
  "at",
  "as",
  "is",
  "are",
  "was",
  "were",
  "this",
  "that",
  "these",
  "those",
  "into",
  "over",
  "under",
  "about",
  "covering",
  "focus",
  "including",
]);

/** When the full value is paraphrased, locate the longest exact word-window still in the PDF. */
const phraseFallbackHits = (spans: TextSpan[], value: string): Hit[] => {
  const words = value
    .trim()
    .split(/\s+/)
    .map((word) => word.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, ""))
    .filter((word) => word.length > 1);
  if (words.length < 3) return [];

  for (let len = Math.min(words.length, 10); len >= 3; len -= 1) {
    const phrases: string[] = [];
    for (let i = 0; i <= words.length - len; i += 1) {
      phrases.push(words.slice(i, i + len).join(" "));
    }
    const hits = collectHits(spans, phrases);
    if (hits.length) return hits;
  }
  return [];
};

/** Last resort for Claude paraphrases: span that contains the most distinctive keywords. */
const keywordOverlapHits = (spans: TextSpan[], value: string): Hit[] => {
  const keywords = [
    ...new Set(
      value
        .trim()
        .split(/\s+/)
        .map((word) => word.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, ""))
        .map((word) => word.toLowerCase())
        .filter((word) => word.length >= 4 && !STOP_WORDS.has(word)),
    ),
  ];
  if (keywords.length < 2) return [];

  let best: { span: TextSpan; score: number; quote: string } | null = null;
  for (const span of spans) {
    const hay = normalizeValue(span.text);
    if (hay.length < 8) continue;
    let score = 0;
    const matched: string[] = [];
    for (const word of keywords) {
      if (hay.includes(word)) {
        score += 1;
        matched.push(word);
      }
    }
    if (score < 2) continue;
    if (!best || score > best.score || (score === best.score && span.text.length < best.span.text.length)) {
      best = { span, score, quote: matched.slice(0, 4).join(" ") };
    }
  }
  if (!best || best.score < 2) return [];
  return [
    {
      span: best.span,
      confidence: "normalized",
      quote: best.quote || best.span.text.slice(0, 120),
      matchStart: 0,
      matchLength: Math.min(best.span.text.length, Math.max(12, best.quote.length)),
    },
  ];
};

/** Prefer a unique / high-confidence occurrence. */
export const locateValueInSpans = (
  spans: TextSpan[],
  value: string,
  adapter: SourceLocation["adapter"],
  context?: string,
): SourceLocation[] => {
  const candidates = candidateValues(value);
  if (!candidates.length || !spans.length) return [];

  let hits = collectHits(spans, candidates);
  if (!hits.length) hits = phraseFallbackHits(spans, value);
  if (!hits.length) hits = keywordOverlapHits(spans, value);
  if (!hits.length) return [];

  let pool = hits;
  if (hits.length > 1 && context?.trim()) {
    const ctx = normalizeValue(context);
    const contextual = hits.filter((hit) => normalizeValue(hit.span.text).includes(ctx));
    // Only narrow when context actually appears in source text — never drop all hits.
    if (contextual.length) pool = contextual;
  }

  const chosen = pickBestHits(pool);
  if (!chosen.length) return [];

  return chosen.map((hit) => {
    const box = refineBox(hit.span, hit.matchStart, hit.matchLength);
    return {
      adapter,
      page: hit.span.page,
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      start: box.start,
      end: box.end,
      quote: hit.quote || hit.span.text.slice(0, 120),
      confidence: hit.confidence,
      ...(hit.span.sheet ? { sheet: hit.span.sheet } : {}),
      ...(hit.span.cell ? { cell: hit.span.cell } : {}),
      ...(typeof hit.span.row === "number" ? { row: hit.span.row } : {}),
      ...(typeof hit.span.col === "number" ? { col: hit.span.col } : {}),
    };
  });
};
