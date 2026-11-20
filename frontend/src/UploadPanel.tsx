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
  /** Temporary compressed file waiting in local storage. */
  stagedId?: string;
  compressed?: boolean;
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
  activeTemplate: { id?: string; name: string } | null;
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
  const busy =
    uploading ||
    driveLoading ||
    job?.status === "running" ||
    queue.some((item) => item.status === "running" || item.status === "uploaded");
  const readyCount = queue.filter(
    (item) => item.status === "ready" && (item.file || item.stagedId) && !item.permanentlyFailed,
  ).length;
  const savableCount = queue.filter((item) => {
    if (item.saved) return false;
    if (item.status === "done") {
      return typeof item.documentId === "number" || (item.documentIds?.length ?? 0) > 0;
    }
    return item.status === "error" && Boolean(item.stagedId || item.batchId);
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

  const templateBar = (
    <div className="ingest-toolbar">
      <div className="ingest-template">
        <span
          className={activeTemplate ? "ingest-status-dot on" : "ingest-status-dot"}
          aria-hidden="true"
          title={activeTemplate ? "Template in use" : "No active template"}
        />
        <span className="ingest-template-label">Template</span>
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
  );

  return (
    <div className="ingest">
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
          <div className="ingest-template-picker">
            <span className="ingest-choice active">
              <span className="ingest-choice-dot" aria-hidden="true" />
              {activeTemplate?.name ?? "No template selected"}
            </span>
          </div>
          <div className="ingest-drop-lead">
            <span className="ingest-drop-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M12 16V7" strokeLinecap="round" />
                <path d="M8.5 10.5 12 7l3.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M6 16.5a4 4 0 0 1 .4-7.2A5.5 5.5 0 0 1 17 9.2 3.5 3.5 0 0 1 18 16.5" strokeLinecap="round" />
              </svg>
            </span>
            <p className="ingest-drop-kicker">Upload</p>
            <h2>Drop files or a folder.</h2>
            <p>PDF, PNG, JPG, DOCX, XLSX, CSV. Folders included.</p>
            <button type="button" className="ingest-try" onClick={() => fileRef.current?.click()}>
              Try an example
            </button>
            <div className="ingest-samples">
              {SAMPLE_CHIPS.map((name) => (
                <button
                  key={name}
                  type="button"
                  className="ingest-sample"
                  title="Browse your own file"
                  onClick={() => fileRef.current?.click()}
                >
                  <DocTypeIcon fileName={name} size={16} />
                  {name}
                </button>
              ))}
            </div>
          </div>
          <div className="ingest-drop-panel">
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
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v8A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5v-10Z" />
                </svg>
                Browse files
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
          <div className="ingest-or" role="separator">
            <span>or import from drive</span>
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
          </div>
        </div>
      ) : null}

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
        <section className="ingest-board">
          <div className="ingest-board-top">
            {templateBar}
            <form
              className="ingest-drive queue"
              onSubmit={(event) => {
                event.preventDefault();
                void loadDrive();
              }}
            >
              <label className="ingest-drive-field">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M10 13a5 5 0 0 0 7.1.1l2.2-2.2a5 5 0 0 0-7.1-7.1l-1.2 1.2" />
                  <path d="M14 11a5 5 0 0 0-7.1-.1L4.7 13a5 5 0 0 0 7.1 7.1l1.1-1.1" />
                </svg>
                <input
                  type="url"
                  value={driveUrl}
                  onChange={(event) => setDriveUrl(event.target.value)}
                  placeholder="Paste a Google Drive folder or file link"
                  aria-label="Google Drive link"
                  disabled={driveLoading}
                />
              </label>
              <button type="submit" className="ingest-secondary" disabled={!driveUrl.trim() || driveLoading}>
                {driveLoading ? "Loading Drive…" : "Load from Drive"}
              </button>
            </form>
          </div>
          <div className="ingest-queue">
          <header className="ingest-queue-head">
            <h3>
              Active Upload Queue
              <span className="ingest-queue-count">
                {queue.length} file{queue.length === 1 ? "" : "s"}
              </span>
            </h3>
            <div className="ingest-queue-tools">
              <button
                type="button"
                className="ingest-tool"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
              >
                + Add files
              </button>
              <button
                type="button"
                className="ingest-tool"
                disabled={busy}
                onClick={() => folderRef.current?.click()}
              >
                + Add folder
              </button>
              {savableCount > 0 && (
                <button
                  type="button"
                  className="ingest-tool"
                  disabled={!canSave}
                  onClick={onSave}
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              )}
              <button
                type="button"
                className="ingest-tool solid"
                disabled={!readyCount || busy}
                onClick={onExtractAll}
              >
                Extract All
              </button>
            </div>
          </header>

          <ul className="ingest-queue-list">
            {queue.map((item) => {
              const name = queueItemName(item);
              const sizeLabel = queueItemSizeLabel(item);
              const isBatch = item.kind === "batch" || Boolean(item.batchId);
              const compressed = Boolean(item.compressed || item.zipFileName);
              const ext = (name.includes(".") ? name.split(".").pop() : "file")?.slice(0, 4).toUpperCase() || "FILE";
              const percent = Math.min(
                100,
                Math.max(
                  0,
                  Math.round(
                    item.progress || (job && job.id === item.jobId ? job.progress : 0) || (item.status === "running" ? 8 : 0),
                  ),
                ),
              );
              return (
                <li key={item.id} className={`ingest-queue-row status-${item.status}`}>
                  <div className="ingest-queue-file">
                    <span className="ingest-ext" aria-hidden="true">{ext}</span>
                    <div>
                      <strong>{name}</strong>
                      <span>
                        {sizeLabel}
                        {isBatch && item.fileCount
                          ? `${sizeLabel ? " · " : ""}${item.fileCount} file${item.fileCount === 1 ? "" : "s"}`
                          : ""}
                        {item.status === "ready" && compressed ? " · Compressed" : ""}
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
                        <div
                          className="ingest-progress"
                          role="progressbar"
                          aria-valuenow={percent}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label={`${percent} percent extracted`}
                        >
                          <svg viewBox="0 0 40 40" aria-hidden="true">
                            <circle className="ingest-progress-track" cx="20" cy="20" r="15.5" />
                            <circle
                              className="ingest-progress-fill"
                              cx="20"
                              cy="20"
                              r="15.5"
                              style={{
                                strokeDasharray: `${2 * Math.PI * 15.5}`,
                                strokeDashoffset: `${2 * Math.PI * 15.5 * (1 - percent / 100)}`,
                              }}
                            />
                          </svg>
                          <strong className="ingest-progress-value">{percent}%</strong>
                        </div>
                        <span className="ingest-pill running">
                          {item.attempts && item.attempts > 1
                            ? `Try ${item.attempts}/${EXTRACTION_MAX_ATTEMPTS}`
                            : "Processing"}
                        </span>
                      </div>
                    )}
                    {item.status === "done" && (
                      <span className={`ingest-pill done${item.saved ? " saved" : ""}`}>
                        <span className="ingest-pill-mark" aria-hidden="true">
                          <svg viewBox="0 0 16 16" width="11" height="11">
                            <path d="M3.2 8.2 6.3 11.2 12.8 4.6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </span>
                        {item.saved
                          ? "Saved"
                          : compressed
                            ? "Complete"
                            : `${item.fieldCount ?? 0} fields${
                                item.confidence != null ? ` · ${item.confidence}%` : ""
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
                    <span className="ingest-template-dot" aria-hidden="true" />
                    {activeTemplate?.name ?? "No template"}
                  </div>

                  <div className="ingest-queue-actions">
                    {item.status === "ready" && (item.file || item.stagedId || item.batchId) && (
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
                        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                          <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                    )}
                    {item.status === "done" && isBatch && item.documentId != null && (
                      <button type="button" className="ingest-row-btn ghost" onClick={() => onInspect(item.id)}>
                        Inspect Results
                        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                          <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
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
          </div>
        </section>
      )}
    </div>
  );
};
