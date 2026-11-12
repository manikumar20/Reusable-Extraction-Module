import { useEffect, useState } from "react";
import { apiUrl } from "./services/api";
import type { Job } from "./types";

const readJob = (data: string): Job | null => {
  try {
    const parsed: unknown = JSON.parse(data);
    if (!parsed || typeof parsed !== "object" || !("id" in parsed)) return null;
    return parsed as Job;
  } catch {
    return null;
  }
};

export const useJob = (jobId: string | null) => {
  const [job, setJob] = useState<Job | null>(null);
  const [liveError, setLiveError] = useState("");

  useEffect(() => {
    if (!jobId) {
      setJob(null);
      setLiveError("");
      return;
    }

    let stopped = false;
    let poll = 0;
    const source = new EventSource(apiUrl(`/extract/${jobId}/events`));

    const apply = (next: Job) => {
      if (stopped || next.id !== jobId) return;
      setJob(next);
      setLiveError("");
      if (next.status !== "running") {
        stopped = true;
        source.close();
        window.clearInterval(poll);
      }
    };

    const pollJob = async () => {
      try {
        const response = await fetch(apiUrl(`/extract/${jobId}`));
        if (!response.ok) {
          if (response.status === 404) {
            setLiveError("Extraction result is no longer available. Open it from Documents.");
          }
          return;
        }
        const next = readJob(await response.text());
        if (next) apply(next);
      } catch {
        setLiveError("Cannot reach the extraction service.");
      }
    };

    // Load current snapshot immediately so Inspect Results has header/lines
    // even when the live stream has already finished.
    void pollJob();

    source.addEventListener("job", (event) => {
      const next = readJob((event as MessageEvent<string>).data);
      if (next) apply(next);
    });

    source.onerror = () => {
      if (stopped || poll) return;
      setLiveError("Live updates paused. Checking the job again.");
      poll = window.setInterval(() => {
        void pollJob();
      }, 2000);
      void pollJob();
    };

    return () => {
      stopped = true;
      source.close();
      window.clearInterval(poll);
    };
  }, [jobId]);

  return { job, liveError };
};
