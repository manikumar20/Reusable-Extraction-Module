import { useEffect, useState } from "react";

export type FieldRequired = "NO" | "ALWAYS" | "SPARES";

export type TemplateFieldChoice = {
  key: string;
  level: "header" | "line";
  required: FieldRequired;
  showToSupplier: boolean;
};

export type SavedTemplate = {
  id: string;
  name: string;
  description: string;
  fileName: string;
  fields: TemplateFieldChoice[];
  createdAt: string;
  /** The upload page extracts only the active template. */
  active: boolean;
};

const STORAGE_KEY = "extract.templates";
const listeners = new Set<() => void>();

/** At most one template is active. None active is allowed, and then extraction reads every field. */
export const withSingleActive = (templates: SavedTemplate[]): SavedTemplate[] => {
  const chosen = templates.find((template) => template.active)?.id;
  return templates.map((template) => ({ ...template, active: template.id === chosen }));
};

export const loadTemplates = (): SavedTemplate[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return withSingleActive(parsed.filter(isTemplate).map(normalize));
  } catch {
    return [];
  }
};

export const saveTemplates = (templates: SavedTemplate[]) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
  listeners.forEach((listener) => listener());
};

export const subscribeTemplates = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const useTemplates = () => {
  const [templates, setTemplates] = useState<SavedTemplate[]>(() => loadTemplates());
  useEffect(
    () => subscribeTemplates(() => setTemplates(loadTemplates())),
    [],
  );
  const persist = (next: SavedTemplate[]) => {
    const saved = withSingleActive(next);
    setTemplates(saved);
    saveTemplates(saved);
  };
  return [templates, persist] as const;
};

const isTemplate = (value: unknown): value is SavedTemplate => {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<SavedTemplate>;
  return typeof row.id === "string" && typeof row.name === "string" && Array.isArray(row.fields);
};

const normalize = (template: SavedTemplate): SavedTemplate => ({
  ...template,
  description: typeof template.description === "string" ? template.description : "",
  fileName: typeof template.fileName === "string" ? template.fileName : "",
  createdAt: typeof template.createdAt === "string" ? template.createdAt : "",
  active: template.active === true,
  fields: template.fields.filter(
    (field) =>
      field &&
      typeof field.key === "string" &&
      (field.level === "header" || field.level === "line"),
  ),
});
