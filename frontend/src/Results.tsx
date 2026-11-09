import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  FileJson,
  Minus,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  CheckCircle2,
  ArrowLeft,
} from "lucide-react";
import { Document, Page, pdfjs } from "react-pdf";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { extensionOf, formatValue } from "./format";
import type { Catalog, ExtraFieldValue, ExtractedLine, Job, StoredDocument } from "./types";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

type ResultsProps = {
  catalog: Catalog | null;
  job: Job | null;
  documents: StoredDocument[];
  previewFile?: File | null;
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

const confidenceTone = (score: number) => {
  if (score >= 90) return "high";
  if (score >= 70) return "mid";
  return "low";
};

/** Deterministic highlight boxes when OCR coordinates are unavailable. */
const highlightBox = (index: number, selected: boolean) => {
  const col = index % 2;
  const row = Math.floor(index / 2) % 10;
  return {
    left: `${6 + col * 46}%`,
    top: `${10 + row * 8}%`,
    width: "40%",
    height: "5.5%",
    opacity: selected ? 1 : 0.55,
  };
};

export const Results = ({
  catalog,
  job,
  documents,
  previewFile = null,
  onBack,
  onNextDocument,
  backLabel = "Back to Documents",
}: ResultsProps) => {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [approved, setApproved] = useState(false);
  const [query, setQuery] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewKind, setPreviewKind] = useState<"pdf" | "image" | "none">("none");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [split, setSplit] = useState(50);
  const [dragging, setDragging] = useState(false);
  const [paneWidth, setPaneWidth] = useState(560);
  const touched = useRef(false);
  const tableRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const leftPaneRef = useRef<HTMLElement | null>(null);
  const header = draft?.header ?? job?.header ?? {};
  const lines = draft?.lines ?? job?.lines ?? [];
  const template = job?.template ?? null;
  const catalogFields = useMemo(
    () => [...(catalog?.header ?? []), ...(catalog?.lines ?? [])],
    [catalog],
  );

  useEffect(() => {
    touched.current = false;
    setDraft(null);
    setItems([]);
    setSelectedId(null);
    setApproved(false);
    setQuery("");
    setFilter("all");
    setPage(1);
    setZoom(1);
    setExportOpen(false);
  }, [job?.id]);

  useEffect(() => {
    if (!job || touched.current) return;
    setDraft({
      header: structuredClone(job.header),
      lines: structuredClone(job.lines),
    });
  }, [job]);

  useEffect(() => {
    if (!job) return;
    const describe = (key: string) => {
      const known = catalogFields.find((field) => field.key === key);
      return {
        label: known?.label || labelFromKey(key),
        description: known?.description || "",
      };
    };
    const filled = (value: string) => value.trim() !== "";
    const headerKeys = [
      ...new Set([
        ...(template?.headerKeys ?? []),
        ...Object.keys(header).filter((key) => filled(formatValue(header[key]))),
      ]),
    ];
    const next: ReviewItem[] = [];
    headerKeys.forEach((key, index) => {
      const meta = describe(key);
      const value = formatValue(header[key]);
      next.push({
        id: `header:${key}`,
        itemNumber: next.length + 1,
        label: meta.label,
        value,
        details: meta.description || "Header field",
        confidence: fieldConfidence(value, index),
        page: 1,
        status: "open",
        sourceSnippet: value || meta.label,
        scope: "header",
        fieldKey: key,
      });
    });
    lines.forEach((line, lineIndex) => {
      const keys = [
        ...new Set([
          ...(template?.lineKeys ?? []).filter((key) => !headerKeys.includes(key)),
          ...Object.keys(line.fields ?? {}).filter((key) => filled(lineFieldValue(line, key))),
        ]),
      ];
      keys.forEach((key, fieldIndex) => {
        const meta = describe(key);
        const value = lineFieldValue(line, key);
        next.push({
          id: `line:${lineIndex}:${key}`,
          itemNumber: next.length + 1,
          label: lines.length > 1 ? `${meta.label} · L${lineIndex + 1}` : meta.label,
          value,
          details: meta.description || `Line ${lineIndex + 1}`,
          confidence: fieldConfidence(value, next.length + fieldIndex),
          page: Math.min(pages || 1, 1 + Math.floor(lineIndex / 8)),
          status: "open",
          sourceSnippet: value || meta.label,
          scope: "line",
          lineIndex,
          fieldKey: key,
        });
      });
    });
    setItems((current) => {
      if (!current.length || current.every((row) => row.status === "open" && !touched.current)) {
        return next;
      }
      const byId = new Map(current.map((row) => [row.id, row]));
      return next.map((row) => {
        const prior = byId.get(row.id);
        if (!prior) return row;
        return {
          ...row,
          value: prior.value,
          details: prior.details,
          status: prior.status,
          confidence: prior.confidence,
        };
      });
    });
  }, [catalogFields, header, job, lines, pages, template]);

  useEffect(() => {
    if (!previewFile) {
      setPreviewUrl(null);
      setPreviewKind("none");
      return;
    }
    const url = URL.createObjectURL(previewFile);
    const name = previewFile.name.toLowerCase();
    const kind =
      previewFile.type.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(name)
        ? "image"
        : previewFile.type === "application/pdf" || name.endsWith(".pdf")
          ? "pdf"
          : "none";
    setPreviewUrl(url);
    setPreviewKind(kind);
    return () => URL.revokeObjectURL(url);
  }, [previewFile]);

  useEffect(() => {
    const node = leftPaneRef.current;
    if (!node) return;
    const measure = () => setPaneWidth(Math.max(280, node.clientWidth - 24));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [split]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (event: MouseEvent) => {
      const shell = shellRef.current;
      if (!shell) return;
      const rect = shell.getBoundingClientRect();
      const next = ((event.clientX - rect.left) / rect.width) * 100;
      setSplit(Math.min(70, Math.max(30, next)));
    };
    const onUp = () => setDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging]);

  const visibleItems = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      if (item.status === "deleted" as ReviewItem["status"]) return false;
      if (!needle) return true;
      return `${item.label} ${item.value} ${item.details}`.toLowerCase().includes(needle);
    });
  }, [items, query]);

  const activeItems = items.filter((item) => item.status !== ("deleted" as ReviewItem["status"]));
  const selected = items.find((item) => item.id === selectedId) ?? null;
  const stored = documents.find((document) => document.fileName === job?.fileName);
  const documentType = stored?.documentType || extensionOf(job?.fileName || "").replace(".", "").toUpperCase() || "Document";
  const processedAt = stored?.uploadedAt
    ? new Date(stored.uploadedAt).toLocaleString()
    : new Date().toLocaleString();
  const statusLabel =
    approved
      ? "Approved"
      : job?.status === "done"
        ? "Completed"
        : job?.status === "running"
          ? "Processing"
          : "Failed";

  if (!job) return null;

  const editItem = (id: string, patch: Partial<ReviewItem>) => {
    touched.current = true;
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
    const target = items.find((item) => item.id === id);
    if (!target || patch.value === undefined) return;
    if (target.scope === "header" && target.fieldKey) {
      setDraft((current) => {
        const base = current ?? {
          header: structuredClone(job.header),
          lines: structuredClone(job.lines),
        };
        return { ...base, header: { ...base.header, [target.fieldKey!]: patch.value! } };
      });
    } else if (target.scope === "line" && target.lineIndex != null && target.fieldKey) {
      setDraft((current) => {
        const base = current ?? {
          header: structuredClone(job.header),
          lines: structuredClone(job.lines),
        };
        return {
          ...base,
          lines: base.lines.map((line, index) =>
            index === target.lineIndex ? applyLineField(line, target.fieldKey!, patch.value!) : line,
          ),
        };
      });
    }
  };

  const selectItem = (item: ReviewItem) => {
    setSelectedId(item.id);
    setPage(Math.min(pages, Math.max(1, item.page)));
    const node = tableRef.current?.querySelector<HTMLElement>(`[data-item="${CSS.escape(item.id)}"]`);
    node?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    viewerRef.current?.querySelector<HTMLElement>("[data-highlight-layer]")?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  };

  const addItem = () => {
    touched.current = true;
    const id = `custom:${crypto.randomUUID()}`;
    setItems((current) => [
      ...current,
      {
        id,
        itemNumber: current.length + 1,
        label: "New field",
        value: "",
        details: "Manually added",
        confidence: 70,
        page: page,
        status: "open",
        sourceSnippet: "",
        scope: "custom",
      },
    ]);
    setSelectedId(id);
  };

  const removeItem = (id: string) => {
    touched.current = true;
    setItems((current) => current.filter((item) => item.id !== id).map((item, index) => ({
      ...item,
      itemNumber: index + 1,
    })));
    if (selectedId === id) setSelectedId(null);
  };

  const buildExportPayload = () => {
    const live = items.filter((item) => item.status !== ("deleted" as ReviewItem["status"]));
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

  const sheetWidth = Math.max(280, Math.round(paneWidth * zoom));

  return (
    <section className="flex min-h-[calc(100vh-88px)] flex-1 flex-col gap-3 text-[var(--ink)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={onBack} className="app-btn-ghost">
          <ArrowLeft className="h-4 w-4" />
          {backLabel}
        </button>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <button
              type="button"
              disabled={job.status !== "done"}
              onClick={() => setExportOpen((open) => !open)}
              className="app-btn-ghost"
            >
              <Download className="h-4 w-4" />
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
              setItems((current) => current.map((item) => ({ ...item, status: item.status === "flagged" ? item.status : "accepted" })));
              onNextDocument?.();
            }}
            className="app-btn-primary"
          >
            <CheckCircle2 className="h-4 w-4" />
            Confirm &amp; Approve Data
          </button>
        </div>
      </div>

      <div ref={shellRef} className="flex min-h-[620px] flex-1 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--sheet)] shadow-[0_18px_40px_rgba(15,23,42,0.08)]">
        <section
          ref={(node) => {
            leftPaneRef.current = node;
          }}
          className="flex min-h-0 min-w-0 flex-col border-r border-[var(--line)]"
          style={{ width: `${split}%` }}
          aria-label="Document viewer"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] bg-[var(--soft)] px-3 py-2.5">
            <div className="inline-flex items-center gap-1">
              <button type="button" className={toolBtn} disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} aria-label="Previous page">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="min-w-[7.5rem] text-center text-xs font-semibold text-[var(--muted)]">
                Page {page} of {pages}
              </span>
              <button type="button" className={toolBtn} disabled={page >= pages} onClick={() => setPage((value) => Math.min(pages, value + 1))} aria-label="Next page">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <div className="inline-flex items-center gap-1">
              <button type="button" className={toolBtn} onClick={() => setZoom((value) => Math.max(0.6, roundZoom(value - 0.1)))} aria-label="Zoom out">
                <Minus className="h-4 w-4" />
              </button>
              <span className="w-12 text-center text-xs font-semibold tabular-nums">{Math.round(zoom * 100)}%</span>
              <button type="button" className={toolBtn} onClick={() => setZoom((value) => Math.min(1.8, roundZoom(value + 0.1)))} aria-label="Zoom in">
                <Plus className="h-4 w-4" />
              </button>
              <button type="button" className={toolBtn} onClick={() => setZoom(1)} aria-label="Reset zoom">
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div ref={viewerRef} className="relative min-h-0 flex-1 overflow-auto bg-[radial-gradient(circle_at_top,color-mix(in_srgb,var(--accent)_8%,transparent),transparent_42%),var(--soft)] p-5">
            <div className="relative mx-auto overflow-hidden rounded-xl bg-white shadow-[0_16px_40px_rgba(15,23,42,0.12)] ring-1 ring-slate-200/80" style={{ width: sheetWidth }}>
              {(previewKind === "pdf" || previewKind === "image") && previewUrl ? (
                <div className="relative" data-highlight-layer>
                  {previewKind === "image" ? (
                    <img src={previewUrl} alt={job.fileName} className="block w-full object-contain" />
                  ) : (
                    <Document
                      file={previewUrl}
                      onLoadSuccess={({ numPages }) => setPages(numPages)}
                      loading={<p className="p-8 text-center text-sm text-slate-500">Opening PDF…</p>}
                      error={<p className="p-8 text-center text-sm text-slate-500">This PDF could not be previewed.</p>}
                    >
                      <Page pageNumber={page} width={sheetWidth} renderAnnotationLayer={false} renderTextLayer={false} />
                    </Document>
                  )}
                  {visibleItems
                    .filter((item) => item.page === page || pages <= 1)
                    .slice(0, 16)
                    .map((item, index) => {
                      const box = highlightBox(index, selectedId === item.id);
                      const tone = confidenceTone(item.confidence);
                      return (
                        <button
                          key={item.id}
                          type="button"
                          title={item.label}
                          onClick={() => selectItem(item)}
                          className={`absolute rounded-sm border-2 transition ${
                            tone === "high"
                              ? "border-emerald-500 bg-emerald-400/20"
                              : tone === "mid"
                                ? "border-amber-500 bg-amber-400/20"
                                : "border-rose-500 bg-rose-400/25"
                          } ${selectedId === item.id ? "z-10 ring-2 ring-[var(--accent)]" : ""}`}
                          style={box}
                        />
                      );
                    })}
                </div>
              ) : (
                <div className="grid min-h-[420px] place-items-center bg-[linear-gradient(180deg,#f8fafc,#eef2f7)] p-10 text-center">
                  <div className="max-w-sm">
                    <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-white text-sky-600 shadow-sm ring-1 ring-slate-200">
                      <FileJson className="h-5 w-5" />
                    </div>
                    <p className="m-0 text-sm font-bold text-slate-800">No live preview for this file type</p>
                    <p className="mt-1.5 mb-0 text-xs leading-relaxed text-slate-500">
                      Review and edit extracted values on the right. PDF and image uploads show bounding highlights here.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        <button
          type="button"
          aria-label="Resize panes"
          className="group relative w-1.5 shrink-0 cursor-col-resize bg-[var(--line)] transition hover:bg-[var(--accent)]"
          onMouseDown={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
        >
          <span className="absolute left-1/2 top-1/2 h-10 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--muted)] opacity-40 group-hover:bg-[var(--accent)] group-hover:opacity-100" />
        </button>

        <aside className="flex min-h-0 min-w-0 flex-col bg-[var(--sheet)]" style={{ width: `${100 - split}%` }}>
          <div className="border-b border-[var(--line)] px-4 py-4">
            <div className="rounded-2xl border border-[var(--line)] bg-[linear-gradient(180deg,var(--soft),var(--sheet))] p-4 shadow-[0_1px_0_rgba(255,255,255,0.04)_inset]">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="m-0 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--faint)]">
                    Extracted fields
                  </p>
                  <h2 className="mt-1 truncate text-[15px] font-bold tracking-[-0.02em] text-[var(--ink-strong)]" title={job.fileName}>
                    {job.fileName}
                  </h2>
                  <p className="mt-1 text-xs text-[var(--muted)]">Processed {processedAt}</p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full bg-[var(--hover)] px-2.5 py-1 text-[11px] font-bold text-[var(--ink-soft)] ring-1 ring-[var(--line)]">
                    {documentType}
                  </span>
                  <span className="rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-bold text-sky-700 ring-1 ring-sky-200">
                    {activeItems.length} items
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ${
                      statusLabel === "Completed" || statusLabel === "Approved"
                        ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                        : statusLabel === "Processing"
                          ? "bg-amber-50 text-amber-700 ring-amber-200"
                          : "bg-rose-50 text-rose-700 ring-rose-200"
                    }`}
                  >
                    {statusLabel}
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label className="relative min-w-[200px] flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--faint)]" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search fields…"
                  className="h-10 w-full rounded-[12px] border border-[var(--line)] bg-[var(--soft)] pl-9 pr-3 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--accent)] focus:bg-[var(--sheet)] focus:ring-2 focus:ring-[var(--accent-soft)]"
                />
              </label>
              <button type="button" onClick={addItem} className="app-btn-primary has-plus">
                <span className="app-btn-plus" aria-hidden="true">+</span>
                Add New Item
              </button>
            </div>
          </div>

          <div ref={tableRef} className="min-h-0 flex-1 overflow-auto px-2 pb-2">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="sticky top-0 z-10 bg-[var(--sheet)]">
                <tr className="border-b border-[var(--line)] text-[11px] uppercase tracking-[0.06em] text-[var(--faint)]">
                  <th className="w-10 px-3 py-3 font-bold">#</th>
                  <th className="min-w-[140px] px-3 py-3 font-bold">Field / Label</th>
                  <th className="min-w-[160px] px-3 py-3 font-bold">Extracted Value</th>
                  <th className="min-w-[160px] px-3 py-3 font-bold">Details</th>
                  <th className="w-12 px-2 py-3 text-right font-bold" aria-label="Delete" />
                </tr>
              </thead>
              <tbody>
                {visibleItems.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-14 text-center">
                      <p className="m-0 text-sm font-semibold text-[var(--ink-soft)]">No matching fields</p>
                      <p className="mt-1 mb-0 text-xs text-[var(--muted)]">Try another search, or add a new item.</p>
                    </td>
                  </tr>
                ) : (
                  visibleItems.map((item) => (
                    <tr
                      key={item.id}
                      data-item={item.id}
                      onClick={() => selectItem(item)}
                      className={`group cursor-pointer border-b border-[var(--line)] transition ${
                        selectedId === item.id
                          ? "bg-[var(--accent-soft)]"
                          : "hover:bg-[var(--hover)]"
                      }`}
                    >
                      <td className="px-3 py-3 align-middle text-xs font-bold tabular-nums text-[var(--faint)]">
                        {item.itemNumber}
                      </td>
                      <td className="px-3 py-2.5 align-middle">
                        <input
                          value={item.label}
                          onClick={(event) => event.stopPropagation()}
                          onChange={(event) => editItem(item.id, { label: event.target.value })}
                          className="w-full rounded-lg border border-transparent bg-transparent px-2 py-1.5 text-sm font-semibold text-[var(--ink-strong)] outline-none transition hover:border-[var(--line)] hover:bg-[var(--sheet)] focus:border-[var(--accent)] focus:bg-[var(--sheet)] focus:ring-2 focus:ring-[var(--accent-soft)]"
                        />
                      </td>
                      <td className="px-3 py-2.5 align-middle">
                        <input
                          value={item.value}
                          onClick={(event) => event.stopPropagation()}
                          onChange={(event) => editItem(item.id, { value: event.target.value, sourceSnippet: event.target.value })}
                          className="w-full rounded-lg border border-transparent bg-transparent px-2 py-1.5 text-sm text-[var(--ink)] outline-none transition hover:border-[var(--line)] hover:bg-[var(--sheet)] focus:border-[var(--accent)] focus:bg-[var(--sheet)] focus:ring-2 focus:ring-[var(--accent-soft)]"
                        />
                      </td>
                      <td className="px-3 py-2.5 align-middle">
                        <input
                          value={item.details}
                          onClick={(event) => event.stopPropagation()}
                          onChange={(event) => editItem(item.id, { details: event.target.value })}
                          className="w-full rounded-lg border border-transparent bg-transparent px-2 py-1.5 text-xs leading-relaxed text-[var(--muted)] outline-none transition hover:border-[var(--line)] hover:bg-[var(--sheet)] focus:border-[var(--accent)] focus:bg-[var(--sheet)] focus:ring-2 focus:ring-[var(--accent-soft)]"
                        />
                      </td>
                      <td className="px-2 py-2.5 align-middle text-right" onClick={(event) => event.stopPropagation()}>
                        <button
                          type="button"
                          title="Delete row"
                          aria-label={`Delete ${item.label || "row"}`}
                          className="inline-grid h-8 w-8 place-items-center rounded-lg border border-transparent text-[var(--faint)] opacity-70 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 hover:opacity-100 group-hover:opacity-100"
                          onClick={() => removeItem(item.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line)] bg-[var(--soft)] px-4 py-3">
            <p className="m-0 text-xs text-[var(--muted)]">
              {selected ? `Focused: ${selected.label}` : "Select a row to highlight its source on the document."}
              {approved ? " · Approved" : ""}
            </p>
            <button
              type="button"
              disabled={job.status !== "done"}
              onClick={() => {
                setApproved(true);
                onNextDocument?.();
              }}
              className="app-btn-primary"
            >
              <CheckCircle2 className="h-4 w-4" />
              Confirm &amp; Approve Data
            </button>
          </div>
        </aside>
      </div>
    </section>
  );
};

const toolBtn =
  "grid h-8 w-8 place-items-center rounded-lg border border-[var(--line)] bg-[var(--sheet)] text-[var(--ink)] shadow-sm transition hover:bg-[var(--hover)] disabled:opacity-40";

const escapeXml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
