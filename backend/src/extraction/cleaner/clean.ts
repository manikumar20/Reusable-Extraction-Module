import { EMPTY_MARKERS, FIELD_DATA_TYPES, ITEM_SCOPES } from "../shared/constants.js";
import type { CatalogField } from "../shared/fields.js";

/**
 * Values for the optional line fields. Default fields keep their own
 * columns; everything else lives in extraFields.
 */

export type KeyValuePair = { name: string; value: string };
export type ExtraFieldValue = string | string[] | KeyValuePair[];
export type LineExtraFields = Record<string, ExtraFieldValue>;

const cleanText = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  const text = String(value).replace(/\s+/g, " ").trim();
  return EMPTY_MARKERS.has(text.toLowerCase()) ? "" : text;
};

/** Excel blank dates (1/1/1900, 1900-01-01) mean "no date". */
const cleanDate = (value: unknown): string => {
  const text = cleanText(value);
  return /^(0?1[/.-]0?1[/.-]1900|1900-01-01)/.test(text) ? "" : text;
};

const toArray = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") return value.split(/[;\n]+/);
  return value === null || value === undefined ? [] : [value];
};

const cleanList = (value: unknown): string[] => {
  const seen = new Set<string>();
  return toArray(value)
    .map(cleanText)
    .filter((item) => {
      const key = item.toLowerCase();
      if (!item || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const cleanKeyValues = (value: unknown): KeyValuePair[] => {
  const pairs: KeyValuePair[] = [];
  const push = (name: unknown, raw: unknown) => {
    const label = cleanText(name);
    const text = cleanText(raw);
    if (label && text) pairs.push({ name: label, value: text });
  };
  if (Array.isArray(value)) {
    value.forEach((entry) => {
      if (entry && typeof entry === "object" && !Array.isArray(entry)) {
        const row = entry as Record<string, unknown>;
        push(row.name ?? row.key, row.value);
      } else if (typeof entry === "string" && entry.includes(":")) {
        const [name, ...rest] = entry.split(":");
        push(name, rest.join(":"));
      }
    });
  } else if (value && typeof value === "object") {
    Object.entries(value as Record<string, unknown>).forEach(([name, raw]) =>
      push(name, raw),
    );
  } else if (typeof value === "string") {
    return cleanKeyValues(value.split(/[;\n]+/));
  }
  return pairs;
};

export const cleanExtraFieldValue = (
  field: Pick<CatalogField, "key" | "dataType">,
  value: unknown,
): ExtraFieldValue => {
  switch (field.dataType) {
    case FIELD_DATA_TYPES.LIST:
      return cleanList(value);
    case FIELD_DATA_TYPES.KEY_VALUE:
      return cleanKeyValues(value);
    case FIELD_DATA_TYPES.DATE:
      return cleanDate(value);
    case FIELD_DATA_TYPES.ENUM: {
      const text = cleanText(value).toUpperCase();
      if (field.key === "item_scope") {
        return (ITEM_SCOPES as readonly string[]).includes(text) ? text : "";
      }
      return text;
    }
    default:
      return cleanText(value);
  }
};

/** Keep only the optional line fields, cleaned by data type. */
export const cleanExtraFields = (
  fields: CatalogField[],
  raw: unknown,
): LineExtraFields => {
  const source =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const cleaned: LineExtraFields = {};
  fields.forEach((field) => {
    if (field.isDefault) return;
    const value = cleanExtraFieldValue(field, source[field.key]);
    if (isFilled(value)) cleaned[field.key] = value;
  });
  return cleaned;
};

export const isFilled = (value: ExtraFieldValue | undefined | null) =>
  Array.isArray(value) ? value.length > 0 : Boolean(value && value.trim());

/** Non-empty values win; lists are combined; longer text wins over shorter. */
export const mergeExtraFields = (
  base: LineExtraFields | undefined,
  extra: LineExtraFields | undefined,
): LineExtraFields => {
  const merged: LineExtraFields = { ...(base ?? {}) };
  Object.entries(extra ?? {}).forEach(([key, value]) => {
    const current = merged[key];
    if (!isFilled(value)) return;
    if (!isFilled(current)) {
      merged[key] = value;
      return;
    }
    if (Array.isArray(current) && Array.isArray(value)) {
      const seen = new Set(current.map((item) => JSON.stringify(item)));
      merged[key] = [
        ...current,
        ...value.filter((item) => !seen.has(JSON.stringify(item))),
      ] as ExtraFieldValue;
      return;
    }
    if (typeof current === "string" && typeof value === "string") {
      merged[key] = value.length > current.length ? value : current;
    }
  });
  return merged;
};

/** JSON schema for one optional field inside the extraction tool. */
export const extraFieldSchema = (
  field: Pick<CatalogField, "key" | "dataType" | "description" | "label">,
): Record<string, unknown> => {
  const description = field.description || field.label;
  switch (field.dataType) {
    case FIELD_DATA_TYPES.LIST:
      return { type: "array", items: { type: "string" }, description };
    case FIELD_DATA_TYPES.KEY_VALUE:
      return {
        type: "array",
        description,
        items: {
          type: "object",
          additionalProperties: false,
          properties: { name: { type: "string" }, value: { type: "string" } },
          required: ["name", "value"],
        },
      };
    case FIELD_DATA_TYPES.ENUM:
      return field.key === "item_scope"
        ? { type: "string", enum: [...ITEM_SCOPES, ""], description }
        : { type: "string", description };
    case FIELD_DATA_TYPES.DATE:
      return {
        type: "string",
        description: `${description} Write YYYY-MM-DD when the date is unambiguous, otherwise copy it as printed.`,
      };
    default:
      return { type: "string", description };
  }
};
