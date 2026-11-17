import { apiUrl } from "./api";

export type BatchStatus =
  | "Uploaded"
  | "Processing"
  | "Completed"
  | "Failed"
  | "Cancelled";

export type ExtractionBatch = {
  id: string;
  jobName: string;
  zipFileName: string;
  zipSizeBytes: number;
  fileCount: number;
  templateId: number | null;
  status: BatchStatus;
  retryCount: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  zipStoredAs?: string;
  fileNames?: string[];
  templateName?: string | null;
};

export type ExtractionBatchFile = {
  id: string;
  batchId: string;
  originalName: string;
  documentId: number | null;
  status: string;
  errorMessage: string | null;
  createdAt: string;
};

const readError = async (response: Response) => {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    return body.error?.message || `Request failed (${response.status}).`;
  } catch {
    return `Request failed (${response.status}).`;
  }
};

export const createExtractionBatch = async (input: {
  files: File[];
  jobName?: string;
  templateId?: string;
}) => {
  const body = new FormData();
  for (const file of input.files) body.append("files", file);
  if (input.jobName) body.append("jobName", input.jobName);
  if (input.templateId) body.append("templateId", input.templateId);

  const response = await fetch(apiUrl("/batches"), { method: "POST", body });
  if (!response.ok) throw new Error(await readError(response));
  return (await response.json()) as { batch: ExtractionBatch; files: ExtractionBatchFile[] };
};

export const listExtractionBatches = async () => {
  const response = await fetch(apiUrl("/batches"));
  if (!response.ok) throw new Error(await readError(response));
  const payload = (await response.json()) as { batches: ExtractionBatch[] };
  return payload.batches;
};

export const getExtractionBatch = async (id: string) => {
  const response = await fetch(apiUrl(`/batches/${id}`));
  if (!response.ok) throw new Error(await readError(response));
  return (await response.json()) as { batch: ExtractionBatch; files: ExtractionBatchFile[] };
};
