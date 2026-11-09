import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { uploadDir } from "../../middleware/documentUpload.js";
import { HEADER_FIELDS, LINE_FIELDS } from "../../services/extract/engine/shared/fields.js";
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
};

export type ExtractedField = {
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
};

type FieldRow = {
  id: string;
  document_id: string | number;
  field_name: string;
  field_key: string;
  field_value: string;
  data_type: string;
  source: string;
  created_at: Date | string;
  updated_at: Date | string;
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
});

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
          fieldName,
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
  fieldName: row.field_name,
  fieldKey: row.field_key,
  fieldValue: row.field_value ?? "",
  dataType: row.data_type || "STRING",
  source: row.source || "AI",
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at),
});

const catalogByKey = new Map(
  [...HEADER_FIELDS, ...LINE_FIELDS].map((field) => [field.key, field]),
);
const headerRank = new Map(HEADER_FIELDS.map((field, index) => [field.key, index]));
const lineRank = new Map(LINE_FIELDS.map((field, index) => [field.key, index]));

/** Header fields in catalogue order, then each line in line order with catalogue columns. */
const compareFieldKeys = (left: string, right: string) => {
  const [leftBase, leftLine] = left.split("#");
  const [rightBase, rightLine] = right.split("#");
  const leftScope = leftLine ? 1 : 0;
  const rightScope = rightLine ? 1 : 0;
  if (leftScope !== rightScope) return leftScope - rightScope;
  const leftIndex = Number(leftLine ?? 0);
  const rightIndex = Number(rightLine ?? 0);
  if (leftIndex !== rightIndex) return leftIndex - rightIndex;
  const ranks = leftScope === 1 ? lineRank : headerRank;
  const leftRank = ranks.get(leftBase ?? "") ?? 1000;
  const rightRank = ranks.get(rightBase ?? "") ?? 1000;
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
  storedName: string;
  mimeType: string;
  documentType: string;
}): Promise<StoredDocument> => {
  const { rows } = await getPool().query<DocumentRow>(
    `
      INSERT INTO documents (file_name, stored_name, mime_type, document_type, status, source)
      VALUES ($1, $2, $3, $4, 'Processing', 'AI')
      RETURNING id, file_name, mime_type, document_type, uploaded_at, status, source, 0::int AS total_fields, '[]'::json AS fields
    `,
    [input.fileName, input.storedName, input.mimeType, input.documentType],
  );
  const row = rows[0];
  if (!row) throw new Error("Document insert did not return a row.");
  return mapDocument(row);
};

export const updateDocumentStatus = async (documentId: number, status: string) => {
  await getPool().query(`UPDATE documents SET status = $2 WHERE id = $1`, [documentId, status]);
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
             ) AS fields
      FROM documents d
      LEFT JOIN extracted_fields f ON f.document_id = d.id
      GROUP BY d.id
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
      SELECT id, document_id, field_name, field_key, field_value, data_type, source, created_at, updated_at
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
) => {
  const { rows } = await getPool().query<FieldRow>(
    `
      UPDATE extracted_fields
      SET field_value = $3, source = 'MANUAL', updated_at = NOW()
      WHERE document_id = $1 AND id = $2
      RETURNING id, document_id, field_name, field_key, field_value, data_type, source, created_at, updated_at
    `,
    [documentId, fieldId, fieldValue],
  );
  return rows[0] ? mapField(rows[0]) : null;
};

export const deleteDocument = async (documentId: number): Promise<boolean> => {
  const existing = await getPool().query<{ stored_name: string }>(
    `SELECT stored_name FROM documents WHERE id = $1`,
    [documentId],
  );
  const stored = existing.rows[0]?.stored_name;
  const { rowCount } = await getPool().query(`DELETE FROM documents WHERE id = $1`, [documentId]);
  if (stored) {
    await fs.unlink(path.join(uploadDir, path.basename(stored))).catch(() => undefined);
  }
  return (rowCount ?? 0) > 0;
};

/** Persist header and line fields extracted from one uploaded document. */
export const saveExtractedFields = async (input: {
  documentId: number;
  header: Record<string, unknown>;
  lines: { fields: Record<string, unknown> }[];
}) => {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM extracted_fields WHERE document_id = $1`, [input.documentId]);
    const insertField = (fieldKey: string, fieldValue: unknown) => {
      const catalog = catalogByKey.get(fieldKey.split("#")[0] ?? fieldKey);
      return client.query(
        `
          INSERT INTO extracted_fields
            (id, document_id, field_name, field_key, field_value, data_type, source)
          VALUES ($1, $2, $3, $4, $5, $6, 'AI')
        `,
        [
          randomUUID(),
          input.documentId,
          catalog?.label || fieldKey,
          fieldKey,
          valueText(fieldValue),
          dataTypeOf(fieldKey.split("#")[0] ?? fieldKey),
        ],
      );
    };
    for (const [fieldKey, fieldValue] of Object.entries(input.header)) {
      if (isEmptyValue(fieldValue)) continue;
      await insertField(fieldKey, fieldValue);
    }
    for (const [lineIndex, line] of input.lines.entries()) {
      for (const [fieldKey, fieldValue] of Object.entries(line.fields)) {
        if (isEmptyValue(fieldValue)) continue;
        await insertField(`${fieldKey}#${lineIndex + 1}`, fieldValue);
      }
    }
    await client.query(`UPDATE documents SET status = 'Completed' WHERE id = $1`, [input.documentId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};
