import type {
  CatalogField,
  ExtraFieldValue,
  ExtractedLine,
  KeyValuePair,
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
  Array.isArray(value) && value.length > 0 && typeof value[0] !== "string";

export const formatValue = (value: ExtraFieldValue | undefined) => {
  if (!isFilled(value) || value === undefined) return "";
  if (typeof value === "string") return value;
  if (isKeyValue(value)) {
    return value.map((pair) => `${pair.name}: ${pair.value}`).join("; ");
  }
  return value.join(", ");
};

export const manufacturersOf = (line: ExtractedLine) => {
  const listed = (line.manufacturers ?? []).filter(
    (option) => option.name.trim() || option.partNumber.trim(),
  );
  if (listed.length) return listed;
  if (line.manufacturer.trim() || line.partNumber.trim()) {
    return [{ name: line.manufacturer, partNumber: line.partNumber }];
  }
  return [];
};

export const formatManufacturers = (line: ExtractedLine) =>
  manufacturersOf(line)
    .map((option) =>
      [option.name.trim(), option.partNumber.trim()].filter(Boolean).join(" · "),
    )
    .join("\n");

export const formatUsd = (value: number) =>
  value.toLocaleString("en-US", { style: "currency", currency: "USD" });

const csvCell = (value: string) => `"${value.replaceAll('"', '""')}"`;

export const linesToCsv = (lines: ExtractedLine[], extraFields: CatalogField[]) => {
  const extras = extraFields.filter((field) =>
    lines.some((line) => isFilled(line.extraFields?.[field.key])),
  );
  const headers = [
    "Line No.",
    "Short Description",
    "Product Name",
    "Quantity",
    "Unit of Measure",
    "Currency",
    "Manufacturers",
    "Technical Specification",
    ...extras.map((field) => field.label),
  ];
  const rows = lines.map((line) => [
    line.customerItemNumber,
    line.description,
    line.productName,
    line.quantity,
    line.unitOfMeasure,
    line.currency,
    formatManufacturers(line).replaceAll("\n", "; "),
    line.technicalSpecification,
    ...extras.map((field) => formatValue(line.extraFields?.[field.key])),
  ]);
  return [headers, ...rows]
    .map((row) => row.map((cell) => csvCell(cell ?? "")).join(","))
    .join("\r\n");
};

export const downloadText = (filename: string, contents: string, type: string) => {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

export const rowKey = (line: ExtractedLine, index: number) =>
  `${line.customerItemNumber}|${index}|${line.description.slice(0, 40)}`;
