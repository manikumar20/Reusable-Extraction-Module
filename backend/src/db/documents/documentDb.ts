import { randomUUID } from "node:crypto";
import { LINE_FIELDS } from "../../services/extract/engine/shared/fields.js";
import { getPool } from "../_shared/client.js";

export type StoredDocument = {
  id: number;
  fileName: string;
  documentType: string;
  mimeType: string;
  uploadedAt: string;
  status: string;
  sources: string[];
  totalFields: number;
  fields: { fieldName: string; fieldValue: string }[];
  templateId: number | null;
  templateName: string | null;
  templateNumber: number | null;
};

export type SourceLocation = {
  adapter: "pdf" | "text" | "office" | "excel" | "image" | "unknown";
  page: number;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  start?: number;
  end?: number;
  quote?: string;
  confidence: "exact" | "normalized";
  sheet?: string;
  cell?: string;
  row?: number;
  col?: number;
};

export type ExtractedField = {
  id: string;
  documentId: number;
  fieldName: string;
  fieldKey: string;
  fieldValue: string;
  dataType: string;
  source: string;
  sourceLocation: SourceLocation[] | null;
  createdAt: string;
  updatedAt: string;
};

type DocumentRow = {
  id: string | number;
  file_name: string;
  mime_type: string;
  document_type: string;
  uploaded_at: Date | string;
  status: string;
  source?: string | null;
  sources?: string[] | null;
  total_fields: string | number;
  fields?: { fieldName: string; fieldValue: string }[] | string | null;
  template_id?: number | string | null;
  template_name?: string | null;
  template_number?: number | string | null;
};

type FieldRow = {
  id: string;
  document_id: string | number;
  field_name: string;
  field_key: string;
  field_value: string;
  data_type: string;
  source: string;
  source_location?: SourceLocation[] | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

const parseSourceLocation = (value: FieldRow["source_location"]): SourceLocation[] | null => {
  if (!value) return null;
  const rows = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (!Array.isArray(rows) || !rows.length) return null;
  return rows.filter(
    (row): row is SourceLocation =>
      Boolean(row && typeof row === "object" && typeof (row as SourceLocation).page === "number"),
  );
};

const toIso = (value: Date | string) => {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
};

const SOURCE_ORDER = ["AI", "MANUAL", "SUGGESTED"];

const mapSources = (row: DocumentRow) => {
  const raw = (Array.isArray(row.sources) ? row.sources : row.source ? [row.source] : [])
    .map((source) => source.trim().toUpperCase())
    .filter(Boolean);
  const unique = [...new Set(raw)];
  return [
    ...SOURCE_ORDER.filter((source) => unique.includes(source)),
    ...unique.filter((source) => !SOURCE_ORDER.includes(source)),
  ];
};

const mapDocument = (row: DocumentRow): StoredDocument => ({
  id: Number(row.id),
  fileName: row.file_name,
  documentType: row.document_type ?? "",
  mimeType: row.mime_type ?? "",
  uploadedAt: toIso(row.uploaded_at),
  status: row.status || "Pending",
  sources: mapSources(row),
  totalFields: Number(row.total_fields) || 0,
  fields: mapFieldPreview(row.fields),
  templateId: row.template_id == null || row.template_id === "" ? null : Number(row.template_id),
  templateName: row.template_name || null,
  templateNumber: row.template_number == null || row.template_number === "" ? null : Number(row.template_number),
});

const withoutLineSuffix = (value: string) => value.replace(/#\d+$/, "");

const mapFieldPreview = (value: DocumentRow["fields"]) => {
  const rows = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (!Array.isArray(rows)) return [];
  return rows
    .flatMap((row) => {
      if (!row || typeof row !== "object") return [];
      const field = row as { fieldName?: unknown; fieldKey?: unknown; fieldValue?: unknown };
      const fieldName = typeof field.fieldName === "string" ? field.fieldName : "";
      if (!fieldName) return [];
      return [
        {
          fieldName: withoutLineSuffix(fieldName),
          fieldKey: typeof field.fieldKey === "string" ? field.fieldKey : "",
          fieldValue: typeof field.fieldValue === "string" ? field.fieldValue : "",
        },
      ];
    })
    .sort((left, right) => compareFieldKeys(left.fieldKey, right.fieldKey))
    .map(({ fieldName, fieldValue }) => ({ fieldName, fieldValue }));
};

const mapField = (row: FieldRow): ExtractedField => ({
  id: row.id,
  documentId: Number(row.document_id),
  fieldName: withoutLineSuffix(row.field_name),
  fieldKey: row.field_key,
  fieldValue: row.field_value ?? "",
  dataType: row.data_type || "STRING",
  source: row.source || "AI",
  sourceLocation: parseSourceLocation(row.source_location),
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at),
});

const catalogByKey = new Map(LINE_FIELDS.map((field) => [field.key, field]));
const lineRank = new Map(LINE_FIELDS.map((field, index) => [field.key, index]));

/** Each line in order, with catalogue columns inside the line. */
const compareFieldKeys = (left: string, right: string) => {
  const [leftBase, leftLine] = left.split("#");
  const [rightBase, rightLine] = right.split("#");
  const leftIndex = Number(leftLine ?? 0);
  const rightIndex = Number(rightLine ?? 0);
  if (leftIndex !== rightIndex) return leftIndex - rightIndex;
  const leftRank = lineRank.get(leftBase ?? "") ?? 1000;
  const rightRank = lineRank.get(rightBase ?? "") ?? 1000;
  if (leftRank !== rightRank) return leftRank - rightRank;
  return left.localeCompare(right);
};

const dataTypeOf = (key: string) => {
  const type = catalogByKey.get(key)?.dataType;
  if (type === "NUMBER") return "NUMBER";
  if (type === "DATE") return "DATE";
  return "STRING";
};

const valueText = (value: unknown) => {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  return JSON.stringify(value);
};

const isEmptyValue = (value: unknown) => valueText(value) === "" || valueText(value) === "[]";

export const insertDocument = async (input: {
  fileName: string;
  mimeType: string;
  documentType: string;
  templateId?: number | null;
  fileData?: Buffer | null;
}): Promise<StoredDocument> => {
  const { rows } = await getPool().query<DocumentRow>(
    `
      INSERT INTO documents (
        file_name, stored_name, mime_type, document_type, status, source, template_id, file_data
      )
      VALUES ($1, '', $2, $3, 'Processing', 'AI', $4, $5)
      RETURNING id, file_name, mime_type, document_type, uploaded_at, status, source, 0::int AS total_fields, '[]'::json AS fields,
                template_id
    `,
    [input.fileName, input.mimeType, input.documentType, input.templateId ?? null, input.fileData ?? null],
  );
  const row = rows[0];
  if (!row) throw new Error("Document insert did not return a row.");
  return mapDocument(row);
};

/** Create the document row. The gzip bytes are saved on this row immediately. */
export const insertCompressedDocument = async (input: {
  fileName: string;
  mimeType: string;
  documentType: string;
  templateId?: number | null;
}) => {
  const { rows } = await getPool().query<{
    id: number;
    file_name: string;
    mime_type: string;
    template_id: number | null;
    status: string;
    error_message: string | null;
    uploaded_at: Date;
    started_at: Date | null;
    completed_at: Date | null;
    size_bytes: string;
  }>(
    `
      INSERT INTO documents (
        file_name, stored_name, mime_type, document_type, status, source, template_id
      )
      VALUES ($1, '', $2, $3, 'Uploaded', 'AI', $4)
      RETURNING id, file_name, mime_type, template_id, status, error_message,
                uploaded_at, started_at, completed_at, octet_length(file_data)::text AS size_bytes
    `,
    [input.fileName, input.mimeType, input.documentType, input.templateId ?? null],
  );
  const row = rows[0];
  if (!row) throw new Error("Document insert did not return a row.");
  return row;
};

/** Insert the compressed file only after extraction has finished. */
export const insertExtractedDocument = async (input: {
  fileName: string;
  mimeType: string;
  documentType: string;
  templateId?: number | null;
  fileData: Buffer;
}) => {
  const { rows } = await getPool().query<{ id: number }>(
    `
      INSERT INTO documents (
        file_name, stored_name, mime_type, document_type, status, source, template_id, file_data, completed_at, in_library
      )
      VALUES ($1, '', $2, $3, 'Completed', 'AI', $4, $5, NOW(), FALSE)
      RETURNING id
    `,
    [input.fileName, input.mimeType, input.documentType, input.templateId ?? null, input.fileData],
  );
  const row = rows[0];
  if (!row) throw new Error("Document insert did not return a row.");
  return { id: Number(row.id) };
};

/** Keep the gzip bytes after extraction. The decompressed copy is never written here. */
export const saveDocumentFileData = async (documentId: number, fileData: Buffer) => {
  await getPool().query(`UPDATE documents SET file_data = $2 WHERE id = $1`, [documentId, fileData]);
};

export const getCompressedDocument = async (documentId: number) => {
  const { rows } = await getPool().query<{ file_data: Buffer | null }>(
    `SELECT file_data FROM documents WHERE id = $1`,
    [documentId],
  );
  const data = rows[0]?.file_data;
  return data && data.length ? data : null;
};

export const updateDocumentStatus = async (documentId: number, status: string) => {
  await getPool().query(`UPDATE documents SET status = $2 WHERE id = $1`, [documentId, status]);
};

export const setDocumentFile = async (documentId: number, storedName: string) => {
  await getPool().query(`UPDATE documents SET stored_name = $2 WHERE id = $1`, [documentId, storedName]);
};

/** Move extracted files into the Documents library. Unsaved rows stay hidden. */
export const publishDocuments = async (ids: number[]) => {
  const unique = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
  if (!unique.length) return [];
  const { rows } = await getPool().query<{ id: number }>(
    `
      UPDATE documents
      SET status = CASE WHEN status = 'Failed' THEN 'Failed' ELSE 'Completed' END,
          in_library = TRUE
      WHERE id = ANY($1::int[])
      RETURNING id
    `,
    [unique],
  );
  return rows.map((row) => Number(row.id));
};

export const listDocuments = async (): Promise<StoredDocument[]> => {
  const { rows } = await getPool().query<DocumentRow>(
    `
      SELECT d.id, d.file_name, d.mime_type, d.document_type, d.uploaded_at,
             d.status,
             COALESCE(
               ARRAY_AGG(DISTINCT f.source) FILTER (WHERE f.source IS NOT NULL),
               ARRAY[]::text[]
             ) AS sources,
             COUNT(f.id)::int AS total_fields,
             COALESCE(
               json_agg(
                 json_build_object('fieldName', f.field_name, 'fieldKey', f.field_key, 'fieldValue', f.field_value)
               ) FILTER (WHERE f.id IS NOT NULL),
               '[]'::json
             ) AS fields,
             t.numeric_id AS template_id,
             t.name AS template_name,
             t.numeric_id AS template_number
      FROM documents d
      LEFT JOIN extracted_fields f ON f.document_id = d.id
      LEFT JOIN templates t ON t.numeric_id = d.template_id
      WHERE d.in_library = TRUE
        AND (d.status = 'Completed' OR d.status = 'Failed')
      GROUP BY d.id, t.numeric_id, t.name
      ORDER BY d.uploaded_at DESC, d.id DESC
    `,
  );
  return rows.map(mapDocument);
};

export const listExtractedFields = async (documentId: number): Promise<ExtractedField[] | null> => {
  const found = await getPool().query(`SELECT 1 FROM documents WHERE id = $1`, [documentId]);
  if (!found.rowCount) return null;
  const { rows } = await getPool().query<FieldRow>(
    `
      SELECT id, document_id, field_name, field_key, field_value, data_type, source, source_location, created_at, updated_at
      FROM extracted_fields
      WHERE document_id = $1
    `,
    [documentId],
  );
  return rows.map(mapField).sort((left, right) => compareFieldKeys(left.fieldKey, right.fieldKey));
};

export const updateExtractedField = async (
  documentId: number,
  fieldId: string,
  fieldValue: string,
  fieldName?: string,
) => {
  const { rows } = await getPool().query<FieldRow>(
    fieldName == null
      ? `
          UPDATE extracted_fields
          SET field_value = $3, source = 'MANUAL', updated_at = NOW()
          WHERE document_id = $1 AND id = $2
          RETURNING id, document_id, field_name, field_key, field_value, data_type, source, source_location, created_at, updated_at
        `
      : `
          UPDATE extracted_fields
          SET field_value = $3, field_name = $4, source = 'MANUAL', updated_at = NOW()
          WHERE document_id = $1 AND id = $2
          RETURNING id, document_id, field_name, field_key, field_value, data_type, source, source_location, created_at, updated_at
        `,
    fieldName == null
      ? [documentId, fieldId, fieldValue]
      : [documentId, fieldId, fieldValue, fieldName],
  );
  return rows[0] ? mapField(rows[0]) : null;
};

export const createExtractedField = async (input: {
  documentId: number;
  fieldName: string;
  fieldKey?: string;
  fieldValue?: string;
  dataType?: string;
  source?: string;
}): Promise<ExtractedField | null> => {
  const found = await getPool().query(`SELECT 1 FROM documents WHERE id = $1`, [input.documentId]);
  if (!found.rowCount) return null;
  const fieldName = input.fieldName.trim() || "New field";
  const fieldKey =
    input.fieldKey?.trim() ||
    `manual_${fieldName.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "field"}`;
  const { rows } = await getPool().query<FieldRow>(
    `
      INSERT INTO extracted_fields
        (id, document_id, field_name, field_key, field_value, data_type, source, source_location)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NULL)
      RETURNING id, document_id, field_name, field_key, field_value, data_type, source, source_location, created_at, updated_at
    `,
    [
      randomUUID(),
      input.documentId,
      fieldName.slice(0, 200),
      fieldKey.slice(0, 120),
      input.fieldValue ?? "",
      input.dataType?.trim() || "STRING",
      (input.source || "MANUAL").toUpperCase(),
    ],
  );
  return rows[0] ? mapField(rows[0]) : null;
};

export const deleteExtractedField = async (documentId: number, fieldId: string) => {
  const { rowCount } = await getPool().query(
    `DELETE FROM extracted_fields WHERE document_id = $1 AND id = $2`,
    [documentId, fieldId],
  );
  return (rowCount ?? 0) > 0;
};

/** Patch source_location for existing extracted fields (no Claude call). */
export const updateFieldSourceLocations = async (
  documentId: number,
  updates: { fieldKey: string; locations: SourceLocation[] | null }[],
) => {
  if (!updates.length) return 0;
  const client = await getPool().connect();
  let changed = 0;
  try {
    await client.query("BEGIN");
    for (const update of updates) {
      const { rowCount } = await client.query(
        `
          UPDATE extracted_fields
          SET source_location = $3::jsonb, updated_at = NOW()
          WHERE document_id = $1 AND field_key = $2
        `,
        [
          documentId,
          update.fieldKey,
          update.locations?.length ? JSON.stringify(update.locations) : null,
        ],
      );
      changed += rowCount ?? 0;
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return changed;
};

export const getDocumentFileMeta = async (documentId: number) => {
  const { rows } = await getPool().query<{
    file_name: string;
    mime_type: string;
    file_data: Buffer | null;
  }>(
    `SELECT file_name, mime_type, file_data FROM documents WHERE id = $1`,
    [documentId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    fileName: row.file_name,
    mimeType: row.mime_type || "application/octet-stream",
    gzip: row.file_data && row.file_data.length ? row.file_data : null,
  };
};

export const existingDocumentIds = async (ids: number[]) => {
  const unique = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
  if (!unique.length) return new Set<number>();
  const { rows } = await getPool().query<{ id: number }>(
    `SELECT id FROM documents WHERE id = ANY($1::int[])`,
    [unique],
  );
  return new Set(rows.map((row) => Number(row.id)));
};

export const deleteDocument = async (documentId: number): Promise<boolean> => {
  const { rowCount } = await getPool().query(`DELETE FROM documents WHERE id = $1`, [documentId]);
  return (rowCount ?? 0) > 0;
};

/** Persist line fields extracted from one uploaded document. */
export const saveExtractedFields = async (input: {
  documentId: number;
  lines: {
    fields: Record<string, unknown>;
    locations?: Record<string, SourceLocation[]>;
  }[];
}) => {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM extracted_fields WHERE document_id = $1`, [input.documentId]);
    const insertField = (
      fieldKey: string,
      fieldValue: unknown,
      locations: SourceLocation[] | null,
    ) => {
      const baseKey = fieldKey.split("#")[0] || fieldKey;
      const catalog = catalogByKey.get(baseKey);
      return client.query(
        `
          INSERT INTO extracted_fields
            (id, document_id, field_name, field_key, field_value, data_type, source, source_location)
          VALUES ($1, $2, $3, $4, $5, $6, 'AI', $7::jsonb)
        `,
        [
          randomUUID(),
          input.documentId,
          catalog?.label || baseKey,
          fieldKey,
          valueText(fieldValue),
          dataTypeOf(baseKey),
          locations?.length ? JSON.stringify(locations) : null,
        ],
      );
    };
    for (const [lineIndex, line] of input.lines.entries()) {
      for (const [fieldKey, fieldValue] of Object.entries(line.fields)) {
        if (isEmptyValue(fieldValue)) continue;
        await insertField(
          `${fieldKey}#${lineIndex + 1}`,
          fieldValue,
          line.locations?.[fieldKey] ?? null,
        );
      }
    }
    await client.query(
      `
        UPDATE documents
        SET status = CASE WHEN status = 'Completed' THEN 'Completed' ELSE 'Ready' END
        WHERE id = $1
      `,
      [input.documentId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};
