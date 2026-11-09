import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { extensionOf } from "./format";
import { Results } from "./Results";
import { apiUrl } from "./services/api";
import type { ExtractedFieldRow, Job, StoredDocument } from "./types";

const uploadedAt = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const typeLabel = (document: StoredDocument) => {
  if (document.documentType?.trim()) return document.documentType;
  const ext = extensionOf(document.fileName).replace(".", "").toUpperCase();
  return ext || "Document";
};

const sourceLabel = (source: string) => {
  if (source === "MANUAL") return "Manual";
  if (source === "SUGGESTED") return "Suggested";
  if (source === "AI") return "AI";
  return source;
};

const statusClass = (status: string) => {
  const key = status.toLowerCase();
  if (key === "processing") return "processing";
  if (key === "completed") return "completed";
  if (key === "failed") return "failed";
  return "pending";
};

const jobFromDocument = (document: StoredDocument, fields: ExtractedFieldRow[]): Job => {
  const header: Record<string, string> = {};
  for (const field of fields) {
    const key = field.fieldKey?.trim() || field.fieldName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
    if (!key) continue;
    header[key] = field.fieldValue;
  }
  const done = (document.status || "").toLowerCase() === "completed" || fields.length > 0;
  return {
    id: `document-${document.id}`,
    fileName: document.fileName,
    status: done ? "done" : document.status?.toLowerCase() === "failed" ? "error" : "running",
    phase: done ? "done" : "reading",
    progress: done ? 100 : 40,
    header,
    lines: [],
    usage: { inputTokens: 0, outputTokens: 0 },
    headerUsage: { inputTokens: 0, outputTokens: 0 },
    lineCostUsd: 0,
    headerCostUsd: 0,
    template: {
      name: "Saved extraction",
      headerKeys: Object.keys(header),
      lineKeys: [],
    },
    error: null,
  };
};

export const DocumentsPage = () => {
  const [documents, setDocuments] = useState<StoredDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);
  const [fields, setFields] = useState<ExtractedFieldRow[]>([]);
  const [fieldsError, setFieldsError] = useState("");
  const [fieldsLoading, setFieldsLoading] = useState(false);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError("");
    try {
      const response = await fetch(apiUrl("/documents"));
      if (!response.ok) throw new Error("Documents could not be loaded.");
      const payload = (await response.json()) as { documents?: StoredDocument[] };
      setDocuments(payload.documents ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Documents could not be loaded.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.title = "Documents · ExtractIQ";
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!documents.some((document) => document.status === "Processing")) return;
    const timer = window.setInterval(() => void load(true), 3000);
    return () => window.clearInterval(timer);
  }, [documents, load]);

  const openDocument = useCallback(async (document: StoredDocument) => {
    setOpenId(document.id);
    setFieldsError("");
    setFieldsLoading(true);
    try {
      const response = await fetch(apiUrl(`/documents/${document.id}/fields`));
      if (!response.ok) throw new Error("Extracted fields could not be loaded.");
      const payload = (await response.json()) as { fields?: ExtractedFieldRow[] };
      setFields(payload.fields ?? []);
    } catch (reason) {
      setFields([]);
      setFieldsError(reason instanceof Error ? reason.message : "Extracted fields could not be loaded.");
    } finally {
      setFieldsLoading(false);
    }
  }, []);

  const closeReview = () => {
    setOpenId(null);
    setFields([]);
    setFieldsError("");
  };

  const removeDocument = async (document: StoredDocument) => {
    const confirmed = window.confirm(`Delete ${document.fileName}?`);
    if (!confirmed) return;
    const response = await fetch(apiUrl(`/documents/${document.id}`), { method: "DELETE" });
    if (!response.ok && response.status !== 204) {
      setError("Document could not be deleted.");
      return;
    }
    if (openId === document.id) closeReview();
    setDocuments((current) => current.filter((item) => item.id !== document.id));
  };

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return documents;
    return documents.filter((document) => {
      const hay = `${document.fileName} ${document.documentType} ${document.status} ${(document.sources ?? []).join(" ")}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [documents, query]);

  const open = documents.find((document) => document.id === openId) ?? null;
  const reviewJob = open ? jobFromDocument(open, fields) : null;

  if (open && fieldsLoading) {
    return (
      <section className="docs-page">
        <p className="hint">Opening review studio…</p>
      </section>
    );
  }

  if (open && fieldsError) {
    return (
      <section className="docs-page">
        <p className="error-text stand" role="alert">
          {fieldsError}
        </p>
        <button type="button" className="app-btn-ghost" onClick={closeReview}>
          Back to Documents
        </button>
      </section>
    );
  }

  if (open && reviewJob) {
    return (
      <Results
        catalog={null}
        job={reviewJob}
        documents={documents}
        backLabel="Back to Documents"
        onBack={closeReview}
        onNextDocument={closeReview}
      />
    );
  }

  return (
    <section className="docs-page">
      <div className="docs-toolbar">
        <label className="docs-search-wrap">
          <span className="docs-search-icon" aria-hidden="true">
            ⌕
          </span>
          <input
            className="docs-search-input"
            type="search"
            placeholder="Search documents…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search documents"
          />
        </label>
        <span className="docs-count">
          {filtered.length} of {documents.length} document{documents.length === 1 ? "" : "s"}
        </span>
        <div className="docs-head-actions">
          <button type="button" className="docs-refresh" aria-label="Refresh" title="Refresh" onClick={() => void load()}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M21 12a9 9 0 0 1-15.4 6.4" />
              <path d="M3 12a9 9 0 0 1 15.4-6.4" />
              <path d="M21 3v6h-6" />
              <path d="M3 21v-6h6" />
            </svg>
          </button>
          <Link className="docs-create-btn" to="/">
            <span className="docs-create-icon" aria-hidden="true">+</span>
            Extract new file
          </Link>
        </div>
      </div>

      {error && (
        <p className="error-text stand" role="alert">
          {error}
        </p>
      )}
      {loading && <p className="hint">Loading documents…</p>}

      {!loading && !error && documents.length === 0 && (
        <div className="docs-empty">
          <strong>No documents yet</strong>
          <p>Upload files on Extract &amp; Ingest. Extracted files are saved here automatically.</p>
          <Link className="ingest-browse" to="/">
            Go to Extract &amp; Ingest
          </Link>
        </div>
      )}

      {!loading && documents.length > 0 && filtered.length === 0 && (
        <p className="hint">No documents match that search.</p>
      )}

      {!loading && filtered.length > 0 && (
        <div className="docs-table-wrap">
          <table className="docs-table">
            <thead>
              <tr>
                <th>Document name</th>
                <th>Document type</th>
                <th>Total fields</th>
                <th>Source</th>
                <th>Status</th>
                <th>Uploaded at</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((document) => (
                <tr
                  key={document.id}
                  className={openId === document.id ? "docs-row is-open" : "docs-row"}
                  onClick={() => void openDocument(document)}
                >
                  <td>
                    <strong className="docs-file-name" title={document.fileName}>
                      {document.fileName}
                    </strong>
                  </td>
                  <td>
                    <span className="docs-type">{typeLabel(document)}</span>
                  </td>
                  <td>{document.totalFields ?? 0}</td>
                  <td>
                    <div className="docs-sources">
                      {(document.sources ?? []).length === 0 ? (
                        <span className="docs-muted">—</span>
                      ) : (
                        document.sources?.map((source) => (
                          <span key={source} className={`docs-pill source ${source.toLowerCase()}`}>
                            {sourceLabel(source)}
                          </span>
                        ))
                      )}
                    </div>
                  </td>
                  <td>
                    <span className={`docs-pill ${statusClass(document.status || "Pending")}`}>
                      {document.status || "Pending"}
                    </span>
                  </td>
                  <td className="docs-muted">{uploadedAt(document.uploadedAt)}</td>
                  <td>
                    <div className="docs-actions" onClick={(event) => event.stopPropagation()}>
                      <button
                        type="button"
                        className="docs-action view"
                        aria-label={`View ${document.fileName}`}
                        title="Review"
                        onClick={() => void openDocument(document)}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        className="docs-action edit"
                        aria-label={`Edit ${document.fileName}`}
                        title="Review & edit"
                        onClick={() => void openDocument(document)}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M12 20h9" />
                          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        className="docs-action danger"
                        aria-label={`Delete ${document.fileName}`}
                        title="Delete"
                        onClick={() => void removeDocument(document)}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M3 6h18" />
                          <path d="M8 6V4h8v2" />
                          <path d="M6 6l1 14h10l1-14" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
