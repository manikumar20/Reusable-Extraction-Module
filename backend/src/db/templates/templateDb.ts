import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { getPool } from "../_shared/client.js";
import { uploadDir } from "../../middleware/documentUpload.js";

export const TEMPLATE_CATEGORIES = ["Finance", "HR", "Legal", "Identity"] as const;
export const FIELD_TYPES = ["text", "date", "currency", "number", "table"] as const;

export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];
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
  active: boolean;
};

const fieldKey = (field: TemplateField) =>
  field.catalogKey?.trim() ||
  field.name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

/** Shape used by extraction jobs (header/line key lists). */
export const toJobTemplate = (template: Template) => ({
  id: template.id,
  name: template.name,
  headerKeys: template.fields
    .filter((field) => field.level === "header")
    .map(fieldKey)
    .filter(Boolean),
  lineKeys: template.fields
    .filter((field) => field.level !== "header")
    .map(fieldKey)
    .filter(Boolean),
});

export const getActiveTemplateId = async (): Promise<string | null> => {
  const { rows } = await getPool().query<{ template_id: string }>(
    `SELECT template_id FROM template_versions WHERE is_active LIMIT 1`,
  );
  return rows[0]?.template_id ?? null;
};

export const getActiveTemplate = async (): Promise<Template | null> => {
  const id = await getActiveTemplateId();
  return id ? getTemplate(id) : null;
};

export const setActiveTemplate = async (templateId: string | null): Promise<Template | null> => {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(`UPDATE template_versions SET is_active = FALSE WHERE is_active`);
    if (templateId) {
      const updated = await client.query(
        `
          UPDATE template_versions
          SET is_active = TRUE, updated_at = NOW()
          WHERE template_id = $1
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

type VersionRow = {
  id: string;
  template_id: string;
  name: string;
  version: number;
  category: string;
  created_at: Date;
  updated_at: Date;
};

type FieldRow = {
  id: string;
  template_version_id: string;
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
    level: row.level === "header" ? "header" : "line",
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

const loadFields = async (versionIds: string[]) => {
  const grouped = new Map<string, TemplateField[]>();
  if (!versionIds.length) return grouped;
  const { rows } = await getPool().query<FieldRow>(
    `
      SELECT id, template_version_id, position, name, field_type, required,
             hint, format, validation, sample_page, sample_x, sample_y, sample_w, sample_h,
             catalog_key, level
      FROM template_fields
      WHERE template_version_id = ANY($1::uuid[])
      ORDER BY position ASC, name ASC
    `,
    [versionIds],
  );
  for (const row of rows) {
    const list = grouped.get(row.template_version_id) ?? [];
    list.push(mapField(row));
    grouped.set(row.template_version_id, list);
  }
  return grouped;
};

const toTemplate = (row: VersionRow, fields: TemplateField[]): Template => ({
  id: row.template_id,
  name: row.name,
  version: row.version,
  category: row.category as TemplateCategory,
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
  fields,
});

const insertFields = async (
  rowId: string,
  fields: FieldInput[],
  query: (text: string, values: unknown[]) => Promise<unknown>,
) => {
  for (const [index, field] of fields.entries()) {
    const box = field.sampleBox;
    // Prefer the client field id when present so edits stay stable; otherwise mint one.
    await query(
      `
        INSERT INTO template_fields (
          id, template_version_id, position, name, field_type, required,
          hint, format, validation, sample_page, sample_x, sample_y, sample_w, sample_h,
          catalog_key, level
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      `,
      [
        field.id?.trim() || randomUUID(),
        rowId,
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
        field.level === "header" ? "header" : "line",
      ],
    );
  }
};

export const listTemplates = async (filter: {
  category?: string;
  query?: string;
}): Promise<TemplateSummary[]> => {
  const params: unknown[] = [];
  const where: string[] = [];
  if (filter.category && filter.category !== "All") {
    params.push(filter.category);
    where.push(`category = $${params.length}`);
  }
  if (filter.query) {
    params.push(`%${filter.query}%`);
    where.push(`name ILIKE $${params.length}`);
  }
  const { rows } = await getPool().query<VersionRow>(
    `
      SELECT id, template_id, name, version, category, created_at, updated_at
      FROM template_versions
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY updated_at DESC, name ASC
    `,
    params,
  );
  const fields = await loadFields(rows.map((row) => row.id));
  const counts = await countDocumentsByTemplate(rows.map((row) => row.template_id));
  const activeId = await getActiveTemplateId();
  return rows.map((row) => ({
    ...toTemplate(row, fields.get(row.id) ?? []),
    documentCount: counts.get(row.template_id) ?? 0,
    autoApprovedPercent: null,
    active: row.template_id === activeId,
  }));
};

export const getTemplate = async (templateId: string): Promise<Template | null> => {
  const { rows } = await getPool().query<VersionRow>(
    `
      SELECT id, template_id, name, version, category, created_at, updated_at
      FROM template_versions
      WHERE template_id = $1
      LIMIT 1
    `,
    [templateId],
  );
  const row = rows[0];
  if (!row) return null;
  const fields = await loadFields([row.id]);
  return toTemplate(row, fields.get(row.id) ?? []);
};

export const createTemplate = async (input: {
  name: string;
  category: TemplateCategory;
  fields: FieldInput[];
}): Promise<Template> => {
  const templateId = randomUUID();
  const versionId = randomUUID();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `
        INSERT INTO template_versions (id, template_id, name, version, category)
        VALUES ($1, $2, $3, 1, $4)
      `,
      [versionId, templateId, input.name, input.category],
    );
    await insertFields(versionId, input.fields, (text, values) => client.query(text, values));
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

/** Update the single mutable template row in place (no version history). */
export const saveTemplateVersion = async (
  templateId: string,
  input: { name: string; category: TemplateCategory; fields: FieldInput[] },
): Promise<Template | null> => {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query<{ id: string }>(
      `
        SELECT id
        FROM template_versions
        WHERE template_id = $1
        LIMIT 1
      `,
      [templateId],
    );
    const rowId = existing.rows[0]?.id;
    if (!rowId) {
      await client.query("ROLLBACK");
      return null;
    }
    await client.query(
      `
        UPDATE template_versions
        SET name = $2, category = $3, version = 1, updated_at = NOW()
        WHERE template_id = $1
      `,
      [templateId, input.name, input.category],
    );
    await client.query(`DELETE FROM template_fields WHERE template_version_id = $1`, [rowId]);
    await insertFields(rowId, input.fields, (text, values) => client.query(text, values));
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return getTemplate(templateId);
};

export type TemplateDocument = {
  id: string;
  templateId: string;
  fileName: string;
  storedName: string;
  mimeType: string;
  createdAt: string;
};

type DocumentRow = {
  id: string;
  template_id: string;
  file_name: string;
  stored_name: string;
  mime_type: string;
  created_at: Date;
};

const mapDocument = (row: DocumentRow): TemplateDocument => ({
  id: row.id,
  templateId: row.template_id,
  fileName: row.file_name,
  storedName: row.stored_name,
  mimeType: row.mime_type,
  createdAt: iso(row.created_at),
});

const countDocumentsByTemplate = async (templateIds: string[]) => {
  const counts = new Map<string, number>();
  if (!templateIds.length) return counts;
  const { rows } = await getPool().query<{ template_id: string; count: string }>(
    `
      SELECT template_id, COUNT(*)::text AS count
      FROM template_documents
      WHERE template_id = ANY($1::uuid[])
      GROUP BY template_id
    `,
    [templateIds],
  );
  for (const row of rows) counts.set(row.template_id, Number(row.count) || 0);
  return counts;
};

const unlinkStored = async (storedNames: string[]) => {
  await Promise.all(
    storedNames.map((name) =>
      fs.unlink(path.join(uploadDir, path.basename(name))).catch(() => undefined),
    ),
  );
};

export const listTemplateDocuments = async (
  templateId: string,
): Promise<TemplateDocument[]> => {
  const { rows } = await getPool().query<DocumentRow>(
    `
      SELECT id, template_id, file_name, stored_name, mime_type, created_at
      FROM template_documents
      WHERE template_id = $1
      ORDER BY created_at ASC
    `,
    [templateId],
  );
  return rows.map(mapDocument);
};

export const getTemplateDocument = async (
  templateId: string,
  documentId: string,
): Promise<TemplateDocument | null> => {
  const { rows } = await getPool().query<DocumentRow>(
    `
      SELECT id, template_id, file_name, stored_name, mime_type, created_at
      FROM template_documents
      WHERE template_id = $1 AND id = $2
      LIMIT 1
    `,
    [templateId, documentId],
  );
  return rows[0] ? mapDocument(rows[0]) : null;
};

/** Replace all sample documents for a template with the newly uploaded files. */
export const replaceTemplateDocuments = async (
  templateId: string,
  files: { fileName: string; storedName: string; mimeType: string }[],
): Promise<TemplateDocument[]> => {
  const existing = await listTemplateDocuments(templateId);
  await getPool().query("DELETE FROM template_documents WHERE template_id = $1", [templateId]);
  await unlinkStored(existing.map((doc) => doc.storedName));

  for (const file of files) {
    await getPool().query(
      `
        INSERT INTO template_documents (id, template_id, file_name, stored_name, mime_type)
        VALUES ($1, $2, $3, $4, $5)
      `,
      [randomUUID(), templateId, file.fileName, file.storedName, file.mimeType || ""],
    );
  }
  return listTemplateDocuments(templateId);
};

export const deleteTemplate = async (templateId: string): Promise<boolean> => {
  const docs = await listTemplateDocuments(templateId);
  const { rowCount } = await getPool().query(
    "DELETE FROM template_versions WHERE template_id = $1",
    [templateId],
  );
  await getPool().query("DELETE FROM template_documents WHERE template_id = $1", [templateId]);
  await unlinkStored(docs.map((doc) => doc.storedName));
  return (rowCount ?? 0) > 0;
};
