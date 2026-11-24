import { randomUUID } from "node:crypto";
import { getPool } from "../_shared/client.js";

export const FIELD_TYPES = ["text", "date", "currency", "number", "table"] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

export type SampleBox = {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type FieldLevel = "header" | "line";

export type TemplateField = {
  id: string;
  name: string;
  type: FieldType;
  required: boolean;
  hint?: string;
  format?: string;
  validation?: string;
  sampleBox?: SampleBox;
  catalogKey?: string;
  level?: FieldLevel;
  suggested?: boolean;
  sampleValue?: string;
};

export type Template = {
  id: string;
  numericId: number;
  name: string;
  createdAt: string;
  updatedAt: string;
  published: boolean;
  fields: TemplateField[];
};

export type TemplateSummary = Template & {
  documentCount: number;
  autoApprovedPercent: number | null;
  active: boolean;
};

const fieldKey = (field: TemplateField) =>
  field.catalogKey?.trim() ||
  field.name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

/** Shape used by extraction jobs. Every template field is a line field. */
export const toJobTemplate = (template: Template) => ({
  id: template.id,
  name: template.name,
  lineKeys: template.fields.map(fieldKey).filter(Boolean),
});

export const getActiveTemplateId = async (): Promise<string | null> => {
  const { rows } = await getPool().query<{ id: string }>(
    `SELECT id FROM templates WHERE is_active LIMIT 1`,
  );
  return rows[0]?.id ?? null;
};

export const getActiveTemplate = async (): Promise<Template | null> => {
  const id = await getActiveTemplateId();
  return id ? getTemplate(id) : null;
};

export const setActiveTemplate = async (templateId: string | null): Promise<Template | null> => {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(`UPDATE templates SET is_active = FALSE WHERE is_active`);
    if (templateId) {
      const updated = await client.query(
        `
          UPDATE templates
          SET is_active = TRUE, updated_at = NOW()
          WHERE id::text = $1 OR numeric_id::text = $1
        `,
        [templateId],
      );
      if (!updated.rowCount) {
        await client.query("ROLLBACK");
        return null;
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return templateId ? getTemplate(templateId) : null;
};

type TemplateRow = {
  id: string;
  numeric_id: number;
  name: string;
  created_at: Date;
  updated_at: Date;
  published: boolean;
};

type FieldRow = {
  id: string;
  template_id: string;
  position: number;
  name: string;
  field_type: string;
  required: boolean;
  hint: string | null;
  format: string | null;
  validation: string | null;
  sample_page: number | null;
  sample_x: number | null;
  sample_y: number | null;
  sample_w: number | null;
  sample_h: number | null;
  catalog_key: string | null;
  level: string | null;
};

export type FieldInput = {
  id?: string;
  name: string;
  type: FieldType;
  required: boolean;
  hint?: string;
  format?: string;
  validation?: string;
  sampleBox?: SampleBox;
  catalogKey?: string;
  level?: FieldLevel;
};

const iso = (value: Date) => value.toISOString();

const mapField = (row: FieldRow): TemplateField => {
  const field: TemplateField = {
    id: row.id,
    name: row.name,
    type: row.field_type as FieldType,
    required: row.required,
    level: "line",
  };
  if (row.hint) field.hint = row.hint;
  if (row.format) field.format = row.format;
  if (row.validation) field.validation = row.validation;
  if (row.catalog_key) field.catalogKey = row.catalog_key;
  if (
    row.sample_page != null &&
    row.sample_x != null &&
    row.sample_y != null &&
    row.sample_w != null &&
    row.sample_h != null
  ) {
    field.sampleBox = {
      page: row.sample_page,
      x: row.sample_x,
      y: row.sample_y,
      w: row.sample_w,
      h: row.sample_h,
    };
  }
  return field;
};

const loadFields = async (templateIds: string[]) => {
  const grouped = new Map<string, TemplateField[]>();
  if (!templateIds.length) return grouped;
  const { rows } = await getPool().query<FieldRow>(
    `
      SELECT id, template_id, position, name, field_type, required,
             hint, format, validation, sample_page, sample_x, sample_y, sample_w, sample_h,
             catalog_key, level
      FROM template_fields
      WHERE template_id = ANY($1::uuid[])
      ORDER BY position ASC, name ASC
    `,
    [templateIds],
  );
  for (const row of rows) {
    const list = grouped.get(row.template_id) ?? [];
    list.push(mapField(row));
    grouped.set(row.template_id, list);
  }
  return grouped;
};

const toTemplate = (row: TemplateRow, fields: TemplateField[]): Template => ({
  id: row.id,
  numericId: Number(row.numeric_id),
  name: row.name,
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
  published: row.published !== false,
  fields,
});

const insertFields = async (
  templateId: string,
  fields: FieldInput[],
  query: (text: string, values: unknown[]) => Promise<unknown>,
) => {
  for (const [index, field] of fields.entries()) {
    const box = field.sampleBox;
    await query(
      `
        INSERT INTO template_fields (
          id, template_id, position, name, field_type, required,
          hint, format, validation, sample_page, sample_x, sample_y, sample_w, sample_h,
          catalog_key, level
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      `,
      [
        (() => {
          const id = field.id?.trim() ?? "";
          return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
            ? id
            : randomUUID();
        })(),
        templateId,
        index,
        field.name,
        field.type,
        field.required,
        field.hint?.trim() || null,
        field.format?.trim() || null,
        field.validation?.trim() || null,
        box?.page ?? null,
        box?.x ?? null,
        box?.y ?? null,
        box?.w ?? null,
        box?.h ?? null,
        field.catalogKey?.trim() || null,
        "line",
      ],
    );
  }
};

export const listTemplates = async (filter: {
  query?: string;
}): Promise<TemplateSummary[]> => {
  const params: unknown[] = [];
  const where: string[] = [];
  if (filter.query) {
    params.push(`%${filter.query}%`);
    where.push(`name ILIKE $${params.length}`);
  }
  const { rows } = await getPool().query<TemplateRow>(
    `
      SELECT id, numeric_id, name, is_active, published, created_at, updated_at
      FROM templates
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY updated_at DESC, name ASC
    `,
    params,
  );
  const fields = await loadFields(rows.map((row) => row.id));
  const counts = await countDocumentsByTemplate(rows.map((row) => Number(row.numeric_id)));
  const activeId = await getActiveTemplateId();
  return rows.map((row) => ({
    ...toTemplate(row, fields.get(row.id) ?? []),
    documentCount: counts.get(Number(row.numeric_id)) ?? 0,
    autoApprovedPercent: null,
    active: row.id === activeId,
  }));
};

/** Resolve a template by UUID or numeric_id. */
export const getTemplate = async (templateId: string): Promise<Template | null> => {
  const { rows } = await getPool().query<TemplateRow>(
    `
      SELECT id, numeric_id, name, is_active, published, created_at, updated_at
      FROM templates
      WHERE id::text = $1 OR numeric_id::text = $1
      LIMIT 1
    `,
    [templateId],
  );
  const row = rows[0];
  if (!row) return null;
  const fields = await loadFields([row.id]);
  return toTemplate(row, fields.get(row.id) ?? []);
};

const numericIdForTemplate = async (templateRef: string): Promise<number | null> => {
  const template = await getTemplate(templateRef);
  return template?.numericId ?? null;
};

export const createTemplate = async (input: {
  name: string;
  fields: FieldInput[];
  published?: boolean;
}): Promise<Template> => {
  const templateId = randomUUID();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `
        INSERT INTO templates (id, name, published)
        VALUES ($1, $2, $3)
      `,
      [templateId, input.name, input.published === true],
    );
    await insertFields(templateId, input.fields, (text, values) => client.query(text, values));
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  const created = await getTemplate(templateId);
  if (!created) throw new Error("Template was not saved.");
  return created;
};

/** Update the template row in place (no version history). */
export const saveTemplateVersion = async (
  templateId: string,
  input: { name: string; fields: FieldInput[] },
): Promise<Template | null> => {
  const existingTemplate = await getTemplate(templateId);
  if (!existingTemplate) return null;
  const uuid = existingTemplate.id;
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `
        UPDATE templates
        SET name = $2, published = TRUE, updated_at = NOW()
        WHERE id = $1
      `,
      [uuid, input.name],
    );
    await client.query(`DELETE FROM template_fields WHERE template_id = $1`, [uuid]);
    await insertFields(uuid, input.fields, (text, values) => client.query(text, values));
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return getTemplate(uuid);
};

export type TemplateDocument = {
  id: string;
  templateId: number;
  fileName: string;
  storedName: string;
  mimeType: string;
  createdAt: string;
  extractedFields: TemplateField[];
};

type DocumentRow = {
  id: string;
  template_id: number | string;
  file_name: string;
  stored_name: string;
  mime_type: string;
  created_at: Date;
  extracted_fields?: unknown;
};

const parseExtractedFields = (value: unknown): TemplateField[] => {
  if (!Array.isArray(value)) return [];
  const fields: TemplateField[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const name = typeof row.name === "string" ? row.name.trim() : "";
    if (!name) continue;
    const type = (FIELD_TYPES as readonly string[]).includes(String(row.type))
      ? (row.type as FieldType)
      : "text";
    fields.push({
      id: typeof row.id === "string" && row.id.trim() ? row.id : randomUUID(),
      name,
      type,
      required: row.required === true,
      hint: typeof row.hint === "string" ? row.hint : undefined,
      catalogKey: typeof row.catalogKey === "string" ? row.catalogKey : undefined,
      level: "line",
      suggested: row.suggested === true,
    });
  }
  return fields;
};

const mapDocument = (row: DocumentRow): TemplateDocument => ({
  id: row.id,
  templateId: Number(row.template_id),
  fileName: row.file_name,
  storedName: row.stored_name,
  mimeType: row.mime_type,
  createdAt: iso(row.created_at),
  extractedFields: parseExtractedFields(row.extracted_fields),
});

const countDocumentsByTemplate = async (numericIds: number[]) => {
  const counts = new Map<number, number>();
  if (!numericIds.length) return counts;
  const { rows } = await getPool().query<{ template_id: number; count: string }>(
    `
      SELECT template_id, COUNT(*)::text AS count
      FROM template_documents
      WHERE template_id = ANY($1::int[])
      GROUP BY template_id
    `,
    [numericIds],
  );
  for (const row of rows) counts.set(Number(row.template_id), Number(row.count) || 0);
  return counts;
};

export const listTemplateDocuments = async (
  templateId: string,
): Promise<TemplateDocument[]> => {
  const numericId = await numericIdForTemplate(templateId);
  if (numericId == null) return [];
  const { rows } = await getPool().query<DocumentRow>(
    `
      SELECT id, template_id, file_name, stored_name, mime_type, extracted_fields, created_at
      FROM template_documents
      WHERE template_id = $1
      ORDER BY created_at ASC
    `,
    [numericId],
  );
  return rows.map(mapDocument);
};

export const getTemplateDocument = async (
  templateId: string,
  documentId: string,
): Promise<TemplateDocument | null> => {
  const numericId = await numericIdForTemplate(templateId);
  if (numericId == null) return null;
  const { rows } = await getPool().query<DocumentRow>(
    `
      SELECT id, template_id, file_name, stored_name, mime_type, extracted_fields, created_at
      FROM template_documents
      WHERE template_id = $1 AND id = $2
      LIMIT 1
    `,
    [numericId, documentId],
  );
  return rows[0] ? mapDocument(rows[0]) : null;
};

/** Replace all sample documents for a template with the newly uploaded files. */
export const replaceTemplateDocuments = async (
  templateId: string,
  files: { fileName: string; mimeType: string; fileData: Buffer; extractedFields?: unknown }[],
): Promise<TemplateDocument[]> => {
  const numericId = await numericIdForTemplate(templateId);
  if (numericId == null) return [];
  await getPool().query("DELETE FROM template_documents WHERE template_id = $1", [numericId]);

  for (const file of files) {
    await getPool().query(
      `
        INSERT INTO template_documents (id, template_id, file_name, stored_name, mime_type, extracted_fields, file_data)
        VALUES ($1, $2, $3, '', $4, $5::jsonb, $6)
      `,
      [
        randomUUID(),
        numericId,
        file.fileName,
        file.mimeType || "",
        JSON.stringify(parseExtractedFields(file.extractedFields)),
        file.fileData,
      ],
    );
  }
  return listTemplateDocuments(templateId);
};

export const getTemplateDocumentBytes = async (templateId: string, documentId: string) => {
  const numericId = await numericIdForTemplate(templateId);
  if (numericId == null) return null;
  const { rows } = await getPool().query<{
    file_name: string;
    mime_type: string;
    file_data: Buffer | null;
  }>(
    `
      SELECT file_name, mime_type, file_data
      FROM template_documents
      WHERE template_id = $1 AND id = $2
      LIMIT 1
    `,
    [numericId, documentId],
  );
  const row = rows[0];
  if (!row?.file_data?.length) return null;
  return {
    fileName: row.file_name,
    mimeType: row.mime_type || "application/octet-stream",
    bytes: row.file_data,
  };
};

export const deleteTemplate = async (templateId: string): Promise<boolean> => {
  const numericId = await numericIdForTemplate(templateId);
  const { rowCount } = await getPool().query(
    "DELETE FROM templates WHERE id::text = $1 OR numeric_id::text = $1",
    [templateId],
  );
  if (numericId != null) {
    await getPool().query("DELETE FROM template_documents WHERE template_id = $1", [numericId]);
  }
  return (rowCount ?? 0) > 0;
};
