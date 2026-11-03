export const TEMPLATE_CATEGORIES = ["Finance", "HR", "Legal", "Identity"] as const;
export const FIELD_TYPES = ["text", "date", "currency", "number", "table"] as const;

export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];
export type FieldType = (typeof FIELD_TYPES)[number];
export type FieldLevel = "header" | "line";

export type SampleBox = {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type TemplateField = {
  id: string;
  name: string;
  type: FieldType;
  required: boolean;
  hint?: string;
  format?: string;
  validation?: string;
  sampleBox?: SampleBox;
  suggested?: boolean;
  catalogKey?: string;
  level?: FieldLevel;
  sampleValue?: string;
};

export type Template = {
  id: string;
  name: string;
  version: number;
  category: TemplateCategory;
  createdAt: string;
  updatedAt: string;
  fields: TemplateField[];
};

export type TemplateSummary = Template & {
  documentCount: number;
  autoApprovedPercent: number | null;
  active?: boolean;
};

export type FieldTest = {
  fieldId: string;
  name: string;
  value: string;
  confidence: number;
};

export type SampleTest = {
  fileName: string;
  fields: FieldTest[];
};

export type MatchedFieldSuggestion = {
  key: string;
  label: string;
  printedLabel: string;
  sampleValue: string;
  isDefault: boolean;
};

export type NewFieldSuggestion = {
  key: string;
  label: string;
  dataType: string;
  description: string;
  matchRole: string;
  sampleValue: string;
  showToSupplier: boolean;
};

export type FieldSuggestions = {
  matched: MatchedFieldSuggestion[];
  suggested: NewFieldSuggestion[];
};

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: "Text",
  date: "Date",
  currency: "Currency",
  number: "Number",
  table: "Table",
};

export const dataTypeToFieldType = (dataType: string): FieldType => {
  if (dataType === "DATE") return "date";
  if (dataType === "NUMBER") return "number";
  if (dataType === "LIST" || dataType === "KEY_VALUE" || dataType === "MANUFACTURER_LIST") {
    return "table";
  }
  return "text";
};

export const ACTIVE_TEMPLATE_KEY = "extract.templateInUse";

export type TemplateInUse = {
  id: string;
  name: string;
  headerKeys: string[];
  lineKeys: string[];
};

const fieldKey = (field: Template["fields"][number]) =>
  field.catalogKey?.trim() ||
  field.name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

export const rememberTemplate = (template: Pick<Template, "id" | "name" | "fields">) => {
  const stored: TemplateInUse = {
    id: template.id,
    name: template.name,
    headerKeys: template.fields.filter((field) => field.level === "header").map(fieldKey).filter(Boolean),
    lineKeys: template.fields.filter((field) => field.level !== "header").map(fieldKey).filter(Boolean),
  };
  localStorage.setItem(ACTIVE_TEMPLATE_KEY, JSON.stringify(stored));
};

export const clearRememberedTemplate = () => {
  localStorage.removeItem(ACTIVE_TEMPLATE_KEY);
};

export const readTemplateInUse = (): TemplateInUse | null => {
  try {
    const raw = localStorage.getItem(ACTIVE_TEMPLATE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const row = parsed as Partial<TemplateInUse> & { fieldNames?: unknown };
    if (typeof row.id !== "string" || typeof row.name !== "string") return null;
    const asKeys = (value: unknown) =>
      Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
    // Older saves stored display names in fieldNames; treat them as line keys.
    const legacy = asKeys(row.fieldNames);
    return {
      id: row.id,
      name: row.name,
      headerKeys: asKeys(row.headerKeys),
      lineKeys: asKeys(row.lineKeys).length ? asKeys(row.lineKeys) : legacy,
    };
  } catch {
    return null;
  }
};
