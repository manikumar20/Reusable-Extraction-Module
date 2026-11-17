import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import DocTypeIcon from "./components/DocTypeIcon";
import { extensionOf, FALLBACK_ACCEPT } from "./format";
import { EXTRACTION_MAX_ATTEMPTS } from "./services/extractionSlotQueue";
import type { Job, ServerConfig } from "./types";

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
  zipFileName?: string;
  fileCount?: number;
  /** Extraction attempts used by the slot FIFO scheduler (max 3). */
  attempts?: number;
  permanentlyFailed?: boolean;
};

type UploadPanelProps = {
  config: ServerConfig | null;
  job: Job | null;
  uploading: boolean;
  uploadError: string;
  liveError: string;
  activeTemplate: { name: string } | null;
  queue: QueueItem[];
  saving?: boolean;
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

type DropEntry = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (success: (file: File) => void, error?: (reason: DOMException) => void) => void;
  createReader?: () => {
    readEntries: (
      success: (entries: DropEntry[]) => void,
      error?: (reason: DOMException) => void,
    ) => void;
  };
};

const entryOf = (item: DataTransferItem) => {
  const reader = item as DataTransferItem & { webkitGetAsEntry?: () => DropEntry | null };
  return reader.webkitGetAsEntry?.() ?? null;
};

const readDirectory = (entry: DropEntry) =>
  new Promise<DropEntry[]>((resolve, reject) => {
    const reader = entry.createReader?.();
    if (!reader) {
      resolve([]);
      return;
    }
    const all: DropEntry[] = [];
    const read = () => {
      reader.readEntries((batch) => {
        if (!batch.length) {
          resolve(all);
          return;
        }
        all.push(...batch);
        read();
      }, reject);
    };
    read();
  });

const filesFromEntry = async (entry: DropEntry, prefix = ""): Promise<File[]> => {
  if (entry.isFile && entry.file) {
    const file = await new Promise<File>((resolve, reject) => entry.file!(resolve, reject));
    if (file.size <= 0) return [];
    const relative = `${prefix}${file.name}`;
    if (!relative || relative === file.name) return [file];
    return [new File([file], relative, { type: file.type, lastModified: file.lastModified })];
  }
  if (!entry.isDirectory) return [];
  const children = await readDirectory(entry);
  const nested = await Promise.all(children.map((child) => filesFromEntry(child, `${prefix}${entry.name}/`)));
  return nested.flat();
};

const filesFromDrop = async (data: DataTransfer) => {
  const entries = [...data.items].map(entryOf).filter((entry): entry is DropEntry => Boolean(entry));
  const folder = entries.some((entry) => entry.isDirectory);
  if (!folder) return { files: filesFromTransfer(data), folder: false };
  const groups = await Promise.all(entries.map((entry) => filesFromEntry(entry)));
  return { files: groups.flat(), folder: true };
};

const IGNORED_NAMES = new Set([".ds_store", "thumbs.db", "desktop.ini"]);

const withFolderPath = (file: File) => {
  const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath?.replace(/\\/g, "/");
  if (!relative || relative === file.name) return file;
  return new File([file], relative, { type: file.type, lastModified: file.lastModified });
};

const isIgnoredFile = (file: File) => {
  const base = file.name.split("/").pop()?.toLowerCase() || "";
  return !base || base.startsWith(".") || IGNORED_NAMES.has(base);
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

export const UploadPanel = ({
  config,
  job,
  uploading,
  uploadError,
  liveError,
  activeTemplate,
  queue,
  saving = false,
  onAddFiles,
  onExtract,
  onExtractAll,
  onSave,
  onImportDrive,
  onInspect,
  onRemove,
}: UploadPanelProps) => {
  const [dragOver, setDragOver] = useState(false);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [localError, setLocalError] = useState("");
  const [driveUrl, setDriveUrl] = useState("");
  const [driveLoading, setDriveLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const folderRef = useRef<HTMLInputElement | null>(null);
  const browseRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const input = folderRef.current;
    if (!input) return;
    input.setAttribute("webkitdirectory", "");
    input.setAttribute("directory", "");
  }, []);

  useEffect(() => {
    if (!browseOpen) return;
    const close = (event: MouseEvent) => {
      if (!browseRef.current?.contains(event.target as Node)) setBrowseOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setBrowseOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [browseOpen]);
  const accept = config?.accept ?? FALLBACK_ACCEPT;
  const maxUpload = config?.maxUploadMb ?? 25;
  const maxImage = config?.maxImageMb ?? 5;
  const busy =
    uploading ||
    driveLoading ||
    job?.status === "running" ||
    queue.some((item) => item.status === "running" || item.status === "uploaded");
  const readyCount = queue.filter((item) => item.status === "ready" && item.kind !== "batch").length;
  const savableCount = queue.filter((item) => {
    if (item.saved) return false;
    if (item.status === "done") {
      return typeof item.documentId === "number" || (item.documentIds?.length ?? 0) > 0;
    }
    return item.status === "error" && Boolean(item.batchId);
  }).length;
  const canSave = savableCount > 0 && !busy && !saving;

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

  const take = (list: FileList | File[] | null, folder = false) => {
    setLocalError("");
    const incoming = [...(list ?? [])].filter((file) => !isIgnoredFile(file));
    const files = folder ? incoming.map(withFolderPath) : incoming;
    if (!files.length) {
      if (folder) setLocalError("That folder has no supported PDF, Word, Excel, text, or image files.");
      return;
    }
    const accepted: File[] = [];
    let skipped = 0;
    for (const file of files) {
      const reason = validate(file);
      if (reason) {
        skipped += 1;
        if (!folder) setLocalError(reason);
        continue;
      }
      accepted.push(file);
    }
    if (accepted.length) onAddFiles(accepted);
    if (folder && !accepted.length) {
      setLocalError("That folder has no supported PDF, Word, Excel, text, or image files.");
    } else if (folder && skipped > 0) {
      setLocalError(`Added ${accepted.length} file${accepted.length === 1 ? "" : "s"}. Skipped ${skipped} unsupported file${skipped === 1 ? "" : "s"}.`);
    }
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
  const extractAllLabel =
    readyCount > 1 ? `Extract All (${readyCount})` : "Extract All";

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
            </span>
          </div>
          {!activeTemplate && (
            <Link className="ingest-template-link" to="/templates">
              Open Templates
            </Link>
          )}
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
            void filesFromDrop(event.dataTransfer)
              .then(({ files, folder }) => take(files, folder))
              .catch(() => setLocalError("Could not read that folder. Use Browse, then choose Folder."));
          }}
        >
          <div className="ingest-drop-icon" aria-hidden="true">
            <span />
          </div>
          <h2>Drop files or a folder here to extract structured fields.</h2>
          <p>
            Supports PDF, PNG, JPG, DOCX, XLSX, CSV · folders included · up to {Math.max(maxUpload, maxImage)}MB each
          </p>
          <div className="ingest-drop-actions">
            <div className="browse-wrap" ref={browseRef}>
              <button
                type="button"
                className="ingest-browse"
                disabled={busy}
                aria-expanded={browseOpen}
                aria-haspopup="menu"
                onClick={() => setBrowseOpen((open) => !open)}
              >
                Browse
              </button>
              {browseOpen ? (
                <div className="browse-menu" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setBrowseOpen(false);
                      fileRef.current?.click();
                    }}
                  >
                    Files and images
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setBrowseOpen(false);
                      folderRef.current?.click();
                    }}
                  >
                    Folder
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setBrowseOpen(false);
                      void pasteClipboard();
                    }}
                  >
                    Image or URL
                  </button>
                </div>
              ) : null}
            </div>
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
        multiple
        hidden
        accept={accept.join(",")}
        onChange={(event) => {
          take(event.target.files);
          event.target.value = "";
        }}
      />
      <input
        ref={folderRef}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          take(event.target.files, true);
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
              Active Upload Queue <span>({queue.length})</span>
            </h3>
            <div className="ingest-queue-tools">
              <button
                type="button"
                className="ingest-browse"
                disabled={!readyCount || busy}
                onClick={onExtractAll}
              >
                {extractAllLabel}
              </button>
              {savableCount > 0 && (
                <button
                  type="button"
                  className="ingest-browse"
                  disabled={!canSave}
                  onClick={onSave}
                >
                  {saving ? "Saving…" : `Save${savableCount > 1 ? ` (${savableCount})` : ""}`}
                </button>
              )}
              <button
                type="button"
                className="ingest-add-files"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
              >
                <span className="app-btn-plus" aria-hidden="true">+</span>
                Add files
              </button>
              <button
                type="button"
                className="ingest-add-files"
                disabled={busy}
                onClick={() => folderRef.current?.click()}
              >
                <span className="app-btn-plus" aria-hidden="true">+</span>
                Add folder
              </button>
            </div>
          </header>

          <ul className="ingest-queue-list">
            {queue.map((item) => {
              const name = queueItemName(item);
              const sizeLabel = queueItemSizeLabel(item);
              const isBatch = item.kind === "batch" || Boolean(item.batchId);
              return (
                <li key={item.id} className={`ingest-queue-row status-${item.status}`}>
                  <div className="ingest-queue-file">
                    <span className="ingest-queue-mark" aria-hidden="true">
                      <DocTypeIcon fileName={name} size={28} />
                    </span>
                    <div>
                      <strong>{name}</strong>
                      <span>
                        {sizeLabel}
                        {isBatch && item.fileCount
                          ? `${sizeLabel ? " · " : ""}${item.fileCount} file${item.fileCount === 1 ? "" : "s"}`
                          : ""}
                      </span>
                    </div>
                  </div>

                  <div className="ingest-queue-status">
                    {item.status === "ready" && <span className="ingest-pill ready">Ready</span>}
                    {item.status === "uploaded" && (
                      <span className="ingest-pill running">Queued</span>
                    )}
                    {item.status === "running" && (
                      <div className="ingest-running">
                        <span className="ingest-pill running">
                          {item.attempts && item.attempts > 1
                            ? `Processing · try ${item.attempts}/${EXTRACTION_MAX_ATTEMPTS}…`
                            : isBatch
                              ? "Processing…"
                              : job && job.id === item.jobId
                                ? phaseLabel(job)
                                : "Processing…"}
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
                          : isBatch
                            ? `✓ Complete · ${item.fileCount ?? 0} file${(item.fileCount ?? 0) === 1 ? "" : "s"}`
                            : `✓ ${item.fieldCount ?? 0} fields extracted${
                                item.confidence != null ? `, ${item.confidence}% confidence` : ""
                              }`}
                      </span>
                    )}
                    {item.status === "cancelled" && (
                      <span className="ingest-pill error">Cancelled</span>
                    )}
                    {item.status === "error" && (
                      <span className="ingest-pill error" title={item.message || "Failed"}>
                        {item.permanentlyFailed
                          ? item.message || "Failed after 3 attempts"
                          : item.message || "Failed"}
                      </span>
                    )}
                  </div>

                  <div className="ingest-queue-template">
                    {activeTemplate?.name ?? "—"}
                  </div>

                  <div className="ingest-queue-actions">
                    {item.status === "ready" && !isBatch && (
                      <button
                        type="button"
                        className="ingest-row-btn"
                        disabled={busy}
                        onClick={() => onExtract(item.id)}
                      >
                        Extract Fields
                      </button>
                    )}
                    {item.status === "done" && !isBatch && (
                      <button type="button" className="ingest-row-btn ghost" onClick={() => onInspect(item.id)}>
                        Inspect Results
                      </button>
                    )}
                    {item.status === "done" && isBatch && item.documentId != null && (
                      <button type="button" className="ingest-row-btn ghost" onClick={() => onInspect(item.id)}>
                        Inspect Results
                      </button>
                    )}
                    {item.status !== "running" && item.status !== "uploaded" && (
                      <button
                        type="button"
                        className="ingest-row-x"
                        aria-label={`Remove ${name}`}
                        onClick={() => onRemove(item.id)}
                      >
                        ×
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
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
