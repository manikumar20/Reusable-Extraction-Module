import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import DocTypeIcon from "./components/DocTypeIcon";
import { extensionOf, FALLBACK_ACCEPT } from "./format";
import type { Job, ServerConfig } from "./types";
import type { TemplateSummary } from "./templates/types";

export type QueueItem = {
  id: string;
  file: File;
  status: "ready" | "running" | "done" | "error";
  progress: number;
  jobId?: string;
  documentId?: number;
  message?: string;
  fieldCount?: number;
  confidence?: number;
  saved?: boolean;
  /** Completed extraction snapshot — used by Inspect Results even after SSE closes. */
  result?: Job;
};

type UploadPanelProps = {
  config: ServerConfig | null;
  job: Job | null;
  uploading: boolean;
  uploadError: string;
  liveError: string;
  activeTemplate: TemplateSummary | null;
  templates: TemplateSummary[];
  queue: QueueItem[];
  batchMode: boolean;
  saving?: boolean;
  onBatchModeChange: (value: boolean) => void;
  onSelectTemplate: (id: string) => void;
  onAddFiles: (files: File[]) => void;
  onExtract: (itemId: string) => void;
  onExtractAll: () => void;
  onSave: () => void;
  onImportDrive: (url: string) => Promise<void>;
  onInspect: (itemId: string) => void;
  onRemove: (itemId: string) => void;
};

const SAMPLE_CHIPS = ["Acme Invoice.pdf", "Lab Blood Report.pdf", "Store Receipt.png"];

const IMAGE_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

const fileFromBlob = (blob: Blob, name?: string) => {
  const ext = IMAGE_EXT[blob.type] || "";
  if (!ext) return null;
  const named = name && extensionOf(name) ? name : `clipboard.${ext}`;
  return new File([blob], named, { type: blob.type });
};

const fileFromDataUrl = async (value: string) => {
  const response = await fetch(value);
  return fileFromBlob(await response.blob());
};

const fileFromUrl = async (value: string) => {
  try {
    const response = await fetch(value);
    if (!response.ok) return null;
    const blob = await response.blob();
    if (!IMAGE_EXT[blob.type]) return null;
    const pathName = new URL(value).pathname.split("/").pop() || "";
    return fileFromBlob(blob, decodeURIComponent(pathName));
  } catch {
    return null;
  }
};

const filesFromTransfer = (data: DataTransfer | null) => {
  if (!data) return [];
  const direct = [...data.files].filter((file) => file.size > 0);
  if (direct.length) return direct;
  const files: File[] = [];
  for (const item of data.items) {
    if (!IMAGE_EXT[item.type]) continue;
    const blob = item.getAsFile();
    const file = blob ? fileFromBlob(blob) : null;
    if (file) files.push(file);
  }
  return files;
};

const filesFromClipboard = async () => {
  const files: File[] = [];
  let readError: unknown = null;
  if (navigator.clipboard?.read) {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find((entry) => IMAGE_EXT[entry]);
        if (!type) continue;
        const file = fileFromBlob(await item.getType(type));
        if (file) files.push(file);
      }
      if (files.length) return files;
      for (const item of items) {
        if (!item.types.includes("text/html")) continue;
        const html = await (await item.getType("text/html")).text();
        const src = html.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1];
        if (!src) continue;
        const file = src.startsWith("data:image/")
          ? await fileFromDataUrl(src).catch(() => null)
          : await fileFromUrl(src).catch(() => null);
        if (file) return [file];
      }
    } catch (error) {
      readError = error;
    }
  }
  try {
    const text = (await navigator.clipboard.readText()).trim();
    if (text.startsWith("data:image/")) {
      const file = await fileFromDataUrl(text);
      if (file) return [file];
    }
    if (/^https?:\/\//i.test(text)) {
      const file = await fileFromUrl(text);
      if (file) return [file];
    }
  } catch (error) {
    if (readError) throw readError;
    throw error;
  }
  if (readError && !files.length) throw readError;
  return files;
};

export const UploadPanel = ({
  config,
  job,
  uploading,
  uploadError,
  liveError,
  activeTemplate,
  templates,
  queue,
  batchMode,
  saving = false,
  onBatchModeChange,
  onSelectTemplate,
  onAddFiles,
  onExtract,
  onExtractAll,
  onSave,
  onImportDrive,
  onInspect,
  onRemove,
}: UploadPanelProps) => {
  const [dragOver, setDragOver] = useState(false);
  const [localError, setLocalError] = useState("");
  const [driveUrl, setDriveUrl] = useState("");
  const [driveLoading, setDriveLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const accept = config?.accept ?? FALLBACK_ACCEPT;
  const maxUpload = config?.maxUploadMb ?? 25;
  const maxImage = config?.maxImageMb ?? 5;
  const busy =
    uploading ||
    driveLoading ||
    job?.status === "running" ||
    queue.some((item) => item.status === "running");
  const readyCount = queue.filter((item) => item.status === "ready").length;
  const doneCount = queue.filter((item) => item.status === "done" && !item.saved).length;
  const canSave = doneCount > 0 && !busy && !saving;

  const loadDrive = async () => {
    const url = driveUrl.trim();
    if (!url || driveLoading) return;
    setLocalError("");
    setDriveLoading(true);
    try {
      await onImportDrive(url);
      setDriveUrl("");
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Could not load Google Drive files.");
    } finally {
      setDriveLoading(false);
    }
  };

  const validate = (file: File) => {
    const ext = extensionOf(file.name);
    if (!accept.includes(ext)) return "Use a PDF, Word, Excel, text, or image file.";
    const image = [".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(ext);
    const limit = (image ? maxImage : maxUpload) * 1024 * 1024;
    if (file.size > limit) {
      return image
        ? `Images must be ${maxImage} MB or smaller.`
        : `File is larger than ${maxUpload} MB.`;
    }
    return "";
  };

  const take = (list: FileList | File[] | null) => {
    setLocalError("");
    const files = [...(list ?? [])];
    if (!files.length) return;
    const accepted: File[] = [];
    for (const file of files) {
      const reason = validate(file);
      if (reason) {
        setLocalError(reason);
        continue;
      }
      accepted.push(file);
    }
    if (accepted.length) onAddFiles(accepted);
  };

  const takeRef = useRef(take);
  takeRef.current = take;

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        (target.closest("input, textarea, select") || (target instanceof HTMLElement && target.isContentEditable))
      ) {
        return;
      }
      const files = filesFromTransfer(event.clipboardData);
      if (!files.length) return;
      event.preventDefault();
      takeRef.current(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  const pasteClipboard = async () => {
    setLocalError("");
    try {
      const files = await filesFromClipboard();
      if (!files.length) {
        setLocalError("Copy an image or an image link, then paste again. Ctrl+V also works.");
        return;
      }
      take(files);
    } catch (error) {
      const blocked = error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError");
      setLocalError(
        blocked
          ? "Allow clipboard access when the browser asks, or press Ctrl+V."
          : "Could not read the clipboard. Press Ctrl+V to paste the image.",
      );
    }
  };

  const message = localError || uploadError || liveError;

  return (
    <div className="ingest">
      <div className="ingest-toolbar">
        <div className="ingest-template">
          <span
            className={activeTemplate ? "ingest-status-dot on" : "ingest-status-dot"}
            aria-hidden="true"
            title={activeTemplate ? "Template in use" : "No active template"}
          />
          <div className="ingest-template-pill">
            <span className="ingest-template-using">
              <strong>{activeTemplate?.name ?? "No template selected"}</strong>
              {activeTemplate ? ` v${activeTemplate.version}` : ""}
            </span>
            <select
              aria-label="Choose active template"
              value={activeTemplate?.id ?? ""}
              onChange={(event) => {
                if (event.target.value) onSelectTemplate(event.target.value);
              }}
            >
              {!activeTemplate && <option value="">Select template…</option>}
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name} v{template.version}
                </option>
              ))}
            </select>
          </div>
          {!activeTemplate && (
            <Link className="ingest-template-link" to="/templates">
              Open Templates
            </Link>
          )}
        </div>

        <div className="ingest-toolbar-actions">
          <label className="ingest-toggle">
            <input
              type="checkbox"
              checked={batchMode}
              onChange={(event) => onBatchModeChange(event.target.checked)}
            />
            <span className="ingest-toggle-track" aria-hidden="true" />
            Group Mode
          </label>
        </div>
      </div>

      {queue.length === 0 ? (
        <div
          className={dragOver ? "ingest-drop over" : "ingest-drop"}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragOver(false);
            take(event.dataTransfer.files);
          }}
        >
          <div className="ingest-drop-icon" aria-hidden="true">
            <span />
          </div>
          <h2>Drop any file here to extract structured fields.</h2>
          <p>
            Supports PDF, PNG, JPG, DOCX, XLSX, CSV · up to {Math.max(maxUpload, maxImage)}MB
          </p>
          <div className="ingest-drop-actions">
            <button
              type="button"
              className="ingest-browse"
              disabled={busy && !batchMode}
              onClick={() => fileRef.current?.click()}
            >
              Browse Files
            </button>
            <button type="button" className="ingest-secondary" onClick={() => void pasteClipboard()}>
              Paste Clipboard Image / URL
            </button>
          </div>
          <form
            className="ingest-drive"
            onSubmit={(event) => {
              event.preventDefault();
              void loadDrive();
            }}
          >
            <input
              type="url"
              value={driveUrl}
              onChange={(event) => setDriveUrl(event.target.value)}
              placeholder="Paste a Google Drive folder or file link"
              aria-label="Google Drive link"
              disabled={driveLoading}
            />
            <button type="submit" className="ingest-secondary" disabled={!driveUrl.trim() || driveLoading}>
              {driveLoading ? "Loading Drive…" : "Load from Drive"}
            </button>
          </form>
          <div className="ingest-samples">
            {SAMPLE_CHIPS.map((name) => (
              <button
                key={name}
                type="button"
                className="ingest-sample"
                title="Sample names are illustrative — browse or drop your own file"
                onClick={() => fileRef.current?.click()}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {queue.length > 0 && (
        <form
          className="ingest-drive queue"
          onSubmit={(event) => {
            event.preventDefault();
            void loadDrive();
          }}
        >
          <input
            type="url"
            value={driveUrl}
            onChange={(event) => setDriveUrl(event.target.value)}
            placeholder="Paste a Google Drive folder or file link"
            aria-label="Google Drive link"
            disabled={driveLoading}
          />
          <button type="submit" className="ingest-secondary" disabled={!driveUrl.trim() || driveLoading}>
            {driveLoading ? "Loading Drive…" : "Load from Drive"}
          </button>
        </form>
      )}
      <input
        ref={fileRef}
        type="file"
        multiple={batchMode}
        hidden
        accept={accept.join(",")}
        onChange={(event) => {
          take(event.target.files);
          event.target.value = "";
        }}
      />

      {message && (
        <p className="error-text stand" role="alert">
          {message}
        </p>
      )}

      {queue.length > 0 && (
        <section className="ingest-queue">
          <header className="ingest-queue-head">
            <h3>
              Active Upload Queue <span>({queue.length} file{queue.length === 1 ? "" : "s"})</span>
            </h3>
            <div className="ingest-queue-tools">
              <button
                type="button"
                className="ingest-browse"
                disabled={!readyCount || busy}
                onClick={onExtractAll}
              >
                Extract All
              </button>
              {doneCount > 0 && (
                <button
                  type="button"
                  className="ingest-browse"
                  disabled={!canSave}
                  onClick={onSave}
                >
                  {saving ? "Saving…" : `Save${doneCount > 1 ? ` (${doneCount})` : ""}`}
                </button>
              )}
              <button
                type="button"
                className="ingest-add-files"
                disabled={busy && !batchMode}
                onClick={() => fileRef.current?.click()}
              >
                <span className="app-btn-plus" aria-hidden="true">+</span>
                Add files
              </button>
            </div>
          </header>

          <ul className="ingest-queue-list">
            {queue.map((item) => (
              <li key={item.id} className={`ingest-queue-row status-${item.status}`}>
                <div className="ingest-queue-file">
                  <span className="ingest-queue-mark" aria-hidden="true">
                    <DocTypeIcon fileName={item.file.name} size={28} />
                  </span>
                  <div>
                    <strong>{item.file.name}</strong>
                    <span>{(item.file.size / 1024).toFixed(0)} KB</span>
                  </div>
                </div>

                <div className="ingest-queue-status">
                  {item.status === "ready" && <span className="ingest-pill ready">Ready</span>}
                  {item.status === "running" && (
                    <div className="ingest-running">
                      <span className="ingest-pill running">
                        {job && job.id === item.jobId ? phaseLabel(job) : "Processing…"}
                      </span>
                      <div className="ingest-progress" aria-hidden="true">
                        <span style={{ width: `${item.progress || job?.progress || 8}%` }} />
                      </div>
                    </div>
                  )}
                  {item.status === "done" && (
                    <span className={`ingest-pill done${item.saved ? " saved" : ""}`}>
                      {item.saved
                        ? "Saved to Documents"
                        : `✓ ${item.fieldCount ?? 0} fields extracted${
                            item.confidence != null ? `, ${item.confidence}% confidence` : ""
                          }`}
                    </span>
                  )}
                  {item.status === "error" && (
                    <span className="ingest-pill error">{item.message || "Failed"}</span>
                  )}
                </div>

                <div className="ingest-queue-template">
                  {activeTemplate?.name ?? "—"}
                </div>

                <div className="ingest-queue-actions">
                  {item.status === "ready" && (
                    <button
                      type="button"
                      className="ingest-row-btn"
                      disabled={busy}
                      onClick={() => onExtract(item.id)}
                    >
                      Extract Fields (AI)
                    </button>
                  )}
                  {item.status === "done" && (
                    <button type="button" className="ingest-row-btn ghost" onClick={() => onInspect(item.id)}>
                      Inspect Results
                    </button>
                  )}
                  {item.status !== "running" && (
                    <button
                      type="button"
                      className="ingest-row-x"
                      aria-label={`Remove ${item.file.name}`}
                      onClick={() => onRemove(item.id)}
                    >
                      ×
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};

const phaseLabel = (job: Job) => {
  if (job.phase === "reading") return "Reading file…";
  if (job.phase === "lines") return "Extracting line items…";
  if (job.phase === "header") return "Reading document header…";
  return `Processing… ${job.progress}%`;
};
