import { useState } from "react";
import { FALLBACK_ACCEPT } from "../format";
import type { SourceDocument } from "./matching";

type DocumentStageProps = {
  documents: SourceDocument[];
  activeId: string | null;
  onAdd: (files: File[]) => void;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
};

const fileSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const FileInput = ({
  className,
  label,
  onAdd,
  withPlus = false,
}: {
  className?: string;
  label: string;
  onAdd: (files: File[]) => void;
  withPlus?: boolean;
}) => (
  <label className={className}>
    {withPlus ? <span className="tm-btn-plus" aria-hidden="true">+</span> : null}
    {label}
    <input
      type="file"
      multiple
      hidden
      accept={FALLBACK_ACCEPT.join(",")}
      onChange={(event) => {
        const files = [...(event.target.files ?? [])];
        event.target.value = "";
        if (files.length) onAdd(files);
      }}
    />
  </label>
);

export const DocumentStage = ({
  documents,
  activeId,
  onAdd,
  onSelect,
  onRemove,
}: DocumentStageProps) => {
  const [over, setOver] = useState(false);
  const reading = documents.filter((document) => document.status === "reading").length;

  const take = (list: FileList | null) => {
    const files = [...(list ?? [])];
    if (files.length) onAdd(files);
  };

  const fieldCount = (document: SourceDocument) =>
    (document.suggestions?.matched.length ?? 0) + (document.suggestions?.suggested.length ?? 0);

  return (
    <section className="tm-panel tm-canvas tm-canvas-list-only">
      <div className="tm-canvas-head">
        <div>
          <h2>Document Anchor Mapper</h2>
          <p className="tm-caption">
            {reading > 0
              ? `Extracting schema fields from ${reading} file${reading === 1 ? "" : "s"}…`
              : documents.length
                ? "Select a file to review its extracted fields on the left."
                : "Upload sample documents to extract schema fields."}
          </p>
        </div>
        <div className="tm-canvas-head-actions">
          {documents.length > 0 && (
            <FileInput
              className="tm-btn tm-btn-primary tm-add-files has-plus"
              label="Add more files"
              withPlus
              onAdd={onAdd}
            />
          )}
        </div>
      </div>

      {documents.length === 0 ? (
        <label
          className={over ? "tm-drop empty over" : "tm-drop empty"}
          onDragEnter={(event) => {
            event.preventDefault();
            setOver(true);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setOver(false);
            take(event.dataTransfer.files);
          }}
        >
          <span className="tm-drop-mark" aria-hidden="true">
            ↑
          </span>
          <strong>Drop documents here</strong>
          <span>PDF, Word, Excel, text, or image · multiple files allowed</span>
          <input
            type="file"
            multiple
            hidden
            accept={FALLBACK_ACCEPT.join(",")}
            onChange={(event) => {
              take(event.target.files);
              event.target.value = "";
            }}
          />
        </label>
      ) : (
        <ul
          className="tm-files tm-files-only"
          onDragOver={(event) => {
            event.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setOver(false);
            take(event.dataTransfer.files);
          }}
        >
          {documents.map((document) => (
            <li key={document.id}>
              <button
                type="button"
                draggable={false}
                className={`tm-file ${document.id === activeId ? "active" : ""} ${document.status === "reading" ? "reading" : ""}`}
                onClick={() => onSelect(document.id)}
                onDragStart={(event) => event.preventDefault()}
              >
                <span className="tm-file-mark" aria-hidden="true">
                  {document.file.name.split(".").pop()?.slice(0, 3).toUpperCase() || "FILE"}
                </span>
                <span className="tm-file-copy">
                  <span className="tm-file-name">{document.file.name}</span>
                  <span className="tm-file-kind">{fileSize(document.file.size)} · sample</span>
                </span>
                <span className={`tm-file-state ${document.status}`}>
                  {document.status === "reading" ? (
                    <>
                      <span className="tm-extract-spinner sm" aria-hidden="true" />
                      Extracting…
                    </>
                  ) : document.status === "error" ? (
                    document.message || "Failed"
                  ) : (
                    `Ready (${fieldCount(document)} fields)`
                  )}
                </span>
              </button>
              <button
                type="button"
                className="tm-file-remove"
                aria-label={`Remove ${document.file.name}`}
                onClick={() => onRemove(document.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
