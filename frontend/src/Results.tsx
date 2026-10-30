import { useEffect, useMemo, useRef, useState } from "react";
import {
  downloadText,
  extensionOf,
  formatManufacturers,
  formatUsd,
  formatValue,
  linesToCsv,
  manufacturersOf,
} from "./format";
import type { Catalog, CatalogField, ExtraFieldValue, ExtractedLine, Job } from "./types";

type ResultsProps = {
  catalog: Catalog | null;
  job: Job | null;
};

const NARROW_LINE_FIELDS = new Set(["line_no", "quantity", "uom", "currency"]);

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
  if (key === "line_no") return line.customerItemNumber;
  if (key === "short_description") return line.description;
  if (key === "product_name") return line.productName;
  if (key === "technical_specification") return line.technicalSpecification;
  if (key === "quantity") return line.quantity;
  if (key === "uom") return line.unitOfMeasure;
  if (key === "currency") return line.currency;
  if (key === "manufacturers") return formatManufacturers(line);
  if (key.startsWith("extra:")) return formatValue(line.extraFields?.[key.slice(6)]);
  return formatValue(line.extraFields?.[key]);
};

const applyLineField = (line: ExtractedLine, key: string, value: string): ExtractedLine => {
  let next = line;
  if (key === "line_no") next = { ...line, customerItemNumber: value };
  else if (key === "short_description") next = { ...line, description: value };
  else if (key === "product_name") next = { ...line, productName: value };
  else if (key === "technical_specification") next = { ...line, technicalSpecification: value };
  else if (key === "quantity") next = { ...line, quantity: value };
  else if (key === "uom") next = { ...line, unitOfMeasure: value };
  else if (key === "currency") next = { ...line, currency: value };
  else if (key === "manufacturers") {
    const manufacturers = value.split("\n").flatMap((row) => {
      const separator = row.indexOf(" · ");
      const name = separator < 0 ? row.trim() : row.slice(0, separator).trim();
      const partNumber = separator < 0 ? "" : row.slice(separator + 3).trim();
      return name || partNumber ? [{ name, partNumber }] : [];
    });
    next = {
      ...line,
      manufacturers,
      manufacturer: manufacturers[0]?.name ?? "",
      partNumber: manufacturers[0]?.partNumber ?? "",
    };
  } else if (key.startsWith("extra:")) {
    next = {
      ...line,
      extraFields: { ...line.extraFields, [key.slice(6)]: value },
    };
  } else {
    next = {
      ...line,
      extraFields: { ...line.extraFields, [key]: value },
    };
  }
  const previous = typedText.get(line);
  if (previous) typedText.set(next, new Map(previous));
  return rememberText(next, key, value);
};

type Draft = {
  header: Record<string, ExtraFieldValue>;
  lines: ExtractedLine[];
};

const numberedLines = (lines: ExtractedLine[]) =>
  lines.map((line, index) => ({
    ...line,
    customerItemNumber: String(index + 1),
  }));

export const Results = ({ catalog, job }: ResultsProps) => {
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const touched = useRef(false);
  const header = draft?.header ?? job?.header ?? {};
  const lines = draft?.lines ?? numberedLines(job?.lines ?? []);
  const extraFields = useMemo(
    () => (catalog?.lines ?? []).filter((field) => !field.isDefault),
    [catalog],
  );
  const headerFields = catalog?.header ?? [];
  const needle = query.trim().toLowerCase();
  const filtered = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => !needle || haystack(line).includes(needle));

  const defaultFields = useMemo(
    () => (catalog?.lines ?? []).filter((field) => field.isDefault),
    [catalog],
  );

  useEffect(() => {
    touched.current = false;
    setQuery("");
    setDraft(null);
  }, [job?.id]);

  useEffect(() => {
    if (!job || touched.current) return;
    setDraft({
      header: structuredClone(job.header),
      lines: numberedLines(structuredClone(job.lines)),
    });
  }, [job]);

  const title = formatValue(header.document_title) || job?.fileName || "Document";

  const editHeader = (key: string, value: string) => {
    if (!job) return;
    touched.current = true;
    setDraft((current) => {
      const base = current ?? {
        header: structuredClone(job.header),
        lines: numberedLines(structuredClone(job.lines)),
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
        lines: numberedLines(structuredClone(job.lines)),
      };
      return {
        ...base,
        lines: base.lines.map((line, lineIndex) =>
          lineIndex === index ? applyLineField(line, key, value) : line,
        ),
      };
    });
  };

  const saveCsv = () => {
    if (!job) return;
    downloadText(
      downloadName(job.fileName, "csv"),
      linesToCsv(lines, extraFields),
      "text/csv;charset=utf-8",
    );
  };

  const saveJson = () => {
    if (!job) return;
    downloadText(
      downloadName(job.fileName, "json"),
      JSON.stringify(
        {
          fileName: job.fileName,
          header,
          lines,
          usage: job.usage,
          headerUsage: job.headerUsage,
          lineCostUsd: job.lineCostUsd,
          headerCostUsd: job.headerCostUsd,
        },
        null,
        2,
      ),
      "application/json",
    );
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
        <div className="actions">
          <button type="button" onClick={saveCsv} disabled={!lines.length}>
            Download CSV
          </button>
          <button type="button" onClick={saveJson} disabled={job.status === "running" && !lines.length}>
            Download JSON
          </button>
        </div>
      </header>

      <section className="block">
        <h3>Header</h3>
        <p className="muted">Correct any value. Downloads use what is on the page.</p>
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

      <section className="block">
        <div className="block-head">
          <h3>
            Line items <span>{lines.length}</span>
          </h3>
          {lines.length > 6 && (
            <input
              type="search"
              value={query}
              placeholder="Search lines"
              aria-label="Search lines"
              onChange={(event) => setQuery(event.target.value)}
            />
          )}
        </div>
        {lines.length === 0 ? (
          <>
            <p className="muted">
              {job.status === "running"
                ? "Waiting for the first line."
                : "No buy lines were found in this file."}
            </p>
            <LineFields fields={defaultFields} line={null} extras={[]} />
          </>
        ) : filtered.length === 0 ? (
          <p className="muted">No lines match that search.</p>
        ) : (
          <div className="line-list">
            {filtered.map(({ line, index }) => (
              <article className="line-card" key={`line-${index}`}>
                <p className="line-index">Line {index + 1}</p>
                <LineFields
                  fields={defaultFields}
                  line={line}
                  extras={extraFields.filter(
                    (field) => field.key in (line.extraFields ?? {}),
                  )}
                  onChange={(key, value) => editLine(index, key, value)}
                  onFocus={() => {
                    touched.current = true;
                  }}
                />
              </article>
            ))}
          </div>
        )}
      </section>

      {job.status === "done" && (
        <footer className="sheet-foot">
          Total {formatUsd(job.lineCostUsd + job.headerCostUsd)}
        </footer>
      )}
    </section>
  );
};

const LineFields = ({
  fields,
  line,
  extras,
  onChange,
  onFocus,
}: {
  fields: { key: string; label: string; description: string }[];
  line: ExtractedLine | null;
  extras: CatalogField[];
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
        wide={!NARROW_LINE_FIELDS.has(field.key)}
        onChange={onChange ? (value) => onChange(field.key, value) : undefined}
        onFocus={onFocus}
      />
    ))}
    {extras.map((field) => (
      <FieldBox
        key={field.key}
        label={field.label}
        description={field.description}
        value={lineFieldValue(line, `extra:${field.key}`)}
        wide
        onChange={onChange ? (value) => onChange(`extra:${field.key}`, value) : undefined}
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

const haystack = (line: ExtractedLine) =>
  [
    line.customerItemNumber,
    line.description,
    line.productName,
    line.manufacturer,
    line.partNumber,
    line.technicalSpecification,
    ...manufacturersOf(line).flatMap((maker) => [maker.name, maker.partNumber]),
    ...Object.values(line.extraFields ?? {}).map((value) => formatValue(value)),
  ]
    .join(" ")
    .toLowerCase();

const downloadName = (fileName: string, extension: string) => {
  const dot = fileName.lastIndexOf(".");
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  return `${stem}-extracted.${extension}`;
};
