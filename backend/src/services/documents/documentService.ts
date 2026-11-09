import {
  deleteDocument,
  listDocuments,
  listExtractedFields,
  updateExtractedField,
} from "../../db/documents/documentDb.js";

export const listDocumentsForApi = async () => {
  const documents = await listDocuments();
  return { documents };
};

export const fieldsForDocument = (documentId: number) => listExtractedFields(documentId);

export const editExtractedField = (
  documentId: number,
  fieldId: string,
  fieldValue: string,
) => updateExtractedField(documentId, fieldId, fieldValue);

export const removeDocument = (documentId: number) => deleteDocument(documentId);
