import { useEffect, useMemo, useRef, useState } from "react";
import { API_URL, apiGet } from "../api";
import { ProgressBar } from "../components/ProgressBar";
import { StatsBar } from "../components/StatsBar";

type FileStatus = "queued" | "processing" | "done" | "non_traite";

type UploadFileState = {
  id: string;
  filename: string;
  size: number;
  status: FileStatus;
  reason?: string;
};

type UploadResponse = {
  queued: number;
  documents: Array<{
    documentId: string;
    filename: string;
    jobId?: string;
  }>;
};

type ProgressEvent = {
  documentId: string;
  filename: string;
  status: FileStatus;
  reason?: string;
};

type StatsResponse = {
  total_docs: number;
  processed: number;
  non_traite: number;
  match_rate: string;
  total_exposure_mad: string;
};

const ACCEPTED_EXTENSIONS = [".pdf", ".jpg", ".jpeg", ".png", ".xlsx"];
const MAX_FILES = 50;

function isAccepted(file: File): boolean {
  const name = file.name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((extension) => name.endsWith(extension));
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function Upload() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [files, setFiles] = useState<UploadFileState[]>([]);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const doneCount = files.filter((file) => file.status === "done").length;
  const nonTraiteCount = files.filter((file) => file.status === "non_traite").length;
  const finishedCount = doneCount + nonTraiteCount;
  const progress = files.length === 0 ? 0 : (finishedCount / files.length) * 100;
  const allDone = files.length > 0 && finishedCount === files.length;

  const summary = useMemo(() => {
    if (!allDone) {
      return null;
    }

    return `${doneCount}/${files.length} processed`;
  }, [allDone, doneCount, files.length]);

  useEffect(() => {
    const source = new EventSource(`${API_URL}/api/progress`);

    source.addEventListener("ingestion", (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as ProgressEvent;
      setFiles((current) =>
        current.map((file) =>
          file.id === payload.documentId || file.filename === payload.filename
            ? {
                ...file,
                id: payload.documentId,
                status: payload.status,
                reason: payload.reason
              }
            : file
        )
      );
    });

    source.onerror = () => {
      setError("Progress stream disconnected. The API may still be processing files.");
    };

    return () => {
      source.close();
    };
  }, []);

  useEffect(() => {
    if (!allDone) {
      return;
    }

    void apiGet<StatsResponse>("/api/stats")
      .then(setStats)
      .catch(() => setStats(null));
  }, [allDone]);

  async function upload(selectedFiles: File[]): Promise<void> {
    const accepted = selectedFiles.filter(isAccepted).slice(0, MAX_FILES);

    if (accepted.length === 0) {
      setError("Choose PDF, JPG, PNG or XLSX files.");
      return;
    }

    if (selectedFiles.length > MAX_FILES) {
      setError(`Only the first ${MAX_FILES} files were queued.`);
    } else {
      setError(null);
    }

    const optimisticFiles = accepted.map((file) => ({
      id: `${file.name}-${file.size}-${file.lastModified}`,
      filename: file.name,
      size: file.size,
      status: "queued" as const
    }));

    setFiles(optimisticFiles);
    setStats(null);
    setIsUploading(true);

    const form = new FormData();
    for (const file of accepted) {
      form.append("files", file, file.name);
    }

    try {
      const response = await fetch(`${API_URL}/api/upload`, {
        method: "POST",
        body: form
      });

      if (!response.ok) {
        throw new Error(`Upload failed with ${response.status}`);
      }

      const payload = (await response.json()) as UploadResponse;
      setFiles((current) =>
        current.map((file) => {
          const match = payload.documents.find((document) => document.filename === file.filename);
          return match ? { ...file, id: match.documentId, status: "queued" } : file;
        })
      );
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed.");
      setFiles((current) =>
        current.map((file) => ({
          ...file,
          status: "non_traite",
          reason: "upload_failed"
        }))
      );
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <section className="workspace">
      <div className="workspace__header">
        <div>
          <p className="eyebrow">T11 Upload batch</p>
          <h1>Ingestion documents</h1>
        </div>
        <div className="summary-strip">
          <span>{summary ?? "Waiting for files"}</span>
          <strong>{stats ? `${stats.match_rate}% match rate` : "0.00% match rate"}</strong>
        </div>
      </div>

      <StatsBar />

      <div
        className={`dropzone${isDragging ? " dropzone--active" : ""}`}
        onDragEnter={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          void upload(Array.from(event.dataTransfer.files));
        }}
      >
        <input
          ref={inputRef}
          className="sr-only"
          type="file"
          multiple
          accept=".pdf,.jpg,.jpeg,.png,.xlsx"
          onChange={(event) => void upload(Array.from(event.target.files ?? []))}
        />
        <button className="primary-button" type="button" onClick={() => inputRef.current?.click()}>
          Select files
        </button>
        <p>Drop up to 50 PDF, JPG, PNG or XLSX files.</p>
      </div>

      {error ? <p className="notice notice--danger">{error}</p> : null}

      <ProgressBar value={progress} label="Batch progress" />

      <div className="file-list">
        {files.length === 0 ? (
          <div className="empty-state">No files queued yet.</div>
        ) : (
          files.map((file) => (
            <article className={`file-row file-row--${file.status}`} key={file.id}>
              <div>
                <strong>{file.filename}</strong>
                <span>{formatSize(file.size)}</span>
              </div>
              <div className="file-row__status">
                <span>{isUploading && file.status === "queued" ? "queued" : file.status}</span>
                {file.reason ? <small>{file.reason}</small> : null}
              </div>
            </article>
          ))
        )}
      </div>

      {allDone ? (
        <div className="result-grid">
          <div>
            <span>Processed</span>
            <strong>{doneCount}</strong>
          </div>
          <div>
            <span>Non traite</span>
            <strong>{nonTraiteCount}</strong>
          </div>
          <div>
            <span>Match rate</span>
            <strong>{stats ? `${stats.match_rate}%` : "loading"}</strong>
          </div>
        </div>
      ) : null}
    </section>
  );
}
