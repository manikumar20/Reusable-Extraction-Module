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

/** Seed "In your schema" from catalogue fields that already exist in the database. */
export const fieldsFromCatalogSeed = (
  header: CatalogField[],
  lines: CatalogField[],
  options?: { defaultsOnly?: boolean },
) => {
  const defaultsOnly = options?.defaultsOnly ?? true;
  const headerKeys = new Set(header.map((field) => field.key));
  const picked = [
    ...header.filter((field) => (defaultsOnly ? Boolean(field.isDefault) : true)),
    ...lines.filter((field) => (defaultsOnly ? Boolean(field.isDefault) : true)),
  ];
  // Header catalog rarely marks isDefault; keep the same starter set as the backend default template.
  const defaultHeaderKeys = new Set([
    "document_number",
    "customer_name",
    "document_title",
    "issue_date",
    "document_currency",
    "buyer_name",
    "delivery_location",
    "payment_terms",
  ]);
  const fallbackHeaders =
    defaultsOnly && !picked.some((field) => headerKeys.has(field.key))
      ? header.filter((field) => defaultHeaderKeys.has(field.key))
      : defaultsOnly
        ? header.filter((field) => defaultHeaderKeys.has(field.key))
        : [];
  const seenKeys = new Set<string>();
  const seenNames = new Set<string>();
  return [...fallbackHeaders, ...picked]
    .filter((field) => {
      const nameKey = field.label.trim().toLowerCase();
      if (seenKeys.has(field.key) || seenNames.has(nameKey)) return false;
      seenKeys.add(field.key);
      seenNames.add(nameKey);
      return true;
    })
    .map((field) =>
      newTemplateField({
        id: `matched:${field.key}`,
        name: field.label,
        type: dataTypeToFieldType(field.dataType),
        catalogKey: field.key,
        level: headerKeys.has(field.key) ? "header" : "line",
        suggested: false,
        hint: field.description,
        required: Boolean(field.isDefault),
      }),
    );
};

/** Keep first occurrence of each field name (case-insensitive). */
export const uniqueFieldsByName = (fields: TemplateField[]) => {
  const seen = new Set<string>();
  return fields.filter((field) => {
    const key = field.name.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const normalLabel = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const resolveCatalogField = (catalog: CatalogField[], key: string, label = "") => {
  const byKey = catalog.find((field) => field.key === key);
  if (byKey) return byKey;
  const candidates = [key, label].map(normalLabel).filter(Boolean);
  if (!candidates.length) return undefined;
  return catalog.find((field) => {
    const aliases = [normalLabel(field.key), normalLabel(field.label)];
    return candidates.some((candidate) => aliases.includes(candidate));
  });
};

/**
 * Build the template field list from sample suggestions.
 * - matched / "In your schema": only catalogue fields that already exist in the database
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
    {
      label: string;
      type: TemplateField["type"];
      hits: number;
      sampleValue?: string;
      level: "header" | "line";
      description?: string;
    }
  >();
  const suggestedVotes = new Map<
    string,
    { label: string; type: TemplateField["type"]; description: string; hits: number; sampleValue?: string }
  >();

  const voteMatched = (
    catalogField: CatalogField,
    sampleValue?: string,
  ) => {
    if (dismissed.has(catalogField.key)) return;
    const row = matchedVotes.get(catalogField.key) ?? {
      label: catalogField.label,
      type: dataTypeToFieldType(catalogField.dataType ?? "TEXT"),
      hits: 0,
      sampleValue,
      level: headerKeys.has(catalogField.key) ? "header" : "line",
      description: catalogField.description,
    };
    row.hits += 1;
    row.label = catalogField.label;
    row.description = catalogField.description;
    row.level = headerKeys.has(catalogField.key) ? "header" : "line";
    if (sampleValue) row.sampleValue = sampleValue;
    matchedVotes.set(catalogField.key, row);
  };

  for (const document of ready) {
    const suggestions = document.suggestions as FieldSuggestions;
    const seenMatched = new Set<string>();
    for (const hit of suggestions.matched) {
      const catalogField = resolveCatalogField(catalog, hit.key, hit.label || hit.printedLabel || "");
      // Only keep fields that already exist in the catalogue / database.
      if (!catalogField || seenMatched.has(catalogField.key)) continue;
      seenMatched.add(catalogField.key);
      voteMatched(catalogField, hit.sampleValue);
    }
    const seenSuggested = new Set<string>();
    for (const hit of suggestions.suggested) {
      const catalogField = resolveCatalogField(catalog, hit.key, hit.label || "");
      if (catalogField) {
        if (seenMatched.has(catalogField.key)) continue;
        seenMatched.add(catalogField.key);
        voteMatched(catalogField, hit.sampleValue);
        continue;
      }
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

  const matched = [...matchedVotes.entries()]
    .filter(([, row]) => row.hits >= 1)
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
        hint: row.description,
      }),
    );
  const suggested = [...suggestedVotes.entries()]
    .filter(([, row]) => row.hits >= 1)
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
