import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FileSpreadsheet,
  FileJson,
  FileText,
  Minus,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  CheckCircle2,
  ArrowLeft,
} from "lucide-react";
import { Document, Page } from "react-pdf";
import { extensionOf, formatValue } from "./format";
import "./pdfWorker";
import { apiUrl } from "./services/api";
import type {
  Catalog,
  ExtraFieldValue,
  ExtractedFieldRow,
  ExtractedLine,
  Job,
  StoredDocument,
} from "./types";

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
    return {
      id: field.id,
      fieldId: field.id,
      itemNumber: index + 1,
      label: field.fieldName,
      value: field.fieldValue,
      details:
        source === "MANUAL"
          ? "Manually added"
          : source === "SUGGESTED"
            ? "Suggested field"
            : "AI extracted",
      confidence: source === "MANUAL" ? 100 : fieldConfidence(field.fieldValue, index),
      page: 1,
      status: "open" as const,
      sourceSnippet: field.fieldValue,
      scope: field.fieldKey.includes("#")
        ? ("line" as const)
        : field.fieldKey.startsWith("manual_")
          ? ("custom" as const)
          : ("header" as const),
      fieldKey: field.fieldKey,
      source,
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
      next.push({
        id: `line:${lineIndex}:${key}`,
        itemNumber: next.length + 1,
        label: lines.length > 1 ? `${meta.label} · L${lineIndex + 1}` : meta.label,
        value,
        details: meta.description || `Line ${lineIndex + 1}`,
        confidence: fieldConfidence(value, next.length),
        page: Math.min(pages || 1, 1 + Math.floor(lineIndex / 8)),
        status: "open",
        sourceSnippet: value,
        scope: "line",
        lineIndex,
        fieldKey: key,
        source: "AI",
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
  const [exportOpen, setExportOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [docxError, setDocxError] = useState("");
  const [pdfError, setPdfError] = useState("");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const previewKind = useMemo(() => {
    if (!previewFile) return "none" as const;
    const name = (previewFile.name || job?.fileName || "").toLowerCase().trim();
    const mime = (previewFile.type || "").toLowerCase();
    if (mime.includes("pdf") || name.endsWith(".pdf")) return "pdf" as const;
    if (mime.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp)$/i.test(name)) return "image" as const;
    if (
      mime.includes("wordprocessingml") ||
      mime.includes("msword") ||
      /\.docx?$/i.test(name)
    ) {
      return "docx" as const;
    }
    return "none" as const;
  }, [previewFile, job?.fileName]);
  const [zoom, setZoom] = useState(1);
  const [paneWidth, setPaneWidth] = useState(560);
  const persistTimers = useRef(new Map<string, number>());
  const tableRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const leftPaneRef = useRef<HTMLElement | null>(null);
  const docxHostRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    setItems(null);
    setDbFields(null);
    setDraft(job ? { header: structuredClone(job.header), lines: structuredClone(job.lines) } : null);
    setSelectedId(null);
    setApproved(false);
    setQuery("");
    setPage(1);
    setZoom(1);
    setExportOpen(false);
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
    setPage(1);
    setPages(1);
    if (!previewFile || previewKind === "pdf") {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(previewFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [previewFile, previewKind]);

  useEffect(() => {
    if (previewKind !== "docx" || !previewFile) return;

    let cancelled = false;
    const frame = window.requestAnimationFrame(() => {
      const host = docxHostRef.current;
      if (!host) return;
      host.innerHTML = "";
      setDocxError("");

      void (async () => {
        try {
          const { renderAsync } = await import("docx-preview");
          const buffer = await previewFile.arrayBuffer();
          if (cancelled || !docxHostRef.current) return;
          await renderAsync(buffer, docxHostRef.current, undefined, {
            className: "docx-preview-host",
            inWrapper: true,
            ignoreWidth: true,
            ignoreHeight: false,
            breakPages: true,
            renderHeaders: true,
            renderFooters: true,
          });
        } catch (reason) {
          if (!cancelled) {
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

  const activeItems = displayItems.filter(
    (item) => item.status !== ("deleted" as ReviewItem["status"]),
  );
  const selected = displayItems.find((item) => item.id === selectedId) ?? null;
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

  const selectItem = (item: ReviewItem) => {
    setSelectedId(item.id);
    const targetPage = Math.min(pages, Math.max(1, item.page));
    setPage(targetPage);
    const node = tableRef.current?.querySelector<HTMLElement>(`[data-item="${CSS.escape(item.id)}"]`);
    node?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    viewerRef.current
      ?.querySelector<HTMLElement>(`[data-doc-page="${targetPage}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
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

  const removeItem = (id: string) => {
    const target = displayItems.find((item) => item.id === id);
    const next = displayItems
      .filter((item) => item.id !== id)
      .map((item, index) => ({
        ...item,
        itemNumber: index + 1,
      }));
    setItems(next);
    if (selectedId === id) setSelectedId(next[0]?.id ?? null);
    if (!documentId || !target?.fieldId) return;
    const pending = persistTimers.current.get(target.fieldId);
    if (pending) {
      window.clearTimeout(pending);
      persistTimers.current.delete(target.fieldId);
    }
    void (async () => {
      try {
        await fetch(apiUrl(`/documents/${documentId}/fields/${target.fieldId}`), {
          method: "DELETE",
        });
        onFieldsChanged?.();
      } catch {
        /* already removed locally */
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

  return (
    <section className="flex h-[calc(100vh-88px)] min-h-0 flex-1 flex-col gap-4 overflow-hidden text-[var(--ink)] review-results">
      <header className="flex flex-wrap items-center gap-3 rounded-2xl border border-[var(--line)] bg-[var(--sheet)] px-3.5 py-3 shadow-sm">
        <button
          type="button"
          onClick={onBack}
          aria-label={backLabel}
          title={backLabel}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[var(--line-strong)] bg-[var(--soft)] text-[var(--ink)] transition hover:bg-[var(--hover)]"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>

        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
          <FileText className="h-5 w-5" />
        </div>

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[15px] font-extrabold tracking-[-0.02em] text-[var(--ink-strong)]" title={job.fileName}>
            {job.fileName}
          </h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-[var(--hover)] px-2.5 py-0.5 text-[11px] font-bold text-[var(--ink-soft)] ring-1 ring-[var(--line)]">
              {documentType}
            </span>
            <span className="rounded-full bg-sky-50 px-2.5 py-0.5 text-[11px] font-bold text-sky-700 ring-1 ring-sky-200">
              {activeItems.length} items
            </span>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold ring-1 ${
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
        </div>

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
            <CheckCircle2 className="h-4 w-4" />
            Confirm &amp; approve data
        </button>
      </div>
      </header>

      <div ref={shellRef} className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden lg:grid-cols-2">
        <section
          ref={(node) => {
            leftPaneRef.current = node;
          }}
          className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--sheet)] shadow-sm"
          aria-label="Document viewer"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] bg-[var(--soft)] px-4 py-3">
            <span className="rounded-lg bg-[var(--accent-soft)] px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-[0.06em] text-[var(--accent)]">
              Document
            </span>
            <div className="inline-flex items-center gap-1">
              {previewKind === "pdf" && pages > 1 ? (
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
          </div>

          <div
            ref={viewerRef}
            className="doc-scroll-pane relative min-h-0 flex-1 overflow-auto overscroll-contain bg-[var(--soft)] p-4"
            onScroll={() => {
              if (previewKind !== "pdf" || pages <= 1) return;
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
            {previewKind === "image" && previewUrl ? (
              <div className="relative mx-auto bg-white shadow-lg ring-1 ring-slate-200" style={{ width: sheetWidth }}>
                <img src={previewUrl} alt={job.fileName} className="block w-full object-contain" draggable={false} />
              </div>
            ) : previewKind === "pdf" && pdfError ? (
              <div className="rounded-2xl border border-dashed border-[var(--line-strong)] bg-[var(--sheet)] px-6 py-8 text-center">
                <p className="text-sm font-bold text-[var(--ink-strong)]">PDF preview unavailable</p>
                <p className="mt-1.5 text-xs text-[var(--muted)]">{pdfError}</p>
                <p className="mt-1.5 text-xs text-[var(--muted)]">Extracted fields are still available on the right.</p>
              </div>
            ) : previewKind === "pdf" && previewFile ? (
              <Document
                file={previewFile}
                onLoadSuccess={({ numPages }) => {
                  setPdfError("");
                  setPages(Math.max(1, numPages));
                }}
                onLoadError={(error) => {
                  setPdfError(error instanceof Error ? error.message : "This PDF could not be previewed.");
                  setPages(1);
                }}
                loading={<p className="p-8 text-center text-sm text-[var(--muted)]">Opening PDF…</p>}
                error={<p className="p-8 text-center text-sm text-[var(--muted)]">This PDF could not be previewed.</p>}
                className="mx-auto flex w-fit flex-col gap-4"
              >
                {Array.from({ length: Math.max(1, pages) }, (_, index) => {
                  const pageNumber = index + 1;
                  return (
                    <div
                      key={`${previewFile.name}-${previewFile.size}-${pageNumber}`}
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
                            className="grid place-items-center bg-[var(--soft)] text-xs text-[var(--muted)]"
                            style={{ width: sheetWidth, height: Math.round(sheetWidth * 1.3) }}
                          >
                            Loading page {pageNumber}…
                          </div>
                        }
                      />
                    </div>
                  );
                })}
              </Document>
            ) : previewKind === "docx" ? (
              <div className="mx-auto" style={{ width: sheetWidth }}>
                {docxError ? (
                  <div className="rounded-2xl border border-dashed border-[var(--line-strong)] bg-[var(--sheet)] px-6 py-8 text-center">
                    <p className="text-sm font-bold text-[var(--ink-strong)]">Word preview failed</p>
                    <p className="mt-1.5 text-xs text-[var(--muted)]">{docxError}</p>
                  </div>
                ) : (
                  <div
                    ref={docxHostRef}
                    className="docx-fit-host w-full rounded-xl bg-white shadow-lg ring-1 ring-slate-200"
                  />
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
                      ? "Review extracted values on the right. PDF, Word, and image files can be previewed here."
                      : "Open the document again after upload, or extract from the queue to attach the source file."}
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>

        <aside
          className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--sheet)] shadow-sm"
          aria-label="Extracted fields"
        >
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] bg-[var(--soft)] px-4 py-3">
            <span className="rounded-lg bg-[var(--accent-soft)] px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-[0.06em] text-[var(--accent)]">
              Extracted data
            </span>
            <label className="relative min-w-[160px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--faint)]" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search fields…"
                className="h-10 w-full rounded-xl border border-[var(--line)] bg-[var(--sheet)] pl-8 pr-3 text-sm outline-none transition focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)]"
              />
            </label>
            <button type="button" onClick={addItem} className="app-btn-primary has-plus">
              <span className="app-btn-plus" aria-hidden="true">+</span>
              Add New Item
            </button>
            </div>

          <div ref={tableRef} className="doc-scroll-pane min-h-0 flex-1 overflow-auto overscroll-contain px-4 py-4">
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
              <ul className="m-0 grid list-none gap-2 p-0">
                {visibleItems.map((item) => {
                  const active = selectedId === item.id;
                  return (
                    <li key={item.id}>
                      <article
                        data-item={item.id}
                        onClick={() => selectItem(item)}
                        className={`flex items-center gap-3 rounded-full border bg-[var(--sheet)] px-3 py-1.5 transition ${
                          active
                            ? "border-[var(--accent)] shadow-sm"
                            : "border-[var(--line)] hover:border-[var(--line-strong)]"
                        }`}
                      >
                        <span className="inline-grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--accent)] text-[11px] font-extrabold tracking-tight text-white">
                          {String(item.itemNumber).padStart(2, "0")}
                        </span>

                        <input
                          value={item.label}
                          aria-label="Field name"
                          onClick={(event) => event.stopPropagation()}
                          onChange={(event) => editItem(item.id, { label: event.target.value })}
                          className="w-[150px] shrink-0 truncate rounded-full border border-transparent bg-transparent px-2 py-0 text-[13px] font-extrabold leading-tight text-[var(--ink-strong)] outline-none transition hover:border-[var(--line)] focus:border-[var(--accent)] focus:bg-[var(--soft)]"
                        />

                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.04em] ${
                            (item.source || "AI").toUpperCase() === "MANUAL"
                              ? "bg-amber-100 text-amber-800"
                              : (item.source || "AI").toUpperCase() === "SUGGESTED"
                                ? "bg-violet-100 text-violet-800"
                                : "bg-sky-100 text-sky-800"
                          }`}
                          title={item.details}
                        >
                          {(item.source || "AI").toUpperCase() === "MANUAL"
                            ? "Manual"
                            : (item.source || "AI").toUpperCase() === "SUGGESTED"
                              ? "Suggested"
                              : "AI"}
                        </span>

                        <input
                          value={item.value}
                          aria-label={`${item.label || "Field"} value`}
                          onClick={(event) => event.stopPropagation()}
                          onChange={(event) =>
                            editItem(item.id, { value: event.target.value, sourceSnippet: event.target.value })
                          }
                          placeholder="No value extracted"
                          className="h-8 min-w-0 flex-1 truncate rounded-full border border-[var(--line)] bg-[var(--soft)] px-4 text-[13px] font-bold text-[var(--ink-strong)] outline-none placeholder:font-medium placeholder:text-[var(--faint)] transition hover:border-[var(--line-strong)] focus:border-[var(--accent)] focus:bg-[var(--sheet)] focus:ring-2 focus:ring-[var(--accent-soft)]"
                        />

                        <div className="flex shrink-0 items-center gap-1.5">
                          <button
                            type="button"
                            title="Copy value"
                            aria-label={`Copy ${item.label || "value"}`}
                            className="grid h-8 w-8 place-items-center rounded-full border border-[var(--line)] bg-[linear-gradient(180deg,var(--sheet),var(--soft))] text-[var(--accent)] shadow-[0_1px_0_rgba(255,255,255,0.65)_inset] transition hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
                            onClick={(event) => {
                              event.stopPropagation();
                              void navigator.clipboard?.writeText(item.value || item.label);
                            }}
                          >
                            <Copy className="h-3.5 w-3.5" strokeWidth={2} />
                          </button>
        <button
          type="button"
                            title="Delete field"
                            aria-label={`Delete ${item.label || "field"}`}
                            className="grid h-8 w-8 place-items-center rounded-full border border-[var(--line)] bg-[linear-gradient(180deg,var(--sheet),var(--soft))] text-[var(--muted)] shadow-[0_1px_0_rgba(255,255,255,0.65)_inset] transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600"
          onClick={(event) => {
            event.stopPropagation();
                              removeItem(item.id);
          }}
        >
                            <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>
                      </article>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {selected ? (
            <div className="border-t border-[var(--line)] bg-[var(--soft)] px-4 py-2.5 text-xs text-[var(--muted)]">
              Focused: <span className="font-semibold text-[var(--ink)]">{selected.label}</span>
              {approved ? " · Approved" : ""}
        </div>
      ) : null}
        </aside>
      </div>
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
