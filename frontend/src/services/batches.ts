import { apiUrl } from "@/services/client";

export type StagedStatus = "Uploaded" | "Processing" | "Completed" | "Failed";

export type StagedFile = {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  templateId: number | null;
  status: StagedStatus;
  documentId: number | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

const readError = async (response: Response) => {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    return body.error?.message || `Request failed (${response.status}).`;
  } catch {
    return `Request failed (${response.status}).`;
  }
};

/** Compress each file on its own. Extraction starts only when run is not false. */
export const stageUploads = async (input: {
  files: File[];
  templateId?: string;
  run?: boolean;
  deferTemplate?: boolean;
}) => {
  const body = new FormData();
  for (const file of input.files) body.append("files", file);
  if (input.templateId) body.append("templateId", input.templateId);
  if (input.run === false) body.append("run", "false");
  if (input.deferTemplate) body.append("deferTemplate", "true");

  const response = await fetch(apiUrl("/batches"), { method: "POST", body });
  if (!response.ok) throw new Error(await readError(response));
  return (await response.json()) as { files: StagedFile[] };
};

export const createExtractionBatch = (input: {
  files: File[];
  jobName?: string;
  templateId?: string;
  run?: boolean;
  deferTemplate?: boolean;
}) => stageUploads(input);

export const runStagedFile = async (id: string) => {
  const response = await fetch(apiUrl(`/batches/${id}/run`), { method: "POST" });
  if (!response.ok) throw new Error(await readError(response));
  return (await response.json()) as { file: StagedFile };
};

export const listStagedFiles = async () => {
  const response = await fetch(apiUrl("/batches"));
  if (!response.ok) throw new Error(await readError(response));
  const payload = (await response.json()) as { files: StagedFile[] };
  return payload.files;
};

export const getStagedFile = async (id: string) => {
  const response = await fetch(apiUrl(`/batches/${id}`));
  if (!response.ok) {
    const error = new Error(await readError(response)) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return (await response.json()) as { file: StagedFile };
};

export const deleteStagedFile = async (id: string) => {
  const response = await fetch(apiUrl(`/batches/${id}`), { method: "DELETE" });
  if (!response.ok && response.status !== 404) throw new Error(await readError(response));
};
