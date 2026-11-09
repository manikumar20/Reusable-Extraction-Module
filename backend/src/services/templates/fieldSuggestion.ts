import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import {
  FIELD_DATA_TYPES,
  HEADER_FIELDS,
  LINE_FIELDS,
  type CatalogField,
  type FieldDataType,
} from "../extract/engine/shared/fields.js";
import { withClaudeSlot } from "../extract/engine/shared/limiter.js";
import {
  EXTRACTION_MODEL,
  HEADER_MAX_TOKENS,
  HEADER_MODEL,
  HEADER_TIMEOUT_MS,
  LINE_TIMEOUT_MS,
} from "../extract/engine/shared/constants.js";
import {
  emptyTokenUsage,
  tokenCostUsd,
  type ExtractionTokenUsage,
} from "../extract/engine/shared/tokens.js";
import { AppError, HTTP_STATUS } from "../../utils/errors/index.js";
import { createAnthropicClient, hasClaudeCredentials } from "../extract/anthropicClient.js";
import { mapClaudeError } from "../extract/claudeErrors.js";
import { documentModel, recordModel } from "../../config/runtime.js";
import { readSampleDocument, type SampleDocument } from "./sampleDocument.js";

const MAX_SUGGESTIONS = 10;
/** Majority vote runs. Default 1 for speed; set FIELD_SUGGESTION_RUNS=3 for stricter voting. */
const SUGGESTION_RUNS = Math.max(
  1,
  Math.min(5, Number(process.env.FIELD_SUGGESTION_RUNS) || 1),
);
const TOOL_NAME = "save_field_suggestions";
const MAX_OUTPUT_TOKENS = HEADER_MAX_TOKENS;
const MAX_MATCHED = 24;
const SUGGESTION_RETRIES = 1;
const SAMPLE_VALUE_MAX_CHARS = 200;
const KEY_SLUG_MAX_CHARS = 50;
const CUSTOM_FIELD_PREFIX = "x_";

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

const normalLabel = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");

const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, KEY_SLUG_MAX_CHARS) || "field";

const text = (value: unknown) =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";

const isPdfName = (name: string) => name.toLowerCase().endsWith(".pdf");

const detectTemplateFields = async (
  originalName: string,
  sample: SampleDocument,
): Promise<FieldSuggestions> => {
  if (!hasClaudeCredentials()) {
    throw AppError(HTTP_STATUS.SERVICE_UNAVAILABLE, "AI API key is not configured.", {
      code: "CLAUDE_NOT_CONFIGURED",
    });
  }

  // Header + line catalogue (dedupe shared keys such as payment_terms).
  const catalog: CatalogField[] = [];
  const catalogKeys = new Set<string>();
  for (const entry of [...HEADER_FIELDS, ...LINE_FIELDS]) {
    if (catalogKeys.has(entry.key)) continue;
    catalogKeys.add(entry.key);
    catalog.push(entry);
  }
  const headerKeySet = new Set(HEADER_FIELDS.map((entry) => entry.key));
  // Key + label only — full descriptions bloat the prompt (~10k+ tokens) and slow every run.
  const catalogText = catalog
    .map((entry) => {
      const scope = headerKeySet.has(entry.key) ? "header" : "line";
      const mark = entry.isDefault ? " [always included]" : "";
      return `- ${entry.key} (${entry.label}) [${scope}]${mark}`;
    })
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
              key: {
                type: "string",
                description: "Exact catalogue key from the list (e.g. document_number, line_no).",
              },
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
          description: `Labeled fields the catalogue does not cover. At most ${MAX_SUGGESTIONS}.`,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              label: {
                type: "string",
                description: "Short field name, e.g. Patient Name.",
              },
              printedLabel: {
                type: "string",
                description: "The column heading or form label exactly as printed.",
              },
              printedOn: {
                type: "string",
                enum: [PRINTED_ON.EACH_LINE, PRINTED_ON.ONCE_PER_DOCUMENT],
              },
              dataType: {
                type: "string",
                enum: [...CUSTOM_FIELD_DATA_TYPES],
              },
              description: {
                type: "string",
                description: "Optional one-sentence extractor hint.",
              },
              sampleValue: {
                type: "string",
                description: "One value from the document, copied as printed.",
              },
            },
            required: ["label", "printedLabel", "printedOn", "dataType", "sampleValue"],
          },
        },
      },
      required: ["matched", "suggested"],
    },
  };

  // Text samples: fast Haiku (same as extract header). Vision/scans: Sonnet for reliable OCR.
  const model =
    process.env.FIELD_SUGGESTION_MODEL?.trim() ||
    (sample.vision ? recordModel() || EXTRACTION_MODEL : documentModel() || HEADER_MODEL);
  const client = createAnthropicClient({
    timeout: sample.vision ? LINE_TIMEOUT_MS : HEADER_TIMEOUT_MS,
    maxRetries: SUGGESTION_RETRIES,
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
                    ? `PDF/image sample "${originalName}". Read every visible form label, table column heading, and filled value with vision. Build an extraction template.`
                    : `Sample "${originalName}". Build an extraction template from printed labels and values.`,
                  "Catalogue keys (use exact key in matched):",
                  catalogText,
                  `Call ${TOOL_NAME} once.`,
                  `matched: up to ${MAX_MATCHED} catalogue keys this document clearly shows (header + line). Prefer the most important labels. Map RFQ No → document_number. Skip missing keys. Keep sampleValue short.`,
                  `suggested: up to ${MAX_SUGGESTIONS} other printed labels not in the catalogue. ONCE_PER_DOCUMENT for form fields; EACH_LINE for table columns. If this is not an RFQ, still suggest the important printed labels (patient name, invoice total, etc.).`,
                  "Copy sampleValue briefly as printed. An empty matched+suggested response is wrong when labels are visible.",
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
    throw mapClaudeError((settled[0] as PromiseRejectedResult).reason);
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
  const resolveCatalogKey = (raw: string, printedLabel = "") => {
    const key = text(raw);
    if (byKey.has(key)) return key;
    const candidates = [key, printedLabel].map(normalLabel).filter(Boolean);
    for (const entry of catalog) {
      const aliases = [normalLabel(entry.key), normalLabel(entry.label)];
      if (candidates.some((candidate) => aliases.includes(candidate))) return entry.key;
    }
    return "";
  };
  const firstSeen = new Map<string, Record<string, unknown>>();
  const votes = new Map<string, number>();
  runs.forEach((run) => {
    const seen = new Set<string>();
    run.matched.forEach((row) => {
      const key = resolveCatalogKey(text(row.key), text(row.printedLabel));
      if (!key || seen.has(key)) return;
      seen.add(key);
      votes.set(key, (votes.get(key) ?? 0) + 1);
      if (!firstSeen.has(key)) firstSeen.set(key, row);
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
    })
    .slice(0, MAX_MATCHED);

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
      // Soft text-layer check: allow near matches (spacing / punctuation differ).
      if (!vision && docText && printed.length >= 4) {
        const compactDoc = docText.replace(/[^a-z0-9]/g, "");
        const compactPrinted = printed.replace(/[^a-z0-9]/g, "");
        if (compactPrinted && !compactDoc.includes(compactPrinted) && !docText.includes(printed)) {
          return false;
        }
      }
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
    catalog.flatMap((entry: CatalogField) => [normalLabel(entry.label), normalLabel(entry.key)]),
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
      matchRole: matchRole || "NONE",
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
const CACHE_VERSION = "v8-any-pdf-vision";
const resultsByFile = new Map<string, FieldSuggestions>();

const mergeUsage = (
  left: FieldSuggestions["usage"],
  right: FieldSuggestions["usage"],
): FieldSuggestions["usage"] => ({
  inputTokens: left.inputTokens + right.inputTokens,
  outputTokens: left.outputTokens + right.outputTokens,
  model: right.model || left.model,
  costUsd: left.costUsd + right.costUsd,
});

export const suggestTemplateFields = async (
  filePath: string,
  originalName: string,
): Promise<FieldSuggestions> => {
  if (!hasClaudeCredentials()) {
    throw AppError(HTTP_STATUS.SERVICE_UNAVAILABLE, "AI API key is not configured.", {
      code: "CLAUDE_NOT_CONFIGURED",
    });
  }
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

  const sample = await readSampleDocument(filePath, originalName);
  if (!sample) {
    throw AppError(HTTP_STATUS.BAD_REQUEST, "No readable content was found in this document.", {
      code: "DOCUMENT_UNREADABLE",
    });
  }

  let result = await detectTemplateFields(originalName, sample);

  // Text-layer PDF returned nothing — retry with page vision (scans / weak OCR).
  if (
    isPdfName(originalName) &&
    !sample.vision &&
    !result.matched.length &&
    !result.suggested.length
  ) {
    const visionSample = await readSampleDocument(filePath, originalName, { forceVision: true });
    if (visionSample?.vision) {
      console.info(`Template suggest retrying "${originalName}" with PDF vision.`);
      const retry = await detectTemplateFields(originalName, visionSample);
      result = {
        matched: retry.matched,
        suggested: retry.suggested,
        usage: mergeUsage(result.usage, retry.usage),
      };
    }
  }

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
