import fs from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import { HEADER_FIELDS } from "../shared/fields.js";
import { CLAUDE_MAX_RETRIES, withClaudeSlot } from "../shared/limiter.js";
import { HEADER_TOOL_NAME, headerUserText } from "../shared/prompt.js";
import {
  cleanExtraFieldValue,
  isFilled,
  type ExtraFieldValue,
} from "../cleaner/clean.js";
import type { ExtractionTokenUsage } from "../shared/tokens.js";
import {
  officePlainText,
  pdfRowText,
  sniffImageExtension,
  splitPdfParts,
  textIsUsable,
} from "../read/documentText.js";
import {
  HEAD_CHARS,
  HEADER_MAX_TOKENS,
  HEADER_TIMEOUT_MS,
  IMAGE_MEDIA,
  MAX_IMAGE_BYTES,
  SCAN_PAGES,
} from "../shared/constants.js";

/**
 * Document header fields (title, currency, and other details when present)
 * come from the first part of each file, read once with the caller's header model.
 */

export type HeaderExtraction = {
  fields: Record<string, ExtraFieldValue>;
  usage: ExtractionTokenUsage;
};

const extensionOf = (fileName: string) => {
  const dot = fileName.lastIndexOf(".");
  return dot < 0 ? "" : fileName.slice(dot).toLowerCase();
};

const documentBlock = async (
  filePath: string,
  originalName: string,
): Promise<Anthropic.ContentBlockParam | null> => {
  const buffer = await fs.readFile(filePath);
  const pathExt = extensionOf(originalName) || extensionOf(filePath);
  const imageExt = sniffImageExtension(originalName || filePath, buffer);
  const ext = imageExt || pathExt;
  const imageMedia = IMAGE_MEDIA[ext];
  if (imageMedia) {
    if (buffer.length > MAX_IMAGE_BYTES) return null;
    return {
      type: "image",
      source: {
        type: "base64",
        media_type: imageMedia,
        data: buffer.toString("base64"),
      },
    };
  }
  if (ext === ".pdf") {
    const { text } = await pdfRowText(buffer);
    if (textIsUsable(text)) {
      return textBlock(originalName, text);
    }
    const [firstPages] = await splitPdfParts(buffer, SCAN_PAGES);
    if (!firstPages) return null;
    return {
      type: "document",
      title: originalName,
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: firstPages.toString("base64"),
      },
    };
  }
  const text =
    ext === ".txt" ? buffer.toString("utf8") : await officePlainText(buffer, ext);
  return text.trim() ? textBlock(originalName, text) : null;
};

const textBlock = (
  title: string,
  text: string,
): Anthropic.ContentBlockParam => ({
  type: "document",
  title,
  source: {
    type: "text",
    media_type: "text/plain",
    data: text.slice(0, HEAD_CHARS),
  },
});

export const extractHeaderFields = async (input: {
  filePath: string;
  originalName: string;
  apiKey: string;
  model: string;
  fields?: typeof HEADER_FIELDS;
  /** Reuse text already extracted for lines — avoids a second full PDF parse. */
  plainText?: string;
  signal?: AbortSignal;
}): Promise<HeaderExtraction> => {
  const { filePath, originalName, apiKey, model, plainText, signal } = input;
  const empty: HeaderExtraction = {
    fields: {},
    usage: { inputTokens: 0, outputTokens: 0, model },
  };
  if (!apiKey) return empty;
  if (signal?.aborted) return empty;

  const catalog = input.fields?.length ? input.fields : HEADER_FIELDS;
  const document =
    plainText && textIsUsable(plainText)
      ? textBlock(originalName, plainText)
      : await documentBlock(filePath, originalName);
  if (!catalog.length || !document) return empty;

  const tool: Anthropic.Tool = {
    name: HEADER_TOOL_NAME,
    description:
      "Save the document header. Leave a field empty when this document does not show it.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: Object.fromEntries(
        catalog.map((field) => [
          field.key,
          { type: "string", description: field.description || field.label },
        ]),
      ),
      required: catalog.map((field) => field.key),
    },
  };

  const client = new Anthropic({
    apiKey,
    timeout: HEADER_TIMEOUT_MS,
    maxRetries: CLAUDE_MAX_RETRIES,
  });
  const response = await withClaudeSlot(() =>
    client.messages.create(
      {
        model,
        max_tokens: HEADER_MAX_TOKENS,
        output_config: { effort: "low" },
        tools: [tool],
        tool_choice: { type: "auto" },
        messages: [
          {
            role: "user",
            content: [
              document,
              {
                type: "text",
                text: headerUserText(originalName),
              },
            ],
          },
        ],
      },
      signal ? { signal } : undefined,
    ),
  );

  const usage: ExtractionTokenUsage = {
    inputTokens: response.usage.input_tokens ?? 0,
    outputTokens: response.usage.output_tokens ?? 0,
    model,
  };
  const call = response.content.find(
    (block) => block.type === "tool_use" && block.name === HEADER_TOOL_NAME,
  );
  if (!call || call.type !== "tool_use") return { fields: {}, usage };

  const raw = (call.input ?? {}) as Record<string, unknown>;
  const fields: Record<string, ExtraFieldValue> = {};
  catalog.forEach((field) => {
    const value = cleanExtraFieldValue(field, raw[field.key]);
    if (isFilled(value)) fields[field.key] = value;
  });
  return { fields, usage };
};
