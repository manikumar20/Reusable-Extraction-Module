import { useCallback, useEffect, useState } from "react";
import { Results } from "./Results";
import { Sidebar, type Page } from "./Sidebar";
import { TemplatePage } from "./TemplatePage";
import type { Catalog, ServerConfig } from "./types";
import { UploadPanel } from "./UploadPanel";
import { useJob } from "./useJob";

const pageFromHash = (): Page =>
  window.location.hash === "#template" ? "template" : "upload";

export const App = () => {
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [offline, setOffline] = useState(false);
  const [page, setPage] = useState<Page>(pageFromHash);
  const { job, liveError } = useJob(jobId);

  useEffect(() => {
    const sync = () => setPage(pageFromHash());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const openPage = (next: Page) => {
    const hash = next === "template" ? "#template" : "#upload";
    if (window.location.hash !== hash) window.location.hash = hash;
    setPage(next);
  };

  const loadCatalog = useCallback(async () => {
    try {
      const response = await fetch("/api/catalog");
      if (!response.ok) return;
      setCatalog((await response.json()) as Catalog);
      setOffline(false);
    } catch {
      // Keep the last catalog while the API restarts after a fields.ts edit.
    }
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
        const [configResponse, catalogResponse] = await Promise.all([
          fetch("/api/config"),
          fetch("/api/catalog"),
        ]);
        if (!configResponse.ok || !catalogResponse.ok) throw new Error("unavailable");
        const nextConfig = (await configResponse.json()) as ServerConfig;
        const nextCatalog = (await catalogResponse.json()) as Catalog;
        if (!cancelled) {
          setConfig(nextConfig);
          setCatalog(nextCatalog);
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
  }, []);

  useEffect(() => {
    if (page !== "template") return;
    void loadCatalog();
    const timer = window.setInterval(() => {
      void loadCatalog();
    }, 4000);
    window.addEventListener("focus", loadCatalog);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", loadCatalog);
    };
  }, [page, loadCatalog]);

  const onFile = async (file: File) => {
    setUploadError("");
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch("/api/jobs", { method: "POST", body });
      const payload = (await response.json().catch(() => null)) as {
        id?: string;
        error?: { message?: string };
      } | null;
      if (!response.ok || !payload?.id) {
        throw new Error(payload?.error?.message || "Upload failed.");
      }
      setJobId(payload.id);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="shell">
      <Sidebar page={page} onPage={openPage} />
      <div className="workspace">
        {offline && (
          <p className="banner">
            The extraction service is not running. Start the backend, then refresh.
          </p>
        )}

        {page === "template" ? (
          <TemplatePage catalog={catalog} />
        ) : (
          <main className="upload-page">
            <UploadPanel
              config={config}
              job={job}
              uploading={uploading}
              uploadError={uploadError}
              liveError={liveError}
              onFile={(file) => {
                void onFile(file);
              }}
            />
            <Results catalog={catalog} job={job} />
          </main>
        )}
      </div>
    </div>
  );
};
