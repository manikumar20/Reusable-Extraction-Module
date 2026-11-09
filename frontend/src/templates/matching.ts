import type { CatalogField } from "../types";
import {
  dataTypeToFieldType,
  type FieldSuggestions,
  type TemplateField,
} from "./types";

export type SourceDocument = {
  id: string;
  file: File;
  status: "reading" | "ready" | "error";
  message?: string;
  suggestions?: FieldSuggestions;
};

export const newTemplateField = (partial?: Partial<TemplateField>): TemplateField => ({
  id: partial?.id || crypto.randomUUID(),
  name: partial?.name || "New field",
  type: partial?.type || "text",
  required: partial?.required ?? false,
  hint: partial?.hint,
  format: partial?.format,
  validation: partial?.validation,
  sampleBox: partial?.sampleBox,
  catalogKey: partial?.catalogKey,
  level: partial?.level ?? "line",
  suggested: partial?.suggested,
  sampleValue: partial?.sampleValue,
});

/**
 * Build the template field list from sample suggestions.
 * - matched: catalogue keys from fields.ts
 * - suggested: values found in the file that are NOT in the catalogue
 * - keptAccepted: customs the user already accepted (no catalogue key)
 */
export const fieldsFromSuggestions = (
  docs: SourceDocument[],
  dismissed: Set<string>,
  keptAccepted: TemplateField[],
  catalog: CatalogField[],
  headerKeys: Set<string>,
) => {
  const byKey = new Map(catalog.map((field) => [field.key, field]));
  const acceptedIds = new Set(keptAccepted.map((field) => field.id));
  const ready = docs.filter((document) => document.status === "ready" && document.suggestions);
  const matchedVotes = new Map<
    string,
    { label: string; type: TemplateField["type"]; hits: number; sampleValue?: string; level: "header" | "line" }
  >();
  const suggestedVotes = new Map<
    string,
    { label: string; type: TemplateField["type"]; description: string; hits: number; sampleValue?: string }
  >();

  for (const document of ready) {
    const suggestions = document.suggestions as FieldSuggestions;
    const seenMatched = new Set<string>();
    for (const hit of suggestions.matched) {
      if (dismissed.has(hit.key) || seenMatched.has(hit.key)) continue;
      seenMatched.add(hit.key);
      const catalogField = byKey.get(hit.key);
      // Keep API matches even if the local catalogue has not loaded yet.
      const row = matchedVotes.get(hit.key) ?? {
        label: catalogField?.label || hit.label || hit.printedLabel || hit.key,
        type: dataTypeToFieldType(catalogField?.dataType ?? "TEXT"),
        hits: 0,
        sampleValue: hit.sampleValue,
        level: headerKeys.has(hit.key) ? "header" : "line",
      };
      row.hits += 1;
      if (catalogField?.label) row.label = catalogField.label;
      row.level = headerKeys.has(hit.key) ? "header" : "line";
      if (hit.sampleValue) row.sampleValue = hit.sampleValue;
      matchedVotes.set(hit.key, row);
    }
    const seenSuggested = new Set<string>();
    for (const hit of suggestions.suggested) {
      if (byKey.has(hit.key) || dismissed.has(hit.key) || acceptedIds.has(hit.key) || seenSuggested.has(hit.key)) {
        continue;
      }
      seenSuggested.add(hit.key);
      const row = suggestedVotes.get(hit.key) ?? {
        label: hit.label,
        type: dataTypeToFieldType(hit.dataType),
        description: hit.description,
        hits: 0,
        sampleValue: hit.sampleValue,
      };
      row.hits += 1;
      row.label = hit.label;
      row.description = hit.description;
      if (hit.sampleValue) row.sampleValue = hit.sampleValue;
      suggestedVotes.set(hit.key, row);
    }
  }

  const docCount = Math.max(ready.length, 1);
  const matched = [...matchedVotes.entries()]
    .filter(([, row]) => row.hits >= Math.ceil(docCount / 2))
    .map(([key, row]) =>
      newTemplateField({
        id: `matched:${key}`,
        name: row.label,
        type: row.type,
        catalogKey: key,
        level: row.level,
        sampleValue: row.sampleValue,
        required: false,
        suggested: false,
      }),
    );
  const suggested = [...suggestedVotes.entries()]
    .filter(([, row]) => row.hits >= Math.ceil(docCount / 2))
    .map(([key, row]) =>
      newTemplateField({
        id: key,
        name: row.label,
        type: row.type,
        level: "line",
        suggested: true,
        sampleValue: row.sampleValue,
        hint: row.description,
      }),
    );

  return [...matched, ...suggested, ...keptAccepted];
};
