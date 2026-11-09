import { useState } from "react";
import { FALLBACK_ACCEPT } from "../format";
import type { SourceDocument } from "./matching";
import { SampleViewer } from "./SampleViewer";
import type { SampleBox, TemplateField } from "./types";

type DocumentStageProps = {
  documents: SourceDocument[];
  activeId: string | null;
  fields: TemplateField[];
  selectedFieldId: string | null;
  onAdd: (files: File[]) => void;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onMap: (box: SampleBox) => void;
};

const fileSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const previewable = (file: File) => {
  const name = file.name.toLowerCase();
  return file.type.startsWith("image/") || file.type === "application/pdf" || name.endsWith(".pdf");
};

const FileInput = ({
  className,
  label,
  onAdd,
}: {
  className?: string;
  label: string;
  onAdd: (files: File[]) => void;
}) => (
  <label className={className}>
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
  fields,
  selectedFieldId,
  onAdd,
  onSelect,
  onRemove,
  onMap,
}: DocumentStageProps) => {
  const [over, setOver] = useState(false);
  const active = documents.find((document) => document.id === activeId) ?? documents[0] ?? null;
  const reading = documents.filter((document) => document.status === "reading").length;

  const take = (list: FileList | null) => {
    const files = [...(list ?? [])];
    if (files.length) onAdd(files);
  };

  return (
    <section className="tm-panel tm-canvas">
      <div className="tm-canvas-head">
        <div>
          <h2>Document Anchor Mapper</h2>
          <p className="tm-caption">
            {reading
              ? `Suggesting catalogue fields from ${reading} file${reading === 1 ? "" : "s"}…`
              : documents.length
                ? "Draw translucent boxes on the sample to anchor selected schema fields."
                : "Upload a sample (PDF, Word, Excel, text, or image). Suggestions run for every type; draw boxes on PDF or images."}
          </p>
        </div>
        {documents.length > 0 && (
          <FileInput className="tm-btn tm-add-files" label="Add files" onAdd={onAdd} />
        )}
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
          <strong>Drop a sample document</strong>
          <span>PDF, Word, Excel, text, or image · field suggestions for all · draw boxes on PDF/image</span>
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
        <>
          <ul className="tm-files">
            {documents.map((document) => (
              <li key={document.id}>
                <button
                  type="button"
                  className={document.id === active?.id ? "tm-file active" : "tm-file"}
                  onClick={() => onSelect(document.id)}
                >
                  <span className="tm-file-mark" aria-hidden="true">
                    {document.file.name.split(".").pop()?.slice(0, 3).toUpperCase() || "FILE"}
                  </span>
                  <span className="tm-file-copy">
                    <span className="tm-file-name">{document.file.name}</span>
                    <span className="tm-file-kind">{fileSize(document.file.size)} · sample</span>
                  </span>
                  <span className={`tm-file-state ${document.status}`}>
                    {document.status === "reading"
                      ? "Reading"
                      : document.status === "error"
                        ? document.message || "Failed"
                        : document.suggestions &&
                            !document.suggestions.matched.length &&
                            !document.suggestions.suggested.length
                          ? "No fields"
                          : "Ready"}
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

          <div
            className={over ? "tm-preview over" : "tm-preview"}
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
            {active && previewable(active.file) ? (
              <SampleViewer
                file={active.file}
                fields={fields}
                selectedId={selectedFieldId}
                onMap={onMap}
              />
            ) : active ? (
              <div className="tm-preview-empty">
                <strong>{active.file.name}</strong>
                <p>
                  {active.status === "reading"
                    ? "Reading this file and suggesting catalogue fields…"
                    : active.status === "error"
                      ? active.message || "This file could not be read."
                      : "This file is used for field suggestions. Open a PDF or image to draw a box over a value."}
                </p>
              </div>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
};
