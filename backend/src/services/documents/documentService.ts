import { listDocuments } from "../../db/documents/documentDb.js";

export const listDocumentsForApi = async () => {
  const documents = await listDocuments();
  return { documents };
};
