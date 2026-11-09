import {
  createTemplate,
  getActiveTemplate,
  getActiveTemplateId,
  listTemplates,
  setActiveTemplate,
  type FieldInput,
  type FieldType,
} from "../../db/templates/templateDb.js";
import {
  DEFAULT_LINE_FIELDS,
  HEADER_FIELDS,
  type CatalogField,
} from "../extract/engine/shared/fields.js";

export const DEFAULT_TEMPLATE_NAME = "Default Line Fields";

const catalogType = (dataType: string): FieldType => {
  if (dataType === "DATE") return "date";
  if (dataType === "NUMBER") return "number";
  if (dataType === "LIST" || dataType === "KEY_VALUE" || dataType === "MANUFACTURER_LIST") {
    return "table";
  }
  return "text";
};

const toFieldInput = (
  field: CatalogField,
  level: "header" | "line",
): FieldInput => ({
  name: field.label,
  type: catalogType(field.dataType),
  required: Boolean(field.isDefault),
  hint: field.description,
  catalogKey: field.key,
  level,
});

/** Header keys that pair well with the default line extract set. */
const DEFAULT_HEADER_KEYS = new Set([
  "document_number",
  "customer_name",
  "document_title",
  "issue_date",
  "document_currency",
  "buyer_name",
  "delivery_location",
  "payment_terms",
]);

export const defaultTemplateFields = (): FieldInput[] => [
  ...HEADER_FIELDS.filter((field) => DEFAULT_HEADER_KEYS.has(field.key)).map((field) =>
    toFieldInput(field, "header"),
  ),
  ...DEFAULT_LINE_FIELDS.map((field) => toFieldInput(field, "line")),
];

/**
 * Ensure a built-in template exists with the catalogue default line fields
 * (and a small header set). Activate it when nothing else is active.
 */
export const ensureDefaultTemplate = async () => {
  const templates = await listTemplates({});
  const existing = templates.find(
    (template) => template.name === DEFAULT_TEMPLATE_NAME || template.name === "Default template",
  );

  const defaults =
    existing ??
    (await createTemplate({
      name: DEFAULT_TEMPLATE_NAME,
      category: "Finance",
      fields: defaultTemplateFields(),
    }));

  if (!existing) {
    console.log(`Created default template “${DEFAULT_TEMPLATE_NAME}” (${defaults.id}).`);
  }

  const activeId = await getActiveTemplateId();
  if (!activeId) {
    await setActiveTemplate(defaults.id);
    console.log(`Activated default template “${DEFAULT_TEMPLATE_NAME}”.`);
  }

  return (await getActiveTemplate()) ?? defaults;
};
