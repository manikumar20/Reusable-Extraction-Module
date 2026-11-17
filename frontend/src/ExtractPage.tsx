import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { jobFromDocument } from "./jobFromDocument";
import { Results } from "./Results";
import { apiUrl } from "./services/api";
import {
  createExtractionBatch,
  getExtractionBatch,
  listExtractionBatches,
  type ExtractionBatch,
  type ExtractionBatchFile,
} from "./services/batches";
import { downloadDriveFile, listDriveFiles } from "./services/drive";
import {
  EXTRACTION_MAX_ATTEMPTS,
  ExtractionSlotQueue,
} from "./services/extractionSlotQueue";
import { getActiveTemplate } from "./templates/api";
import { rememberTemplate, type Template } from "./templates/types";
import type { Catalog, ExtractedFieldRow, Job, ServerConfig, StoredDocument } from "./types";
import {
  UploadPanel,
  type QueueItem,
} from "./UploadPanel";

const statusFromBatch = (
  status: ExtractionBatch["status"],
): QueueItem["status"] => {
  if (status === "Uploaded") return "uploaded";
  if (status === "Processing") return "running";
  if (status === "Completed") return "done";
  if (status === "Cancelled") return "cancelled";
  return "error";
};

const progressFromBatch = (status: ExtractionBatch["status"]) => {
  if (status === "Completed") return 100;
  if (status === "Processing") return 55;
  if (status === "Uploaded") return 12;
  return 0;
};

const queueItemFromBatch = (
  batch: ExtractionBatch,
  files: ExtractionBatchFile[] = [],
  existing?: QueueItem,
): QueueItem => {
  const completedDocs = files
    .map((file) => file.documentId)
    .filter((id): id is number => typeof id === "number");
  const documentIds =
    completedDocs.length > 0 ? [...new Set(completedDocs)] : existing?.documentIds;
  const label =
    files.length === 1
      ? files[0]!.originalName
      : batch.jobName?.trim() ||
        (batch.fileCount === 1 ? existing?.fileName || "1 file" : `${batch.fileCount} files`);
  return {
    id: existing?.id || `batch-${batch.id}`,
    kind: "batch",
    fileName: label,
    fileSize: batch.zipSizeBytes,
    status: statusFromBatch(batch.status),
    progress: progressFromBatch(batch.status),
    message: batch.errorMessage || undefined,
    batchId: batch.id,
    zipFileName: batch.zipFileName,
    fileCount: batch.fileCount,
    documentIds,
    documentId: documentIds?.[0] ?? existing?.documentId,
    fieldCount: documentIds?.length ?? existing?.fieldCount,
    saved: existing?.saved,
  };
};

const placeholderFile = (name: string) => new File([], name);

const DISMISSED_BATCHES_KEY = "extractiq-dismissed-batches";

const readDismissedBatches = () => {
  try {
    const raw = sessionStorage.getItem(DISMISSED_BATCHES_KEY);
    const ids = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set<string>();
  }
};

const writeDismissedBatches = (ids: Set<string>) => {
  sessionStorage.setItem(DISMISSED_BATCHES_KEY, JSON.stringify([...ids]));
};

const fallbackJob = (item: QueueItem): Job => ({
  id: item.jobId || `queue-${item.id}`,
  fileName: item.file?.name || item.fileName || item.zipFileName || "Document",
  status: "done",
  phase: "done",
  progress: 100,
  header: {},
  lines: [],
  usage: { inputTokens: 0, outputTokens: 0 },
  headerUsage: { inputTokens: 0, outputTokens: 0 },
  lineCostUsd: 0,
  headerCostUsd: 0,
  template: null,
  error: null,
});

export const ExtractPage = () => {
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [documents, setDocuments] = useState<StoredDocument[]>([]);
  const [offline, setOffline] = useState(false);
  const [activeTemplate, setActiveTemplate] = useState<Template | null>(null);
  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [inspecting, setInspecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [inspectFields, setInspectFields] = useState<ExtractedFieldRow[]>([]);
  const [inspectDocumentId, setInspectDocumentId] = useState<number | null>(null);
  const [inspectJobSnapshot, setInspectJobSnapshot] = useState<Job | null>(null);
  const dismissedBatches = useRef(readDismissedBatches());
  const queueRef = useRef(queue);
  const templateRef = useRef(activeTemplate);
  const documentsRef = useRef(documents);
  const slotQueueRef = useRef<ExtractionSlotQueue | null>(null);
  const submitOneRef = useRef<
    (item: QueueItem, attempt: number) => Promise<{ ok: boolean; settled?: boolean; errorMessage?: string }>
  >(async () => ({ ok: false, errorMessage: "Not ready." }));

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  useEffect(() => {
    templateRef.current = activeTemplate;
  }, [activeTemplate]);

  useEffect(() => {
    documentsRef.current = documents;
  }, [documents]);

  if (!slotQueueRef.current) {
    slotQueueRef.current = new ExtractionSlotQueue({
      getItems: () => queueRef.current,
      processItem: (item, attempt) => {
        const row = queueRef.current.find((entry) => entry.id === item.id);
        if (!row) return Promise.resolve({ ok: false, errorMessage: "File left the queue." });
        return submitOneRef.current(row, attempt);
      },
      requeueForRetry: (itemId, attempt, maxAttempts) => {
        setQueue((current) => {
          const row = current.find((entry) => entry.id === itemId);
          if (!row) return current;
          const rest = current.filter((entry) => entry.id !== itemId);
          return [
            ...rest,
            {
              ...row,
              kind: "file",
              status: "ready",
              progress: 0,
              batchId: undefined,
              zipFileName: undefined,
              permanentlyFailed: false,
              attempts: attempt,
              message: `Waiting to retry (${attempt}/${maxAttempts})…`,
            },
          ];
        });
      },
      markPermanentlyFailed: (itemId, attempts, message) => {
        setQueue((current) =>
          current.map((row) =>
            row.id === itemId
              ? {
                  ...row,
                  status: "error",
                  progress: 0,
                  permanentlyFailed: true,
                  attempts,
                  message: message || `Failed after ${attempts} attempts.`,
                }
              : row,
          ),
        );
      },
    });
  }
  const slotQueue = slotQueueRef.current;

  const loadDocuments = useCallback(async () => {
    try {
      const response = await fetch(apiUrl("/documents"));
      if (!response.ok) return;
      const payload = (await response.json()) as { documents?: StoredDocument[] };
      setDocuments(payload.documents ?? []);
    } catch {
      // The upload page still works if the document list cannot be read.
    }
  }, []);

  const mergeBatchIntoQueue = useCallback(
    (batch: ExtractionBatch, files: ExtractionBatchFile[] = []) => {
      if (dismissedBatches.current.has(batch.id)) return;
      setQueue((current) => {
        const existing = current.find((row) => row.batchId === batch.id);
        const nextItem = {
          ...queueItemFromBatch(batch, files, existing),
          id: existing?.id || `batch-${batch.id}`,
          file: existing?.file,
          attempts: existing?.attempts,
          permanentlyFailed: existing?.permanentlyFailed,
        };
        if (existing) {
          return current.map((row) => (row.batchId === batch.id ? nextItem : row));
        }
        return [nextItem, ...current];
      });
    },
    [],
  );

  useEffect(() => {
    document.title = "Extract & Ingest · ExtractIQ";
  }, []);

  useEffect(() => {
    const prevent = (event: DragEvent) => event.preventDefault();
    window.addEventListener("dragover", prevent);
    window.addEventListener("drop", prevent);
    return () => {
      window.removeEventListener("dragover", prevent);
      window.removeEventListener("drop", prevent);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [configResponse, catalogResponse, active] = await Promise.all([
          fetch(apiUrl("/extract/config")),
          fetch(apiUrl("/extract/catalog")),
          getActiveTemplate().catch(() => null),
        ]);
        if (cancelled) return;
        if (configResponse.ok) {
          setConfig((await configResponse.json()) as ServerConfig);
          setOffline(false);
        } else {
          setOffline(true);
        }
        if (catalogResponse.ok) {
          setCatalog((await catalogResponse.json()) as Catalog);
        }
        if (active) {
          rememberTemplate(active);
          setActiveTemplate(active);
        }
      } catch {
        if (!cancelled) setOffline(true);
      }
    };
    void load();
    void loadDocuments();
    return () => {
      cancelled = true;
    };
  }, [loadDocuments]);

  useEffect(() => {
    let cancelled = false;
    const hydrateBatches = async () => {
      try {
        const batches = await listExtractionBatches();
        if (cancelled) return;
        const recent = batches.slice(0, 20);
        const details = await Promise.all(
          recent.map(async (batch) => {
            try {
              return await getExtractionBatch(batch.id);
            } catch {
              return { batch, files: [] as ExtractionBatchFile[] };
            }
          }),
        );
        if (cancelled) return;
        const completedIds = new Set<number>();
        try {
          const response = await fetch(apiUrl("/documents"));
          if (response.ok) {
            const payload = (await response.json()) as { documents?: StoredDocument[] };
            for (const document of payload.documents ?? []) completedIds.add(document.id);
          }
        } catch {
          // Saved batches stay visible only if the library cannot be read.
        }
        if (cancelled) return;
        setQueue((current) => {
          const localReady = current.filter((row) => row.kind !== "batch" && !row.batchId);
          const fromServer = details
            .filter(({ batch, files }) => {
              if (dismissedBatches.current.has(batch.id)) return false;
              const documentIds = files
                .map((file) => file.documentId)
                .filter((id): id is number => typeof id === "number");
              if (!documentIds.length) {
                // Skip idle unsaved uploads that are not in-flight.
                return batch.status === "Processing" || batch.status === "Failed";
              }
              return !documentIds.every((id) => completedIds.has(id));
            })
            .map(({ batch, files }) => {
              const existing = current.find((row) => row.batchId === batch.id);
              return queueItemFromBatch(batch, files, existing);
            });
          return [...localReady, ...fromServer];
        });
      } catch {
        // Queue still works without prior batch history.
      }
    };
    void hydrateBatches();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const needsDetail = queue.filter(
      (item) =>
        item.batchId &&
        (item.status === "uploaded" ||
          item.status === "running" ||
          (item.status === "done" && !(item.documentIds?.length || item.documentId != null))),
    );
    if (!needsDetail.length) return;

    const refresh = () => {
      for (const item of needsDetail) {
        void getExtractionBatch(item.batchId!)
          .then((detail) => mergeBatchIntoQueue(detail.batch, detail.files))
          .catch(() => undefined);
      }
    };
    refresh();
    const timer = window.setInterval(refresh, 2500);
    return () => window.clearInterval(timer);
  }, [queue, mergeBatchIntoQueue]);

  const submitOneFile = useCallback(
    async (item: QueueItem, attempt: number) => {
      const template = templateRef.current;
      if (!template) {
        setUploadError("Set an active template under Templates before extracting.");
        return { ok: false as const, errorMessage: "Set an active template under Templates before extracting." };
      }
      const file = item.file;
      if (!file) {
        return { ok: false as const, errorMessage: "File is missing from the queue." };
      }

      setUploadError("");
      setUploading(true);
      setQueue((current) =>
        current.map((row) =>
          row.id === item.id
            ? {
                ...row,
                status: "running",
                progress: 8,
                attempts: attempt,
                permanentlyFailed: false,
                message:
                  attempt > 1
                    ? `Attempt ${attempt}/${EXTRACTION_MAX_ATTEMPTS} · Uploading…`
                    : "Uploading…",
              }
            : row,
        ),
      );

      try {
        const detail = await createExtractionBatch({
          files: [file],
          templateId: template.id,
        });
        // Keep FIFO position and original id/file so retries stay possible.
        setQueue((current) =>
          current.map((row) => {
            if (row.id !== item.id) return row;
            return {
              ...queueItemFromBatch(detail.batch, detail.files, row),
              id: row.id,
              file: row.file ?? file,
              attempts: attempt,
              permanentlyFailed: false,
              message:
                attempt > 1
                  ? `Attempt ${attempt}/${EXTRACTION_MAX_ATTEMPTS} · Processing…`
                  : detail.batch.errorMessage || undefined,
            };
          }),
        );
        if (detail.batch.status === "Processing" || detail.batch.status === "Uploaded") {
          void getExtractionBatch(detail.batch.id)
            .then((latest) => mergeBatchIntoQueue(latest.batch, latest.files))
            .catch(() => undefined);
        }
        if (detail.batch.status === "Completed") {
          void loadDocuments();
          return { ok: true as const, settled: true };
        }
        if (detail.batch.status === "Failed" || detail.batch.status === "Cancelled") {
          return {
            ok: false as const,
            errorMessage: detail.batch.errorMessage || "Extraction failed.",
          };
        }
        void loadDocuments();
        return { ok: true as const, settled: false };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Upload failed.";
        setUploadError(message);
        setQueue((current) =>
          current.map((row) =>
            row.id === item.id
              ? { ...row, status: "error", message, progress: 0, attempts: attempt }
              : row,
          ),
        );
        return { ok: false as const, errorMessage: message };
      } finally {
        setUploading(false);
      }
    },
    [loadDocuments, mergeBatchIntoQueue],
  );

  submitOneRef.current = submitOneFile;

  // Release slots when in-flight items reach a terminal status (polled from the server).
  useEffect(() => {
    for (const item of queue) {
      if (!slotQueue.isAwaitingTerminal(item.id)) continue;
      if (item.status === "done") {
        slotQueue.notifyTerminal(item.id, "done");
      } else if (item.status === "error" || item.status === "cancelled") {
        if (item.permanentlyFailed) continue;
        slotQueue.notifyTerminal(item.id, "failed", item.message);
      }
    }
  }, [queue, slotQueue]);

  const startExtract = useCallback(
    (itemId: string) => {
      const snapshot = queueRef.current.find((row) => row.id === itemId);
      if (!snapshot?.file || snapshot.kind === "batch") return;
      if (snapshot.permanentlyFailed) return;
      slotQueue.schedule([itemId]);
    },
    [slotQueue],
  );

  const extractAll = useCallback(() => {
    const ready = queueRef.current.filter(
      (item) =>
        item.status === "ready" &&
        item.file &&
        item.kind !== "batch" &&
        !item.permanentlyFailed,
    );
    if (!ready.length) return;
    slotQueue.schedule(ready.map((item) => item.id));
  }, [slotQueue]);

  const saveToDocuments = useCallback(async () => {
    const collectIds = (items: QueueItem[]) =>
      [
        ...new Set(
          items.flatMap((item) => {
            const fromList = item.documentIds ?? [];
            return typeof item.documentId === "number"
              ? [...fromList, item.documentId]
              : fromList;
          }),
        ),
      ];

    const targets = queueRef.current.filter((item) => {
      if (item.saved) return false;
      if (item.status === "done") return true;
      return item.status === "error" && Boolean(item.batchId);
    });
    let ids = collectIds(targets);

    if (!ids.length) {
      const pending = targets.filter((item) => item.batchId);
      if (!pending.length) {
        setUploadError("Extract the files, then save them to Documents.");
        return;
      }
      setUploadError("Loading extracted documents…");
      const details = await Promise.all(
        pending.map((item) =>
          getExtractionBatch(item.batchId!)
            .then((detail) => {
              mergeBatchIntoQueue(detail.batch, detail.files);
              return detail;
            })
            .catch(() => null),
        ),
      );
      ids = [
        ...new Set(
          details.flatMap((detail) =>
            (detail?.files ?? [])
              .map((file) => file.documentId)
              .filter((id): id is number => typeof id === "number"),
          ),
        ),
      ];
      if (!ids.length) {
        setUploadError("Extracted documents are not ready yet. Wait for processing to finish.");
        return;
      }
    }

    const targetIds = new Set(targets.map((item) => item.id));
    setSaving(true);
    setUploadError("");
    try {
      const response = await fetch(apiUrl("/documents/save"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!response.ok) throw new Error("Documents could not be saved.");
      const savedBatchIds = targets
        .map((item) => item.batchId)
        .filter((id): id is string => Boolean(id));
      if (savedBatchIds.length) {
        const nextDismissed = new Set(dismissedBatches.current);
        for (const batchId of savedBatchIds) nextDismissed.add(batchId);
        dismissedBatches.current = nextDismissed;
        writeDismissedBatches(nextDismissed);
      }
      setQueue((current) =>
        current.filter((item) => {
          if (item.saved || targetIds.has(item.id)) return false;
          const itemIds = [
            ...(item.documentIds ?? []),
            ...(typeof item.documentId === "number" ? [item.documentId] : []),
          ];
          return !itemIds.some((id) => ids.includes(id));
        }),
      );
      setInspecting(false);
      setPreviewFile(null);
      setInspectFields([]);
      setInspectDocumentId(null);
      setInspectJobSnapshot(null);
      setUploadError("");
      await loadDocuments();
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Documents could not be saved.");
    } finally {
      setSaving(false);
    }
  }, [loadDocuments, mergeBatchIntoQueue]);

  const importFromDrive = useCallback(async (url: string) => {
    setUploadError("");
    const listed = await listDriveFiles(url);
    if (!listed.files.length) {
      setUploadError("No files found for that Drive link.");
      return;
    }
    const files: File[] = [];
    const failures: string[] = [];
    for (const entry of listed.files) {
      try {
        files.push(await downloadDriveFile(entry));
      } catch (error) {
        failures.push(
          `${entry.name}: ${error instanceof Error ? error.message : "download failed"}`,
        );
      }
    }
    setQueue((current) => [
      ...current,
      ...files.map((file) => ({
        id: crypto.randomUUID(),
        kind: "file" as const,
        file,
        fileName: file.name,
        fileSize: file.size,
        status: "ready" as const,
        progress: 0,
      })),
    ]);
    if (failures.length) {
      setUploadError(`Loaded ${files.length} file(s). Skipped: ${failures.join("; ")}`);
    }
  }, []);

  const closeInspect = useCallback(() => {
    setInspecting(false);
    setInspectFields([]);
    setInspectDocumentId(null);
    setInspectJobSnapshot(null);
    void loadDocuments();
  }, [loadDocuments]);

  const openInspect = useCallback((itemId: string) => {
    const item = queueRef.current.find((row) => row.id === itemId);
    if (!item) return;
    if (item.status !== "done" && !item.jobId && item.documentId == null) return;

    setUploadError("");
    setInspectFields([]);

    const snapshot = item.result ?? fallbackJob(item);
    setInspectJobSnapshot(snapshot);
    setPreviewFile(item.file ?? placeholderFile(item.fileName || item.zipFileName || "Document"));

    const docs = documentsRef.current;
    const matched =
      (item.documentId != null ? docs.find((document) => document.id === item.documentId) : null) ||
      docs.find(
        (document) =>
          document.fileName === (item.file?.name || item.fileName) &&
          (document.status || "").toLowerCase() === "completed",
      ) ||
      null;
    const documentId = item.documentId ?? matched?.id ?? null;
    setInspectDocumentId(documentId);
    setInspecting(true);

    void (async () => {
      try {
        let resolvedId = documentId;
        if (resolvedId == null) {
          await loadDocuments();
          const latest = await fetch(apiUrl("/documents"))
            .then(async (response) =>
              response.ok ? ((await response.json()) as { documents?: StoredDocument[] }) : null,
            )
            .catch(() => null);
          const found = (latest?.documents ?? []).find(
            (document) =>
              document.fileName === (item.file?.name || item.fileName) &&
              (document.status || "").toLowerCase() === "completed",
          );
          resolvedId = found?.id ?? null;
          if (resolvedId != null) setInspectDocumentId(resolvedId);
        }

        if (resolvedId == null) return;

        if (item.documentId == null) {
          setQueue((current) =>
            current.map((row) => (row.id === itemId ? { ...row, documentId: resolvedId! } : row)),
          );
        }

        for (let attempt = 0; attempt < 6; attempt += 1) {
          const fieldsResponse = await fetch(apiUrl(`/documents/${resolvedId}/fields`));
          if (fieldsResponse.ok) {
            const payload = (await fieldsResponse.json()) as { fields?: ExtractedFieldRow[] };
            const rows = payload.fields ?? [];
            if (rows.length || attempt === 5) {
              setInspectFields(rows);
              break;
            }
          }
          await new Promise((resolve) => window.setTimeout(resolve, 500));
        }
      } catch (error) {
        setUploadError(
          error instanceof Error ? error.message : "Could not load saved fields for this document.",
        );
      }
    })();
  }, [loadDocuments]);

  const inspectDocument = useMemo(() => {
    if (inspectDocumentId == null) return null;
    return (
      documents.find((document) => document.id === inspectDocumentId) ??
      ({
        id: inspectDocumentId,
        fileName: previewFile?.name || inspectJobSnapshot?.fileName || "Document",
        documentType: "Document",
        mimeType: previewFile?.type || "application/octet-stream",
        uploadedAt: new Date().toISOString(),
        status: "Completed",
      } satisfies StoredDocument)
    );
  }, [documents, inspectDocumentId, inspectJobSnapshot?.fileName, previewFile]);

  const reviewJob = useMemo(() => {
    if (inspectFields.length > 0 && inspectDocument) {
      return jobFromDocument(inspectDocument, inspectFields);
    }
    if (inspectJobSnapshot) return inspectJobSnapshot;
    if (inspectDocument) return jobFromDocument(inspectDocument, inspectFields);
    return null;
  }, [inspectDocument, inspectFields, inspectJobSnapshot]);

  return (
    <main
      className={
        inspecting
          ? "upload-page extract-studio reviewing"
          : "upload-page extract-studio ingest-page"
      }
    >
      {offline && (
        <p className="banner">
          The extraction service is not running. Start the backend, then refresh.
        </p>
      )}

      {!inspecting && (
        <UploadPanel
          config={config}
          job={null}
          uploading={uploading}
          uploadError={uploadError}
          liveError=""
          activeTemplate={activeTemplate}
          queue={queue}
          saving={saving}
          onAddFiles={(files) => {
            setUploadError("");
            setQueue((current) => [
              ...current,
              ...files.map((file) => ({
                id: crypto.randomUUID(),
                kind: "file" as const,
                file,
                fileName: file.name,
                fileSize: file.size,
                status: "ready" as const,
                progress: 0,
              })),
            ]);
          }}
          onExtract={startExtract}
          onExtractAll={extractAll}
          onSave={() => void saveToDocuments()}
          onImportDrive={importFromDrive}
          onInspect={openInspect}
          onRemove={(itemId) => {
            const item = queueRef.current.find((row) => row.id === itemId);
            if (item?.batchId) {
              const nextDismissed = new Set(dismissedBatches.current);
              nextDismissed.add(item.batchId);
              dismissedBatches.current = nextDismissed;
              writeDismissedBatches(nextDismissed);
            }
            slotQueue.forget(itemId);
            setQueue((current) => current.filter((row) => row.id !== itemId));
            void slotQueue.pump();
          }}
        />
      )}

      {inspecting && reviewJob && (
        <Results
          catalog={catalog}
          job={reviewJob}
          documents={documents}
          previewFile={previewFile}
          documentId={inspectDocumentId}
          persistedFields={inspectFields}
          onFieldsChanged={() => void loadDocuments()}
          backLabel="Back to Ingest Queue"
          onBack={closeInspect}
          onNextDocument={closeInspect}
        />
      )}

      {inspecting && !reviewJob && (
        <div className="stand" style={{ display: "grid", gap: 12, maxWidth: 420 }}>
          <p className="error-text" role="alert">
            Could not open results for this file.
          </p>
          <button type="button" className="app-btn-primary" onClick={closeInspect}>
            Back to Ingest Queue
          </button>
        </div>
      )}
    </main>
  );
};
