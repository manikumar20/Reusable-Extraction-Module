const FILE_KIND: Record<string, string> = {
  ".pdf": "PDF",
  ".doc": "Word",
  ".docx": "Word",
  ".xls": "Excel",
  ".xlsx": "Excel",
  ".txt": "Text",
  ".jpg": "Image",
  ".jpeg": "Image",
  ".png": "Image",
  ".gif": "Image",
  ".webp": "Image",
};

const extensionOf = (fileName: string) => {
  const dot = fileName.lastIndexOf(".");
  return dot < 0 ? "" : fileName.slice(dot).toLowerCase();
};

/** Named kinds such as Textura. Empty when the caller did not choose one. */
export const namedDocumentType = (value: unknown) => {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > 80) return "";
  if (!/^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u.test(text)) return "";
  return text;
};

/** File kind used when no named type was chosen. */
export const documentTypeFromFile = (fileName: string) =>
  FILE_KIND[extensionOf(fileName)] ?? "File";

export const resolveDocumentType = (requested: unknown, fileName: string) =>
  namedDocumentType(requested) || documentTypeFromFile(fileName);
