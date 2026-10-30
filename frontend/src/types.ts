export type KeyValuePair = { name: string; value: string };
export type ExtraFieldValue = string | string[] | KeyValuePair[];

export type Manufacturer = { name: string; partNumber: string };

export type ExtractedLine = {
  customerItemNumber: string;
  description: string;
  productName: string;
  manufacturers: Manufacturer[];
  manufacturer: string;
  partNumber: string;
  quantity: string;
  unitOfMeasure: string;
  currency: string;
  technicalSpecification: string;
  extraFields?: Record<string, ExtraFieldValue>;
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
  error: { message: string; code: string; status: number } | null;
};

export type CatalogField = {
  key: string;
  label: string;
  dataType: string;
  description: string;
  isDefault?: boolean;
};

export type Catalog = {
  header: CatalogField[];
  lines: CatalogField[];
};

export type ServerConfig = {
  ready: boolean;
  recordModel: string;
  documentModel: string;
  accept: string[];
  maxUploadMb: number;
  maxImageMb: number;
};
