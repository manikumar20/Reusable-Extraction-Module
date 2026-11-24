import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { QueueRow } from "@/components/extract/QueueRow";
import {
  matchesQueueFilter,
  queueItemName,
  queueStatusCounts,
  type QueueFilter,
  type QueueItem,
} from "@/components/extract/queueUtils";
import { extensionOf, FALLBACK_ACCEPT } from "@/lib/format";
import type { Job, ServerConfig } from "@/types";

export type { QueueItem } from "@/components/extract/queueUtils";
export { queueItemName, queueItemSizeLabel } from "@/components/extract/queueUtils";

const QUEUE_CARD_HEIGHT = 56;
const QUEUE_ROW_GAP = 0;
const QUEUE_ROW_HEIGHT = QUEUE_CARD_HEIGHT + QUEUE_ROW_GAP;
const QUEUE_VIEWPORT_MIN_HEIGHT = 220;
const QUEUE_OVERSCAN = 6;

type QueueSort = "added" | "name";

const FILTER_OPTIONS: { id: QueueFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "ready", label: "Ready" },
  { id: "processing", label: "Processing" },
  { id: "done", label: "Done" },
  { id: "failed", label: "Failed" },
];

type UploadPanelProps = {
  config: ServerConfig | null;
  job: Job | null;
  uploading: boolean;
  uploadError: string;
  liveError: string;
  activeTemplate: { id?: string; name: string; fields?: readonly unknown[] } | null;
  queue: QueueItem[];
  saving?: boolean;
  onAddFiles: (files: File[]) => void;
  onExtract: (itemId: string) => void;
  onExtractAll: () => void;
  onSave: () => void;
  onImportDrive: (url: string) => Promise<void>;
  onConnectOneDrive?: () => Promise<void>;
  onFetchOneDriveLink?: (url: string) => Promise<void>;
  onDisconnectOneDrive?: () => Promise<void>;
  oneDriveConnected?: boolean;
  oneDriveAccount?: string;
  onInspect: (itemId: string) => void;
  onRemove: (itemId: string) => void;
  onDismissError?: () => void;
};

const TYPE_CHIPS = ["PDF", "PNG", "JPG", "DOCX", "XLSX", "CSV"];

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

const entryOf = (item: DataTransferItem): DropEntry | null => {
  const entry = item.webkitGetAsEntry?.() ?? null;
  return entry ? (entry as unknown as DropEntry) : null;
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
  onConnectOneDrive,
  onFetchOneDriveLink,
  onDisconnectOneDrive,
  oneDriveConnected = false,
  oneDriveAccount = "",
  onInspect,
  onRemove,
  onDismissError,
}: UploadPanelProps) => {
  const [dragOver, setDragOver] = useState(false);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [localError, setLocalError] = useState("");
  const [driveUrl, setDriveUrl] = useState("");
  const [driveLoading, setDriveLoading] = useState(false);
  const [oneDriveUrl, setOneDriveUrl] = useState("");
  const [oneDriveBusy, setOneDriveBusy] = useState(false);
  const [queueFilter, setQueueFilter] = useState<QueueFilter>("all");
  const [queueSearch, setQueueSearch] = useState("");
  const [queueSort, setQueueSort] = useState<QueueSort>("added");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [queueScrollTop, setQueueScrollTop] = useState(0);
  const [queueViewportHeight, setQueueViewportHeight] = useState(QUEUE_VIEWPORT_MIN_HEIGHT);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const imageRef = useRef<HTMLInputElement | null>(null);
  const folderRef = useRef<HTMLInputElement | null>(null);
  const browseRef = useRef<HTMLDivElement | null>(null);
  const queueViewportRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const input = folderRef.current;
    if (!input) return;
    input.setAttribute("webkitdirectory", "");
    input.setAttribute("directory", "");
  }, []);

  useEffect(() => {
    if (!browseOpen) return;
    const onPointer = (event: MouseEvent) => {
      if (!browseRef.current?.contains(event.target as Node)) setBrowseOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setBrowseOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [browseOpen]);

  const accept = config?.accept ?? FALLBACK_ACCEPT;
  const busy =
    uploading ||
    driveLoading ||
    oneDriveBusy ||
    job?.status === "running" ||
    queue.some((item) => item.status === "running" || item.status === "uploaded");
  const counts = useMemo(() => queueStatusCounts(queue), [queue]);
  const readyCount = queue.filter(
    (item) => item.status === "ready" && (item.file || item.stagedId) && !item.permanentlyFailed,
  ).length;
  const runningCount = queue.filter((item) => item.status === "running").length;
  const queuedCount = queue.filter((item) => item.status === "uploaded").length;
  const waitingCount = readyCount + queuedCount;
  const savableCount = queue.filter((item) => {
    if (item.saved) return false;
    if (item.status === "done") {
      return typeof item.documentId === "number" || (item.documentIds?.length ?? 0) > 0;
    }
    return item.status === "error" && Boolean(item.stagedId || item.batchId);
  }).length;
  const canSave = savableCount > 0 && !busy && !saving;

  const filteredQueue = useMemo(() => {
    const query = queueSearch.trim().toLowerCase();
    const next = queue.filter((item) => {
      if (!matchesQueueFilter(item, queueFilter)) return false;
      if (!query) return true;
      return queueItemName(item).toLowerCase().includes(query);
    });
    if (queueSort === "name") {
      return [...next].sort((a, b) =>
        queueItemName(a).localeCompare(queueItemName(b), undefined, { sensitivity: "base" }),
      );
    }
    return next;
  }, [queue, queueFilter, queueSearch, queueSort]);

  const extractedCount = counts.done;
  const progressPercent =
    counts.total === 0 ? 0 : Math.min(100, Math.round((extractedCount / counts.total) * 100));

  const allFilteredSelected =
    filteredQueue.length > 0 && filteredQueue.every((item) => selectedIds.has(item.id));

  const virtualRange = useMemo(() => {
    const start = Math.max(0, Math.floor(queueScrollTop / QUEUE_ROW_HEIGHT) - QUEUE_OVERSCAN);
    const end = Math.min(
      filteredQueue.length,
      Math.ceil((queueScrollTop + queueViewportHeight) / QUEUE_ROW_HEIGHT) + QUEUE_OVERSCAN,
    );
    return { start, end };
  }, [filteredQueue.length, queueScrollTop, queueViewportHeight]);

  const visibleQueue = filteredQueue.slice(virtualRange.start, virtualRange.end);

  useEffect(() => {
    setQueueScrollTop(0);
    if (queueViewportRef.current) queueViewportRef.current.scrollTop = 0;
  }, [queueFilter, queueSearch, queueSort]);

  useEffect(() => {
    setSelectedIds((current) => {
      const alive = new Set(queue.map((item) => item.id));
      let changed = false;
      const next = new Set<string>();
      for (const id of current) {
        if (alive.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : current;
    });
  }, [queue]);

  const toggleSelect = (itemId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const toggleSelectAllFiltered = () => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allFilteredSelected) {
        for (const item of filteredQueue) next.delete(item.id);
      } else {
        for (const item of filteredQueue) next.add(item.id);
      }
      return next;
    });
  };

  useEffect(() => {
    const viewport = queueViewportRef.current;
    if (!viewport) return;
    const syncHeight = () => {
      const next = Math.max(QUEUE_VIEWPORT_MIN_HEIGHT, Math.floor(viewport.clientHeight));
      setQueueViewportHeight((current) => (current === next ? current : next));
    };
    syncHeight();
    const observer = new ResizeObserver(syncHeight);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [queue.length]);

  const requestExtractAll = () => {
    if (!readyCount) return;
    if (readyCount > 50) {
      const ok = window.confirm(
        `Extract ${readyCount} files? About 3 run at a time; the rest wait in the queue.`,
      );
      if (!ok) return;
    }
    onExtractAll();
  };

  const connectOneDrive = async () => {
    if (!onConnectOneDrive || oneDriveBusy) return;
    setLocalError("");
    setOneDriveBusy(true);
    try {
      await onConnectOneDrive();
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Could not connect OneDrive.");
      setOneDriveBusy(false);
    }
  };

  const fetchOneDriveLink = async () => {
    const url = oneDriveUrl.trim();
    if (!onFetchOneDriveLink || !url || oneDriveBusy) return;
    setLocalError("");
    setOneDriveBusy(true);
    try {
      await onFetchOneDriveLink(url);
      setOneDriveUrl("");
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Could not fetch OneDrive documents.");
    } finally {
      setOneDriveBusy(false);
    }
  };

  const disconnectOneDrive = async () => {
    if (!onDisconnectOneDrive || oneDriveBusy) return;
    setLocalError("");
    setOneDriveBusy(true);
    try {
      await onDisconnectOneDrive();
      setOneDriveUrl("");
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Could not disconnect OneDrive.");
    } finally {
      setOneDriveBusy(false);
    }
  };

  const loadDrive = async () => {
    const url = driveUrl.trim();
    if (!url || driveLoading) return;
    setLocalError("");
    setDriveLoading(true);
    try {
      await onImportDrive(url);
      setDriveUrl("");
    } catch (error) {
      const raw = error instanceof Error ? error.message : "Could not load that Drive link.";
      setLocalError(
        /failed to fetch/i.test(raw)
          ? "Could not reach the extraction API. Confirm the backend is running, then refresh and try again."
          : raw,
      );
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

  const message = localError || uploadError || liveError;
  const dismissMessage = () => {
    setLocalError("");
    onDismissError?.();
  };

  const renderBrowse = (label: string) => (
    <div className="browse-wrap" ref={browseRef}>
      <button
        type="button"
        className={`ingest-hero-browse${browseOpen ? " open" : ""}`}
        disabled={busy}
        aria-expanded={browseOpen}
        aria-haspopup="menu"
        onClick={() => setBrowseOpen((open) => !open)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v8A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5v-10Z" />
        </svg>
        {label}
        <svg className="ingest-hero-browse-caret" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4 6.2 8 10l4-3.8" />
        </svg>
      </button>
      {browseOpen ? (
        <div className="browse-dropdown" role="menu" aria-label="Browse options">
          <button
            type="button"
            role="menuitem"
            className="browse-dropdown-item"
            onClick={() => {
              setBrowseOpen(false);
              fileRef.current?.click();
            }}
          >
            <strong>Files</strong>
            <span>Any file type</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="browse-dropdown-item"
            onClick={() => {
              setBrowseOpen(false);
              imageRef.current?.click();
            }}
          >
            <strong>Images</strong>
            <span>JPG, PNG, WebP, GIF…</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="browse-dropdown-item"
            onClick={() => {
              setBrowseOpen(false);
              folderRef.current?.click();
            }}
          >
            <strong>Folder</strong>
            <span>Includes subfolders</span>
          </button>
        </div>
      ) : null}
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
          <div className={`ingest-hero${dragOver ? " over" : ""}`}>
            <span className="ingest-hero-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M12 16V7" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" />
                <path d="M8.2 10.2 12 6.4l3.8 3.8" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M6 16.5h12" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </span>
            <h2>Drop files or a folder</h2>
            {renderBrowse("Browse files")}
            <ul className="ingest-types">
              {TYPE_CHIPS.map((type) => (
                <li key={type}>{type}</li>
              ))}
            </ul>
          </div>
          <aside className="ingest-sources">
            <Link
              className="ingest-template-btn"
              to="/templates"
              title={activeTemplate ? `Template in use: ${activeTemplate.name}` : "Choose a template"}
            >
              <span className="ingest-template-btn-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="M7 3.5h7l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-9.5A1.5 1.5 0 0 1 5.5 20V5A1.5 1.5 0 0 1 7 3.5Z" stroke="currentColor" strokeWidth="1.6" />
                  <path d="M14 3.8V8h4" stroke="currentColor" strokeWidth="1.6" />
                  <path d="M8.5 12.5h7M8.5 16h4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </span>
              <span className="ingest-template-btn-copy">
                <strong>{activeTemplate?.name ?? "Choose a template"}</strong>
                <span className="ingest-template-btn-sub">
                  {activeTemplate ? "Template in use" : "No template selected"}
                </span>
              </span>
              <svg className="ingest-template-btn-chevron" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M6 3.5 10.5 8 6 12.5" />
              </svg>
            </Link>

            <section className="ingest-source">
              <div className="ingest-source-head">
                <span className="ingest-source-mark onedrive" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path d="M8.2 17.2h8.4a3.4 3.4 0 0 0 .3-6.8 4.4 4.4 0 0 0-8.4-1.2 3.1 3.1 0 0 0-.3 8Z" />
                  </svg>
                </span>
                <div>
                  <strong>OneDrive</strong>
                  {oneDriveConnected ? (
                    <p className="ingest-account">
                      <span className="ingest-account-dot" aria-hidden="true" />
                      <span>{oneDriveAccount || "Connected"}</span>
                    </p>
                  ) : (
                    <p>Connect a Microsoft account to import</p>
                  )}
                </div>
                {oneDriveConnected ? (
                  <button
                    type="button"
                    className="ingest-disconnect"
                    disabled={oneDriveBusy}
                    onClick={() => void disconnectOneDrive()}
                  >
                    Disconnect
                  </button>
                ) : null}
              </div>
              {oneDriveConnected ? (
                <form
                  className="ingest-source-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void fetchOneDriveLink();
                  }}
                >
                  <input
                    type="url"
                    value={oneDriveUrl}
                    onChange={(event) => setOneDriveUrl(event.target.value)}
                    placeholder="Paste a OneDrive or SharePoint link"
                    aria-label="OneDrive link"
                    disabled={oneDriveBusy}
                  />
                  <button type="submit" className="ingest-fetch" disabled={!oneDriveUrl.trim() || oneDriveBusy || !onFetchOneDriveLink}>
                    {oneDriveBusy ? "Fetching…" : "Fetch"}
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  className="ingest-connect"
                  disabled={oneDriveBusy || !onConnectOneDrive}
                  onClick={() => void connectOneDrive()}
                >
                  {oneDriveBusy ? "Opening Microsoft…" : "Connect OneDrive"}
                </button>
              )}
              <p className="ingest-source-caption">
                {oneDriveConnected
                  ? "Paste a link shared so anyone can open it."
                  : "You’ll be asked to sign in with Microsoft"}
              </p>
            </section>

            <section className="ingest-source">
              <div className="ingest-source-head">
                <span className="ingest-source-mark drive" aria-hidden="true">
                  <svg viewBox="0 0 87.3 78">
                    <path fill="#0066da" d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3L27.5 53H0c0 1.55.4 3.1 1.2 4.5z" />
                    <path fill="#00ac47" d="M43.65 25 29.9 1.2c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44c-.8 1.4-1.2 2.95-1.2 4.5h27.5z" />
                    <path fill="#ea4335" d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.8l5.85 11.5z" />
                    <path fill="#00832d" d="M43.65 25 57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2z" />
                    <path fill="#2684fc" d="M59.8 53H27.5L13.75 76.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" />
                    <path fill="#ffba00" d="M73.4 26.5 60.7 4.5c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25l16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" />
                  </svg>
                </span>
                <div>
                  <strong>Google Drive</strong>
                  <p>Import from a public link</p>
                </div>
              </div>
              <form
                className="ingest-source-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void loadDrive();
                }}
              >
                <input
                  type="url"
                  value={driveUrl}
                  onChange={(event) => setDriveUrl(event.target.value)}
                  placeholder="Paste a Google Drive link"
                  aria-label="Google Drive link"
                  disabled={driveLoading}
                />
                <button type="submit" className="ingest-import" disabled={!driveUrl.trim() || driveLoading}>
                  {driveLoading ? "Importing…" : "Import"}
                </button>
              </form>
              <p className="ingest-source-caption">Link must be shared as “Anyone with the link”</p>
            </section>
          </aside>
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
        ref={imageRef}
        type="file"
        multiple
        hidden
        accept=".jpg,.jpeg,.png,.webp,.gif,image/jpeg,image/png,image/webp,image/gif"
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
        <div className="ingest-toast" role="alert">
          <p>{message}</p>
          <button
            type="button"
            className="ingest-toast-close"
            aria-label="Dismiss notification"
            onClick={dismissMessage}
          >
            ×
          </button>
        </div>
      )}

      {queue.length > 0 && (
        <section className="ingest-board">
          <header className="ingest-queue-head">
            <div className="ingest-queue-title-block">
              <h3>Active upload queue</h3>
              <span className="ingest-queue-count">
                {counts.total} file{counts.total === 1 ? "" : "s"}
              </span>
              {activeTemplate ? (
                <span className="ingest-template-chip" title="Template in use">
                  <span className="ingest-status-dot on" aria-hidden="true" />
                  Template {activeTemplate.name}
                </span>
              ) : (
                <Link className="ingest-template-chip muted" to="/templates">
                  <span className="ingest-status-dot" aria-hidden="true" />
                  Choose template
                </Link>
              )}
            </div>
            <div className="ingest-queue-tools">
              {savableCount > 0 && (
                <button type="button" className="ingest-tool" disabled={!canSave} onClick={onSave}>
                  {saving ? "Saving…" : "Save"}
                </button>
              )}
              <button
                type="button"
                className="ingest-tool solid"
                disabled={!readyCount || busy}
                onClick={requestExtractAll}
              >
                Extract all ({readyCount || counts.total})
              </button>
            </div>
          </header>

          <div className="ingest-queue-progress-block" aria-live="polite">
            <div
              className="ingest-queue-progress-track"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progressPercent}
              aria-label="Extraction progress"
            >
              <span style={{ width: `${progressPercent}%` }} />
            </div>
            <div className="ingest-queue-progress-meta">
              <span>
                {extractedCount} of {counts.total} extracted
              </span>
              <span>
                {runningCount} running · {waitingCount} waiting
              </span>
            </div>
          </div>

          <div className="ingest-board-top">
            <label className="ingest-queue-search">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="11" cy="11" r="6.5" />
                <path d="m16.2 16.2 4.3 4.3" />
              </svg>
              <input
                type="search"
                value={queueSearch}
                onChange={(event) => setQueueSearch(event.target.value)}
                placeholder="Search files by name"
                aria-label="Search files by name"
              />
            </label>
            {renderBrowse("Add files")}
          </div>

          <div className="ingest-queue">
            <div className="ingest-queue-filters" role="tablist" aria-label="Filter queue by status">
              {FILTER_OPTIONS.map((option) => {
                const count =
                  option.id === "all"
                    ? counts.total
                    : option.id === "ready"
                      ? counts.ready
                      : option.id === "processing"
                        ? counts.processing
                        : option.id === "done"
                          ? counts.done
                          : counts.failed;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="tab"
                    aria-selected={queueFilter === option.id}
                    className={`ingest-queue-filter${queueFilter === option.id ? " active" : ""}`}
                    onClick={() => setQueueFilter(option.id)}
                  >
                    {option.label} ({count})
                  </button>
                );
              })}
              <label className="ingest-queue-sort">
                <span className="sr-only">Sort queue</span>
                <select
                  value={queueSort}
                  onChange={(event) => setQueueSort(event.target.value as QueueSort)}
                  aria-label="Sort queue"
                >
                  <option value="added">Order added</option>
                  <option value="name">Name A–Z</option>
                </select>
              </label>
            </div>

            <div className="ingest-queue-table-head">
              <label className="ingest-queue-check">
                <input
                  type="checkbox"
                  checked={allFilteredSelected}
                  onChange={toggleSelectAllFiltered}
                  aria-label="Select all visible files"
                />
              </label>
              <span>File</span>
              <span>Status</span>
              <span>Action</span>
            </div>

            <div
              className="ingest-queue-viewport"
              ref={queueViewportRef}
              onScroll={(event) => setQueueScrollTop(event.currentTarget.scrollTop)}
            >
              {filteredQueue.length === 0 ? (
                <p className="ingest-queue-empty">
                  {queue.length === 0
                    ? "No files in the queue yet."
                    : "No files match this search or filter."}
                </p>
              ) : (
                <ul
                  className="ingest-queue-list"
                  style={{
                    height: filteredQueue.length * QUEUE_ROW_HEIGHT,
                    position: "relative",
                  }}
                >
                  {visibleQueue.map((item, index) => {
                    const absoluteIndex = virtualRange.start + index;
                    return (
                      <QueueRow
                        key={item.id}
                        item={item}
                        busy={busy}
                        selected={selectedIds.has(item.id)}
                        onToggleSelect={toggleSelect}
                        onExtract={onExtract}
                        onInspect={onInspect}
                        onRemove={onRemove}
                        style={{
                          position: "absolute",
                          top: absoluteIndex * QUEUE_ROW_HEIGHT,
                          left: 0,
                          right: 0,
                          height: QUEUE_CARD_HEIGHT,
                        }}
                      />
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
};
