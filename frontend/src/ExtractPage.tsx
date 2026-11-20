import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { jobFromDocument, mimeForFileName } from "./jobFromDocument";
import { Results } from "./Results";
import { apiUrl } from "./services/api";
import {
  deleteStagedFile,
  getStagedFile,
  listStagedFiles,
  runStagedFile,
  stageUploads,
  type StagedFile,
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

const statusFromStaged = (status: StagedFile["status"]): QueueItem["status"] => {
  if (status === "Uploaded") return "ready";
  if (status === "Processing") return "running";
  if (status === "Completed") return "done";
  return "error";
};

const progressFromStaged = (status: StagedFile["status"]) => {
  if (status === "Completed") return 100;
  if (status === "Processing") return 55;
  return 0;
};

const queueItemFromStaged = (file: StagedFile, existing?: QueueItem): QueueItem => ({
  id: existing?.id || `staged-${file.id}`,
  kind: "file",
  fileName: file.originalName,
  fileSize: file.sizeBytes,
  status: statusFromStaged(file.status),
  progress: progressFromStaged(file.status),
  message:
    file.status === "Uploaded" ? "Compressed" : file.errorMessage || existing?.message,
  stagedId: file.id,
  compressed: true,
  documentId: file.documentId ?? existing?.documentId,
  documentIds: file.documentId != null ? [file.documentId] : existing?.documentIds,
  saved: existing?.saved,
  file: existing?.file,
  attempts: existing?.attempts,
  permanentlyFailed: existing?.permanentlyFailed,
});

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
  fileName: item.file?.name || item.fileName || "Document",
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
              status: "ready",
              progress: 0,
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

  const mergeStagedIntoQueue = useCallback((file: StagedFile) => {
    if (dismissedBatches.current.has(file.id)) return;
    setQueue((current) => {
      const existing = current.find((row) => row.stagedId === file.id);
      const nextItem = queueItemFromStaged(file, existing);
      if (existing?.status === "running" && nextItem.status === "ready") {
        nextItem.status = "running";
        nextItem.progress = existing.progress;
      }
      if (existing) {
        return current.map((row) => (row.stagedId === file.id ? nextItem : row));
      }
      return [nextItem, ...current];
    });
  }, []);

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
    const hydrateStaged = async () => {
      try {
        const staged = await listStagedFiles();
        if (cancelled) return;
        const completedIds = new Set<number>();
        try {
          const response = await fetch(apiUrl("/documents"));
          if (response.ok) {
            const payload = (await response.json()) as { documents?: StoredDocument[] };
            for (const document of payload.documents ?? []) completedIds.add(document.id);
          }
        } catch {
          // Compressed uploads stay visible when the library cannot be read.
        }
        if (cancelled) return;
        setQueue((current) => {
          const localOnly = current.filter((row) => !row.stagedId);
          const fromServer = staged
            .filter((file) => {
              if (dismissedBatches.current.has(file.id)) return false;
              if (file.documentId == null) {
                return file.status === "Processing" || file.status === "Failed" || file.status === "Uploaded";
              }
              return !completedIds.has(file.documentId);
            })
            .map((file) => queueItemFromStaged(file, current.find((row) => row.stagedId === file.id)));
          return [...localOnly, ...fromServer];
        });
      } catch {
        // Queue still works without files left in temporary storage.
      }
    };
    void hydrateStaged();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const needsDetail = queue.filter(
      (item) =>
        item.stagedId &&
        (item.status === "running" || (item.status === "done" && item.documentId == null)),
    );
    if (!needsDetail.length) return;
    const refresh = () => {
      for (const item of needsDetail) {
        void getStagedFile(item.stagedId!)
          .then((detail) => mergeStagedIntoQueue(detail.file))
          .catch(() => undefined);
      }
    };
    refresh();
    const timer = window.setInterval(refresh, 2000);
    return () => window.clearInterval(timer);
  }, [queue, mergeStagedIntoQueue]);

  const submitOneFile = useCallback(
    async (item: QueueItem, attempt: number) => {
      const template = templateRef.current;
      if (!template) {
        setUploadError("Set an active template under Templates before extracting.");
        return { ok: false as const, errorMessage: "No active template." };
      }
      if (!item.file && !item.stagedId) {
        return { ok: false as const, errorMessage: "File is missing from the queue." };
      }

      setUploadError("");
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
                    ? `Attempt ${attempt}/${EXTRACTION_MAX_ATTEMPTS} · Processing…`
                    : "Processing…",
              }
            : row,
        ),
      );

      try {
        const detail = item.stagedId
          ? await runStagedFile(item.stagedId)
          : await stageUploads({
              files: [item.file!],
              templateId: template.id,
            }).then(async (staged) => {
              const first = staged.files[0];
              if (!first) throw new Error("Compressed file was not stored.");
              return { file: first };
            });
        const staged = detail.file;
        setQueue((current) =>
          current.map((row) => {
            if (row.id !== item.id) return row;
            const next = queueItemFromStaged(staged, row);
            return {
              ...next,
              id: row.id,
              file: row.file ?? item.file,
              attempts: attempt,
              permanentlyFailed: false,
              status: staged.status === "Uploaded" ? "running" : next.status,
              message:
                attempt > 1
                  ? `Attempt ${attempt}/${EXTRACTION_MAX_ATTEMPTS} · Processing…`
                  : staged.errorMessage || undefined,
            };
          }),
        );
        if (staged.status === "Processing" || staged.status === "Uploaded") {
          void getStagedFile(staged.id)
            .then((latest) => mergeStagedIntoQueue(latest.file))
            .catch(() => undefined);
        }
        if (staged.status === "Completed") {
          void loadDocuments();
          return { ok: true as const, settled: true };
        }
        if (staged.status === "Failed") {
          return {
            ok: false as const,
            errorMessage: staged.errorMessage || "Extraction failed.",
          };
        }
        return { ok: true as const };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Extraction failed.";
        setQueue((current) =>
          current.map((row) =>
            row.id === item.id
              ? { ...row, status: "error", message, progress: 0, attempts: attempt }
              : row,
          ),
        );
        return { ok: false as const, errorMessage: message };
      }
    },
    [loadDocuments, mergeStagedIntoQueue],
  );

  submitOneRef.current = submitOneFile;

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
      if (!snapshot || snapshot.permanentlyFailed) return;
      if (!snapshot.file && !snapshot.stagedId) return;
      slotQueue.schedule([itemId]);
    },
    [slotQueue],
  );

  const extractAll = useCallback(() => {
    const ready = queueRef.current.filter(
      (item) =>
        item.status === "ready" &&
        (item.file || item.stagedId) &&
        !item.permanentlyFailed,
    );
    if (!ready.length) return;
    slotQueue.schedule(ready.map((item) => item.id));
  }, [slotQueue]);

  const compressIncoming = useCallback(async (files: File[]) => {
    if (!files.length) return;
    setUploadError("");
    setUploading(true);
    const failures: string[] = [];
    try {
      for (let index = 0; index < files.length; index += 50) {
        const chunk = files.slice(index, index + 50);
        try {
          const { files: staged } = await stageUploads({
            files: chunk,
            run: false,
            deferTemplate: true,
          });
          setQueue((current) => [
            ...current,
            ...staged.map((file) => queueItemFromStaged(file)),
          ]);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Could not compress the upload.";
          failures.push(message);
          setQueue((current) => [
            ...current,
            ...chunk.map((file) => ({
              id: crypto.randomUUID(),
              kind: "file" as const,
              file,
              fileName: file.name,
              fileSize: file.size,
              status: "ready" as const,
              progress: 0,
            })),
          ]);
        }
      }
    } finally {
      setUploading(false);
    }
    if (failures.length) {
      setUploadError(failures[0] || "Could not compress the upload.");
    }
  }, []);

  const saveToDocuments = useCallback(async () => {
    const collectIds = (items: QueueItem[]) =>
      [
        ...new Set(
          items.flatMap((item) => {
            const fromList = item.documentIds ?? [];
            return typeof item.documentId === "number" ? [...fromList, item.documentId] : fromList;
          }),
        ),
      ];

    const targets = queueRef.current.filter((item) => !item.saved && item.status === "done");
    let ids = collectIds(targets);

    if (!ids.length) {
      const pending = targets.filter((item) => item.stagedId);
      if (!pending.length) {
        setUploadError("Extract the files, then save them to Documents.");
        return;
      }
      setUploadError("Loading extracted documents…");
      const details = await Promise.all(
        pending.map((item) =>
          getStagedFile(item.stagedId!)
            .then((detail) => {
              mergeStagedIntoQueue(detail.file);
              return detail.file;
            })
            .catch(() => null),
        ),
      );
      ids = [
        ...new Set(
          details
            .map((file) => file?.documentId)
            .filter((id): id is number => typeof id === "number"),
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
      const savedIds = targets
        .map((item) => item.stagedId)
        .filter((id): id is string => Boolean(id));
      if (savedIds.length) {
        const nextDismissed = new Set(dismissedBatches.current);
        for (const stagedId of savedIds) nextDismissed.add(stagedId);
        dismissedBatches.current = nextDismissed;
        writeDismissedBatches(nextDismissed);
        await Promise.all(savedIds.map((id) => deleteStagedFile(id).catch(() => undefined)));
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
  }, [loadDocuments, mergeStagedIntoQueue]);

  const importFromDrive = useCallback(
    async (url: string) => {
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
      if (files.length) await compressIncoming(files);
      if (failures.length) {
        setUploadError(`Loaded ${files.length} file(s). Skipped: ${failures.join("; ")}`);
      }
    },
    [compressIncoming],
  );

  const closeInspect = useCallback(() => {
    setInspecting(false);
    setPreviewFile(null);
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
    const localFile = item.file && item.file.size > 0 ? item.file : null;
    setPreviewFile(localFile);

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

        if (!localFile) {
          const fileResponse = await fetch(apiUrl(`/documents/${resolvedId}/file`));
          if (fileResponse.ok) {
            const blob = await fileResponse.blob();
            if (blob.size) {
              const name = item.file?.name || item.fileName || "Document";
              const type = mimeForFileName(
                name,
                blob.type || fileResponse.headers.get("Content-Type") || "",
              );
              setPreviewFile(new File([blob], name, { type }));
            }
          }
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
            void compressIncoming(files);
          }}
          onExtract={startExtract}
          onExtractAll={extractAll}
          onSave={() => void saveToDocuments()}
          onImportDrive={importFromDrive}
          onInspect={openInspect}
          onRemove={(itemId) => {
            const item = queueRef.current.find((row) => row.id === itemId);
            if (item?.stagedId) {
              const nextDismissed = new Set(dismissedBatches.current);
              nextDismissed.add(item.stagedId);
              dismissedBatches.current = nextDismissed;
              writeDismissedBatches(nextDismissed);
              void deleteStagedFile(item.stagedId).catch(() => undefined);
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
