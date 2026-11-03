import type {
  ExtraFieldValue,
  ExtractedLine,
  KeyValuePair,
  ManufacturerValue,
} from "./types";

export const FALLBACK_ACCEPT = [
  ".pdf",
  ".txt",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
];

export const extensionOf = (fileName: string) => {
  const dot = fileName.lastIndexOf(".");
  return dot < 0 ? "" : fileName.slice(dot).toLowerCase();
};

export const isFilled = (value: ExtraFieldValue | undefined) => {
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return false;
};

export const isKeyValue = (
  value: ExtraFieldValue,
): value is KeyValuePair[] =>
  Array.isArray(value) &&
  value.length > 0 &&
  typeof value[0] !== "string" &&
  !("partNumber" in value[0]);

const isManufacturerList = (
  value: ExtraFieldValue,
): value is ManufacturerValue[] =>
  Array.isArray(value) &&
  value.length > 0 &&
  typeof value[0] !== "string" &&
  "partNumber" in value[0];

export const formatValue = (value: ExtraFieldValue | undefined) => {
  if (!isFilled(value) || value === undefined) return "";
  if (typeof value === "string") return value;
  if (isManufacturerList(value)) {
    return value
      .map((maker) =>
        [maker.name.trim(), maker.partNumber.trim()].filter(Boolean).join(" · "),
      )
      .join("\n");
  }
  if (isKeyValue(value)) {
    return value.map((pair) => `${pair.name}: ${pair.value}`).join("; ");
  }
  return value.join(", ");
};

export const formatUsd = (value: number) =>
  value.toLocaleString("en-US", { style: "currency", currency: "USD" });

export const rowKey = (line: ExtractedLine, index: number) =>
  `${index}|${JSON.stringify(line.fields)}`;
