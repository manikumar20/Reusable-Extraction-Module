import { apiUrl } from "@/services/client";
import type { CatalogField } from "@/types";
import type {
  FieldSuggestions,
  SampleTest,
  Template,
  TemplateField,
  TemplateSummary,
} from "@/types/templates";

const errorMessage = async (response: Response, fallback: string) => {
  const payload = (await response.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;
  return payload?.error?.message || fallback;
};

export const listTemplates = async (filter: { query: string }) => {
  const params = new URLSearchParams();
  if (filter.query.trim()) params.set("q", filter.query.trim());
  const response = await fetch(apiUrl(`/templates?${params.toString()}`));
  if (!response.ok) throw new Error(await errorMessage(response, "Templates could not be loaded."));
  const payload = (await response.json()) as { templates: TemplateSummary[] };
  return payload.templates;
};

export const getTemplate = async (id: string) => {
  const response = await fetch(apiUrl(`/templates/${id}`));
  if (!response.ok) throw new Error(await errorMessage(response, "Template could not be loaded."));
  return (await response.json()) as Template;
};

export const saveTemplate = async (input: {
  id?: string;
  name: string;
  fields: TemplateField[];
}) => {
  const body = JSON.stringify({
    name: input.name,
    fields: input.fields.map((field) => {
      const copy = { ...field };
      delete copy.suggested;
      delete copy.sampleValue;
      return copy;
    }),
  });
  const response = await fetch(input.id ? apiUrl(`/templates/${input.id}`) : apiUrl("/templates"), {
    method: input.id ? "PUT" : "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  if (!response.ok) throw new Error(await errorMessage(response, "Template could not be saved."));
  return (await response.json()) as Template;
};

export const deleteTemplate = async (id: string) => {
  const response = await fetch(apiUrl(`/templates/${id}`), { method: "DELETE" });
  if (!response.ok) throw new Error(await errorMessage(response, "Template could not be deleted."));
};

export const getActiveTemplate = async () => {
  const response = await fetch(apiUrl("/templates/active"));
  if (!response.ok) throw new Error(await errorMessage(response, "Active template could not be loaded."));
  const payload = (await response.json()) as { template: Template | null };
  return payload.template;
};

export const activateTemplate = async (id: string) => {
  const response = await fetch(apiUrl(`/templates/${id}/activate`), { method: "POST" });
  if (!response.ok) throw new Error(await errorMessage(response, "Template could not be set as active."));
  return (await response.json()) as Template;
};

export const clearActiveTemplate = async () => {
  const response = await fetch(apiUrl("/templates/active"), { method: "DELETE" });
  if (!response.ok) throw new Error(await errorMessage(response, "Active template could not be cleared."));
};

export type StoredTemplateDocument = {
  id: string;
  fileName: string;
  mimeType: string;
  createdAt: string;
  extractedFields?: TemplateField[];
};

export const listTemplateDocuments = async (templateId: string) => {
  const response = await fetch(apiUrl(`/templates/${templateId}/documents`));
  if (!response.ok) throw new Error(await errorMessage(response, "Documents could not be loaded."));
  const payload = (await response.json()) as { documents: StoredTemplateDocument[] };
  return payload.documents;
};

export const saveTemplateDocuments = async (
  templateId: string,
  files: { file: File; fields: TemplateField[] }[],
) => {
  const body = new FormData();
  files.forEach((item) => body.append("files", item.file));
  body.append(
    "extracted",
    JSON.stringify(
      files.map((item) =>
        item.fields.map((field) => {
          const copy = { ...field };
          delete copy.sampleValue;
          return copy;
        }),
      ),
    ),
  );
  const response = await fetch(apiUrl(`/templates/${templateId}/documents`), {
    method: "PUT",
    body,
  });
  if (!response.ok) throw new Error(await errorMessage(response, "Documents could not be saved."));
  const payload = (await response.json()) as { documents: StoredTemplateDocument[] };
  return payload.documents;
};

export const fetchTemplateDocumentFile = async (templateId: string, documentId: string, fileName: string) => {
  const response = await fetch(apiUrl(`/templates/${templateId}/documents/${documentId}/file`));
  if (!response.ok) throw new Error(await errorMessage(response, "Document file could not be loaded."));
  const blob = await response.blob();
  const type = blob.type || response.headers.get("Content-Type") || "";
  return new File([blob], fileName, { type });
};

/** Full catalogue (header + line fields from fields.ts). */
export const listCatalogFields = async () => {
  const response = await fetch(apiUrl("/extract/catalog"));
  if (!response.ok) throw new Error(await errorMessage(response, "The field catalog could not be loaded."));
  const payload = (await response.json()) as { header?: CatalogField[]; lines?: CatalogField[] };
  return {
    header: payload.header ?? [],
    lines: payload.lines ?? [],
    all: [...(payload.header ?? []), ...(payload.lines ?? [])],
  };
};

export const suggestFields = async (file: File) => {
  const body = new FormData();
  body.append("file", file);
  let response: Response;
  try {
    response = await fetch(apiUrl("/templates/suggest-fields"), { method: "POST", body });
  } catch {
    throw new Error(
      "Could not reach the API (Failed to fetch). Check that the backend is running on port 8787 and try again.",
    );
  }
  if (!response.ok) throw new Error(await errorMessage(response, "Fields could not be suggested."));
  return (await response.json()) as FieldSuggestions;
};

export const testTemplate = async (id: string, files: File[]) => {
  const body = new FormData();
  files.slice(0, 3).forEach((file) => body.append("samples", file));
  const response = await fetch(apiUrl(`/templates/${id}/test`), { method: "POST", body });
  if (!response.ok) throw new Error(await errorMessage(response, "The template test failed."));
  const payload = (await response.json()) as { results: SampleTest[] };
  return payload.results;
};
