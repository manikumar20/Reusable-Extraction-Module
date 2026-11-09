import { useCallback, useEffect, useRef, useState } from "react";
import { Results } from "./Results";
import { apiUrl } from "./services/api";
import { activateTemplate, getActiveTemplate, getTemplate, listTemplates } from "./templates/api";
import { rememberTemplate, type Template, type TemplateSummary } from "./templates/types";
import type { Catalog, ServerConfig, StoredDocument } from "./types";
import { UploadPanel, type QueueItem } from "./UploadPanel";
import { useJob } from "./useJob";

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
  const { job, liveError } = useJob(jobId);
  const runningId = useRef<string | null>(null);
  const chain = useRef<string[]>([]);
  const queueRef = useRef(queue);
  const templateRef = useRef(activeTemplate);

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  useEffect(() => {
    templateRef.current = activeTemplate;
  }, [activeTemplate]);

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
        if (!configResponse.ok || !catalogResponse.ok) throw new Error("unavailable");
        if (!cancelled) {
          setConfig((await configResponse.json()) as ServerConfig);
          setCatalog((await catalogResponse.json()) as Catalog);
          setTemplates(rows);
          if (active) {
            rememberTemplate(active);
            setActiveTemplate(active);
          } else {
            setActiveTemplate(null);
          }
          void loadDocuments();
          setOffline(false);
        }
      } catch {
        if (!cancelled) setOffline(true);
      }
    };
    void load();
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
          error?: { message?: string };
        } | null;
        if (!response.ok || !payload?.id) {
          throw new Error(payload?.error?.message || "Upload failed.");
        }
        void loadDocuments();
        setJobId(payload.id);
        setQueue((current) =>
          current.map((row) => (row.id === itemId ? { ...row, jobId: payload.id } : row)),
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
              }
            : item,
        ),
      );
      runningId.current = null;
      setUploading(false);
      const nextId = chain.current.shift();
      if (nextId) void startExtract(nextId);
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
  }, [job, startExtract]);

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
          onInspect={(itemId) => {
            const item = queue.find((row) => row.id === itemId);
            if (!item?.jobId) return;
            setPreviewFile(item.file);
            setJobId(item.jobId);
            setInspecting(true);
          }}
          onRemove={(itemId) => {
            setQueue((current) => current.filter((item) => item.id !== itemId));
          }}
        />
      )}

      {inspecting && job && (
        <Results
          catalog={catalog}
          job={job}
          documents={documents}
          previewFile={previewFile}
          backLabel="Back to Ingest Queue"
          onBack={() => setInspecting(false)}
          onNextDocument={() => setInspecting(false)}
        />
      )}
    </main>
  );
};
