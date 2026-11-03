import { getPool } from "../_shared/client.js";

export type StoredDocument = {
  id: number;
  fileName: string;
  documentType: string;
  mimeType: string;
  uploadedAt: string;
};

type DocumentRow = {
  id: string | number;
  file_name: string;
  mime_type: string;
  document_type: string;
  uploaded_at: Date | string;
};

const toIso = (value: Date | string) => {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
};

const mapDocument = (row: DocumentRow): StoredDocument => ({
  id: Number(row.id),
  fileName: row.file_name,
  documentType: row.document_type ?? "",
  mimeType: row.mime_type ?? "",
  uploadedAt: toIso(row.uploaded_at),
});

export const insertDocument = async (input: {
  fileName: string;
  storedName: string;
  mimeType: string;
  documentType: string;
}): Promise<StoredDocument> => {
  const { rows } = await getPool().query<DocumentRow>(
    `
      INSERT INTO documents (file_name, stored_name, mime_type, document_type)
      VALUES ($1, $2, $3, $4)
      RETURNING id, file_name, mime_type, document_type, uploaded_at
    `,
    [input.fileName, input.storedName, input.mimeType, input.documentType],
  );
  const row = rows[0];
  if (!row) throw new Error("Document insert did not return a row.");
  return mapDocument(row);
};

export const listDocuments = async (): Promise<StoredDocument[]> => {
  const { rows } = await getPool().query<DocumentRow>(
    `
      SELECT id, file_name, mime_type, document_type, uploaded_at
      FROM documents
      ORDER BY uploaded_at DESC, id DESC
    `,
  );
  return rows.map(mapDocument);
};
