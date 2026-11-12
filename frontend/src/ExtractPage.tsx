import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { jobFromDocument } from "./jobFromDocument";
import { Results } from "./Results";
import { apiUrl } from "./services/api";
import { downloadDriveFile, listDriveFiles } from "./services/drive";
import { activateTemplate, getActiveTemplate, getTemplate, listTemplates } from "./templates/api";
import { rememberTemplate, type Template, type TemplateSummary } from "./templates/types";
import type { Catalog, ExtractedFieldRow, Job, ServerConfig, StoredDocument } from "./types";
import { UploadPanel, type QueueItem } from "./UploadPanel";
import { useJob } from "./useJob";

const fallbackJob = (item: QueueItem): Job => ({
  id: item.jobId || `queue-${item.id}`,
  fileName: item.file.name,
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
  const [jobId, setJobId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [documents, setDocuments] = useState<StoredDocument[]>([]);
  const [offline, setOffline] = useState(false);
  const [activeTemplate, setActiveTemplate] = useState<Template | null>(null);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [batchMode, setBatchMode] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [inspectFields, setInspectFields] = useState<ExtractedFieldRow[]>([]);
  const [inspectDocumentId, setInspectDocumentId] = useState<number | null>(null);
  const [inspectJobSnapshot, setInspectJobSnapshot] = useState<Job | null>(null);
  const { job, liveError } = useJob(jobId);
  const runningId = useRef<string | null>(null);
  const chain = useRef<string[]>([]);
  const queueRef = useRef(queue);
  const templateRef = useRef(activeTemplate);
  const jobRef = useRef(job);
  const documentsRef = useRef(documents);

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  useEffect(() => {
    templateRef.current = activeTemplate;
  }, [activeTemplate]);

  useEffect(() => {
    jobRef.current = job;
  }, [job]);

  useEffect(() => {
    documentsRef.current = documents;
  }, [documents]);

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
        const [configResponse, catalogResponse, active, rows] = await Promise.all([
          fetch(apiUrl("/extract/config")),
          fetch(apiUrl("/extract/catalog")),
          getActiveTemplate().catch(() => null),
          listTemplates({ category: "All", query: "" }).catch(() => [] as TemplateSummary[]),
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
        setTemplates(rows);
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

  const startExtract = useCallback(
    async (itemId: string) => {
      setUploadError("");
      const template = templateRef.current;
      if (!template) {
        setUploadError("Set an active template under Templates before extracting.");
        return;
      }
      const snapshot = queueRef.current.find((row) => row.id === itemId);
      if (!snapshot) return;

      runningId.current = itemId;
      setUploading(true);
      setPreviewFile(snapshot.file);
      setInspecting(false);
      setQueue((current) =>
        current.map((row) =>
          row.id === itemId ? { ...row, status: "running", progress: 4, message: undefined } : row,
        ),
      );

      try {
        const body = new FormData();
        body.append("file", snapshot.file);
        const fieldKey = (field: (typeof template.fields)[number]) =>
          field.catalogKey?.trim() ||
          field.name
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "_")
            .replace(/^_+|_+$/g, "");
        body.append(
          "template",
          JSON.stringify({
            name: template.name,
            headerKeys: template.fields
              .filter((field) => field.level === "header")
              .map(fieldKey)
              .filter(Boolean),
            lineKeys: template.fields
              .filter((field) => field.level !== "header")
              .map(fieldKey)
              .filter(Boolean),
          }),
        );
        const response = await fetch(apiUrl("/extract"), { method: "POST", body });
        const payload = (await response.json().catch(() => null)) as {
          id?: string;
          document?: { id?: number };
          error?: { message?: string };
        } | null;
        if (!response.ok || !payload?.id) {
          throw new Error(payload?.error?.message || "Upload failed.");
        }
        void loadDocuments();
        setJobId(payload.id);
        setQueue((current) =>
          current.map((row) =>
            row.id === itemId
              ? {
                  ...row,
                  jobId: payload.id,
                  documentId:
                    typeof payload.document?.id === "number" ? payload.document.id : row.documentId,
                }
              : row,
          ),
        );
      } catch (error) {
        runningId.current = null;
        setUploading(false);
        const message = error instanceof Error ? error.message : "Upload failed.";
        setUploadError(message);
        setQueue((current) =>
          current.map((row) =>
            row.id === itemId ? { ...row, status: "error", message } : row,
          ),
        );
        const nextId = chain.current.shift();
        if (nextId) void startExtract(nextId);
      }
    },
    [loadDocuments],
  );

  useEffect(() => {
    if (!job || !runningId.current) return;
    const itemId = runningId.current;
    if (job.status === "running") {
      setQueue((current) =>
        current.map((item) =>
          item.id === itemId
            ? { ...item, status: "running", progress: job.progress, jobId: job.id }
            : item,
        ),
      );
      return;
    }
    if (job.status === "done") {
      const filledHeader = Object.values(job.header ?? {}).filter((value) => {
        if (value == null) return false;
        return String(value).trim() !== "";
      }).length;
      const fieldCount = filledHeader + job.lines.length;
      const confidence = Math.min(99, 90 + Math.min(fieldCount, 9));
      const result = structuredClone(job);
      setQueue((current) =>
        current.map((item) =>
          item.id === itemId
            ? {
                ...item,
                status: "done",
                progress: 100,
                jobId: job.id,
                fieldCount,
                confidence,
                result,
              }
            : item,
        ),
      );
      runningId.current = null;
      setUploading(false);
      const nextId = chain.current.shift();
      if (nextId) void startExtract(nextId);
      else void loadDocuments();
      return;
    }
    if (job.status === "error") {
      setQueue((current) =>
        current.map((item) =>
          item.id === itemId
            ? {
                ...item,
                status: "error",
                message: job.error?.message || "Extraction failed.",
              }
            : item,
        ),
      );
      runningId.current = null;
      setUploading(false);
      const nextId = chain.current.shift();
      if (nextId) void startExtract(nextId);
    }
  }, [job, loadDocuments, startExtract]);

  const saveToDocuments = useCallback(async () => {
    const ids = queueRef.current
      .filter(
        (item) => item.status === "done" && !item.saved && typeof item.documentId === "number",
      )
      .map((item) => item.documentId as number);
    if (!ids.length) {
      setUploadError("Extract the files, then save them to Documents.");
      return;
    }
    setSaving(true);
    setUploadError("");
    try {
      const response = await fetch(apiUrl("/documents/save"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!response.ok) throw new Error("Documents could not be saved.");
      setQueue((current) =>
        current.map((item) =>
          item.status === "done" && item.documentId != null && ids.includes(item.documentId)
            ? { ...item, saved: true }
            : item,
        ),
      );
      await loadDocuments();
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Documents could not be saved.");
    } finally {
      setSaving(false);
    }
  }, [loadDocuments]);

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
        file,
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

  /** Open Inspect Results immediately from the queue item — no waiting on PDF/network. */
  const openInspect = useCallback((itemId: string) => {
    const item = queueRef.current.find((row) => row.id === itemId);
    if (!item) return;
    if (item.status !== "done" && !item.jobId && item.documentId == null) return;

    setUploadError("");
    setInspectFields([]);

    const live =
      jobRef.current && item.jobId && jobRef.current.id === item.jobId ? jobRef.current : null;
    const snapshot = item.result ?? live ?? fallbackJob(item);
    setInspectJobSnapshot(snapshot);
    setPreviewFile(item.file);
    if (item.jobId) setJobId(item.jobId);

    const docs = documentsRef.current;
    const matched =
      (item.documentId != null ? docs.find((document) => document.id === item.documentId) : null) ||
      docs.find(
        (document) =>
          document.fileName === item.file.name &&
          (document.status || "").toLowerCase() === "completed",
      ) ||
      null;
    const documentId = item.documentId ?? matched?.id ?? null;
    setInspectDocumentId(documentId);

    // Show Results now — network enrichment happens after paint.
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
              document.fileName === item.file.name &&
              (document.status || "").toLowerCase() === "completed",
          );
          resolvedId = found?.id ?? null;
          if (resolvedId != null) setInspectDocumentId(resolvedId);
        }

        if (!item.result && item.jobId && !live) {
          const response = await fetch(apiUrl(`/extract/${item.jobId}`));
          if (response.ok) {
            const payload = (await response.json()) as Job;
            if (payload?.id) {
              setInspectJobSnapshot(payload);
              setQueue((current) =>
                current.map((row) => (row.id === itemId ? { ...row, result: payload } : row)),
              );
            }
          }
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

  const onSelectTemplate = async (id: string) => {
    setUploadError("");
    try {
      const activated = await activateTemplate(id);
      rememberTemplate(activated);
      setActiveTemplate(activated);
      setTemplates((current) =>
        current.map((row) => ({ ...row, active: row.id === activated.id })),
      );
    } catch (reason) {
      try {
        const template = await getTemplate(id);
        rememberTemplate(template);
        setActiveTemplate(template);
      } catch {
        setUploadError(reason instanceof Error ? reason.message : "Template could not be activated.");
      }
    }
  };

  const activeSummary: TemplateSummary | null = activeTemplate
    ? {
        ...activeTemplate,
        documentCount: templates.find((row) => row.id === activeTemplate.id)?.documentCount ?? 0,
        autoApprovedPercent:
          templates.find((row) => row.id === activeTemplate.id)?.autoApprovedPercent ?? null,
        active: true,
      }
    : null;

  const inspectDocument = useMemo(() => {
    if (inspectDocumentId == null) return null;
    return (
      documents.find((document) => document.id === inspectDocumentId) ??
      ({
        id: inspectDocumentId,
        fileName: previewFile?.name || inspectJobSnapshot?.fileName || job?.fileName || "Document",
        documentType: "Document",
        mimeType: previewFile?.type || "application/octet-stream",
        uploadedAt: new Date().toISOString(),
        status: "Completed",
      } satisfies StoredDocument)
    );
  }, [documents, inspectDocumentId, inspectJobSnapshot?.fileName, job?.fileName, previewFile]);

  const reviewJob = useMemo(() => {
    if (inspectFields.length > 0 && inspectDocument) {
      return jobFromDocument(inspectDocument, inspectFields);
    }
    if (inspectJobSnapshot) return inspectJobSnapshot;
    if (job) return job;
    if (inspectDocument) return jobFromDocument(inspectDocument, inspectFields);
    return null;
  }, [inspectDocument, inspectFields, inspectJobSnapshot, job]);

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
          job={job}
          uploading={uploading}
          uploadError={uploadError}
          liveError={liveError}
          activeTemplate={activeSummary}
          templates={templates}
          queue={queue}
          batchMode={batchMode}
          saving={saving}
          onBatchModeChange={setBatchMode}
          onSelectTemplate={(id) => void onSelectTemplate(id)}
          onAddFiles={(files) => {
            setUploadError("");
            setQueue((current) => [
              ...current,
              ...files.map((file) => ({
                id: crypto.randomUUID(),
                file,
                status: "ready" as const,
                progress: 0,
              })),
            ]);
          }}
          onExtract={(itemId) => {
            if (runningId.current) return;
            void startExtract(itemId);
          }}
          onExtractAll={() => {
            const ready = queue.filter((item) => item.status === "ready").map((item) => item.id);
            if (!ready.length || runningId.current) return;
            const [first, ...rest] = ready;
            chain.current = rest;
            if (first) void startExtract(first);
          }}
          onSave={() => void saveToDocuments()}
          onImportDrive={importFromDrive}
          onInspect={openInspect}
          onRemove={(itemId) => {
            setQueue((current) => current.filter((item) => item.id !== itemId));
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
            Could not open Inspect Results for this file.
          </p>
          <button type="button" className="app-btn-ghost" onClick={closeInspect}>
            Back to Ingest Queue
          </button>
        </div>
      )}
    </main>
  );
};
