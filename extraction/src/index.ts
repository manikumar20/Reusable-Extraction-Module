/**
 * Other projects depend on this package and call extractDocument.
 * The field catalog is src/shared/fields.ts. Leave src/shared/prompt.ts unchanged.
 */

export {
  extractDocument,
  ExtractionError,
} from "./extract/run.js";
export type {
  ExtractDocumentInput,
  ExtractDocumentResult,
} from "./extract/run.js";

export type { ExtractedLine, LineManufacturerOption } from "./extract/records.js";

export {
  FIELD_DATA_TYPES,
  ITEM_SCOPES,
  LINE_FIELDS,
  OPTIONAL_LINE_FIELDS,
  HEADER_FIELDS,
} from "./shared/fields.js";
export type { CatalogField, FieldDataType } from "./shared/fields.js";

export {
  cleanExtraFieldValue,
  cleanExtraFields,
  extraFieldSchema,
  isFilled,
  mergeExtraFields,
} from "./cleaner/clean.js";
export type {
  ExtraFieldValue,
  KeyValuePair,
  LineExtraFields,
} from "./cleaner/clean.js";

export {
  CLAUDE_MAX_RETRIES,
  configureClaudeLimiter,
  withClaudeSlot,
} from "./shared/limiter.js";

export {
  EXTRACTION_MODEL,
  addTokenUsage,
  emptyTokenUsage,
  tokenCostUsd,
  tokenUsageTotal,
} from "./shared/tokens.js";
export type { ExtractionTokenUsage } from "./shared/tokens.js";

export {
  officePlainText,
  pdfRowText,
  splitPdfParts,
  textIsUsable,
} from "./read/documentText.js";

export {
  DEFAULT_CLAUDE_CONCURRENCY,
  HEADER_MODEL,
  HEADER_TOOL_NAME,
  LINE_ITEMS_TOOL_NAME,
} from "./shared/constants.js";
