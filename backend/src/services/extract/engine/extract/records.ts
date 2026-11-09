import Anthropic from "@anthropic-ai/sdk";
import {
  LINE_IDENTITY_KEY,
  lineFieldsForExtract,
  type CatalogField,
} from "../shared/fields.js";
import { CLAUDE_MAX_RETRIES, withClaudeSlot } from "../shared/limiter.js";
import { lineUserText, SYSTEM_PROMPT } from "../shared/prompt.js";
import {
  cleanExtraFields,
  extraFieldSchema,
  isFilled,
  type ExtraFieldValue,
  type LineExtraFields,
  type ManufacturerOption,
} from "../cleaner/clean.js";
import { emptyTokenUsage, type ExtractionTokenUsage } from "../shared/tokens.js";
import {
  IMAGE_MEDIA,
  LINE_ITEMS_TOOL_NAME,
  LINE_MAX_TOKENS,
  LINE_TIMEOUT_MS,
  MAX_IMAGE_BYTES,
  MAX_PDF_BYTES,
  MAX_TEXT_CHARS,
} from "../shared/constants.js";

export type LineManufacturerOption = ManufacturerOption;

/** One buy line: values keyed by catalog field keys from fields.ts. */
export type ExtractedLine = {
  fields: LineExtraFields;
};

const stringField = (fields: LineExtraFields, key: string) => {
  const value = fields[key];
  return typeof value === "string" ? value.trim() : "";
};

export const lineIdentityValue = (line: ExtractedLine) =>
  stringField(line.fields, LINE_IDENTITY_KEY);

/** Catalog keys the results page reads from each line. */
export const lineFieldValues = (line: ExtractedLine): LineExtraFields => ({
  ...line.fields,
});

/**
 * Tool schema built entirely from the catalog fields passed in.
 * Adding or renaming a field in fields.ts updates this automatically.
 * Only default fields are required so Claude does not emit empty shells for
 * every optional key on every row (that was slowing large catalogs).
 */
const extractToolFor = (fields: CatalogField[]): Anthropic.Tool => {
  const required = fields
    .filter((field) => field.isDefault)
    .map((field) => field.key);
  return {
    name: LINE_ITEMS_TOOL_NAME,
    description: "Save every product row extracted from the attached document.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        items: {
          type: "array",
          description:
            "Products, materials, spares, or services listed in the document. Skip questionnaire rows and blank form fields.",
          items: {
            type: "object",
            additionalProperties: false,
            properties: Object.fromEntries(
              fields.map((field) => [field.key, extraFieldSchema(field)]),
            ),
            required: required.length ? required : fields.slice(0, 1).map((f) => f.key),
          },
        },
      },
      required: ["items"],
    },
  };
};

const toLineItem = (
  raw: unknown,
  fieldDefs: CatalogField[],
): ExtractedLine | null => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const fields = cleanExtraFields(fieldDefs, raw);
  const item: ExtractedLine = { fields };
  if (!hasExtractedIdentity(item)) return null;
  return item;
};

const takeCompleteJsonObjects = (source: string): unknown[] => {
  const start = source.indexOf("[");
  if (start < 0) return [];
  const objects: unknown[] = [];
  let index = start + 1;
  while (index < source.length) {
    while (
      index < source.length &&
      (source[index] === " " ||
        source[index] === "\n" ||
        source[index] === "\r" ||
        source[index] === "\t" ||
        source[index] === ",")
    ) {
      index += 1;
    }
    if (source[index] !== "{") break;
    const objectStart = index;
    let depth = 0;
    let inString = false;
    let escape = false;
    let closed = false;
    for (; index < source.length; index += 1) {
      const ch = source[index] ?? "";
      if (inString) {
        if (escape) {
          escape = false;
          continue;
        }
        if (ch === "\\") {
          escape = true;
          continue;
        }
        if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === "{") depth += 1;
      if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          index += 1;
          closed = true;
          break;
        }
      }
    }
    if (!closed) break;
    try {
      objects.push(JSON.parse(source.slice(objectStart, index)));
    } catch {
      break;
    }
  }
  return objects;
};

const parseToolItems = (
  input: unknown,
  fieldDefs: CatalogField[],
): ExtractedLine[] => {
  const rows = Array.isArray(input)
    ? input
    : input && !Array.isArray(input) && input instanceof Object
      ? Array.isArray((input as { items?: unknown }).items)
        ? (input as { items: unknown[] }).items
        : Array.isArray((input as { lineItems?: unknown }).lineItems)
          ? (input as { lineItems: unknown[] }).lineItems
          : []
      : [];

  return rows.flatMap((row) => {
    const item = toLineItem(row, fieldDefs);
    return item ? [item] : [];
  });
};

const hasExtractedIdentity = (item: ExtractedLine) =>
  Object.entries(item.fields).some(
    ([key, value]) => key !== LINE_IDENTITY_KEY && isFilled(value),
  );

const isReadyItem = (item: ExtractedLine) => {
  if (!hasExtractedIdentity(item)) return false;
  const filled = Object.entries(item.fields).filter(
    ([key, value]) => key !== LINE_IDENTITY_KEY && isFilled(value),
  );
  return filled.length >= 1;
};

const itemPersistKey = (item: ExtractedLine, index: number) =>
  lineIdentityValue(item) || `row:${index}`;

const itemPersistSig = (item: ExtractedLine) => JSON.stringify(item.fields);

const userContent = (
  buffer: Buffer,
  originalName: string,
  ext: string,
  officeText: string,
  fieldDefs: CatalogField[],
): Anthropic.ContentBlockParam[] => {
  const blocks: Anthropic.ContentBlockParam[] = [];
  const imageMedia = IMAGE_MEDIA[ext];
  const trimmedText = officeText.trim();

  // Images first — never treat binary image bytes as plain text.
  if (imageMedia) {
    if (buffer.length > MAX_IMAGE_BYTES) {
      throw new Error("Images must be 5 MB or smaller.");
    }
    blocks.push({
      type: "image",
      source: {
        type: "base64",
        media_type: imageMedia,
        data: buffer.toString("base64"),
      },
    });
  } else if (trimmedText) {
    blocks.push({
      type: "document",
      title: originalName,
      source: {
        type: "text",
        media_type: "text/plain",
        data: trimmedText.slice(0, MAX_TEXT_CHARS),
      },
    });
  } else if (ext === ".pdf" && buffer.length <= MAX_PDF_BYTES) {
    blocks.push({
      type: "document",
      title: originalName,
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: buffer.toString("base64"),
      },
    });
  }

  blocks.push({
    type: "text",
    text: lineUserText({
      originalName,
      ext,
      hasText: Boolean(trimmedText) && !imageMedia,
      fieldKeys: fieldDefs.map((field) => field.key),
      identityKey: LINE_IDENTITY_KEY,
    }),
  });

  return blocks;
};

export const extractLineItemsWithClaude = async (input: {
  buffer: Buffer;
  originalName: string;
  ext: string;
  officeText: string;
  apiKey: string;
  model: string;
  /** Catalog fields to extract (defaults + optionals). Derived from fields.ts. */
  lineFields?: CatalogField[];
  signal?: AbortSignal;
  onBatch?: (items: ExtractedLine[]) => Promise<void>;
}): Promise<{
  items: ExtractedLine[];
  stopReason: string;
  usage: ExtractionTokenUsage;
}> => {
  if (!input.apiKey) {
    return { items: [], stopReason: "", usage: emptyTokenUsage() };
  }
  if (input.signal?.aborted) {
    throw new Error("Extraction was cancelled.");
  }

  const fieldDefs =
    input.lineFields?.length
      ? input.lineFields
      : lineFieldsForExtract([]);
  const content = userContent(
    input.buffer,
    input.originalName,
    input.ext,
    input.officeText,
    fieldDefs,
  );
  const hasFile = content.some(
    (block) => block.type === "document" || block.type === "image",
  );
  if (!hasFile) {
    if (input.ext === ".pdf" && input.buffer.length > MAX_PDF_BYTES) {
      throw new Error("This scanned PDF is larger than 20 MB, so it cannot be read.");
    }
    if (IMAGE_MEDIA[input.ext] && input.buffer.length > MAX_IMAGE_BYTES) {
      throw new Error("Images must be 5 MB or smaller.");
    }
    return { items: [], stopReason: "", usage: emptyTokenUsage() };
  }

  const client = new Anthropic({
    apiKey: input.apiKey || null,
    authToken: process.env.ANTHROPIC_AUTH_TOKEN?.trim() || undefined,
    timeout: LINE_TIMEOUT_MS,
    maxRetries: CLAUDE_MAX_RETRIES,
  });

  try {
    const persisted = new Map<string, string>();
    let jsonAcc = "";
    let persistQueue: Promise<void> = Promise.resolve();
    const emitItems = (all: ExtractedLine[], readyOnly: boolean) => {
      const rows = all.flatMap((item, index) => {
        if (readyOnly && !isReadyItem(item)) return [];
        if (!hasExtractedIdentity(item)) return [];
        const key = itemPersistKey(item, index);
        const signature = itemPersistSig(item);
        if (persisted.get(key) === signature) return [];
        persisted.set(key, signature);
        return [item];
      });
      if (!rows.length || !input.onBatch) return;
      persistQueue = persistQueue
        .then(() => input.onBatch?.(rows))
        .then(() => undefined)
        .catch((error) => {
          console.error("Failed to persist extracted line items.", error);
        });
    };

    const response = await withClaudeSlot(async () => {
      const stream = client.messages.stream(
        {
          model: input.model,
          max_tokens: LINE_MAX_TOKENS,
          temperature: 0,
          system: SYSTEM_PROMPT,
          tools: [extractToolFor(fieldDefs)],
          tool_choice: { type: "tool", name: LINE_ITEMS_TOOL_NAME },
          messages: [{ role: "user", content }],
        },
        input.signal ? { signal: input.signal } : undefined,
      );
      for await (const event of stream) {
        if (input.signal?.aborted) {
          stream.abort();
          throw new Error("Extraction was cancelled.");
        }
        if (event.type !== "content_block_delta") continue;
        if (event.delta.type !== "input_json_delta") continue;
        jsonAcc += event.delta.partial_json;
        emitItems(
          parseToolItems(takeCompleteJsonObjects(jsonAcc), fieldDefs),
          true,
        );
      }
      return stream.finalMessage();
    });
    await persistQueue;

    const toolBlock = response.content.find(
      (block) => block.type === "tool_use" && block.name === LINE_ITEMS_TOOL_NAME,
    );
    const items =
      toolBlock && toolBlock.type === "tool_use"
        ? parseToolItems(toolBlock.input, fieldDefs)
        : [];
    emitItems(items, false);
    await persistQueue;
    const counted = response.usage as {
      input_tokens?: number;
      output_tokens?: number;
    };
    const usage = {
      inputTokens: counted?.input_tokens ?? 0,
      outputTokens: counted?.output_tokens ?? 0,
      model: input.model,
    };
    console.info(
      `AI extracted ${items.length} line item(s) from ${input.originalName} (${response.stop_reason ?? "done"}, in ${usage.inputTokens}, out ${usage.outputTokens}).`,
    );
    return { items, stopReason: response.stop_reason ?? "", usage };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(
      `AI line-item extraction failed for ${input.originalName}: ${message}`,
    );
    throw error instanceof Error
      ? error
      : new Error(`Line item extraction failed for ${input.originalName}.`);
  }
};

export type { ExtraFieldValue };
