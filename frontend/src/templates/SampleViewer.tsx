import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import type { SampleBox, TemplateField } from "./types";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

type SampleViewerProps = {
  file: File | null;
  fields: TemplateField[];
  selectedId: string | null;
  onMap: (box: SampleBox) => void;
};

type Draft = { x: number; y: number; w: number; h: number };

export const SampleViewer = ({ file, fields, selectedId, onMap }: SampleViewerProps) => {
  const [url, setUrl] = useState("");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [draft, setDraft] = useState<Draft | null>(null);
  const draftRef = useRef<Draft | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const layer = useRef<HTMLDivElement>(null);
  const isPdf = file?.type === "application/pdf" || file?.name.toLowerCase().endsWith(".pdf");
  const isImage = Boolean(file && !isPdf && file.type.startsWith("image/"));

  useEffect(() => {
    if (!file) {
      setUrl("");
      return;
    }
    const next = URL.createObjectURL(file);
    setUrl(next);
    setPage(1);
    return () => URL.revokeObjectURL(next);
  }, [file]);

  const showDraft = (next: Draft | null) => {
    draftRef.current = next;
    setDraft(next);
  };

  const point = (event: ReactPointerEvent<HTMLDivElement>) => {
    const bounds = layer.current?.getBoundingClientRect();
    if (!bounds || bounds.width === 0 || bounds.height === 0) return null;
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * 100,
      y: ((event.clientY - bounds.top) / bounds.height) * 100,
    };
  };

  const boxes = fields.filter((field) => field.sampleBox?.page === page && field.sampleBox.w > 0);

  return (
    <div className="tm-viewer">
      {!file && <p className="tm-note">No sample yet.</p>}
      {file && !isPdf && !isImage && <p className="tm-note">Mapping is available for PDF and image samples.</p>}
      {url && (isPdf || isImage) && (
        <div className="tm-stage">
          <div className="tm-page">
            {isPdf ? (
              <Document file={url} onLoadSuccess={({ numPages }) => setPages(numPages)}>
                <Page pageNumber={page} width={640} renderAnnotationLayer renderTextLayer />
              </Document>
            ) : (
              <img src={url} alt="" style={{ width: 640, display: "block" }} />
            )}
            <div
              className="tm-draw"
              ref={layer}
              onPointerDown={(event) => {
                if (!selectedId) return;
                const start = point(event);
                if (!start) return;
                origin.current = start;
                showDraft({ x: start.x, y: start.y, w: 0, h: 0 });
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                const start = origin.current;
                const current = point(event);
                if (!start || !current) return;
                showDraft({
                  x: Math.min(start.x, current.x),
                  y: Math.min(start.y, current.y),
                  w: Math.abs(current.x - start.x),
                  h: Math.abs(current.y - start.y),
                });
              }}
              onPointerUp={() => {
                const drawn = draftRef.current;
                origin.current = null;
                showDraft(null);
                if (!drawn || drawn.w < 0.8 || drawn.h < 0.8) return;
                onMap({ page, ...drawn });
              }}
            >
              {boxes.map((field) => (
                <div
                  key={field.id}
                  className={field.id === selectedId ? "tm-box selected" : "tm-box"}
                  style={{
                    left: `${field.sampleBox?.x ?? 0}%`,
                    top: `${field.sampleBox?.y ?? 0}%`,
                    width: `${field.sampleBox?.w ?? 0}%`,
                    height: `${field.sampleBox?.h ?? 0}%`,
                  }}
                >
                  {field.id === selectedId && <span>{field.name}</span>}
                </div>
              ))}
              {draft && (
                <div
                  className="tm-draft"
                  style={{ left: `${draft.x}%`, top: `${draft.y}%`, width: `${draft.w}%`, height: `${draft.h}%` }}
                />
              )}
            </div>
          </div>
        </div>
      )}
      {isPdf && pages > 1 && (
        <div className="tm-pager">
          <button type="button" className="tm-btn" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>
            Previous page
          </button>
          <span>
            Page {page} of {pages}
          </span>
          <button
            type="button"
            className="tm-btn"
            disabled={page >= pages}
            onClick={() => setPage((current) => current + 1)}
          >
            Next page
          </button>
        </div>
      )}
    </div>
  );
};
