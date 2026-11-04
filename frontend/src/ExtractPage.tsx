import { useCallback, useEffect, useState } from "react";
import { Results } from "./Results";
import { apiUrl } from "./services/api";
import { getActiveTemplate } from "./templates/api";
import { rememberTemplate, type Template } from "./templates/types";
import type { Catalog, ServerConfig, StoredDocument } from "./types";
import { UploadPanel } from "./UploadPanel";
import { useJob } from "./useJob";

export const ExtractPage = () => {
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [documents, setDocuments] = useState<StoredDocument[]>([]);
  const [offline, setOffline] = useState(false);
  const [activeTemplate, setActiveTemplate] = useState<Template | null>(null);
  const { job, liveError } = useJob(jobId);

  const loadDocuments = useCallback(async () => {
    try {
      const response = await fetch(apiUrl("/documents"));
      if (!response.ok) return;
      const payload = (await response.json()) as { documents?: StoredDocument[] };
      setDocuments(payload.documents ?? []);
    } catch {
      // The upload page still works if the document list cannot be read.
    }
  }, []);

  useEffect(() => {
    document.title = "Extract · ExtractIQ";
  }, []);

  useEffect(() => {
    const prevent = (event: DragEvent) => event.preventDefault();
    window.addEventListener("dragover", prevent);
    window.addEventListener("drop", prevent);
    return () => {
      window.removeEventListener("dragover", prevent);
      window.removeEventListener("drop", prevent);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [configResponse, catalogResponse, active] = await Promise.all([
          fetch(apiUrl("/extract/config")),
          fetch(apiUrl("/extract/catalog")),
          getActiveTemplate().catch(() => null),
        ]);
        if (!configResponse.ok || !catalogResponse.ok) throw new Error("unavailable");
        if (!cancelled) {
          setConfig((await configResponse.json()) as ServerConfig);
          setCatalog((await catalogResponse.json()) as Catalog);
          if (active) rememberTemplate(active);
          setActiveTemplate(active);
          void loadDocuments();
          setOffline(false);
        }
      } catch {
        if (!cancelled) setOffline(true);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [loadDocuments]);

  const onFile = async (file: File) => {
    setUploadError("");
    if (!activeTemplate) {
      setUploadError("Set an active template under Templates before extracting.");
      return;
    }
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const fieldKey = (field: (typeof activeTemplate.fields)[number]) =>
        field.catalogKey?.trim() ||
        field.name
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_+|_+$/g, "");
      body.append(
        "template",
        JSON.stringify({
          name: activeTemplate.name,
          headerKeys: activeTemplate.fields
            .filter((field) => field.level === "header")
            .map(fieldKey)
            .filter(Boolean),
          lineKeys: activeTemplate.fields
            .filter((field) => field.level !== "header")
            .map(fieldKey)
            .filter(Boolean),
        }),
      );
      const response = await fetch(apiUrl("/extract"), { method: "POST", body });
      const payload = (await response.json().catch(() => null)) as {
        id?: string;
        error?: { message?: string };
      } | null;
      if (!response.ok || !payload?.id) {
        throw new Error(payload?.error?.message || "Upload failed.");
      }
      void loadDocuments();
      setJobId(payload.id);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <main className="upload-page">
      <header className="extract-page-head">
        <div>
          <h1>Extract</h1>
          <p>
            Upload a customer file. Header and line fields follow the active template
            {activeTemplate ? ` (${activeTemplate.name})` : ""}.
          </p>
        </div>
      </header>
      {offline && (
        <p className="banner">
          The extraction service is not running. Start the backend, then refresh.
        </p>
      )}
      <UploadPanel
        config={config}
        job={job}
        uploading={uploading}
        uploadError={uploadError}
        liveError={liveError}
        activeTemplateName={activeTemplate?.name ?? null}
        onFile={(file) => {
          void onFile(file);
        }}
      />
      {job && <Results catalog={catalog} job={job} documents={documents} />}
    </main>
  );
};
