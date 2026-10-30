/**
 * Fixed values used in more than one place.
 * Field keys and descriptions stay in shared/fields.ts. Prompt sentences stay in shared/prompt.ts.
 */

export const FIELD_DATA_TYPES = {
  TEXT: "TEXT",
  NUMBER: "NUMBER",
  DATE: "DATE",
  CODE: "CODE",
  ENUM: "ENUM",
  LIST: "LIST",
  KEY_VALUE: "KEY_VALUE",
  MANUFACTURER_LIST: "MANUFACTURER_LIST",
} as const;

export type FieldDataType =
  (typeof FIELD_DATA_TYPES)[keyof typeof FIELD_DATA_TYPES];

export const ITEM_SCOPES = ["FULL", "PARTIAL", "PART"] as const;

export const EXTRACTION_MODEL = "claude-sonnet-4-5";
export const HEADER_MODEL = "claude-haiku-5-5";

/** USD per million tokens [input, output]. */
export const TOKEN_PRICES: Readonly<
  Record<string, readonly [number, number]>
> = {
  [EXTRACTION_MODEL]: [3, 15],
  [HEADER_MODEL]: [0.1, 0.5],
};

export const CLAUDE_MAX_RETRIES = 4;
export const DEFAULT_CLAUDE_CONCURRENCY = 4;

export const LINE_ITEMS_TOOL_NAME = "save_line_items";
export const HEADER_TOOL_NAME = "save_document_header";

export const MAX_TEXT_CHARS = 100_000;
export const CHUNK_CHARS = 24_000;
/** Smaller chunks once optional fields start adding output. */
export const CHUNK_CHARS_FEW_FIELDS = 16_000;
export const CHUNK_CHARS_MANY_FIELDS = 12_000;
export const FEW_EXTRA_FIELDS = 8;
export const CHUNK_OVERLAP = 2_500;
export const CHUNK_PREAMBLE = 1_500;
/** Non-space characters below this mean a PDF scan, not usable text. */
export const MIN_USABLE_TEXT_CHARS = 200;
/** Leftover text shorter than this is not sent as another line call. */
export const MIN_CONTINUATION_CHARS = 200;
export const CHUNK_CONCURRENCY = 3;
export const READ_SHARE = 20;
export const MAX_CONTINUATION_DEPTH = 4;

export const MAX_PDF_BYTES = 20 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const PDF_PART_PAGES = 100;

export const HEAD_CHARS = 20_000;
export const SCAN_PAGES = 3;

export const LINE_TIMEOUT_MS = 180_000;
export const HEADER_TIMEOUT_MS = 60_000;
export const LINE_MAX_TOKENS = 24_000;
export const HEADER_MAX_TOKENS = 4_000;

export const IMAGE_MEDIA: Readonly<
  Record<string, "image/jpeg" | "image/png" | "image/gif" | "image/webp">
> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

export const EMPTY_MARKERS: ReadonlySet<string> = new Set([
  "",
  "-",
  "--",
  "---",
  "n/a",
  "na",
  "none",
  "null",
  "nil",
  "unknown",
  "tbd",
]);
