import { memo, type CSSProperties } from "react";
import { EXTRACTION_MAX_ATTEMPTS } from "@/services/extractionSlotQueue";
import {
  queueItemName,
  queueItemSizeLabel,
  type QueueItem,
} from "@/components/extract/queueUtils";

type QueueRowProps = {
  item: QueueItem;
  busy: boolean;
  selected: boolean;
  onToggleSelect: (itemId: string) => void;
  onExtract: (itemId: string) => void;
  onInspect: (itemId: string) => void;
  onRemove: (itemId: string) => void;
  style?: CSSProperties;
};

export const QueueRow = memo(function QueueRow({
  item,
  busy,
  selected,
  onToggleSelect,
  onExtract,
  onInspect,
  onRemove,
  style,
}: QueueRowProps) {
  const name = queueItemName(item);
  const sizeLabel = queueItemSizeLabel(item);
  const isBatch = item.kind === "batch" || Boolean(item.batchId);
  const compressed = Boolean(item.compressed || item.zipFileName);
  const metaParts = [
    sizeLabel,
    isBatch && item.fileCount ? `${item.fileCount} file${item.fileCount === 1 ? "" : "s"}` : "",
    compressed ? "Compressed" : "",
  ].filter(Boolean);

  return (
    <li className={`ingest-queue-row status-${item.status}${selected ? " selected" : ""}`} style={style}>
      <label className="ingest-queue-check">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(item.id)}
          aria-label={`Select ${name}`}
        />
      </label>

      <div className="ingest-queue-file">
        <div>
          <strong title={name}>{name}</strong>
          <span>{metaParts.join(" · ")}</span>
        </div>
      </div>

      <div className="ingest-queue-status">
        {item.status === "ready" && <span className="ingest-pill ready">Ready</span>}
        {item.status === "uploaded" && <span className="ingest-pill running">Queued</span>}
        {item.status === "running" && (
          <span className="ingest-pill running">
            {item.attempts && item.attempts > 1
              ? `Try ${item.attempts}/${EXTRACTION_MAX_ATTEMPTS}`
              : "Processing"}
          </span>
        )}
        {item.status === "done" && (
          <span className={`ingest-pill done${item.saved ? " saved" : ""}`}>
            {item.saved
              ? "Saved"
              : compressed
                ? "Complete"
                : `${item.fieldCount ?? 0} fields${
                    item.confidence != null ? ` · ${item.confidence}%` : ""
                  }`}
          </span>
        )}
        {item.status === "cancelled" && <span className="ingest-pill error">Cancelled</span>}
        {item.status === "error" && (
          <span className="ingest-pill error" title={item.message || "Failed"}>
            {item.permanentlyFailed
              ? item.message || "Failed after 3 attempts"
              : item.message || "Failed"}
          </span>
        )}
      </div>

      <div className="ingest-queue-actions">
        {item.status === "ready" && (item.file || item.stagedId || item.batchId) && (
          <button
            type="button"
            className="ingest-row-btn"
            disabled={busy}
            onClick={() => onExtract(item.id)}
          >
            Extract
          </button>
        )}
        {item.status === "done" && (!isBatch || item.documentId != null) && (
          <button type="button" className="ingest-row-btn ghost" onClick={() => onInspect(item.id)}>
            Inspect
          </button>
        )}
        {item.status !== "running" && item.status !== "uploaded" && (
          <button
            type="button"
            className="ingest-row-x"
            aria-label={`Remove ${name}`}
            onClick={() => onRemove(item.id)}
          >
            ×
          </button>
        )}
      </div>
    </li>
  );
});
