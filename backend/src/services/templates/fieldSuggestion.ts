import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import {
  FIELD_DATA_TYPES,
  HEADER_FIELDS,
  LINE_FIELDS,
  type CatalogField,
  type FieldDataType,
} from "../../extraction/shared/fields.js";
import { CLAUDE_MAX_RETRIES, withClaudeSlot } from "../../extraction/shared/limiter.js";
import {
  officePlainText,
  pdfRowText,
  sniffImageExtension,
  splitPdfParts,
  textIsUsable,
} from "../../extraction/read/documentText.js";
import {
  EXTRACTION_MODEL,
  IMAGE_MEDIA,
  MAX_IMAGE_BYTES,
  SCAN_PAGES,
} from "../../extraction/shared/constants.js";
import {
  emptyTokenUsage,
  tokenCostUsd,
  type ExtractionTokenUsage,
} from "../../extraction/shared/tokens.js";
import { apiKey } from "../../app.js";
import { HttpError } from "../../utils/httpError.js";

const SAMPLE_CHARS = 12_000;
const TEXT_PAGES = 25;
const MAX_SUGGESTIONS = 10;
/** Majority vote runs. Default 1 for speed; set FIELD_SUGGESTION_RUNS=3 for stricter voting. */
const SUGGESTION_RUNS = Math.max(
  1,
  Math.min(5, Number(process.env.FIELD_SUGGESTION_RUNS) || 1),
);
const TOOL_NAME = "save_field_suggestions";
const CLAUDE_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_TOKENS = 3_000;
const SAMPLE_VALUE_MAX_CHARS = 200;
const KEY_SLUG_MAX_CHARS = 50;
const CUSTOM_FIELD_PREFIX = "x_";
const SHEET_HEAD_CHARS = 1_500;
const CHUNK_CHARS = 1_500;

const PRINTED_ON = {
  EACH_LINE: "EACH_LINE",
  ONCE_PER_DOCUMENT: "ONCE_PER_DOCUMENT",
} as const;

const CUSTOM_FIELD_DATA_TYPES = [
  FIELD_DATA_TYPES.TEXT,
  FIELD_DATA_TYPES.NUMBER,
  FIELD_DATA_TYPES.DATE,
  FIELD_DATA_TYPES.LIST,
  FIELD_DATA_TYPES.KEY_VALUE,
] as const;

const CUSTOM_ROLES = ["NONE", "CATEGORY", "MAKER", "PARENT_OEM", "DESCRIPTIVE"] as const;

export type MatchedFieldSuggestion = {
  key: string;
  label: string;
  printedLabel: string;
  sampleValue: string;
  isDefault: boolean;
};

export type NewFieldSuggestion = {
  key: string;
  label: string;
  dataType: FieldDataType;
  description: string;
  matchRole: string;
  sampleValue: string;
  showToSupplier: boolean;
};

export type FieldSuggestions = {
  matched: MatchedFieldSuggestion[];
  suggested: NewFieldSuggestion[];
  usage: ExtractionTokenUsage & { costUsd: number };
};

const extensionOf = (fileName: string) => {
  const dot = fileName.lastIndexOf(".");
  return dot < 0 ? "" : fileName.slice(dot).toLowerCase();
};

const ITEM_WORDS =
  /\b(qty|quantity|uom|unit|units|item|items|sr\.?\s?no|s\/n|description|material|part\s?no|mpn|pcs|nos|each|ea|sets?|meters?|sq\/?\s?meter)\b/gi;
const NUMBERED_ROW = /^\s*\d+(\.\d+)*[.)]?\s+\S/gm;
const CONTENTS_LINE = /\.{5,}/;

const itemScore = (chunk: string) => {
  const body = chunk
    .split("\n")
    .filter((line) => !CONTENTS_LINE.test(line))
    .join("\n");
  return (body.match(ITEM_WORDS)?.length ?? 0) + (body.match(NUMBERED_ROW)?.length ?? 0);
};

const chunksOf = (text: string) => {
  const chunks: string[] = [];
  let current = "";
  text.split("\n").forEach((line) => {
    if (current && current.length + line.length > CHUNK_CHARS) {
      chunks.push(current);
      current = "";
    }
    current += `${line}\n`;
  });
  if (current) chunks.push(current);
  return chunks;
};

const itemFocusedText = (text: string) => {
  if (text.length <= SAMPLE_CHARS) return text;
  const chunks = chunksOf(text);
  const picked = new Set([0]);
  let used = chunks[0]?.length ?? 0;
  [...chunks.keys()]
    .slice(1)
    .sort((a, b) => itemScore(chunks[b] ?? "") - itemScore(chunks[a] ?? ""))
    .forEach((index) => {
      const size = chunks[index]?.length ?? 0;
      if (used + size > SAMPLE_CHARS) return;
      picked.add(index);
      used += size;
    });
  return [...picked]
    .sort((a, b) => a - b)
    .map((index, position, list) =>
      position > 0 && index !== (list[position - 1] ?? 0) + 1
        ? `[...]\n${chunks[index]}`
        : chunks[index],
    )
    .join("");
};

const sampleText = (text: string) => {
  const sheets = text.split(/(?=^# )/m);
  if (sheets.length <= 1) return itemFocusedText(text);
  const take = sheets.map((sheet) => Math.min(sheet.length, SHEET_HEAD_CHARS));
  let left = SAMPLE_CHARS - take.reduce((sum, value) => sum + value, 0);
  [...sheets.keys()]
    .sort((a, b) => (sheets[b]?.length ?? 0) - (sheets[a]?.length ?? 0))
    .forEach((index) => {
      const extra = Math.max(0, Math.min(left, (sheets[index]?.length ?? 0) - (take[index] ?? 0)));
      take[index] = (take[index] ?? 0) + extra;
      left -= extra;
    });
  return sheets.map((sheet, index) => sheet.slice(0, take[index])).join("\n");
};

type SampleDocument = {
  block: Anthropic.ContentBlockParam;
  text: string;
  /** True when Claude must read pixels/PDF pages (no plain-text layer). */
  vision: boolean;
};

const textSample = (title: string, fullText: string): SampleDocument => {
  const text = sampleText(fullText);
  return {
    block: {
      type: "document",
      title,
      source: { type: "text", media_type: "text/plain", data: text },
    },
    text,
    vision: false,
  };
};

const readSample = async (
  filePath: string,
  originalName: string,
): Promise<SampleDocument | null> => {
  const buffer = await fs.readFile(filePath);
  const pathExt = extensionOf(originalName) || extensionOf(filePath);
  const imageExt = sniffImageExtension(originalName || filePath, buffer);
  const ext = imageExt || pathExt;
  const imageMedia = IMAGE_MEDIA[ext];
  if (imageMedia) {
    if (buffer.length > MAX_IMAGE_BYTES) {
      throw new HttpError(
        413,
        "Images must be 5 MB or smaller for field suggestions.",
        "IMAGE_TOO_LARGE",
      );
    }
    return {
      block: {
        type: "image",
        source: { type: "base64", media_type: imageMedia, data: buffer.toString("base64") },
      },
      text: "",
      vision: true,
    };
  }
  if (ext === ".pdf") {
    const [textPages] = await splitPdfParts(buffer, TEXT_PAGES);
    if (!textPages) return null;
    let text = "";
    try {
      text = (await pdfRowText(textPages)).text;
    } catch (error) {
      console.error(`PDF text read failed for ${originalName}:`, error);
    }
    if (textIsUsable(text)) return textSample(originalName, text);
    // Scanned / image-only PDF: send the first pages for Claude vision.
    const [firstPages] = await splitPdfParts(buffer, SCAN_PAGES);
    if (!firstPages) return null;
    return {
      block: {
        type: "document",
        title: originalName,
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: firstPages.toString("base64"),
        },
      },
      text: "",
      vision: true,
    };
  }
  if (ext === ".txt") {
    const text = buffer.toString("utf8");
    return text.trim() ? textSample(originalName, text) : null;
  }
  const text = await officePlainText(buffer, ext);
  return text.trim() ? textSample(originalName, text) : null;
};

const normalLabel = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");

const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, KEY_SLUG_MAX_CHARS) || "field";

const text = (value: unknown) =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";

const detectTemplateFields = async (
  filePath: string,
  originalName: string,
): Promise<FieldSuggestions> => {
  if (!apiKey()) {
    throw new HttpError(503, "AI API key is not configured.", "CLAUDE_NOT_CONFIGURED");
  }
  const sample = await readSample(filePath, originalName);
  if (!sample) {
    throw new HttpError(400, "No readable text was found in this document.", "DOCUMENT_UNREADABLE");
  }

  const catalog = LINE_FIELDS;
  // Key + label only — full descriptions bloat the prompt (~10k+ tokens) and slow every run.
  const catalogText = catalog
    .map(
      (entry) =>
        `- ${entry.key} (${entry.label})${entry.isDefault ? " [always included]" : ""}`,
    )
    .join("\n");

  const tool: Anthropic.Tool = {
    name: TOOL_NAME,
    description:
      "Save which catalogue fields this document shows, and suggest new fields for any other clearly labeled values.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        matched: {
          type: "array",
          description:
            "Catalogue fields from the list that this document clearly shows (table columns, form labels, or repeated row values).",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              key: { type: "string", enum: catalog.map((entry) => entry.key) },
              printedLabel: { type: "string", description: "The column or label as printed." },
              sampleValue: {
                type: "string",
                description: "One value from the document, copied as printed.",
              },
            },
            required: ["key", "printedLabel", "sampleValue"],
          },
        },
        suggested: {
          type: "array",
          description: `Labeled fields the catalogue does not cover (forms, invoices, medical records, RFQs, etc.). At most ${MAX_SUGGESTIONS}. Prefer suggesting real printed labels over returning an empty list.`,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              label: {
                type: "string",
                description: "Short field name, e.g. Patient Name or Valve Body Rating.",
              },
              printedLabel: {
                type: "string",
                description: "The column heading or form label exactly as printed.",
              },
              printedOn: {
                type: "string",
                enum: [PRINTED_ON.EACH_LINE, PRINTED_ON.ONCE_PER_DOCUMENT],
                description:
                  "EACH_LINE for repeating table/row values. ONCE_PER_DOCUMENT for form fields shown once on the page.",
              },
              dataType: {
                type: "string",
                enum: [...CUSTOM_FIELD_DATA_TYPES],
                description: "TEXT, NUMBER, DATE, LIST or KEY_VALUE.",
              },
              description: {
                type: "string",
                description:
                  "An instruction for an extractor reading this document type, in one or two sentences.",
              },
              customerInternal: {
                type: "boolean",
                description: "True when the value should stay internal / not be shared externally.",
              },
              matchRole: {
                type: "string",
                enum: [...CUSTOM_ROLES],
                description: "CATEGORY, MAKER, PARENT_OEM, DESCRIPTIVE, or NONE.",
              },
              sampleValue: {
                type: "string",
                description: "One value from the document, copied as printed.",
              },
            },
            required: [
              "label",
              "printedLabel",
              "printedOn",
              "dataType",
              "description",
              "customerInternal",
              "matchRole",
              "sampleValue",
            ],
          },
        },
      },
      required: ["matched", "suggested"],
    },
  };

  const model = process.env.FIELD_SUGGESTION_MODEL?.trim() || EXTRACTION_MODEL;
  const client = new Anthropic({
    apiKey: apiKey(),
    timeout: CLAUDE_TIMEOUT_MS,
    maxRetries: CLAUDE_MAX_RETRIES,
  });
  const ask = () =>
    withClaudeSlot(() =>
      client.messages.create({
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        tools: [tool],
        tool_choice: { type: "tool", name: TOOL_NAME },
        messages: [
          {
            role: "user",
            content: [
              sample.block,
              {
                type: "text",
                text: [
                  sample.vision
                    ? `This attachment is a PDF scan or image ("${originalName}"). Read every visible form label, table column, and value with vision. We are building an extraction template from this sample.`
                    : `This is a sample document ("${originalName}"). We are building an extraction template from the labels and values it shows (RFQ, invoice, medical form, spreadsheet, etc.).`,
                  "Our field catalogue (prefer these keys when a printed label means the same thing):",
                  catalogText,
                  `Call ${TOOL_NAME} once.`,
                  "matched: every catalogue key that this document clearly shows. Map printed labels to catalogue keys when they mean the same thing. Skip keys the document does not show. Do not invent matches.",
                  "suggested: every other clearly labeled field that is NOT already covered by a matched catalogue key. Include form fields printed once (patient name, invoice number, diagnosis, dates, amounts, etc.) and repeating table columns. Use ONCE_PER_DOCUMENT for form fields shown once; EACH_LINE for repeating rows. Never suggest a rename of a catalogue field you already matched. Do not invent labels that are not printed.",
                  "If the document is not a procurement RFQ, matched may be empty — still fill suggested with the important printed labels (up to the limit). An empty suggested list is wrong when the page shows labeled values.",
                  sample.vision
                    ? "Copy sampleValue exactly as printed. Prefer the first filled example for each label."
                    : "Copy sampleValue from the document text exactly as printed.",
                ].join("\n"),
              },
            ],
          },
        ],
      }),
    );

  const settled = await Promise.allSettled(Array.from({ length: SUGGESTION_RUNS }, ask));
  const responses = settled.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  if (!responses.length) {
    throw (settled[0] as PromiseRejectedResult).reason;
  }
  const usage: ExtractionTokenUsage = { ...emptyTokenUsage(), model };
  responses.forEach((response) => {
    usage.inputTokens += response.usage.input_tokens ?? 0;
    usage.outputTokens += response.usage.output_tokens ?? 0;
  });
  const majority = Math.floor(responses.length / 2) + 1;
  const runs = responses.map((response) => {
    const call = response.content.find(
      (block) => block.type === "tool_use" && block.name === TOOL_NAME,
    );
    const raw = (call?.type === "tool_use" ? call.input : {}) as {
      matched?: unknown[];
      suggested?: unknown[];
    };
    return {
      matched: (raw.matched ?? []).map((item) => (item ?? {}) as Record<string, unknown>),
      suggested: (raw.suggested ?? []).map((item) => (item ?? {}) as Record<string, unknown>),
    };
  });

  const byKey = new Map(catalog.map((entry) => [entry.key, entry]));
  const firstSeen = new Map<string, Record<string, unknown>>();
  const votes = new Map<string, number>();
  runs.forEach((run) => {
    new Set(run.matched.map((row) => text(row.key))).forEach((key) => {
      if (!byKey.has(key)) return;
      votes.set(key, (votes.get(key) ?? 0) + 1);
      if (!firstSeen.has(key)) {
        firstSeen.set(key, run.matched.find((row) => text(row.key) === key) ?? {});
      }
    });
  });
  const matched: MatchedFieldSuggestion[] = catalog
    .filter((entry) => (votes.get(entry.key) ?? 0) >= majority)
    .map((entry) => {
      const row = firstSeen.get(entry.key) ?? {};
      return {
        key: entry.key,
        label: entry.label,
        printedLabel: text(row.printedLabel),
        sampleValue: text(row.sampleValue).slice(0, SAMPLE_VALUE_MAX_CHARS),
        isDefault: Boolean(entry.isDefault),
      };
    });

  const docText = normalLabel(sample.text);
  const vision = sample.vision;
  const matchedColumns = new Set(
    matched.flatMap((match) =>
      [normalLabel(match.printedLabel), normalLabel(match.label), normalLabel(match.key)].filter(
        Boolean,
      ),
    ),
  );
  // Keep Claude suggestions that have a real printed label + sample value.
  // Forms (medical, invoice, etc.) often use ONCE_PER_DOCUMENT — allow that for all samples.
  const ownColumns = (rows: Record<string, unknown>[]) => {
    const labelUses = new Map<string, number>();
    rows.forEach((row) => {
      const printed = normalLabel(text(row.printedLabel) || text(row.label));
      labelUses.set(printed, (labelUses.get(printed) ?? 0) + 1);
    });
    return rows.filter((row) => {
      const printedOn = text(row.printedOn);
      if (
        printedOn &&
        printedOn !== PRINTED_ON.EACH_LINE &&
        printedOn !== PRINTED_ON.ONCE_PER_DOCUMENT
      ) {
        return false;
      }
      const printed = normalLabel(text(row.printedLabel) || text(row.label));
      if (!printed || (labelUses.get(printed) ?? 0) > 1) return false;
      if (matchedColumns.has(printed)) return false;
      if (!normalLabel(text(row.sampleValue)).replace(/^na$/, "")) return false;
      // Text layer check only when we have extracted text (skip for vision / weak OCR).
      if (!vision && docText && printed.length >= 3 && !docText.includes(printed)) return false;
      return true;
    });
  };

  const columnVotes = new Map<string, { count: number; row: Record<string, unknown> }>();
  runs.forEach((run) => {
    ownColumns(run.suggested).forEach((row) => {
      const printed = normalLabel(text(row.printedLabel));
      const current = columnVotes.get(printed);
      columnVotes.set(printed, { count: (current?.count ?? 0) + 1, row: current?.row ?? row });
    });
  });
  const rows = [...columnVotes.values()]
    .filter((vote) => vote.count >= majority)
    .map((vote) => vote.row);

  const taken = new Set(
    [...catalog, ...HEADER_FIELDS].flatMap((entry: CatalogField) => [
      normalLabel(entry.label),
      normalLabel(entry.key),
    ]),
  );
  matched.forEach((entry) => {
    taken.add(normalLabel(entry.label));
    taken.add(normalLabel(entry.printedLabel));
  });
  const keys = new Set<string>();
  const suggested: NewFieldSuggestion[] = [];
  rows.forEach((row) => {
    if (suggested.length >= MAX_SUGGESTIONS) return;
    const label = text(row.label).slice(0, 80);
    const printed = text(row.printedLabel);
    const normal = normalLabel(label);
    if (!normal || taken.has(normal) || taken.has(normalLabel(printed))) return;
    // Drop suggestions that collide with a catalogue key slug
    if (catalog.some((entry) => normalLabel(entry.key) === normal || normalLabel(entry.label) === normal)) {
      return;
    }
    taken.add(normal);
    let key = `${CUSTOM_FIELD_PREFIX}${slug(label)}`;
    for (let index = 2; keys.has(key); index += 1) {
      key = `${CUSTOM_FIELD_PREFIX}${slug(label)}_${index}`;
    }
    keys.add(key);
    const dataType = (CUSTOM_FIELD_DATA_TYPES as readonly string[]).includes(text(row.dataType))
      ? (text(row.dataType) as FieldDataType)
      : FIELD_DATA_TYPES.TEXT;
    const matchRole = (CUSTOM_ROLES as readonly string[]).includes(text(row.matchRole))
      ? text(row.matchRole)
      : "NONE";
    suggested.push({
      key,
      label,
      dataType,
      description: text(row.description).slice(0, 500),
      matchRole,
      sampleValue: text(row.sampleValue).slice(0, SAMPLE_VALUE_MAX_CHARS),
      showToSupplier: row.customerInternal !== true,
    });
  });

  console.info(
    `Template field suggestion for "${originalName}": ${responses.length} runs, ${usage.inputTokens} in / ${usage.outputTokens} out tokens, matched ${matched.length}, suggested ${suggested.length}${vision ? " (vision)" : ""}.`,
  );

  return {
    matched,
    suggested,
    usage: { ...usage, costUsd: tokenCostUsd(usage) },
  };
};

const CACHE_LIMIT = 200;
const CACHE_VERSION = "v3-general-forms";
const resultsByFile = new Map<string, FieldSuggestions>();

export const suggestTemplateFields = async (
  filePath: string,
  originalName: string,
): Promise<FieldSuggestions> => {
  const fileHash =
    CACHE_VERSION +
    ":" +
    createHash("sha256")
      .update(await fs.readFile(filePath))
      .digest("hex");
  const cached = resultsByFile.get(fileHash);
  if (cached) {
    return {
      ...cached,
      usage: { inputTokens: 0, outputTokens: 0, model: cached.usage.model, costUsd: 0 },
    };
  }
  const result = await detectTemplateFields(filePath, originalName);
  // Do not cache total misses — retry should be able to recover after prompt/filter fixes.
  if (result.matched.length || result.suggested.length) {
    resultsByFile.set(fileHash, result);
    if (resultsByFile.size > CACHE_LIMIT) {
      const oldest = resultsByFile.keys().next().value;
      if (oldest) resultsByFile.delete(oldest);
    }
  }
  return result;
};
