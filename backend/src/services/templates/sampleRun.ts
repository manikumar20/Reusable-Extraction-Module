import { LINE_FIELDS, type CatalogField } from "../extract/engine/shared/fields.js";
import type { ExtraFieldValue } from "../extract/engine/cleaner/clean.js";
import { extractDocument } from "../extract/engine/extract/run.js";
import {
  lineFieldValues,
  type ExtractedLine,
} from "../extract/engine/extract/records.js";
import { apiKey, recordModel } from "../../config/runtime.js";

const labels = new Map(LINE_FIELDS.map((field) => [field.key, field.label]));

const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

const textOf = (value: ExtraFieldValue | undefined) => {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  return value
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if ("partNumber" in item) return [item.name, item.partNumber].filter(Boolean).join(" ");
      return `${item.name}: ${item.value}`;
    })
    .filter(Boolean)
    .join(", ");
};

const collectedValues = (lines: ExtractedLine[]) => {
  const values = new Map<string, string>();
  for (const line of lines) {
    for (const [key, value] of Object.entries(lineFieldValues(line))) {
      const text = textOf(value);
      if (!text || values.has(key)) continue;
      values.set(key, text);
    }
  }
  return values;
};

const readFile = async (
  file: { buffer: Buffer; originalname: string },
  template?: {
    lineExtras?: CatalogField[];
  },
) => {
  const lines: ExtractedLine[] = [];
  await extractDocument({
    filePath: file.originalname,
    fileBuffer: file.buffer,
    fileName: file.originalname,
    apiKey: apiKey(),
    recordModel: recordModel(),
    lineExtras: template?.lineExtras,
    onRecords: (records) => {
      lines.push(...records);
    },
  });
  return collectedValues(lines);
};

export const testTemplateOnSamples = async (
  fields: { id: string; name: string; catalogKey?: string }[],
  files: { buffer: Buffer; originalname: string }[],
  templateKeys?: { lineExtras?: CatalogField[] },
) => {
  const results = [];
    for (const file of files) {
      const values = await readFile(file, templateKeys);
      const byName = new Map<string, string>();
      for (const [key, value] of values) {
        byName.set(norm(key), value);
        const label = labels.get(key);
        if (label) byName.set(norm(label), value);
      }
      results.push({
        fileName: file.originalname,
        fields: fields.map((field) => {
          const value =
            (field.catalogKey ? byName.get(norm(field.catalogKey)) : undefined) ??
            byName.get(norm(field.name)) ??
            "";
          return {
            fieldId: field.id,
            name: field.name,
            value,
            confidence: value ? 1 : 0,
          };
        }),
      });
    }
  return results;
};
