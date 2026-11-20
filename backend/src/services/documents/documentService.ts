import { removeStagedFilesForDocument } from "../batches/stagedStore.js";
import {
  createExtractedField,
  deleteDocument,
  deleteExtractedField,
  getDocumentFileMeta,
  listDocuments,
  listExtractedFields,
  publishDocuments,
  updateExtractedField,
} from "../../db/documents/documentDb.js";

export const listDocumentsForApi = async () => {
  const documents = await listDocuments();
  return { documents };
};

export const saveDocumentsToLibrary = (ids: number[]) => publishDocuments(ids);

export const fieldsForDocument = (documentId: number) => listExtractedFields(documentId);

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
