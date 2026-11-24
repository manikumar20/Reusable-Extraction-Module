import { Component, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type MouseEvent, type ReactNode } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  FileJson,
  FileText,
  Minus,
  Plus,
  RotateCcw,
  Search,
  CheckCircle2,
  ArrowLeft,
} from "lucide-react";
import { Document, Page } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import { extensionOf, formatValue } from "@/lib/format";
import "@/lib/pdfWorker";
import {
  boxesForPage,
  clearDocxHighlights,
  hasMappableLocation,
  highlightDocxNeedles,
  highlightNeedlesFor,
  primaryLocation,
  renderMarkedText,
  textMarkRanges,
} from "@/lib/sourceHighlight";
import { apiUrl } from "@/services/client";
import type {
  Catalog,
  ExtraFieldValue,
  ExtractedFieldRow,
  ExtractedLine,
  Job,
  SourceLocation,
  StoredDocument,
} from "@/types";
import { ExcelPreview } from "@/components/extract/ExcelPreview";
import { SourceHighlightLayer } from "@/components/extract/SourceHighlightLayer";

type ResultsProps = {
  catalog: Catalog | null;
  job: Job | null;
  documents: StoredDocument[];
  previewFile?: File | null;
  documentId?: number | null;
  persistedFields?: ExtractedFieldRow[];
  onFieldsChanged?: () => void;
  onBack?: () => void;
  onNextDocument?: () => void;
  backLabel?: string;
};

type Draft = {
  header: Record<string, ExtraFieldValue>;
  lines: ExtractedLine[];
};

type ReviewItem = {
  id: string;
  itemNumber: number;
  label: string;
  value: string;
  details: string;
  confidence: number;
  page: number;
  status: "open" | "accepted" | "flagged";
  sourceSnippet: string;
  scope: "header" | "line" | "custom";
  lineIndex?: number;
  fieldKey?: string;
  /** Persisted extracted_fields.id when saved on the document. */
  fieldId?: string;
  source?: string;
  locations?: SourceLocation[] | null;
};

const ITEM_PAGE_SIZE = 15;

const pageRange = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, index) => from + index);

const paginationItems = (current: number, totalPages: number): Array<number | "ellipsis"> => {
  if (totalPages <= 7) return pageRange(1, totalPages);
  if (current <= 3 || current >= totalPages - 2) {
    return [...pageRange(1, 3), "ellipsis", ...pageRange(totalPages - 2, totalPages)];
  }
  return [1, "ellipsis", current - 1, current, current + 1, "ellipsis", totalPages];
};

const typedText = new WeakMap<ExtractedLine, Map<string, string>>();

const rememberText = (line: ExtractedLine, key: string, value: string) => {
  const bag = typedText.get(line) ?? new Map<string, string>();
  bag.set(key, value);
  typedText.set(line, bag);
  return line;
};

const lineFieldValue = (line: ExtractedLine | null, key: string) => {
  if (!line) return "";
  const typed = typedText.get(line)?.get(key);
  if (typed !== undefined) return typed;
  return formatValue(line.fields?.[key]);
};

const applyLineField = (line: ExtractedLine, key: string, value: string): ExtractedLine => {
  const next = { ...line, fields: { ...line.fields, [key]: value } };
  const previous = typedText.get(line);
  if (previous) typedText.set(next, new Map(previous));
  return rememberText(next, key, value);
};

const fieldConfidence = (value: string, index: number) => {
  if (!value.trim()) return 42 + (index % 7);
  const base = 78 + ((index * 7) % 22);
  return Math.min(99, base);
};

const itemsFromPersisted = (rows: ExtractedFieldRow[]): ReviewItem[] =>
  rows.map((field, index) => {
    const source = (field.source || "AI").toUpperCase();
    const locations = field.sourceLocation?.length ? field.sourceLocation : null;
    const mappedPage = primaryLocation(locations)?.page;
    return {
      id: field.id,
      fieldId: field.id,
      itemNumber: index + 1,
      label: field.fieldName.replace(/#\d+$/, ""),
      value: field.fieldValue,
      details:
        source === "MANUAL"
          ? "Manually added"
          : source === "SUGGESTED"
            ? "Suggested field"
            : "AI extracted",
      confidence: source === "MANUAL" ? 100 : fieldConfidence(field.fieldValue, index),
      page: mappedPage && mappedPage > 0 ? mappedPage : 1,
      status: "open" as const,
      sourceSnippet: locations?.[0]?.quote || field.fieldValue,
      scope: field.fieldKey.includes("#")
        ? ("line" as const)
        : field.fieldKey.startsWith("manual_")
          ? ("custom" as const)
          : ("header" as const),
      fieldKey: field.fieldKey,
      source,
      locations,
    };
  });

const itemsFromJob = (
  job: Job,
  catalogFields: Catalog["header"],
  pages: number,
): ReviewItem[] => {
  const describe = (key: string) => {
    const base = key.replace(/#\d+$/, "");
    const known = catalogFields.find((field) => field.key === base);
    return {
      label: known?.label || labelFromKey(base),
      description: known?.description || "",
    };
  };
  const filled = (value: string) => value.trim() !== "";
  const header = job.header ?? {};
  const lines = job.lines ?? [];
  const next: ReviewItem[] = [];

  for (const [key, raw] of Object.entries(header)) {
    const value =
      typeof raw === "string" || Array.isArray(raw)
        ? formatValue(raw)
        : raw == null
          ? ""
          : String(raw).trim();
    if (!filled(value)) continue;
    const meta = describe(key);
    next.push({
      id: `header:${key}`,
      itemNumber: next.length + 1,
      label: meta.label,
      value,
      details: meta.description || "Header field",
      confidence: fieldConfidence(value, next.length),
      page: 1,
      status: "open",
      sourceSnippet: value,
      scope: "header",
      fieldKey: key,
      source: "AI",
    });
  }

  lines.forEach((line, lineIndex) => {
    for (const key of Object.keys(line.fields ?? {})) {
      const value = lineFieldValue(line, key);
      if (!filled(value)) continue;
      const meta = describe(key);
      const locations = line.locations?.[key]?.length ? line.locations[key] : null;
      const mappedPage = primaryLocation(locations)?.page;
      next.push({
        id: `line:${lineIndex}:${key}`,
        itemNumber: next.length + 1,
        label: lines.length > 1 ? `${meta.label} · L${lineIndex + 1}` : meta.label,
        value,
        details: meta.description || `Line ${lineIndex + 1}`,
        confidence: fieldConfidence(value, next.length),
        page: mappedPage && mappedPage > 0
          ? mappedPage
          : Math.min(pages || 1, 1 + Math.floor(lineIndex / 8)),
        status: "open",
        sourceSnippet: locations?.[0]?.quote || value,
        scope: "line",
        lineIndex,
        fieldKey: key,
        source: "AI",
        locations,
      });
    }
  });

  return next;
};

const downloadBlob = (filename: string, blob: Blob) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

const csvEscape = (value: string) => `"${value.replace(/"/g, '""')}"`;

const labelFromKey = (key: string) =>
  key
    .replace(/#\d+$/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const stem = (fileName: string) => fileName.replace(/\.[^.]+$/, "") || "extract";

const roundZoom = (value: number) => Math.round(value * 10) / 10;

/** A PDF.js failure must not replace the whole review screen with a blank page. */
class PreviewBoundary extends Component<{ children: ReactNode; onError: (message: string) => void }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    this.props.onError(error.message || "This PDF could not be previewed.");
  }

  render() {
    if (this.state.failed) return null;
    return this.props.children;
  }
}

export const Results = ({
  catalog,
  job,
  documents,
  previewFile = null,
  documentId = null,
  persistedFields,
  onFieldsChanged,
  onBack,
  onNextDocument,
  backLabel = "Back to Documents",
}: ResultsProps) => {
  const [draft, setDraft] = useState<Draft | null>(null);
  /** User edits / manual adds; null means show derived extraction results. */
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [dbFields, setDbFields] = useState<ExtractedFieldRow[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [approved, setApproved] = useState(false);
  const [query, setQuery] = useState("");
  const [itemPage, setItemPage] = useState(1);
  const [gotoPage, setGotoPage] = useState("1");
  const [valueTip, setValueTip] = useState<{ text: string; top: number; left: number; above: boolean } | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null);
  const [docxError, setDocxError] = useState("");
  const [pdfError, setPdfError] = useState("");
  const [pdfReady, setPdfReady] = useState(false);
  const [textError, setTextError] = useState("");
  const [textBody, setTextBody] = useState("");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const previewKind = useMemo(() => {
    if (!previewFile) return "none" as const;
    const name = (previewFile.name || job?.fileName || "").toLowerCase().trim();
    const mime = (previewFile.type || "").toLowerCase();
    // Spreadsheets before generic Office/XML — MIME often includes "xml" / "openxml".
    if (
      mime.includes("spreadsheet") ||
      mime.includes("excel") ||
      /\.xlsx?$/i.test(name) ||
      /\.xlsm$/i.test(name)
    ) {
      return "excel" as const;
    }
    // Word/Office first: DOCX MIME contains "xml" and must not be treated as plain text.
    if (
      mime.includes("wordprocessingml") ||
      mime.includes("msword") ||
      /\.docx?$/i.test(name)
    ) {
      return "docx" as const;
    }
    if (mime.includes("pdf") || name.endsWith(".pdf")) return "pdf" as const;
    if (mime.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp)$/i.test(name)) return "image" as const;
    if (
      mime.startsWith("text/") ||
      /\.(txt|csv|tsv|json|xml|md|log|html?)$/i.test(name) ||
      mime === "application/json" ||
      mime === "application/xml" ||
      mime === "text/xml" ||
      mime.includes("csv")
    ) {
      return "text" as const;
    }
    return "none" as const;
  }, [previewFile, job?.fileName]);
  const [zoom, setZoom] = useState(1);
  const [paneWidth, setPaneWidth] = useState(560);
  const [docxReady, setDocxReady] = useState(false);
  const persistTimers = useRef(new Map<string, number>());
  const tableRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const leftPaneRef = useRef<HTMLElement | null>(null);
  const docxHostRef = useRef<HTMLDivElement>(null);
  const textHostRef = useRef<HTMLPreElement>(null);
  const highlightRef = useRef<HTMLElement | null>(null);
  const docxRenderGen = useRef(0);
  const catalogFields = useMemo(
    () => [...(catalog?.header ?? []), ...(catalog?.lines ?? [])],
    [catalog],
  );
  const header = draft?.header ?? job?.header ?? {};

  const derivedItems = useMemo(() => {
    if (persistedFields && persistedFields.length > 0) {
      return itemsFromPersisted(persistedFields);
    }
    if (dbFields && dbFields.length > 0) return itemsFromPersisted(dbFields);
    if (job) return itemsFromJob(job, catalogFields, pages);
    return [];
  }, [persistedFields, dbFields, job, catalogFields, pages]);

  const displayItems = items ?? derivedItems;
  const selectedItem = displayItems.find((item) => item.id === selectedId) ?? null;
  const selectedLocations = selectedItem?.locations ?? null;
  const locationFound = hasMappableLocation(selectedLocations);
  const textMarks = useMemo(
    () => (previewKind === "text" ? textMarkRanges(textBody, selectedLocations) : []),
    [previewKind, textBody, selectedLocations],
  );
  const markedParts = useMemo(
    () => (previewKind === "text" && textBody ? renderMarkedText(textBody, textMarks) : []),
    [previewKind, textBody, textMarks],
  );

  useEffect(() => {
    setItems(null);
    setDbFields(null);
    setDraft(job ? { header: structuredClone(job.header), lines: structuredClone(job.lines) } : null);
    setSelectedId(null);
    setApproved(false);
    setQuery("");
    setItemPage(1);
    setPage(1);
    setZoom(1);
    setExportOpen(false);
    setTextBody("");
    for (const timer of persistTimers.current.values()) window.clearTimeout(timer);
    persistTimers.current.clear();
  }, [job?.id, documentId]);

  useEffect(() => {
    if (!selectedId && displayItems[0]) setSelectedId(displayItems[0].id);
  }, [displayItems, selectedId]);

  // Load saved fields from Documents DB — source of truth after extraction.
  useEffect(() => {
    if (!documentId) return;
    if (persistedFields && persistedFields.length > 0) return;
    let cancelled = false;
    const load = async (attempt = 0) => {
      try {
        const response = await fetch(apiUrl(`/documents/${documentId}/fields`));
        if (!response.ok || cancelled) return;
        const payload = (await response.json()) as { fields?: ExtractedFieldRow[] };
        const rows = payload.fields ?? [];
        if (!rows.length && attempt < 5) {
          window.setTimeout(() => void load(attempt + 1), 600);
          return;
        }
        if (cancelled) return;
        setDbFields(rows);
      } catch {
        if (!cancelled && attempt < 5) {
          window.setTimeout(() => void load(attempt + 1), 600);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [documentId, job?.id, job?.status, persistedFields]);

  useEffect(() => {
    setDocxError("");
    setPdfError("");
    setPdfReady(false);
    setPdfData(null);
    setTextError("");
    setPage(1);
    setPages(1);
    if (!previewFile || previewFile.size === 0 || previewKind === "text" || previewKind === "none") {
      setPreviewUrl(null);
      return;
    }
    let url: string | null = null;
    let cancelled = false;
    try {
      const source =
        previewKind === "pdf" && !previewFile.type.toLowerCase().includes("pdf")
          ? new Blob([previewFile], { type: "application/pdf" })
          : previewFile;
      url = URL.createObjectURL(source);
      setPreviewUrl(url);
    } catch (error) {
      setPreviewUrl(null);
      if (previewKind === "pdf") {
        setPdfError(error instanceof Error ? error.message : "The PDF file could not be opened.");
      }
    }

    if (previewKind === "pdf") {
      void previewFile
        .arrayBuffer()
        .then((buffer) => {
          if (cancelled) return;
          setPdfData(new Uint8Array(buffer));
        })
        .catch((error) => {
          if (cancelled) return;
          setPdfError(error instanceof Error ? error.message : "The PDF file could not be read.");
        });
    }

    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [previewFile, previewKind]);

  // Surface worker hangs instead of staying on "Opening PDF…" forever.
  useEffect(() => {
    if (previewKind !== "pdf" || !pdfData || pdfReady || pdfError) return;
    const timer = window.setTimeout(() => {
      setPdfError("PDF canvas preview timed out — using the browser viewer instead.");
    }, 12_000);
    return () => window.clearTimeout(timer);
  }, [previewKind, pdfData, pdfReady, pdfError]);

  useEffect(() => {
    if (previewKind !== "docx" || !previewFile) {
      setDocxReady(false);
      return;
    }

    let cancelled = false;
    const gen = ++docxRenderGen.current;
    setDocxReady(false);
    setDocxError("");

    const frame = window.requestAnimationFrame(() => {
      const host = docxHostRef.current;
      if (!host || cancelled) return;
      host.innerHTML = "";
      // Dedicated style root so injected Word CSS stays scoped and intact.
      let styleRoot = host.querySelector<HTMLElement>("[data-docx-style-root]");
      if (!styleRoot) {
        styleRoot = document.createElement("div");
        styleRoot.setAttribute("data-docx-style-root", "true");
        styleRoot.hidden = true;
        host.appendChild(styleRoot);
      } else {
        styleRoot.innerHTML = "";
      }
      let bodyRoot = host.querySelector<HTMLElement>("[data-docx-body-root]");
      if (!bodyRoot) {
        bodyRoot = document.createElement("div");
        bodyRoot.setAttribute("data-docx-body-root", "true");
        bodyRoot.className = "docx-body-root";
        host.appendChild(bodyRoot);
      } else {
        bodyRoot.innerHTML = "";
      }

      void (async () => {
        try {
          const { renderAsync } = await import("docx-preview");
          const buffer = await previewFile.arrayBuffer();
          if (cancelled || gen !== docxRenderGen.current || !docxHostRef.current) return;
          // Default className "docx" so library wrapper/page CSS selectors match.
          // Never set ignoreWidth/ignoreHeight — that collapses tables and wrapping.
          await renderAsync(buffer, bodyRoot!, styleRoot!, {
            className: "docx",
            inWrapper: true,
            ignoreWidth: false,
            ignoreHeight: false,
            breakPages: true,
            ignoreLastRenderedPageBreak: true,
            renderHeaders: true,
            renderFooters: true,
            renderFootnotes: true,
            renderEndnotes: true,
            renderAltChunks: true,
            experimental: true,
            useBase64URL: true,
          });
          if (cancelled || gen !== docxRenderGen.current) return;
          setDocxReady(true);
        } catch (reason) {
          if (!cancelled && gen === docxRenderGen.current) {
            setDocxReady(false);
            setDocxError(reason instanceof Error ? reason.message : "Word document could not be previewed.");
          }
        }
      })();
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      if (docxHostRef.current) docxHostRef.current.innerHTML = "";
    };
  }, [previewFile, previewKind]);

  useEffect(() => {
    if (previewKind !== "text" || !previewFile) return;
    let cancelled = false;
    setTextError("");
    setTextBody("");
    void previewFile.text().then((body) => {
      if (cancelled) return;
      setTextBody(body);
    }).catch((reason) => {
      if (!cancelled) {
        setTextError(reason instanceof Error ? reason.message : "Text file could not be previewed.");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [previewFile, previewKind]);

  // Scroll active text/PDF highlight into view after selection / when PDF pages finish loading.
  useEffect(() => {
    if (!selectedId) return;
    const mappedPage = primaryLocation(selectedLocations)?.page;
    if (previewKind === "pdf" && pdfReady && mappedPage) {
      const targetPage = Math.max(1, mappedPage);
      setPage(targetPage);
      const frame = window.requestAnimationFrame(() => {
        const pageNode = viewerRef.current?.querySelector<HTMLElement>(
          `[data-doc-page="${targetPage}"]`,
        );
        const activeBox = pageNode?.querySelector<HTMLElement>("[data-src-hl='active']");
        (activeBox ?? pageNode)?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      return () => window.cancelAnimationFrame(frame);
    }
    const frame = window.requestAnimationFrame(() => {
      highlightRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedId, selectedLocations, page, previewKind, textBody, pdfReady]);

  // Highlight extracted field values inside the rendered DOCX (text may span many Word runs).
  useEffect(() => {
    if (previewKind !== "docx" || !docxReady || !docxHostRef.current) return;
    const host = docxHostRef.current;
    clearDocxHighlights(host);

    const needles = highlightNeedlesFor(selectedLocations, selectedItem?.value);
    if (!needles.length) return;

    const timer = window.setTimeout(() => {
      if (!docxHostRef.current) return;
      const mark = highlightDocxNeedles(docxHostRef.current, needles);
      if (!mark) return;
      highlightRef.current = mark;
      mark.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 40);

    return () => window.clearTimeout(timer);
  }, [previewKind, docxReady, selectedId, selectedLocations, selectedItem?.value]);

  useEffect(() => {
    const node = viewerRef.current ?? leftPaneRef.current;
    if (!node) return;
    const measure = () => {
      const width = viewerRef.current?.clientWidth ?? leftPaneRef.current?.clientWidth ?? 560;
      setPaneWidth(Math.max(240, width - 32));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    if (viewerRef.current && leftPaneRef.current && viewerRef.current !== leftPaneRef.current) {
      observer.observe(leftPaneRef.current);
    }
    return () => observer.disconnect();
  }, [previewKind]);

  const visibleItems = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return displayItems.filter((item) => {
      if (item.status === "deleted" as ReviewItem["status"]) return false;
      if (!needle) return true;
      return `${item.label} ${item.value} ${item.details}`.toLowerCase().includes(needle);
    });
  }, [displayItems, query]);

  const itemPageCount = Math.max(1, Math.ceil(visibleItems.length / ITEM_PAGE_SIZE));
  const itemPageSafe = Math.min(itemPage, itemPageCount);
  const pagedItems = visibleItems.slice(
    (itemPageSafe - 1) * ITEM_PAGE_SIZE,
    itemPageSafe * ITEM_PAGE_SIZE,
  );

  useEffect(() => {
    setGotoPage(String(itemPageSafe));
    if (itemPage !== itemPageSafe) setItemPage(itemPageSafe);
  }, [itemPage, itemPageSafe]);

  const jumpToItemPage = (raw: string) => {
    const next = Number(raw);
    if (!Number.isInteger(next) || next < 1) {
      setGotoPage(String(itemPageSafe));
      return;
    }
    setItemPage(Math.min(next, itemPageCount));
  };

  const onGotoSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const input = event.currentTarget.elements.namedItem("extracted-goto-page");
    jumpToItemPage(input instanceof HTMLInputElement ? input.value : gotoPage);
  };

  const showValueTip = (event: MouseEvent<HTMLElement>, text: string) => {
    const value = text.trim();
    const input = event.currentTarget.querySelector("input");
    if (!value || !input) {
      setValueTip(null);
      return;
    }
    const style = getComputedStyle(input);
    const probe = document.createElement("span");
    probe.textContent = input.value;
    probe.style.position = "fixed";
    probe.style.left = "-9999px";
    probe.style.whiteSpace = "nowrap";
    probe.style.font = style.font;
    probe.style.letterSpacing = style.letterSpacing;
    document.body.appendChild(probe);
    const truncated = probe.offsetWidth > input.clientWidth + 1;
    probe.remove();
    if (!truncated) {
      setValueTip(null);
      return;
    }
    const rect = input.getBoundingClientRect();
    const above = rect.bottom + 140 > window.innerHeight;
    setValueTip({
      text: value,
      top: above ? rect.top - 8 : rect.bottom + 8,
      left: Math.max(12, Math.min(rect.left, window.innerWidth - 392)),
      above,
    });
  };
  const activeItems = displayItems.filter(
    (item) => item.status !== ("deleted" as ReviewItem["status"]),
  );
  const stored = documents.find((document) => document.fileName === job?.fileName);
  const documentType = stored?.documentType || extensionOf(job?.fileName || "").replace(".", "").toUpperCase() || "Document";
  const statusLabel =
    approved
      ? "Approved"
      : job?.status === "done"
        ? "Completed"
        : job?.status === "running"
          ? "Processing"
          : "Failed";

  if (!job) return null;

  const scheduleFieldPersist = (item: ReviewItem) => {
    if (!documentId || !item.fieldId) return;
    const previous = persistTimers.current.get(item.fieldId);
    if (previous) window.clearTimeout(previous);
    const timer = window.setTimeout(() => {
      persistTimers.current.delete(item.fieldId!);
      void (async () => {
        try {
          const response = await fetch(apiUrl(`/documents/${documentId}/fields/${item.fieldId}`), {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fieldValue: item.value, fieldName: item.label.trim() || "Field" }),
          });
          if (!response.ok) return;
          setItems((current) =>
            (current ?? displayItems).map((row) =>
              row.fieldId === item.fieldId
                ? { ...row, source: "MANUAL", details: "Manually added" }
                : row,
            ),
          );
          onFieldsChanged?.();
        } catch {
          /* keep local edit */
        }
      })();
    }, 450);
    persistTimers.current.set(item.fieldId, timer);
  };

  const editItem = (id: string, patch: Partial<ReviewItem>) => {
    const target = displayItems.find((item) => item.id === id);
    if (!target) return;
    const nextItem = { ...target, ...patch };
    setItems(displayItems.map((item) => (item.id === id ? nextItem : item)));
    if (patch.value !== undefined) {
      if (target.scope === "header" && target.fieldKey) {
        setDraft((current) => {
          const base = current ?? {
            header: structuredClone(job!.header),
            lines: structuredClone(job!.lines),
          };
          return { ...base, header: { ...base.header, [target.fieldKey!]: patch.value! } };
        });
      } else if (target.scope === "line" && target.lineIndex != null && target.fieldKey) {
        setDraft((current) => {
          const base = current ?? {
            header: structuredClone(job!.header),
            lines: structuredClone(job!.lines),
          };
          return {
            ...base,
            lines: base.lines.map((line, index) =>
              index === target.lineIndex ? applyLineField(line, target.fieldKey!, patch.value!) : line,
            ),
          };
        });
      }
    }
    if (patch.value !== undefined || patch.label !== undefined) {
      scheduleFieldPersist(nextItem);
    }
  };

  const scrollToSourcePage = (targetPage: number) => {
    window.requestAnimationFrame(() => {
      const pageNode = viewerRef.current?.querySelector<HTMLElement>(
        `[data-doc-page="${targetPage}"]`,
      );
      const activeBox = pageNode?.querySelector<HTMLElement>("[data-src-hl='active']");
      (activeBox ?? pageNode)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  const selectItem = (item: ReviewItem) => {
    setSelectedId(item.id);
    const mapped = primaryLocation(item.locations);
    // Do not clamp to `pages` while the PDF is still loading (pages may still be 1).
    const targetPage = Math.max(1, mapped?.page || item.page || 1);
    setPage(targetPage);
    const node = tableRef.current?.querySelector<HTMLElement>(`[data-item="${CSS.escape(item.id)}"]`);
    node?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    scrollToSourcePage(targetPage);
  };

  const addItem = () => {
    const tempId = `custom:${crypto.randomUUID()}`;
    const draftItem: ReviewItem = {
      id: tempId,
      itemNumber: displayItems.length + 1,
      label: "New field",
      value: "",
      details: "Manually added",
      confidence: 100,
      page,
      status: "open",
      sourceSnippet: "",
      scope: "custom",
      source: "MANUAL",
    };
    setItems([...displayItems, draftItem]);
    setSelectedId(tempId);

    if (!documentId) return;
    void (async () => {
      try {
        const response = await fetch(apiUrl(`/documents/${documentId}/fields`), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fieldName: "New field",
            fieldValue: "",
            source: "MANUAL",
          }),
        });
        if (!response.ok) return;
        const saved = (await response.json()) as ExtractedFieldRow;
        setItems((current) =>
          (current ?? displayItems).map((item) =>
            item.id === tempId
              ? {
                  ...item,
                  id: saved.id,
                  fieldId: saved.id,
                  fieldKey: saved.fieldKey,
                  source: "MANUAL",
                  details: "Manually added",
                }
              : item,
          ),
        );
        setSelectedId(saved.id);
        onFieldsChanged?.();
      } catch {
        /* keep local-only field */
      }
    })();
  };

  const buildExportPayload = () => {
    const live = displayItems.filter(
      (item) => item.status !== ("deleted" as ReviewItem["status"]),
    );
    return {
      document_summary: {
        file_name: job.fileName,
        document_type: documentType,
        document_title:
          formatValue(header.document_title) ||
          formatValue(header.document_name) ||
          formatValue(header.title) ||
          null,
        detected_language: "en",
        total_extracted_items: live.length,
      },
      extracted_items: live.map((item) => ({
        item_id: item.itemNumber,
        label_or_category: item.label,
        extracted_content: item.value || null,
        supporting_details: item.details || null,
        confidence_score: Math.round((item.confidence / 100) * 100) / 100,
        page_number: item.page,
        source_text_snippet: item.sourceSnippet || item.value || "",
      })),
      flagged_for_review: live
        .filter((item) => item.status === "flagged" || item.confidence < 85)
        .map((item) => ({
          item_id: item.itemNumber,
          reason:
            item.status === "flagged"
              ? "Flagged by reviewer"
              : `Confidence ${item.confidence}% is below the 85% review threshold.`,
        })),
    };
  };

  const exportJson = () => {
    downloadBlob(
      `${stem(job.fileName)}.json`,
      new Blob([JSON.stringify(buildExportPayload(), null, 2)], { type: "application/json" }),
    );
    setExportOpen(false);
  };

  const exportCsv = () => {
    const rows = [
      ["item_id", "label_or_category", "extracted_content", "supporting_details", "confidence_score", "page_number", "source_text_snippet"],
    ];
    buildExportPayload().extracted_items.forEach((item) => {
      rows.push([
        String(item.item_id),
        item.label_or_category,
        String(item.extracted_content ?? ""),
        String(item.supporting_details ?? ""),
        String(item.confidence_score),
        String(item.page_number),
        item.source_text_snippet,
      ]);
    });
    downloadBlob(
      `${stem(job.fileName)}.csv`,
      new Blob([rows.map((row) => row.map(csvEscape).join(",")).join("\n")], { type: "text/csv" }),
    );
    setExportOpen(false);
  };

  const exportExcel = () => {
    const payload = buildExportPayload();
    const cells = payload.extracted_items
      .map(
        (item) => `<Row>
  <Cell><Data ss:Type="Number">${item.item_id}</Data></Cell>
  <Cell><Data ss:Type="String">${escapeXml(item.label_or_category)}</Data></Cell>
  <Cell><Data ss:Type="String">${escapeXml(String(item.extracted_content ?? ""))}</Data></Cell>
  <Cell><Data ss:Type="String">${escapeXml(String(item.supporting_details ?? ""))}</Data></Cell>
  <Cell><Data ss:Type="Number">${item.confidence_score}</Data></Cell>
  <Cell><Data ss:Type="Number">${item.page_number}</Data></Cell>
  <Cell><Data ss:Type="String">${escapeXml(item.source_text_snippet)}</Data></Cell>
</Row>`,
      )
      .join("");
    const xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="Extracted Items">
  <Table>
   <Row>
    <Cell><Data ss:Type="String">item_id</Data></Cell>
    <Cell><Data ss:Type="String">label_or_category</Data></Cell>
    <Cell><Data ss:Type="String">extracted_content</Data></Cell>
    <Cell><Data ss:Type="String">supporting_details</Data></Cell>
    <Cell><Data ss:Type="String">confidence_score</Data></Cell>
    <Cell><Data ss:Type="String">page_number</Data></Cell>
    <Cell><Data ss:Type="String">source_text_snippet</Data></Cell>
   </Row>
   ${cells}
  </Table>
 </Worksheet>
</Workbook>`;
    downloadBlob(`${stem(job.fileName)}.xls`, new Blob([xml], { type: "application/vnd.ms-excel" }));
    setExportOpen(false);
  };

  const fitWidth = Math.max(240, paneWidth);
  const sheetWidth = Math.max(240, Math.round(fitWidth * zoom));
  const pdfFrameHeight = Math.max(520, Math.round(sheetWidth * 1.35));
  const pdfFileSource = useMemo(
    () => (pdfData ? { data: pdfData.slice() } : null),
    [pdfData],
  );
  const selectedHasBoxes = useMemo(() => {
    if (!selectedLocations?.length) return false;
    return selectedLocations.some((loc) =>
      boxesForPage([loc], loc.page || 1).length > 0,
    );
  }, [selectedLocations]);

  return (
    <section className="review-results flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden text-[var(--ink)]">
      <header className="review-results-top flex shrink-0 flex-nowrap items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--sheet)] px-2.5 py-1.5 shadow-sm">
        <button
          type="button"
          onClick={onBack}
          aria-label={backLabel}
          title={backLabel}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[var(--line-strong)] bg-[var(--soft)] text-[var(--ink)] transition hover:bg-[var(--hover)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>

        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
          <FileText className="h-4 w-4" />
        </div>

        <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-2 overflow-hidden">
          <h1
            className="min-w-0 truncate text-[13px] font-bold tracking-[-0.02em] text-[var(--ink-strong)]"
            title={job.fileName}
          >
            {job.fileName}
          </h1>
          <span className="shrink-0 rounded-full bg-[var(--hover)] px-2 py-0.5 text-[10px] font-bold text-[var(--ink-soft)] ring-1 ring-[var(--line)]">
            {documentType}
          </span>
          <span className="shrink-0 rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-bold text-sky-700 ring-1 ring-sky-200">
            {activeItems.length} items
          </span>
          <span
            className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${
              statusLabel === "Completed" || statusLabel === "Approved"
                ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                : statusLabel === "Processing"
                  ? "bg-amber-50 text-amber-700 ring-amber-200"
                  : "bg-rose-50 text-rose-700 ring-rose-200"
            }`}
          >
            {(statusLabel === "Completed" || statusLabel === "Approved") && (
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
            )}
            {statusLabel}
          </span>
        </div>

        <div className="flex shrink-0 flex-nowrap items-center gap-1.5">
          <div className="relative">
            <button
              type="button"
              disabled={job.status !== "done"}
              onClick={() => setExportOpen((open) => !open)}
              className="app-btn-ghost"
            >
              <Download />
              Export
            </button>
            {exportOpen && (
              <div className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--sheet)] py-1 shadow-lg">
                <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--hover)]" onClick={exportCsv}>
                  <FileSpreadsheet className="h-4 w-4 text-[var(--muted)]" /> CSV
                </button>
                <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--hover)]" onClick={exportJson}>
                  <FileJson className="h-4 w-4 text-[var(--muted)]" /> JSON
                </button>
                <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--hover)]" onClick={exportExcel}>
                  <FileSpreadsheet className="h-4 w-4 text-emerald-600" /> Excel
                </button>
              </div>
            )}
          </div>
          <button
            type="button"
            disabled={job.status !== "done"}
            onClick={() => {
              setApproved(true);
              setItems(
                displayItems.map((item) => ({
                  ...item,
                  status: item.status === "flagged" ? item.status : "accepted",
                })),
              );
              onNextDocument?.();
            }}
            className="app-btn-primary"
          >
            <CheckCircle2 />
            Confirm &amp; approve data
          </button>
        </div>
      </header>

      <div ref={shellRef} className="review-results-grids grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-hidden lg:grid-cols-2">
        <section
          ref={(node) => {
            leftPaneRef.current = node;
          }}
          className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--sheet)] shadow-sm"
          aria-label="Document viewer"
        >
          <div className="flex shrink-0 flex-nowrap items-center justify-between gap-2 border-b border-[var(--line)] bg-[var(--soft)] px-3 py-1.5">
            <span className="type-label rounded-lg bg-[var(--accent-soft)] px-2 py-0.5 uppercase text-[var(--accent)]">
              Document
            </span>
            {previewKind !== "excel" ? (
              <div className="inline-flex items-center gap-1">
                {previewKind === "pdf" && pdfReady && pages > 1 ? (
                  <>
                    <button
                      type="button"
                      className={toolBtn}
                      disabled={page <= 1}
                      onClick={() => {
                        const next = Math.max(1, page - 1);
                        setPage(next);
                        viewerRef.current
                          ?.querySelector(`[data-doc-page="${next}"]`)
                          ?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }}
                      aria-label="Previous page"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <span className="min-w-[6.5rem] text-center text-xs font-semibold text-[var(--muted)]">
                      Page {page} of {pages}
                    </span>
                    <button
                      type="button"
                      className={toolBtn}
                      disabled={page >= pages}
                      onClick={() => {
                        const next = Math.min(pages, page + 1);
                        setPage(next);
                        viewerRef.current
                          ?.querySelector(`[data-doc-page="${next}"]`)
                          ?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }}
                      aria-label="Next page"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                    <span className="mx-1 h-4 w-px bg-[var(--line)]" />
                  </>
                ) : null}
                <button type="button" className={toolBtn} onClick={() => setZoom((value) => Math.max(0.6, roundZoom(value - 0.1)))} aria-label="Zoom out">
                  <Minus className="h-4 w-4" />
                </button>
                <span className="w-11 text-center text-xs font-semibold">{Math.round(zoom * 100)}%</span>
                <button type="button" className={toolBtn} onClick={() => setZoom((value) => Math.min(1.8, roundZoom(value + 0.1)))} aria-label="Zoom in">
                  <Plus className="h-4 w-4" />
                </button>
                <button type="button" className={toolBtn} onClick={() => setZoom(1)} aria-label="Reset zoom">
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <span className="type-label rounded-lg bg-[var(--accent-soft)] px-2 py-0.5 uppercase text-[var(--accent)]">
                Spreadsheet
              </span>
            )}
          </div>
          {selectedItem && !locationFound ? (
            <div className="src-hl-banner" role="status">
              Source location not found for “{selectedItem.label}”. Extracted value is still shown on the right.
            </div>
          ) : selectedItem && locationFound && (previewKind === "none" || (previewKind === "pdf" && !selectedHasBoxes && !pdfReady)) ? (
            <div className="src-hl-banner src-hl-banner-info" role="status">
              Located in source
              {primaryLocation(selectedLocations)?.page
                ? ` (page ${primaryLocation(selectedLocations)!.page})`
                : ""}
              {selectedLocations?.[0]?.quote
                ? `: “${selectedLocations[0].quote.slice(0, 120)}”`
                : ""}
              {previewKind === "none" ? ". Live preview is unavailable for this file type." : "."}
            </div>
          ) : selectedItem && locationFound && previewKind !== "excel" && (selectedLocations?.length ?? 0) > 1 ? (
            <div className="src-hl-banner src-hl-banner-info" role="status">
              {selectedLocations!.length} source locations found — highlighting all matches.
            </div>
          ) : null}
          <div
            ref={viewerRef}
            className={
              previewKind === "excel"
                ? "relative min-h-0 flex-1 overflow-hidden overscroll-contain bg-[var(--soft)] p-2"
                : "doc-scroll-pane relative min-h-0 flex-1 overflow-auto overscroll-contain bg-[var(--soft)] p-3"
            }
            onScroll={() => {
              if (previewKind !== "pdf" || !pdfReady || pages <= 1) return;
              const root = viewerRef.current;
              if (!root) return;
              const mid = root.scrollTop + root.clientHeight * 0.35;
              let active = 1;
              root.querySelectorAll<HTMLElement>("[data-doc-page]").forEach((node) => {
                if (node.offsetTop <= mid) {
                  active = Number(node.dataset.docPage) || active;
                }
              });
              setPage((current) => (current === active ? current : active));
            }}
          >
            {previewKind === "excel" && previewFile ? (
              <ExcelPreview
                file={previewFile}
                zoom={zoom}
                onZoomChange={setZoom}
                locations={selectedLocations}
                selectedLabel={selectedItem?.label ?? null}
              />
            ) : previewKind === "image" && previewUrl ? (
              <div className="relative mx-auto bg-white shadow-lg ring-1 ring-slate-200" style={{ width: sheetWidth }}>
                <img src={previewUrl} alt={job.fileName} className="block w-full object-contain" draggable={false} />
                <SourceHighlightLayer locations={selectedLocations} page={1} selected />
              </div>
            ) : previewKind === "pdf" && !previewFile ? (
              <div className="rounded-2xl border border-dashed border-[var(--line-strong)] bg-[var(--sheet)] px-6 py-8 text-center">
                <p className="text-sm font-bold text-[var(--ink-strong)]">PDF preview unavailable</p>
                <p className="mt-1.5 text-xs text-[var(--muted)]">The PDF file could not be opened.</p>
                <p className="mt-1.5 text-xs text-[var(--muted)]">Extracted fields are still available on the right.</p>
              </div>
            ) : previewKind === "pdf" && pdfFileSource && !pdfError ? (
              <PreviewBoundary
                key={`${previewFile?.name}-${previewFile?.size}-${pdfFileSource.data.byteLength}`}
                onError={(message) => setPdfError(message)}
              >
                <Document
                  file={pdfFileSource}
                  suspense={false}
                  onLoadSuccess={({ numPages }) => {
                    setPdfError("");
                    setPdfReady(true);
                    setPages(Math.max(1, numPages));
                  }}
                  onLoadError={(error) => {
                    setPdfReady(false);
                    setPdfError(error instanceof Error ? error.message : "This PDF could not be previewed.");
                    setPages(1);
                  }}
                  loading={<p className="p-8 text-center text-sm text-[var(--muted)]">Opening PDF…</p>}
                  error={<p className="p-8 text-center text-sm text-[var(--muted)]">This PDF could not be previewed.</p>}
                  className="mx-auto flex w-fit flex-col gap-4"
                >
                  {pdfReady
                    ? Array.from({ length: Math.max(1, pages) }, (_, index) => {
                        const pageNumber = index + 1;
                        return (
                          <div
                            key={`${previewFile?.name}-${previewFile?.size}-${pageNumber}`}
                            data-doc-page={pageNumber}
                            className="relative bg-white shadow-lg ring-1 ring-slate-200"
                            style={{ width: sheetWidth }}
                          >
                            <Page
                              pageNumber={pageNumber}
                              width={sheetWidth}
                              renderAnnotationLayer={false}
                              renderTextLayer={false}
                              loading={
                                <div
                                  className="grid place-items-center text-xs text-[var(--muted)]"
                                  style={{ width: sheetWidth, height: Math.round(sheetWidth * 1.3) }}
                                >
                                  Loading page {pageNumber}…
                                </div>
                              }
                            />
                            <SourceHighlightLayer
                              locations={selectedLocations}
                              page={pageNumber}
                              selected
                            />
                          </div>
                        );
                      })
                    : null}
                </Document>
              </PreviewBoundary>
            ) : previewKind === "pdf" && previewUrl ? (
              <div className="mx-auto flex flex-col gap-2" style={{ width: sheetWidth }}>
                {pdfError ? (
                  <p className="text-center text-xs text-[var(--muted)]">{pdfError}</p>
                ) : null}
                <div
                  className="overflow-hidden rounded-xl bg-white shadow-lg ring-1 ring-slate-200"
                  style={{ height: pdfFrameHeight }}
                >
                  <object
                    key={`${previewUrl}#${page}`}
                    data={`${previewUrl}#page=${Math.max(1, page)}`}
                    type="application/pdf"
                    title={job.fileName}
                    className="h-full w-full"
                  >
                    <iframe
                      title={job.fileName}
                      src={`${previewUrl}#page=${Math.max(1, page)}`}
                      className="h-full w-full border-0"
                    />
                  </object>
                </div>
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-center text-xs font-semibold text-[var(--accent)] underline-offset-2 hover:underline"
                >
                  Open PDF in a new tab
                </a>
              </div>
            ) : previewKind === "pdf" && previewFile ? (
              <p className="p-8 text-center text-sm text-[var(--muted)]">Opening PDF…</p>
            ) : previewKind === "docx" ? (
              <div className="docx-preview-shell mx-auto">
                {docxError ? (
                  <div className="rounded-2xl border border-dashed border-[var(--line-strong)] bg-[var(--sheet)] px-6 py-8 text-center">
                    <p className="text-sm font-bold text-[var(--ink-strong)]">Word preview failed</p>
                    <p className="mt-1.5 text-xs text-[var(--muted)]">{docxError}</p>
                  </div>
                ) : (
                  <>
                    {!docxReady ? (
                      <p className="mb-3 p-2 text-center text-sm text-[var(--muted)]">Opening Word document…</p>
                    ) : null}
                    <div
                      ref={docxHostRef}
                      className="docx-fit-host rounded-xl shadow-lg ring-1 ring-slate-200"
                      style={{ ["--docx-zoom" as string]: String(zoom) } as CSSProperties}
                    />
                  </>
                )}
              </div>
            ) : previewKind === "text" ? (
            <div className="mx-auto" style={{ width: sheetWidth }}>
              {textError ? (
                <div className="rounded-2xl border border-dashed border-[var(--line-strong)] bg-[var(--sheet)] px-6 py-8 text-center">
                  <p className="text-sm font-bold text-[var(--ink-strong)]">Text preview failed</p>
                  <p className="mt-1.5 text-xs text-[var(--muted)]">{textError}</p>
                </div>
              ) : (
                <pre
                  ref={textHostRef}
                  className="m-0 min-h-[280px] whitespace-pre-wrap break-words rounded-xl bg-white p-6 text-left font-mono text-[13px] leading-6 text-[var(--ink)] shadow-lg ring-1 ring-slate-200"
                >
                  {markedParts.length
                    ? markedParts.map((part, index) =>
                        part.kind === "mark" ? (
                          <mark
                            key={`m-${index}`}
                            ref={index === 0 ? (node) => { highlightRef.current = node; } : undefined}
                            className="src-hl-text src-hl-active"
                          >
                            {part.text}
                          </mark>
                        ) : (
                          <span key={`t-${index}`}>{part.text}</span>
                        ),
                      )
                    : textBody}
                </pre>
              )}
            </div>
          ) : (
              <div className="grid h-full min-h-[280px] place-items-center text-center">
                <div className="max-w-sm rounded-2xl border border-dashed border-[var(--line-strong)] bg-[var(--sheet)] px-6 py-8">
                  <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
                    <FileJson className="h-5 w-5" />
                  </div>
                  <p className="text-sm font-bold text-[var(--ink-strong)]">
                    {previewFile ? "No live preview for this file type" : "Document file unavailable"}
                  </p>
                  <p className="mt-1.5 text-xs leading-relaxed text-[var(--muted)]">
                    {previewFile
                      ? "Review extracted values on the right. PDF, Word, Excel, and image files can be previewed here."
                      : "Open the document again after upload, or extract from the queue to attach the source file."}
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>

        <aside
          className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--sheet)] shadow-sm"
          aria-label="Extracted fields"
        >
          <div className="flex shrink-0 flex-nowrap items-center gap-2 border-b border-[var(--line)] bg-[var(--soft)] px-3 py-1.5">
            <span className="type-label shrink-0 rounded-lg bg-[var(--accent-soft)] px-2 py-0.5 uppercase text-[var(--accent)]">
              Extracted data
            </span>
            <label className="relative min-w-[140px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--faint)]" />
              <input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setItemPage(1);
                }}
                placeholder="Search fields…"
                className="h-8 w-full rounded-lg border border-[var(--line)] bg-[var(--sheet)] pl-8 pr-3 text-sm outline-none transition focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)]"
              />
            </label>
            <button type="button" onClick={addItem} className="app-btn-primary has-plus">
              <span className="app-btn-plus" aria-hidden="true">+</span>
              Add New Item
            </button>
          </div>

          <div
            ref={tableRef}
            className="doc-scroll-pane min-h-0 flex-1 overflow-auto overscroll-contain px-3 pt-2 pb-0"
            onScroll={() => setValueTip(null)}
          >
            {visibleItems.length === 0 ? (
              <div className="grid min-h-[220px] place-items-center px-4 py-12 text-center">
                <div>
                  <p className="m-0 text-sm font-bold text-[var(--ink-strong)]">
                    {query.trim()
                      ? "No extracted items match this search."
                      : job.status === "running"
                        ? "Extracting fields…"
                        : "No data extracted"}
                  </p>
                  <p className="mt-1.5 mb-0 text-xs text-[var(--muted)]">
                    {query.trim()
                      ? "Try a different search term."
                      : job.status === "running"
                        ? "Values will appear here as soon as extraction finishes."
                        : "The AI did not find field values in this document. You can add fields manually."}
                  </p>
                </div>
              </div>
            ) : (
              <div className="docs-table-wrap extracted-fields-wrap">
              <table className="docs-table extracted-fields">
                  <thead>
                    <tr>
                      <th>S.No</th>
                      <th>Field</th>
                      <th>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedItems.map((item) => (
                        <tr
                          key={item.id}
                          data-item={item.id}
                          className={selectedId === item.id ? "docs-row is-open" : "docs-row"}
                          onClick={() => selectItem(item)}
                        >
                          <td>
                            <span className="extracted-sno">{String(item.itemNumber).padStart(2, "0")}</span>
                          </td>
                          <td>
                            <input
                              value={item.label}
                              aria-label="Field name"
                              onClick={(event) => event.stopPropagation()}
                              onChange={(event) => editItem(item.id, { label: event.target.value })}
                              className="docs-cell-input docs-file-name"
                            />
                          </td>
                          <td
                            onMouseEnter={(event) => showValueTip(event, item.value)}
                            onMouseLeave={() => setValueTip(null)}
                          >
                            <input
                              value={item.value}
                              aria-label={`${item.label || "Field"} value`}
                              onClick={(event) => event.stopPropagation()}
                              onChange={(event) =>
                                editItem(item.id, { value: event.target.value, sourceSnippet: event.target.value })
                              }
                              placeholder="No value extracted"
                              className="docs-cell-input"
                            />
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

        </aside>
      </div>

      {valueTip ? (
        <span
          className={valueTip.above ? "extracted-value-tip above" : "extracted-value-tip"}
          style={{ top: valueTip.top, left: valueTip.left }}
        >
          {valueTip.text}
        </span>
      ) : null}

      {visibleItems.length > 0 && (
        <div className="docs-pagination shrink-0">
          <div className="docs-page-size">
            <span>{ITEM_PAGE_SIZE}</span>
            <span>Items per page</span>
          </div>
          <div className="docs-page-numbers">
            <button
              type="button"
              aria-label="Previous page"
              disabled={itemPageSafe <= 1}
              onClick={() => setItemPage(itemPageSafe - 1)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M15 6 9 12l6 6" />
              </svg>
            </button>
            {paginationItems(itemPageSafe, itemPageCount).map((item, index) =>
              item === "ellipsis" ? (
                <span key={`ellipsis-${index}`} className="docs-page-ellipsis">
                  …
                </span>
              ) : (
                <button
                  key={item}
                  type="button"
                  className="docs-page-num"
                  aria-current={item === itemPageSafe ? "page" : undefined}
                  onClick={() => setItemPage(item)}
                >
                  {item}
                </button>
              ),
            )}
            <button
              type="button"
              aria-label="Next page"
              disabled={itemPageSafe >= itemPageCount}
              onClick={() => setItemPage(itemPageSafe + 1)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m9 6 6 6-6 6" />
              </svg>
            </button>
          </div>
          <form className="docs-page-goto" onSubmit={onGotoSubmit}>
            <label htmlFor="extracted-goto-page">Go to page</label>
            <input
              id="extracted-goto-page"
              name="extracted-goto-page"
              value={gotoPage}
              inputMode="numeric"
              onChange={(event) => setGotoPage(event.target.value)}
              onBlur={(event) => jumpToItemPage(event.target.value)}
            />
          </form>
        </div>
      )}
    </section>
  );
};

const toolBtn =
  "grid h-8 w-8 place-items-center rounded-lg border border-[var(--line)] bg-[var(--soft)] text-[var(--ink)] transition hover:bg-[var(--hover)] disabled:opacity-40";

const escapeXml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
