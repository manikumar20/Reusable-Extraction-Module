import {
  createTemplate,
  getActiveTemplate,
  getActiveTemplateId,
  listTemplates,
  saveTemplateVersion,
  setActiveTemplate,
  type FieldInput,
  type FieldType,
  type Template,
} from "../../db/templates/templateDb.js";
import {
  DEFAULT_LINE_FIELDS,
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

const toFieldInput = (field: CatalogField): FieldInput => ({
  name: field.label,
  type: catalogType(field.dataType),
  required: Boolean(field.isDefault),
  hint: field.description,
  catalogKey: field.key,
  level: "line",
});

/** Built-in template: the coded default line fields, and nothing else. */
export const defaultTemplateFields = (): FieldInput[] =>
  DEFAULT_LINE_FIELDS.map((field) => toFieldInput(field));

const matchesCodedDefaults = (
  fields: { catalogKey?: string }[],
) => {
  const wanted = defaultTemplateFields();
  return (
    fields.length === wanted.length &&
    wanted.every((field, index) => fields[index]?.catalogKey === field.catalogKey)
  );
};

/**
 * Ensure a built-in template exists with the catalogue default line fields.
 * Activate it when nothing else is active.
 */
export const ensureDefaultTemplate = async () => {
  const templates = await listTemplates({});
  const existing = templates.find(
    (template) => template.name === DEFAULT_TEMPLATE_NAME || template.name === "Default template",
  );

  let defaults: Template | undefined = existing;
  if (!defaults) {
    defaults = await createTemplate({
      name: DEFAULT_TEMPLATE_NAME,
      fields: defaultTemplateFields(),
      published: true,
    });
    console.log(`Created default template “${DEFAULT_TEMPLATE_NAME}” (${defaults.id}).`);
  } else if (!matchesCodedDefaults(defaults.fields)) {
    const updated = await saveTemplateVersion(defaults.id, {
      name: defaults.name === "Default template" ? DEFAULT_TEMPLATE_NAME : defaults.name,
      fields: defaultTemplateFields(),
    });
    if (updated) defaults = updated;
    console.log(`Updated default template “${defaults.name}” to the coded line fields.`);
  }
  if (!defaults) throw new Error("Default template was not saved.");

  const activeId = await getActiveTemplateId();
  if (!activeId) {
    await setActiveTemplate(defaults.id);
    console.log(`Activated default template “${defaults.name}”.`);
  }

  return (await getActiveTemplate()) ?? defaults;
};
