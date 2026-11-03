import fs from "node:fs/promises";
import { HEADER_FIELDS, LINE_FIELDS } from "../../extraction/shared/fields.js";
import type { ExtraFieldValue } from "../../extraction/cleaner/clean.js";
import { extractDocument } from "../../extraction/extract/run.js";
import {
  lineFieldValues,
  type ExtractedLine,
} from "../../extraction/extract/records.js";
import { apiKey, documentModel, recordModel } from "../../app.js";

const catalog = [...HEADER_FIELDS, ...LINE_FIELDS];
const labels = new Map(catalog.map((field) => [field.key, field.label]));

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

const collectedValues = (header: Record<string, ExtraFieldValue>, lines: ExtractedLine[]) => {
  const values = new Map<string, string>();
  const put = (key: string, value: ExtraFieldValue | undefined) => {
    const text = textOf(value);
    if (!text || values.has(key)) return;
    values.set(key, text);
  };
  for (const [key, value] of Object.entries(header)) put(key, value);
  for (const line of lines) {
    for (const [key, value] of Object.entries(lineFieldValues(line))) put(key, value);
  }
  return values;
};

const readFile = async (
  file: { path: string; originalname: string },
  template?: {
    headerKeys?: string[];
    lineKeys?: string[];
  },
) => {
  const lines: ExtractedLine[] = [];
  const result = await extractDocument({
    filePath: file.path,
    fileName: file.originalname,
    apiKey: apiKey(),
    recordModel: recordModel(),
    documentModel: documentModel(),
    headerKeys: template?.headerKeys,
    lineKeys: template?.lineKeys,
    onRecords: (records) => {
      lines.push(...records);
    },
  });
  return collectedValues(result.header, lines);
};

export const testTemplateOnSamples = async (
  fields: { id: string; name: string; catalogKey?: string }[],
  files: { path: string; originalname: string }[],
  templateKeys?: { headerKeys: string[]; lineKeys: string[] },
) => {
  try {
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
  } finally {
    await Promise.all(files.map((file) => fs.unlink(file.path).catch(() => undefined)));
  }
};
