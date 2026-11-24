export const PATHS = {
  HOME: "/",
  LOGIN: "/login",
  TEMPLATES: "/templates",
  TEMPLATE_NEW: "/templates/new",
  TEMPLATE_EDIT: "/templates/:id/edit",
  DOCUMENTS: "/documents",
  PROFILE: "/profile",
} as const;

export const templateEditPath = (id: string) => `/templates/${id}/edit`;
