import { FileCheck2, FileWarning, UploadCloud } from "lucide-react";
import { useRef, useState } from "react";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { useMockDocuments } from "../mvp/useMvpData";
import type { MockDocument } from "../mvp/mockData";

function statusBadge(document: MockDocument) {
  if (document.status === "done") return <Badge variant="success">Traité</Badge>;
  if (document.status === "non_traite") return <Badge variant="danger">Non traité</Badge>;
  if (document.status === "processing") return <Badge variant="warning">En cours</Badge>;
  return <Badge variant="secondary">En file</Badge>;
}

export function UploadTracking() {
  const inputRef = useRef<HTMLInputElement>(null);
  const { data: documents = [] } = useMockDocuments();
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);

  function acceptFiles(files: FileList | File[]) {
    setSelectedFiles(Array.from(files).map((file) => file.name));
  }

  const completed = documents.filter((document) => document.status === "done").length;
  const humanQueue = documents.filter((document) => document.status === "non_traite").length;

  return (
    <section className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">EX-01 · EX-08</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Upload & tracking</h1>
          <p className="mt-2 max-w-2xl text-slate-600">Déposez un lot hétérogène et suivez chaque document, y compris ceux qui nécessitent une intervention humaine.</p>
        </div>
        <div className="text-sm text-slate-600">{completed}/{documents.length} traités · {humanQueue} en file humaine</div>
      </header>

      <Card>
        <CardContent className="p-0">
          <div
            className={`m-5 rounded-lg border-2 border-dashed p-8 text-center transition-colors ${isDragging ? "border-blue-500 bg-blue-50" : "border-slate-300 bg-slate-50"}`}
            onDragEnter={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setIsDragging(false);
              acceptFiles(event.dataTransfer.files);
            }}
          >
            <UploadCloud className="mx-auto h-10 w-10 text-blue-600" aria-hidden="true" />
            <h2 className="mt-3 font-semibold text-slate-900">Déposer un lot de documents</h2>
            <p className="mt-1 text-sm text-slate-500">PDF, photos et Excel · jusqu'à 50 fichiers</p>
            <input
              ref={inputRef}
              className="sr-only"
              type="file"
              multiple
              accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls,.csv"
              onChange={(event) => acceptFiles(event.target.files ?? [])}
            />
            <Button className="mt-5" type="button" onClick={() => inputRef.current?.click()}>
              Choisir des fichiers
            </Button>
            {selectedFiles.length > 0 ? <p className="mt-3 text-sm text-blue-700">{selectedFiles.length} fichier(s) prêt(s) à être envoyé(s).</p> : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <CardTitle>Suivi du lot</CardTitle>
            <Badge variant="secondary">{documents.length} documents</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {documents.map((document) => (
            <article key={document.id} className="rounded-lg border border-slate-200 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  {document.status === "non_traite" ? <FileWarning className="h-5 w-5 shrink-0 text-red-600" aria-hidden="true" /> : <FileCheck2 className="h-5 w-5 shrink-0 text-slate-500" aria-hidden="true" />}
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-900">{document.filename}</p>
                    <p className="text-sm text-slate-500">{document.kind} · {document.size}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">{statusBadge(document)}<span className="w-12 text-right text-sm font-semibold text-slate-600">{document.progress}%</span></div>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${document.status === "non_traite" ? "bg-red-500" : "bg-blue-600"}`} style={{ width: `${document.progress}%` }} /></div>
              {document.reason ? <p className="mt-3 flex items-start gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800"><FileWarning className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{document.reason} · À traiter dans la file humaine.</p> : null}
            </article>
          ))}
        </CardContent>
      </Card>
    </section>
  );
}
