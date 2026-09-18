import { FileCheck2, FileWarning, UploadCloud } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { API_URL, apiGet, apiUpload } from "../../api";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { useMockDocuments } from "../mvp/useMvpData";
import type { ApiDocument } from "../mvp/useMvpData";

const ACCEPTED_EXTENSIONS = [".pdf", ".jpg", ".jpeg", ".png", ".xlsx", ".xls", ".csv"];

function formatKind(type: string): string {
  if (type.includes("pdf")) return "PDF";
  if (type.includes("spreadsheet") || type.includes("excel")) return "Excel";
  if (type.startsWith("image/")) return "Photo";
  return type;
}

function statusBadge(status: ApiDocument["status"]) {
  if (status === "done") return <Badge variant="success">Traité</Badge>;
  if (status === "non_traite") return <Badge variant="danger">Non traité</Badge>;
  if (status === "processing") return <Badge variant="warning">En cours</Badge>;
  return <Badge variant="secondary">En file</Badge>;
}

export function UploadTracking() {
  const inputRef = useRef<HTMLInputElement>(null);
  const { data: documents = [], refetch } = useMockDocuments();
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const source = new EventSource(`${API_URL}/api/progress`);
    source.addEventListener("ingestion", () => void refetch());
    return () => source.close();
  }, [refetch]);

  async function upload(files: FileList | File[]): Promise<void> {
    const accepted = Array.from(files).filter((file) =>
      ACCEPTED_EXTENSIONS.some((extension) => file.name.toLowerCase().endsWith(extension))
    );
    if (accepted.length === 0) {
      setError("Aucun fichier accepté. Utilisez PDF, image, Excel ou CSV.");
      return;
    }

    setError(null);
    setIsUploading(true);
    const formData = new FormData();
    accepted.forEach((file) => formData.append("files", file, file.name));

    try {
      await apiUpload("/api/upload", formData);
      await refetch();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Échec de l'upload.");
    } finally {
      setIsUploading(false);
    }
  }

  const processed = documents.filter((document) => document.status === "done").length;
  const humanQueue = documents.filter((document) => document.status === "non_traite").length;

  return (
    <section className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">EX-01 · EX-08</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Upload & tracking</h1>
          <p className="mt-2 max-w-2xl text-slate-600">Les statuts proviennent de PostgreSQL et du flux de progression réel.</p>
        </div>
        <div className="text-sm text-slate-600">{processed}/{documents.length} traités · {humanQueue} en file humaine</div>
      </header>

      {error ? <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p> : null}

      <Card>
        <CardContent className="p-0">
          <div
            className={`m-5 rounded-lg border-2 border-dashed p-8 text-center transition-colors ${isDragging ? "border-blue-500 bg-blue-50" : "border-slate-300 bg-slate-50"}`}
            onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(event) => { event.preventDefault(); setIsDragging(false); void upload(event.dataTransfer.files); }}
          >
            <UploadCloud className="mx-auto h-10 w-10 text-blue-600" aria-hidden="true" />
            <h2 className="mt-3 font-semibold text-slate-900">Déposer un lot réel</h2>
            <p className="mt-1 text-sm text-slate-500">PDF, photos, Excel et CSV · traitement BullMQ</p>
            <input ref={inputRef} className="sr-only" type="file" multiple accept={ACCEPTED_EXTENSIONS.join(",")} onChange={(event) => void upload(event.target.files ?? [])} />
            <Button className="mt-5" type="button" disabled={isUploading} onClick={() => inputRef.current?.click()}>
              {isUploading ? "Upload en cours..." : "Choisir des fichiers"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><div className="flex items-center justify-between gap-4"><CardTitle>Suivi du lot réel</CardTitle><Badge variant="secondary">{documents.length} documents</Badge></div></CardHeader>
        <CardContent className="space-y-3">
          {documents.length === 0 ? <p className="text-sm text-slate-500">Aucun document en base.</p> : documents.map((document) => {
            const progress = document.status === "done" || document.status === "non_traite" ? 100 : document.status === "processing" ? 50 : 0;
            return <article key={document.id} className="rounded-lg border border-slate-200 p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex min-w-0 items-center gap-3">{document.status === "non_traite" ? <FileWarning className="h-5 w-5 shrink-0 text-red-600" aria-hidden="true" /> : <FileCheck2 className="h-5 w-5 shrink-0 text-slate-500" aria-hidden="true" />}<div className="min-w-0"><p className="truncate font-medium text-slate-900">{document.filename}</p><p className="text-sm text-slate-500">{formatKind(document.type)} · {new Date(document.created_at).toLocaleString("fr-MA")}</p></div></div><div className="flex items-center gap-3">{statusBadge(document.status)}<span className="w-12 text-right text-sm font-semibold text-slate-600">{progress}%</span></div></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${document.status === "non_traite" ? "bg-red-500" : "bg-blue-600"}`} style={{ width: `${progress}%` }} /></div>{document.status === "non_traite" ? <p className="mt-3 flex items-start gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800"><FileWarning className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{document.reason ?? "Motif indisponible"} · Document laissé dans la file humaine.</p> : null}</article>;
          })}
        </CardContent>
      </Card>
    </section>
  );
}
