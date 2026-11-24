import type { Job } from "@/types";

export type QueueItem = {
  id: string;
  kind?: "file" | "batch";
  file?: File;
  fileName?: string;
  fileSize?: number;
  status: "ready" | "running" | "done" | "error" | "uploaded" | "cancelled";
  progress: number;
  jobId?: string;
  documentId?: number;
  /** All document ids produced by a completed batch (for Save). */
  documentIds?: number[];
  message?: string;
  fieldCount?: number;
  confidence?: number;
  saved?: boolean;
  /** Completed extraction snapshot — used by Inspect Results even after SSE closes. */
  result?: Job;
  batchId?: string;
  /** Temporary compressed file waiting in local storage. */
  stagedId?: string;
  compressed?: boolean;
  zipFileName?: string;
  fileCount?: number;
  /** Extraction attempts used by the slot FIFO scheduler (max 3). */
  attempts?: number;
  permanentlyFailed?: boolean;
};

export const queueItemName = (item: QueueItem) =>
  item.file?.name || item.fileName || "Upload";

export const queueItemSizeLabel = (item: QueueItem) => {
  const bytes = item.file?.size ?? item.fileSize ?? 0;
  if (!bytes) {
    return item.fileCount ? `${item.fileCount} file${item.fileCount === 1 ? "" : "s"}` : "";
  }
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export type QueueFilter = "all" | "ready" | "processing" | "done" | "failed";

export const matchesQueueFilter = (item: QueueItem, filter: QueueFilter) => {
  if (filter === "all") return true;
  if (filter === "ready") return item.status === "ready";
  if (filter === "processing") return item.status === "running" || item.status === "uploaded";
  if (filter === "done") return item.status === "done";
  return item.status === "error" || item.status === "cancelled";
};

export const queueStatusCounts = (queue: QueueItem[]) => {
  let ready = 0;
  let processing = 0;
  let done = 0;
  let failed = 0;
  for (const item of queue) {
    if (item.status === "ready") ready += 1;
    else if (item.status === "running" || item.status === "uploaded") processing += 1;
    else if (item.status === "done") done += 1;
    else if (item.status === "error" || item.status === "cancelled") failed += 1;
  }
  return { ready, processing, done, failed, total: queue.length };
};
