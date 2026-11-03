import type { FieldSuggestions } from "./types";

export type SourceDocument = {
  id: string;
  file: File;
  status: "reading" | "ready" | "error";
  message?: string;
  suggestions?: FieldSuggestions;
};
