import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { jobFromDocument, mimeForFileName } from "@/lib/jobFromDocument";
import { Results } from "@/components/extract/Results";
import { apiUrl } from "@/services/client";
import type { ExtractedFieldRow, StoredDocument } from "@/types";

const formatClock = (date: Date) => {
  const hour = date.getHours();
  const hour12 = hour % 12 || 12;
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const period = hour >= 12 ? "pm" : "am";
  return `${String(hour12).padStart(2, "0")}:${minutes} ${period}`;
};

const uploadedAt = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const day = date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  return `${day}, ${formatClock(date)}`;
};

const sourceFrame = (sources: string[]) => {
  const keys = new Set(sources.map((source) => source.trim().toUpperCase()));
  const ai = keys.has("AI") || keys.has("SUGGESTED");
  const manual = keys.has("MANUAL");
  if (ai && manual) return "AI/Manual";
  if (ai) return "AI";
  if (manual) return "Manual";
  return "";
};

const statusClass = (status: string) => {
  const key = status.toLowerCase();
  if (key === "processing") return "processing";
  if (key === "completed") return "completed";
  if (key === "failed") return "failed";
  return "pending";
};

const PAGE_SIZE = 10;

const pageRange = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, index) => from + index);

const paginationItems = (current: number, totalPages: number): Array<number | "ellipsis"> => {
  if (totalPages <= 7) return pageRange(1, totalPages);
  if (current <= 3 || current >= totalPages - 2) {
    return [...pageRange(1, 3), "ellipsis", ...pageRange(totalPages - 2, totalPages)];
  }
  return [1, "ellipsis", current - 1, current, current + 1, "ellipsis", totalPages];
};

export const DocumentsPage = () => {
  const [documents, setDocuments] = useState<StoredDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [gotoPage, setGotoPage] = useState("1");
  const [openId, setOpenId] = useState<number | null>(null);
  const [fields, setFields] = useState<ExtractedFieldRow[]>([]);
  const [fieldsError, setFieldsError] = useState("");
  const [fieldsLoading, setFieldsLoading] = useState(false);
  const [previewFile, setPreviewFile] = useState<File | null>(null);

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
    setPreviewFile(null);
    try {
      const fieldsResponse = await fetch(apiUrl(`/documents/${document.id}/fields`));
      if (!fieldsResponse.ok) throw new Error("Extracted fields could not be loaded.");
      const payload = (await fieldsResponse.json()) as { fields?: ExtractedFieldRow[] };
      setFields(payload.fields ?? []);
      // Open the studio as soon as fields are ready — PDF download must not block review.
      setFieldsLoading(false);

      void fetch(apiUrl(`/documents/${document.id}/file`))
        .then(async (fileResponse) => {
          if (!fileResponse.ok) return;
          const blob = await fileResponse.blob();
          const type = mimeForFileName(
            document.fileName,
            blob.type || document.mimeType || fileResponse.headers.get("Content-Type") || "",
          );
          setPreviewFile(new File([blob], document.fileName, { type }));
        })
        .catch(() => {
          /* preview stays empty; extracted fields still usable */
        });
    } catch (reason) {
      setFields([]);
      setPreviewFile(null);
      setFieldsError(reason instanceof Error ? reason.message : "Extracted fields could not be loaded.");
      setFieldsLoading(false);
    }
  }, []);

  const closeReview = () => {
    setOpenId(null);
    setFields([]);
    setFieldsError("");
    setPreviewFile(null);
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
      const hay = `${document.fileName} ${document.documentType} ${document.status} ${document.templateName ?? ""} ${document.templateId ?? ""} ${(document.sources ?? []).join(" ")}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [documents, query]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSafe = Math.min(page, pageCount);
  const paged = filtered.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [query]);

  useEffect(() => {
    setGotoPage(String(pageSafe));
    if (page !== pageSafe) setPage(pageSafe);
  }, [page, pageSafe]);

  const jumpToPage = (raw: string) => {
    const next = Number(raw);
    if (!Number.isInteger(next) || next < 1) {
      setGotoPage(String(pageSafe));
      return;
    }
    setPage(Math.min(next, pageCount));
  };

  const onGotoSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const input = event.currentTarget.elements.namedItem("docs-goto-page");
    jumpToPage(input instanceof HTMLInputElement ? input.value : gotoPage);
  };

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
      <section className="upload-page extract-studio reviewing">
        <Results
          catalog={null}
          job={reviewJob}
          documents={documents}
          previewFile={previewFile}
          documentId={open.id}
          persistedFields={fields}
          onFieldsChanged={() => void load(true)}
          backLabel="Back to Documents"
          onBack={() => {
            void load(true);
            closeReview();
          }}
          onNextDocument={() => {
            void load(true);
            closeReview();
          }}
        />
      </section>
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
          <p>Extract files on Extract &amp; Ingest, then click Save to keep them here.</p>
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
                <th>Template</th>
                <th>Name</th>
                <th>Fields</th>
                <th>Source</th>
                <th>Status</th>
                <th>Uploaded at</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((document) => {
                const source = sourceFrame(document.sources ?? []);
                return (
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
                  <td className="docs-nowrap">
                    {document.templateId == null ? (
                      <span className="docs-muted">—</span>
                    ) : (
                      document.templateId
                    )}
                  </td>
                  <td onClick={(event) => event.stopPropagation()}>
                    {document.templateId != null && document.templateName ? (
                      <Link
                        className="docs-template-link"
                        to={`/templates/${document.templateId}/edit`}
                        title={document.templateName}
                      >
                        {document.templateName}
                      </Link>
                    ) : (
                      <span className="docs-muted">—</span>
                    )}
                  </td>
                  <td>{document.totalFields ?? 0}</td>
                  <td>
                    {source ? (
                      <span className="docs-pill source">{source}</span>
                    ) : (
                      <span className="docs-muted">—</span>
                    )}
                  </td>
                  <td>
                    <span className={`docs-pill ${statusClass(document.status || "Pending")}`}>
                      {document.status || "Pending"}
                    </span>
                  </td>
                  <td className="docs-muted docs-nowrap">{uploadedAt(document.uploadedAt)}</td>
                  <td>
                    <div className="docs-actions" onClick={(event) => event.stopPropagation()}>
                      <button
                        type="button"
                        className="docs-action edit"
                        aria-label={`Edit ${document.fileName}`}
                        title="Review & edit"
                        onClick={() => void openDocument(document)}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M13.5 6.5 17.5 10.5" />
                          <path d="M4.5 19.5 8 18.5 18.2 8.3a1.6 1.6 0 0 0-2.3-2.3L5.7 16.2 4.5 19.5z" />
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
                          <path d="M5 7.5h14" />
                          <path d="M9.5 7.5V6h5v1.5" />
                          <path d="M7.5 7.5 8.2 18h7.6l.7-10.5" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="docs-pagination">
          <div className="docs-page-size">
            <span>{PAGE_SIZE}</span>
            <span>Items per page</span>
          </div>
          <div className="docs-page-numbers">
            <button
              type="button"
              aria-label="Previous page"
              disabled={pageSafe <= 1}
              onClick={() => setPage(pageSafe - 1)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M15 6 9 12l6 6" />
              </svg>
            </button>
            {paginationItems(pageSafe, pageCount).map((item, index) =>
              item === "ellipsis" ? (
                <span key={`ellipsis-${index}`} className="docs-page-ellipsis">
                  …
                </span>
              ) : (
                <button
                  key={item}
                  type="button"
                  className="docs-page-num"
                  aria-current={item === pageSafe ? "page" : undefined}
                  onClick={() => setPage(item)}
                >
                  {item}
                </button>
              ),
            )}
            <button
              type="button"
              aria-label="Next page"
              disabled={pageSafe >= pageCount}
              onClick={() => setPage(pageSafe + 1)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m9 6 6 6-6 6" />
              </svg>
            </button>
          </div>
          <form className="docs-page-goto" onSubmit={onGotoSubmit}>
            <label htmlFor="docs-goto-page">Go to page</label>
            <input
              id="docs-goto-page"
              name="docs-goto-page"
              value={gotoPage}
              inputMode="numeric"
              onChange={(event) => setGotoPage(event.target.value)}
              onBlur={(event) => jumpToPage(event.target.value)}
            />
          </form>
        </div>
      )}
    </section>
  );
};
