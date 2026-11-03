import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { extensionOf, formatUsd, formatValue } from "./format";
import { DocumentsPanel } from "./DocumentsPanel";
import type {
  Catalog,
  CatalogField,
  ExtraFieldValue,
  ExtractedLine,
  Job,
  StoredDocument,
} from "./types";

type ResultsProps = {
  catalog: Catalog | null;
  job: Job | null;
  documents: StoredDocument[];
};

const NARROW_TYPES = new Set(["NUMBER", "CODE", "DATE", "ENUM"]);

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

type Draft = {
  header: Record<string, ExtraFieldValue>;
  lines: ExtractedLine[];
};

type ResultTab = "details" | "documents" | "lines";

const RESULT_TABS: ResultTab[] = ["details", "documents", "lines"];

export const Results = ({ catalog, job, documents }: ResultsProps) => {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<ResultTab>("details");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [openLines, setOpenLines] = useState<Set<number>>(() => new Set());
  const touched = useRef(false);
  const header = draft?.header ?? job?.header ?? {};
  const lines = draft?.lines ?? job?.lines ?? [];
  const template = job?.template ?? null;
  const headerFields = (catalog?.header ?? []).filter(
    (field) => !template || template.headerKeys.includes(field.key),
  );
  const lineFields = (catalog?.lines ?? []).filter(
    (field) => !template || template.lineKeys.includes(field.key),
  );
  const needle = query.trim().toLowerCase();
  const filtered = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => !needle || haystack(line).includes(needle));

  useEffect(() => {
    touched.current = false;
    setQuery("");
    setTab("details");
    setDraft(null);
    setOpenLines(new Set());
  }, [job?.id]);

  useEffect(() => {
    if (!job || touched.current) return;
    setDraft({
      header: structuredClone(job.header),
      lines: structuredClone(job.lines),
    });
  }, [job]);

  const title = formatValue(header.document_title) || job?.fileName || "Document";

  const editHeader = (key: string, value: string) => {
    if (!job) return;
    touched.current = true;
    setDraft((current) => {
      const base = current ?? {
        header: structuredClone(job.header),
        lines: structuredClone(job.lines),
      };
      return { ...base, header: { ...base.header, [key]: value } };
    });
  };

  const editLine = (index: number, key: string, value: string) => {
    if (!job) return;
    touched.current = true;
    setDraft((current) => {
      const base = current ?? {
        header: structuredClone(job.header),
        lines: structuredClone(job.lines),
      };
      return {
        ...base,
        lines: base.lines.map((line, lineIndex) =>
          lineIndex === index ? applyLineField(line, key, value) : line,
        ),
      };
    });
  };

  const toggleLine = (index: number) => {
    setOpenLines((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  if (!job) return null;

  return (
    <section className="sheet" data-status={job.status}>
      <header className="sheet-head">
        <div>
          <p className="kicker">{extensionOf(job.fileName).replace(".", "") || "file"}</p>
          <h2>{title}</h2>
          {formatValue(header.document_title) && (
            <p className="file-name">{job.fileName}</p>
          )}
        </div>
      </header>

      {(tab === "details" || tab === "lines") && <p className="muted">Correct any value.</p>}
      <div className="view-tabs" role="tablist" aria-label="Extracted document">
        <button
          type="button"
          role="tab"
          id="details-tab"
          aria-selected={tab === "details"}
          aria-controls="details-panel"
          tabIndex={tab === "details" ? 0 : -1}
          onClick={() => setTab("details")}
          onKeyDown={(event) => moveTab(event, setTab)}
        >
          Details
        </button>
        <button
          type="button"
          role="tab"
          id="documents-tab"
          aria-selected={tab === "documents"}
          aria-controls="documents-panel"
          tabIndex={tab === "documents" ? 0 : -1}
          onClick={() => setTab("documents")}
          onKeyDown={(event) => moveTab(event, setTab)}
        >
          Documents <span>{documents.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          id="lines-tab"
          aria-selected={tab === "lines"}
          aria-controls="lines-panel"
          tabIndex={tab === "lines" ? 0 : -1}
          onClick={() => setTab("lines")}
          onKeyDown={(event) => moveTab(event, setTab)}
        >
          Line items <span>{lines.length}</span>
        </button>
      </div>

      {tab === "documents" ? (
        <section
          className="block"
          role="tabpanel"
          id="documents-panel"
          aria-labelledby="documents-tab"
        >
          <DocumentsPanel documents={documents} />
        </section>
      ) : tab === "details" ? (
        <section
          className="block"
          role="tabpanel"
          id="details-panel"
          aria-labelledby="details-tab"
        >
          {headerFields.length > 0 ? (
            <div className="field-grid header-fields">
              {headerFields.map((field) => (
                <FieldBox
                  key={field.key}
                  label={field.label}
                  description={field.description}
                  value={formatValue(header[field.key])}
                  onChange={(value) => editHeader(field.key, value)}
                  onFocus={() => {
                    touched.current = true;
                  }}
                />
              ))}
            </div>
          ) : (
            <p className="muted">
              {job.status === "running"
                ? "Header fields appear after the line items."
                : "No header fields were found in this file."}
            </p>
          )}
        </section>
      ) : (
        <section
          className="block"
          role="tabpanel"
          id="lines-panel"
          aria-labelledby="lines-tab"
        >
          {lines.length > 6 && (
            <div className="block-head">
              <input
                type="search"
                value={query}
                placeholder="Search lines"
                aria-label="Search lines"
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          )}
          {lines.length === 0 ? (
            <>
              <p className="muted">
                {job.status === "running"
                  ? "Waiting for the first line."
                  : "No buy lines were found in this file."}
              </p>
              <LineFields
                fields={template ? lineFields : lineFields.filter((field) => field.isDefault)}
                line={null}
              />
            </>
          ) : filtered.length === 0 ? (
            <p className="muted">No lines match that search.</p>
          ) : (
            <div className="line-list">
              {filtered.map(({ line, index }) => (
                <LineCard
                  key={`line-${index}`}
                  index={index}
                  line={line}
                  fields={lineFields}
                  templateFields={Boolean(template)}
                  open={openLines.has(index)}
                  onToggle={() => toggleLine(index)}
                  onChange={(key, value) => editLine(index, key, value)}
                  onFocus={() => {
                    touched.current = true;
                  }}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {job.status === "done" && (
        <footer className="sheet-foot">
          Total {formatUsd(job.lineCostUsd + job.headerCostUsd)}
        </footer>
      )}
    </section>
  );
};

const LineCard = ({
  index,
  line,
  fields,
  templateFields,
  open,
  onToggle,
  onChange,
  onFocus,
}: {
  index: number;
  line: ExtractedLine;
  fields: CatalogField[];
  templateFields: boolean;
  open: boolean;
  onToggle: () => void;
  onChange: (key: string, value: string) => void;
  onFocus: () => void;
}) => {
  const defaults = fields.filter((field) => field.isDefault);
  const titleField =
    defaults.find((field) => field.dataType === "TEXT") ?? defaults[0] ?? fields[0];
  const meta = defaults
    .filter((field) => field.key !== titleField?.key && NARROW_TYPES.has(field.dataType))
    .slice(0, 3);
  const title = titleField ? lineFieldValue(line, titleField.key) : "";
  const detailsId = `line-details-${index}`;

  return (
    <article className={open ? "line-card open" : "line-card"}>
      <div className="line-bar" onClick={onToggle}>
        <div className="line-brief">
          <p className="line-index">Line {index + 1}</p>
          <p className={title ? "line-title" : "line-title empty-value"}>{title || "No value"}</p>
          {meta.map((field) => {
            const value = lineFieldValue(line, field.key);
            if (!value) return null;
            return (
              <p className="line-meta" key={field.key}>
                <span>{field.label}</span>
                {value}
              </p>
            );
          })}
        </div>
        <button
          type="button"
          className="line-arrow"
          aria-expanded={open}
          aria-controls={detailsId}
          aria-label={open ? `Hide line ${index + 1} details` : `Show line ${index + 1} details`}
          onClick={(event) => {
            event.stopPropagation();
            onToggle();
          }}
        >
          <svg viewBox="0 0 24 24" className={open ? "point-up" : undefined} aria-hidden="true">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      </div>
      {open ? (
        <div id={detailsId}>
          <LineFields
            fields={
              templateFields
                ? fields
                : fields.filter((field) => field.isDefault || field.key in (line.fields ?? {}))
            }
            line={line}
            onChange={onChange}
            onFocus={onFocus}
          />
        </div>
      ) : null}
    </article>
  );
};

const LineFields = ({
  fields,
  line,
  onChange,
  onFocus,
}: {
  fields: CatalogField[];
  line: ExtractedLine | null;
  onChange?: (key: string, value: string) => void;
  onFocus?: () => void;
}) => (
  <div className="field-grid">
    {fields.map((field) => (
      <FieldBox
        key={field.key}
        label={field.label}
        description={field.description}
        value={lineFieldValue(line, field.key)}
        wide={!NARROW_TYPES.has(field.dataType)}
        onChange={onChange ? (value) => onChange(field.key, value) : undefined}
        onFocus={onFocus}
      />
    ))}
  </div>
);

const FieldBox = ({
  label,
  description,
  value,
  wide,
  onChange,
  onFocus,
}: {
  label: string;
  description: string;
  value: string;
  wide?: boolean;
  onChange?: (value: string) => void;
  onFocus?: () => void;
}) => (
  <label className={wide ? "field wide" : "field"} title={description}>
    <span>{label}</span>
    {onChange ? (
      wide ? (
        <textarea
          className={value ? "value" : "value empty-value"}
          value={value}
          rows={3}
          onFocus={onFocus}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          className={value ? "value" : "value empty-value"}
          value={value}
          onFocus={onFocus}
          onChange={(event) => onChange(event.target.value)}
        />
      )
    ) : (
      <div className={value ? "value" : "value empty-value"}>{value || "—"}</div>
    )}
  </label>
);

const moveTab = (
  event: KeyboardEvent<HTMLButtonElement>,
  setTab: (tab: ResultTab) => void,
) => {
  if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
  event.preventDefault();
  const current = event.currentTarget.id.replace("-tab", "") as ResultTab;
  const index = RESULT_TABS.indexOf(current);
  const step = event.key === "ArrowRight" ? 1 : -1;
  const next = RESULT_TABS[(index + step + RESULT_TABS.length) % RESULT_TABS.length] ?? "details";
  setTab(next);
  document.getElementById(`${next}-tab`)?.focus();
};

const haystack = (line: ExtractedLine) =>
  Object.values(line.fields ?? {})
    .map((value) => formatValue(value))
    .join(" ")
    .toLowerCase();
