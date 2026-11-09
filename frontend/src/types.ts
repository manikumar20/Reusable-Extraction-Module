export type KeyValuePair = { name: string; value: string };
export type ManufacturerValue = { name: string; partNumber: string };
export type ExtraFieldValue = string | string[] | KeyValuePair[] | ManufacturerValue[];

export type ExtractedLine = {
  fields: Record<string, ExtraFieldValue>;
};

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  model?: string;
};

export type JobPhase = "reading" | "lines" | "header" | "done" | "error";

export type Job = {
  id: string;
  fileName: string;
  status: "running" | "done" | "error";
  phase: JobPhase;
  progress: number;
  header: Record<string, ExtraFieldValue>;
  lines: ExtractedLine[];
  usage: TokenUsage;
  headerUsage: TokenUsage;
  lineCostUsd: number;
  headerCostUsd: number;
  template?: {
    name: string;
    headerKeys: string[];
    lineKeys: string[];
  } | null;
  error: { message: string; code: string; status: number } | null;
};

export type CatalogField = {
  key: string;
  label: string;
  dataType: string;
  description: string;
  isDefault?: boolean;
  supplierShareable?: boolean;
};

export type Catalog = {
  header: CatalogField[];
  lines: CatalogField[];
};

export type StoredDocument = {
  id: number;
  fileName: string;
  documentType: string;
  mimeType: string;
  uploadedAt: string;
  status?: string;
  sources?: string[];
  totalFields?: number;
  fields?: { fieldName: string; fieldValue: string }[];
};

export type ExtractedFieldRow = {
  id: string;
  documentId: number;
  fieldName: string;
  fieldKey: string;
  fieldValue: string;
  dataType: string;
  source: string;
  createdAt: string;
  updatedAt: string;
};

export const DOCUMENT_TYPES = [
  "Textura",
  "Enquiry",
  "Invoice",
  "Quote",
  "Specification",
] as const;

export type ServerConfig = {
  ready: boolean;
  recordModel: string;
  documentModel: string;
  accept: string[];
  maxUploadMb: number;
  maxImageMb: number;
};
