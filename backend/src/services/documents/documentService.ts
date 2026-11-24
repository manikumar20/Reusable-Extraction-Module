import { gunzipSync } from "node:zlib";
import { removeStagedFilesForDocument, temporaryGzipFor } from "../batches/stagedStore.js";
import {
  createExtractedField,
  deleteDocument,
  deleteExtractedField,
  getDocumentFileMeta,
  listDocuments,
  listExtractedFields,
  publishDocuments,
  updateExtractedField,
  updateFieldSourceLocations,
} from "../../db/documents/documentDb.js";
import { mapExtractedSources } from "../sourceMapping/index.js";

/** Avoid re-parsing the same PDF on every Inspect poll after a remap attempt. */
const remappedDocumentIds = new Set<number>();
/** Bump when matcher heuristics change so existing docs get one fresh remap. */
const REMAP_GENERATION = 4;
const remappedGeneration = new Map<number, number>();

export const listDocumentsForApi = async () => {
  const documents = await listDocuments();
  return { documents };
};

export const saveDocumentsToLibrary = (ids: number[]) => publishDocuments(ids);

const groupFieldsIntoLines = (fields: Awaited<ReturnType<typeof listExtractedFields>>) => {
  const byLine = new Map<number, Record<string, string>>();
  for (const field of fields ?? []) {
    const match = /^(.*)#(\d+)$/.exec(field.fieldKey);
    const baseKey = match?.[1] || field.fieldKey;
    const lineNumber = Number(match?.[2] || 1);
    const line = byLine.get(lineNumber) ?? {};
    line[baseKey] = field.fieldValue;
    byLine.set(lineNumber, line);
  }
  return [...byLine.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([, fields]) => ({ fields }));
};

/** Backfill missing source boxes from the stored file (no Claude). */
export const ensureSourceLocationsForDocument = async (
  documentId: number,
  options?: { force?: boolean },
) => {
  const fields = await listExtractedFields(documentId);
  if (!fields?.length) return fields;

  const missing = fields.filter((field) => !field.sourceLocation?.length);
  const generationFresh = remappedGeneration.get(documentId) === REMAP_GENERATION;
  const already = !options?.force && remappedDocumentIds.has(documentId) && generationFresh;
  // Remap when boxes are missing, or once per matcher generation (coordinate fixes).
  if (already) return fields;
  if (!missing.length && generationFresh && !options?.force) return fields;

  const meta = await getDocumentFileMeta(documentId);
  if (!meta) return fields;
  const gzip = meta.gzip ?? temporaryGzipFor(String(documentId));
  if (!gzip?.length) return fields;

  let buffer: Buffer;
  try {
    buffer = gunzipSync(gzip);
  } catch {
    return fields;
  }

  const mapped = await mapExtractedSources({
    fileName: meta.fileName,
    mimeType: meta.mimeType,
    buffer,
    lines: groupFieldsIntoLines(fields),
  });

  const updates = fields
    .map((field) => {
      const locations = mapped[field.fieldKey] ?? null;
      if (!locations?.length) return null;
      // Refresh any field we can locate (fills gaps + upgrades stale boxes).
      return { fieldKey: field.fieldKey, locations };
    })
    .filter((row): row is { fieldKey: string; locations: NonNullable<typeof mapped[string]> } =>
      Boolean(row),
    );

  if (updates.length) await updateFieldSourceLocations(documentId, updates);
  remappedDocumentIds.add(documentId);
  remappedGeneration.set(documentId, REMAP_GENERATION);
  return listExtractedFields(documentId);
};

export const fieldsForDocument = async (documentId: number) =>
  ensureSourceLocationsForDocument(documentId);

export const editExtractedField = (
  documentId: number,
  fieldId: string,
  fieldValue: string,
  fieldName?: string,
) => updateExtractedField(documentId, fieldId, fieldValue, fieldName);

export const addExtractedField = (input: {
  documentId: number;
  fieldName: string;
  fieldKey?: string;
  fieldValue?: string;
  dataType?: string;
  source?: string;
}) => createExtractedField(input);

export const removeExtractedField = (documentId: number, fieldId: string) =>
  deleteExtractedField(documentId, fieldId);

export const removeDocument = async (documentId: number) => {
  const removed = await deleteDocument(documentId);
  if (removed) await removeStagedFilesForDocument(documentId);
  return removed;
};

export const fileMetaForDocument = (documentId: number) => getDocumentFileMeta(documentId);
