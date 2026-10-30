import { useState } from "react";
import { extensionOf, FALLBACK_ACCEPT } from "./format";
import type { Job, ServerConfig } from "./types";

type UploadPanelProps = {
  config: ServerConfig | null;
  job: Job | null;
  uploading: boolean;
  uploadError: string;
  liveError: string;
  onFile: (file: File) => void;
};

export const UploadPanel = ({
  config,
  job,
  uploading,
  uploadError,
  liveError,
  onFile,
}: UploadPanelProps) => {
  const [dragOver, setDragOver] = useState(false);
  const [localError, setLocalError] = useState("");
  const accept = config?.accept ?? FALLBACK_ACCEPT;
  const maxUpload = config?.maxUploadMb ?? 25;
  const maxImage = config?.maxImageMb ?? 5;
  const busy = uploading || job?.status === "running";

  const take = (file: File | undefined) => {
    setLocalError("");
    if (!file) return;
    const ext = extensionOf(file.name);
    if (!accept.includes(ext)) {
      setLocalError("Use a PDF, Word, Excel, text, or image file.");
      return;
    }
    const image = [".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(ext);
    const limit = (image ? maxImage : maxUpload) * 1024 * 1024;
    if (file.size > limit) {
      setLocalError(
        image
          ? `Images must be ${maxImage} MB or smaller.`
          : `File is larger than ${maxUpload} MB.`,
      );
      return;
    }
    onFile(file);
  };

  const message = localError || uploadError || liveError;

  return (
    <div className="upload-tools">
      <form
        className={dragOver ? "drop drag" : "drop"}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(false);
          take(event.dataTransfer.files[0]);
        }}
      >
        <h2>Upload a customer file</h2>
        <p className="hint">
          PDF, Word, Excel, text, or an image. Documents up to {maxUpload} MB,
          images up to {maxImage} MB.
        </p>
        <label className="primary">
          {uploading ? "Uploading…" : job ? "Extract another file" : "Choose a file"}
          <input
            type="file"
            accept={accept.join(",")}
            disabled={uploading}
            onChange={(event) => {
              take(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </label>
      </form>

      <div className="upload-side">
      {job && (
        <section className="panel">
          <div className="panel-head">
            <h3>{job.fileName}</h3>
            <span className={`pill ${job.status}`}>{job.status}</span>
          </div>
          <p className="phase">{phaseText(job)}</p>
          <div
            className="bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={job.progress}
          >
            <span style={{ width: `${job.progress}%` }} />
          </div>
          <p className="percent">{job.progress}%</p>
          {job.status !== "error" && (
            <dl className="meta usage">
              <div>
                <dt>Line tokens</dt>
                <dd>
                  {job.usage.inputTokens.toLocaleString("en-US")} in ·{" "}
                  {job.usage.outputTokens.toLocaleString("en-US")} out ·{" "}
                  {usd(job.lineCostUsd)}
                </dd>
              </div>
              <div>
                <dt>Header tokens</dt>
                <dd>
                  {job.headerUsage.inputTokens.toLocaleString("en-US")} in ·{" "}
                  {job.headerUsage.outputTokens.toLocaleString("en-US")} out ·{" "}
                  {usd(job.headerCostUsd)}
                </dd>
              </div>
            </dl>
          )}
          {job.error && <p className="error-text">{job.error.message}</p>}
        </section>
      )}

      {message && !job?.error && (
        <p className="error-text stand" role="alert">
          {message}
        </p>
      )}
      {busy && <p className="hint wait">Leave this page open while the file is read.</p>}
      </div>
    </div>
  );
};

const phaseText = (job: Job) => {
  if (job.phase === "reading") return "Reading the file";
  if (job.phase === "lines") return "Extracting line items";
  if (job.phase === "header") return "Reading the document header";
  if (job.phase === "done") {
    const count = job.lines.length;
    return `${count} line${count === 1 ? "" : "s"} extracted`;
  }
  return "Extraction stopped";
};

const usd = (value: number) =>
  value.toLocaleString("en-US", { style: "currency", currency: "USD" });
