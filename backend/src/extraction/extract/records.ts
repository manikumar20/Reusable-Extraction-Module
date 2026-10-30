import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { OPTIONAL_LINE_FIELDS, type CatalogField } from "../shared/fields.js";
import { CLAUDE_MAX_RETRIES, withClaudeSlot } from "../shared/limiter.js";
import { lineUserText, SYSTEM_PROMPT } from "../shared/prompt.js";
import {
  cleanExtraFields,
  extraFieldSchema,
  type LineExtraFields,
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

export type LineManufacturerOption = {
  name: string;
  partNumber: string;
};

export type ExtractedLine = {
  customerItemNumber: string;
  description: string;
  productName: string;
  manufacturers: LineManufacturerOption[];
  manufacturer: string;
  partNumber: string;
  quantity: string;
  unitOfMeasure: string;
  currency: string;
  technicalSpecification: string;
  extraFields?: LineExtraFields;
};

const normalizeManufacturerOptions = (
  options: LineManufacturerOption[] | undefined,
  manufacturer = "",
  partNumber = "",
): LineManufacturerOption[] => {
  const fromOptions = (options ?? [])
    .map((option) => ({
      name: option.name.trim(),
      partNumber: option.partNumber.trim(),
    }))
    .filter((option) => option.name || option.partNumber);
  if (fromOptions.length) return fromOptions;

  const name = manufacturer.trim();
  const part = partNumber.trim();
  if (!name && !part) return [];
  return [{ name, partNumber: part }];
};

const withManufacturerOptions = <
  T extends {
    manufacturers?: LineManufacturerOption[];
    manufacturer: string;
    partNumber: string;
  },
>(
  item: T,
): T => {
  const manufacturers = normalizeManufacturerOptions(
    item.manufacturers,
    item.manufacturer,
    item.partNumber,
  );
  return {
    ...item,
    manufacturers,
    manufacturer: manufacturers[0]?.name ?? "",
    partNumber: manufacturers[0]?.partNumber ?? "",
  };
};

const fieldSchema = z.preprocess((value) => asField(value), z.string());

const extractedItemSchema = z.object({
  customerItemNumber: fieldSchema.optional().default(""),
  description: fieldSchema.optional().default(""),
  productName: fieldSchema.optional().default(""),
  manufacturers: z
    .array(
      z.object({
        name: fieldSchema.optional().default(""),
        partNumber: fieldSchema.optional().default(""),
      }),
    )
    .optional()
    .default([]),
  manufacturer: fieldSchema.optional().default(""),
  partNumber: fieldSchema.optional().default(""),
  quantity: fieldSchema.optional().default(""),
  unitOfMeasure: fieldSchema.optional().default(""),
  currency: fieldSchema.optional().default(""),
  technicalSpecification: fieldSchema.optional().default(""),
  extraFields: z.unknown().optional(),
});

const EXTRACT_TOOL: Anthropic.Tool = {
  name: LINE_ITEMS_TOOL_NAME,
  description:
    "Save every product row extracted from the attached document.",
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
          properties: {
            customerItemNumber: {
              type: "string",
              description:
                "Printed item / line / position number only. Keep dots and leading zeros. Never put this in description or productName.",
            },
            description: {
              type: "string",
              description:
                "The item text for this product row — short text, Description column, product title, or title after the item number.",
            },
            productName: {
              type: "string",
              description:
                "Short readable catalog name you write from the description. Empty if there is no description.",
            },
            manufacturers: {
              type: "array",
              description:
                "Every manufacturer or brand on this product row, each with its own part number. Empty array only when the row lists none.",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  name: {
                    type: "string",
                    description:
                      "Company name only — not vendor id, city, country, or street.",
                  },
                  partNumber: {
                    type: "string",
                    description:
                      "That manufacturer's MPN, Material No, P/N, or equivalent.",
                  },
                },
                required: ["name", "partNumber"],
              },
            },
            manufacturer: {
              type: "string",
              description: "First manufacturer name if manufacturers is empty.",
            },
            partNumber: {
              type: "string",
              description: "First part number if manufacturers is empty.",
            },
            quantity: {
              type: "string",
              description: "Quantity number only. Never include the unit.",
            },
            unitOfMeasure: {
              type: "string",
              description:
                "Short standard unit code only (PCS, SET, KG, M, L, BOX). Convert a printed word yourself (Pieces, PCE, Each, EA, Nos → PCS). Never include the quantity.",
            },
            currency: {
              type: "string",
              description:
                "3-letter ISO code only. Convert a printed name yourself (US Dollar → USD, UAE Dirham → AED). Use the document currency on every line unless that line shows a different one.",
            },
            technicalSpecification: {
              type: "string",
              description:
                "Notes, classification, PO text, size, or spec on this line. Not a separate line.",
            },
          },
          required: [
            "customerItemNumber",
            "description",
            "productName",
            "manufacturers",
            "manufacturer",
            "partNumber",
            "quantity",
            "unitOfMeasure",
            "currency",
            "technicalSpecification",
          ],
        },
      },
    },
    required: ["items"],
  },
};

type ItemsSchema = {
  items: { properties: Record<string, unknown>; required: string[] };
};

/**
 * The base tool plus an extraFields object holding the optional fields from
 * fields.ts. With no optional fields the base tool is used.
 */
const extractToolFor = (extraFields: CatalogField[]): Anthropic.Tool => {
  if (!extraFields.length) return EXTRACT_TOOL;
  const base = (EXTRACT_TOOL.input_schema.properties as { items: ItemsSchema })
    .items;
  return {
    ...EXTRACT_TOOL,
    input_schema: {
      ...EXTRACT_TOOL.input_schema,
      properties: {
        items: {
          ...base,
          items: {
            ...base.items,
            properties: {
              ...base.items.properties,
              extraFields: {
                type: "object",
                additionalProperties: false,
                description:
                  "Optional fields for this product row. Use an empty string or empty array when the row does not show the value. Never guess.",
                properties: Object.fromEntries(
                  extraFields.map((field) => [field.key, extraFieldSchema(field)]),
                ),
                required: extraFields.map((field) => field.key),
              },
            },
            required: [...base.items.required, "extraFields"],
          },
        },
      },
    },
  };
};

const asField = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) {
    return value
      .map((entry) => asField(entry))
      .filter(Boolean)
      .join("; ");
  }
  return String(value).trim();
};

const cleanField = (value: string): string => value.trim();

const toLineItem = (
  raw: z.infer<typeof extractedItemSchema>,
  extraDefs: CatalogField[],
): ExtractedLine => {
  const description = cleanField(raw.description);
  const manufacturers: LineManufacturerOption[] = (raw.manufacturers ?? [])
    .map((option) => ({
      name: cleanField(option.name),
      partNumber: cleanField(option.partNumber),
    }))
    .filter((option) => option.name || option.partNumber);
  return withManufacturerOptions({
    customerItemNumber: cleanField(raw.customerItemNumber),
    description,
    productName: cleanField(raw.productName).slice(0, 200),
    manufacturers,
    manufacturer: cleanField(raw.manufacturer),
    partNumber: cleanField(raw.partNumber),
    quantity: cleanField(raw.quantity),
    unitOfMeasure: cleanField(raw.unitOfMeasure),
    currency: cleanField(raw.currency),
    technicalSpecification: cleanField(raw.technicalSpecification).slice(
      0,
      4000,
    ),
    ...(extraDefs.length
      ? { extraFields: cleanExtraFields(extraDefs, raw.extraFields) }
      : {}),
  });
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
  extraDefs: CatalogField[],
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
    const parsed = extractedItemSchema.safeParse(row);
    if (!parsed.success) return [];
    const item = toLineItem(parsed.data, extraDefs);
    if (!hasExtractedIdentity(item)) return [];
    return [item];
  });
};

const hasExtractedIdentity = (item: ExtractedLine) =>
  Boolean(
    item.description ||
    item.productName ||
    item.partNumber ||
    item.manufacturer ||
    item.manufacturers.some((option) => option.name || option.partNumber),
  );

const isReadyItem = (item: ExtractedLine) =>
  hasExtractedIdentity(item) &&
  Boolean(
    item.quantity ||
    item.unitOfMeasure ||
    item.manufacturer ||
    item.partNumber ||
    item.manufacturers.some((option) => option.name || option.partNumber),
  );

const itemPersistKey = (item: ExtractedLine, index: number) =>
  item.customerItemNumber.trim() || `row:${index}`;

const itemPersistSig = (item: ExtractedLine) =>
  [
    item.customerItemNumber,
    item.description,
    item.productName,
    item.quantity,
    item.unitOfMeasure,
    item.currency,
    item.manufacturer,
    item.partNumber,
    JSON.stringify(item.manufacturers ?? []),
    JSON.stringify(item.extraFields ?? {}),
  ].join("|");

const userContent = (
  buffer: Buffer,
  originalName: string,
  ext: string,
  officeText: string,
  extraDefs: CatalogField[],
): Anthropic.ContentBlockParam[] => {
  const blocks: Anthropic.ContentBlockParam[] = [];
  const imageMedia = IMAGE_MEDIA[ext];
  const trimmedText = officeText.trim();

  if (trimmedText) {
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
  } else if (imageMedia && buffer.length <= MAX_IMAGE_BYTES) {
    blocks.push({
      type: "image",
      source: {
        type: "base64",
        media_type: imageMedia,
        data: buffer.toString("base64"),
      },
    });
  }

  blocks.push({
    type: "text",
    text: lineUserText({
      originalName,
      ext,
      hasText: Boolean(trimmedText),
      extraFieldKeys: extraDefs.map((field) => field.key),
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
  onBatch?: (items: ExtractedLine[]) => Promise<void>;
}): Promise<{
  items: ExtractedLine[];
  stopReason: string;
  usage: ExtractionTokenUsage;
}> => {
  if (!input.apiKey) {
    return { items: [], stopReason: "", usage: emptyTokenUsage() };
  }

  const extraDefs = OPTIONAL_LINE_FIELDS.filter((field) => !field.isDefault);
  const content = userContent(
    input.buffer,
    input.originalName,
    input.ext,
    input.officeText,
    extraDefs,
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
    apiKey: input.apiKey,
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
      const stream = client.messages.stream({
        model: input.model,
        max_tokens: LINE_MAX_TOKENS,
        temperature: 0,
        system: SYSTEM_PROMPT,
        tools: [extractToolFor(extraDefs)],
        tool_choice: { type: "tool", name: LINE_ITEMS_TOOL_NAME },
        messages: [{ role: "user", content }],
      });
      for await (const event of stream) {
        if (event.type !== "content_block_delta") continue;
        if (event.delta.type !== "input_json_delta") continue;
        jsonAcc += event.delta.partial_json;
        emitItems(
          parseToolItems(takeCompleteJsonObjects(jsonAcc), extraDefs),
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
        ? parseToolItems(toolBlock.input, extraDefs)
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
