import {
  createTemplate,
  deleteTemplate,
  getActiveTemplate,
  getTemplate,
  getTemplateDocument,
  listTemplateDocuments,
  listTemplates,
  replaceTemplateDocuments,
  saveTemplateVersion,
  setActiveTemplate,
  toJobTemplate,
  type FieldInput,
  type TemplateCategory,
} from "../../db/templates/templateDb.js";
import { AppError, HTTP_STATUS } from "../../utils/errors/index.js";

export {
  getActiveTemplate,
  listTemplateDocuments,
  getTemplateDocument,
  replaceTemplateDocuments,
  toJobTemplate,
};

export const listTemplatesForApi = async (filter: { category?: string; query?: string }) => {
  const templates = await listTemplates(filter);
  return { templates };
};

export const requireTemplate = async (templateId: string) => {
  const template = await getTemplate(templateId);
  if (!template) {
    throw AppError(HTTP_STATUS.NOT_FOUND, "Template not found.", { code: "NOT_FOUND" });
  }
  return template;
};

export const createTemplateRecord = async (input: {
  name: string;
  category: TemplateCategory;
  fields: FieldInput[];
}) => createTemplate(input);

export const updateTemplateRecord = async (
  templateId: string,
  input: { name: string; category: TemplateCategory; fields: FieldInput[] },
) => {
  const template = await saveTemplateVersion(templateId, input);
  if (!template) {
    throw AppError(HTTP_STATUS.NOT_FOUND, "Template not found.", { code: "NOT_FOUND" });
  }
  return template;
};

export const deleteTemplateRecord = async (templateId: string) => {
  const removed = await deleteTemplate(templateId);
  if (!removed) {
    throw AppError(HTTP_STATUS.NOT_FOUND, "Template not found.", { code: "NOT_FOUND" });
  }
};

export const activateTemplateRecord = async (templateId: string) => {
  const template = await setActiveTemplate(templateId);
  if (!template) {
    throw AppError(HTTP_STATUS.NOT_FOUND, "Template not found.", { code: "NOT_FOUND" });
  }
  return template;
};

export const clearActiveTemplate = async () => setActiveTemplate(null);

export const publicTemplateDocuments = async (templateId: string) => {
  await requireTemplate(templateId);
  const documents = await listTemplateDocuments(templateId);
  return {
    documents: documents.map((doc) => ({
      id: doc.id,
      fileName: doc.fileName,
      mimeType: doc.mimeType,
      createdAt: doc.createdAt,
    })),
  };
};
